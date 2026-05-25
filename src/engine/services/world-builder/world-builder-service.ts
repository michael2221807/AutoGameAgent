// App doc: docs/user-guide/pages/game-assistant.md §10
/**
 * WorldBuilderService — Story 3 "batch/complex" channel (D3 dual-engineering)
 *
 * Independent from AssistantService, focused on batch world-building tasks:
 * - Region generation (locations + NPCs + items)
 * - Batch NPC generation
 * - Free-text → structured data extraction
 *
 * Shares PayloadValidator/ConversationStore with AssistantService.
 * Does not reuse PipelineRunner (only AICall subset needed, see plan §3.2.1).
 */
import type { AIService } from '../../ai/ai-service';
import type { StateManager } from '../../core/state-manager';
import type { EngramManager } from '../../memory/engram/engram-manager';
import type { GamePack } from '../../types';
import type {
  ConversationStore,
  WorldBuilderTask,
  WorldBuilderResult,
  ProgressPayload,
} from '../assistant/types';
import { generateAssistantMessageId } from '../assistant/types';
import { parseAssistantPayload } from '../assistant/payload-parser';
import { PayloadValidator } from '../assistant/payload-validator';
import { appendMessageWithFifoTrim } from '../assistant/conversation-store';

import type { AssistantMessage, PayloadDraft } from '../assistant/types';

export interface WorldBuilderLabels {
  messagePrefix: string;
  errorPrefix: string;
  noDataFallback: string;
}

const DEFAULT_LABELS: WorldBuilderLabels = {
  messagePrefix: '[World Builder]',
  errorPrefix: 'World build failed:',
  noDataFallback: 'AI produced no usable data. Adjust your instruction and retry.',
};

export interface WorldBuilderDeps {
  aiService: AIService;
  stateManager: StateManager;
  gamePack: GamePack | null;
  payloadValidator: PayloadValidator;
  engramManager?: EngramManager;
  conversationStore: ConversationStore;
  locale?: string;
  maxHistoryTurns?: number;
  labels?: WorldBuilderLabels;
}

export interface WorldBuilderPaths {
  relationships: string;
  locations: string;
  worldDescription: string;
  inventory: string;
  /** Field names within NPC/location records to include in compressed context */
  npcSummaryFields: string[];
  locationSummaryFields: string[];
  /** Field name used as "name" key in inventory items (for item name extraction) */
  itemNameField: string;
}

const NSFW_NPC_SECTION = `
   - **私密信息**（NSFW 模式已开启）— 必须作为一个名为 \`"私密信息"\` 的**嵌套对象**放在 NPC 档案中，格式如下：
     \`\`\`
     "私密信息": {
       "是否为处女/处男": true,
       "身体部位": [
         {"部位名称":"嘴","敏感度":40,"开发度":10,"特征描述":"50-120字具体形态/触感","特殊印记":""},
         {"部位名称":"胸部","敏感度":60,"开发度":20,"特征描述":"...","特殊印记":""},
         {"部位名称":"小穴","敏感度":50,"开发度":0,"特征描述":"...","特殊印记":""},
         {"部位名称":"屁穴","敏感度":30,"开发度":0,"特征描述":"...","特殊印记":""}
       ],
       "性格倾向":"...", "性取向":"...", "性癖好":["..."],
       "性渴望程度":30, "性交总次数":0, "性伴侣名单":[],
       "当前性状态":"...", "体液分泌状态":"...", "特殊体质":[]
     }
     \`\`\`
     ⚠ 私密信息字段**绝对不能**平铺在 NPC 根级！必须嵌套在 \`"私密信息": {...}\` 对象内。
     ⚠ 非处女/处男时追加必填：初夜夺取者/初夜时间/初夜描述(50-200字)
     ⚠ 处女=true → 性交总次数=0 且 性伴侣名单=[]
     ⚠ 所有数值字段（敏感度/开发度/性渴望程度/性交总次数）必须是 number 类型，禁止用字符串如"无法计算"
`;

const PROMPT_KEYS: Record<string, string> = {
  region: 'worldBuilderBatchRegion',
  npcs: 'worldBuilderBatchNpcs',
  'from-description': 'worldBuilderFromDescription',
};

export class WorldBuilderService {
  private isExecuting = false;

  private maxTurns: number;
  private labels: WorldBuilderLabels;

  constructor(private deps: WorldBuilderDeps) {
    this.maxTurns = deps.maxHistoryTurns ?? 5;
    this.labels = deps.labels ?? DEFAULT_LABELS;
  }

  /**
   * Whether a task is currently executing.
   * Note: this is a snapshot — do not use as a concurrency gate.
   * The authoritative guard is inside execute() itself.
   */
  get busy(): boolean {
    return this.isExecuting;
  }

  async execute(
    sessionId: string,
    task: WorldBuilderTask,
    paths: WorldBuilderPaths,
    onProgress?: (payload: ProgressPayload) => void,
  ): Promise<WorldBuilderResult> {
    if (this.isExecuting) {
      throw new Error('[WorldBuilderService] already executing a task');
    }
    this.isExecuting = true;

    try {
      return await this.doExecute(sessionId, task, paths, onProgress);
    } finally {
      this.isExecuting = false;
    }
  }

  private async doExecute(
    sessionId: string,
    task: WorldBuilderTask,
    paths: WorldBuilderPaths,
    onProgress?: (payload: ProgressPayload) => void,
  ): Promise<WorldBuilderResult> {
    // Step 1: Context Assembly
    onProgress?.({
      i18nKey: 'assistant.worldBuilder.progress.context',
      message: '[Context] Compressing world state...',
    });
    const worldContext = compressWorldContext(this.deps.stateManager, paths);

    // Step 2: Prompt Selection + Template Substitution
    onProgress?.({
      i18nKey: 'assistant.worldBuilder.progress.prompt',
      message: '[Prompt] Preparing prompt...',
    });
    const promptKey = PROMPT_KEYS[task.type];
    if (!promptKey) {
      return this.buildErrorResult(sessionId, task, `Unsupported task type: ${task.type}`);
    }
    const promptTemplate = this.deps.gamePack?.prompts?.[promptKey];
    if (!promptTemplate) {
      return this.buildErrorResult(sessionId, task, `Prompt "${promptKey}" not found in game pack`);
    }

    const npcCount = task.config?.npcCount ?? 5;
    const subLocCount = task.config?.subLocationCount ?? 3;
    const genItems = task.config?.generateItems !== false;
    const nsfwMode = this.deps.stateManager.get<boolean>('系统.nsfwMode') === true;
    const prompt = promptTemplate
      .replace(/\{EXISTING_WORLD_CONTEXT\}/g, worldContext)
      .replace(/\{USER_INSTRUCTION\}/g, task.userInstruction)
      .replace(/\{NPC_COUNT\}/g, String(npcCount))
      .replace(/\{SUB_LOCATION_COUNT\}/g, String(subLocCount))
      .replace(/\{GENERATE_ITEMS\}/g, genItems ? 'enabled — generate if thematically appropriate' : 'disabled — do NOT generate items')
      .replace(/\{ITEM_COUNT\}/g, String(task.config?.itemCount ?? 3))
      .replace(/\{\{NSFW_SECTION\}\}/g, nsfwMode ? NSFW_NPC_SECTION : '');

    // Step 3: AI Call (non-streaming — batch needs complete JSON)
    onProgress?.({
      i18nKey: 'assistant.worldBuilder.progress.generating',
      message: '[AI] Generating world data...',
    });

    let aiResponse: string;
    try {
      aiResponse = await this.deps.aiService.generate({
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Please generate the data as instructed above.' },
        ],
        stream: false,
        usageType: 'world_builder',
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return this.buildErrorResult(sessionId, task, errorMsg);
    }

    // Step 4: Response Parsing
    onProgress?.({
      i18nKey: 'assistant.worldBuilder.progress.parsing',
      message: '[Parse] Analyzing response...',
    });
    const parsed = parseAssistantPayload(aiResponse);
    if (!parsed || parsed.patches.length === 0) {
      return this.buildNoDataResult(sessionId, task, aiResponse);
    }

    // Step 5: Validation
    onProgress?.({
      i18nKey: 'assistant.worldBuilder.progress.validating',
      message: '[Validate] Checking patches...',
    });
    const validated = this.deps.payloadValidator.validate(parsed);
    const draft: PayloadDraft = {
      raw: parsed,
      validated,
      status: 'pending',
    };

    // Step 6: Conversation Integration
    const session = await this.deps.conversationStore.load(sessionId);

    const userMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'user',
      content: `${this.labels.messagePrefix} ${task.userInstruction}`,
      timestamp: Date.now(),
    };
    appendMessageWithFifoTrim(session, userMessage, this.maxTurns);

    const assistantMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'assistant',
      content: parsed.summary || aiResponse,
      timestamp: Date.now(),
      payloadDraft: draft,
    };
    appendMessageWithFifoTrim(session, assistantMessage, this.maxTurns);

    await this.deps.conversationStore.save(session);

    // Step 7: Return
    return {
      userMessage,
      assistantMessage,
      knowledgeFacts: parsed.knowledgeFacts,
    };
  }

  private async buildErrorResult(
    sessionId: string,
    task: WorldBuilderTask,
    errorMessage: string,
  ): Promise<WorldBuilderResult> {
    const session = await this.deps.conversationStore.load(sessionId);

    const userMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'user',
      content: `${this.labels.messagePrefix} ${task.userInstruction}`,
      timestamp: Date.now(),
    };
    appendMessageWithFifoTrim(session, userMessage, this.maxTurns);

    const systemMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'system',
      content: `${this.labels.errorPrefix} ${errorMessage}`,
      timestamp: Date.now(),
      systemKind: 'ai-error',
    };
    appendMessageWithFifoTrim(session, systemMessage, this.maxTurns);

    await this.deps.conversationStore.save(session);

    return {
      userMessage,
      assistantMessage: systemMessage,
    };
  }

  private async buildNoDataResult(
    sessionId: string,
    task: WorldBuilderTask,
    rawAiResponse: string,
  ): Promise<WorldBuilderResult> {
    const session = await this.deps.conversationStore.load(sessionId);

    const userMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'user',
      content: `${this.labels.messagePrefix} ${task.userInstruction}`,
      timestamp: Date.now(),
    };
    appendMessageWithFifoTrim(session, userMessage, this.maxTurns);

    const assistantMessage: AssistantMessage = {
      id: generateAssistantMessageId(),
      role: 'assistant',
      content: rawAiResponse || this.labels.noDataFallback,
      timestamp: Date.now(),
    };
    appendMessageWithFifoTrim(session, assistantMessage, this.maxTurns);

    await this.deps.conversationStore.save(session);

    return { userMessage, assistantMessage };
  }
}

/**
 * Compress world state for AI context — keeps only essential fields to reduce token count.
 * All field names come from the paths config to respect engine/content separation (CLAUDE.md §4).
 */
export function compressWorldContext(stateManager: StateManager, paths: WorldBuilderPaths): string {
  const npcs = stateManager.get<Array<Record<string, unknown>>>(paths.relationships) ?? [];
  const locations = stateManager.get<Array<Record<string, unknown>>>(paths.locations) ?? [];
  const worldDesc = stateManager.get<string>(paths.worldDescription) ?? '';
  const itemsObj = stateManager.get<Record<string, Record<string, unknown>>>(paths.inventory) ?? {};
  const nameField = paths.itemNameField;
  const itemNames = Object.values(itemsObj)
    .map(i => (typeof i[nameField] === 'string' ? i[nameField] as string : ''))
    .filter(Boolean);

  const npcSummary = npcs.map(n => pickFields(n, paths.npcSummaryFields));
  const locationSummary = locations.map(l => pickFields(l, paths.locationSummaryFields));

  return JSON.stringify({
    worldDescription: worldDesc,
    existingNPCs: npcSummary,
    existingLocations: locationSummary,
    existingItems: itemNames,
  }, null, 2);
}

function pickFields(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in record) result[f] = record[f];
  }
  return result;
}
