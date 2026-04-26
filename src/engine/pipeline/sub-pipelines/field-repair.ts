/**
 * FieldRepairPipeline — generic post-turn repair for any required field.
 *
 * Differs from `PrivacyProfileRepairPipeline` in two ways:
 *
 * 1. **Scope**: reads `rules/required-fields.json` from the pack and flags any
 *    missing field, not just 私密信息. This is what auto-populates
 *    `外貌描述` / `身材描写` / `衣着风格` on existing NPCs.
 *
 * 2. **Context**: reuses the main-round step-2 assembly (game state, memory,
 *    recent narrative history, core.md, splitGenContext) but swaps the
 *    `splitGenStep2` module for `fieldRepair`. When split-gen is disabled,
 *    the flow is still fully hydrated from the current state tree — the
 *    repair prompt always sees a complete picture.
 *
 * Privacy repair still runs as a separate specialist pass for its deep NSFW
 * 8-field contract; this generic pipeline handles all non-NSFW-deep cases.
 */
import type { StateManager } from '../../core/state-manager';
import type { CommandExecutor } from '../../core/command-executor';
import type { AIService } from '../../ai/ai-service';
import type { AIMessage } from '../../ai/types';
import type { ResponseParser } from '../../ai/response-parser';
import type { PromptAssembler } from '../../prompt/prompt-assembler';
import type { MemoryRetriever } from '../../memory/memory-retriever';
import type { GamePack } from '../../types';
import type { EnginePathConfig } from '../types';
import {
  emitPromptAssemblyDebug,
  emitPromptResponseDebug,
  extractThinkingFromRaw,
} from '../../core/prompt-debug';
import { appendChangesToLastNarrative } from '../../audit/audit-append';
import { loadShortTermInjectionSettings } from '../../memory/memory-manager';
import {
  findIncompleteFields,
  readRequiredFieldsConfig,
  formatMissingFieldsSummary,
  type FieldRepairReport,
} from '../../validators/field-completeness-validator';

/** Narrative history entry shape — mirrors the local type in context-assembly. */
interface NarrativeEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  _delta?: unknown[];
}

const MAX_RETRIES_KEY = 'aga_ai_settings';
const DEFAULT_MAX_RETRIES = 1;

function readMaxRetries(): number {
  try {
    const raw = localStorage.getItem(MAX_RETRIES_KEY);
    if (!raw) return DEFAULT_MAX_RETRIES;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed['fieldRepairRetries'];
    if (typeof v === 'number' && v >= 0 && v <= 5) return Math.floor(v);
    return DEFAULT_MAX_RETRIES;
  } catch {
    return DEFAULT_MAX_RETRIES;
  }
}

export interface FieldRepairResult {
  success: boolean;
  attempts: number;
  remaining: FieldRepairReport;
}

export class FieldRepairPipeline {
  constructor(
    private stateManager: StateManager,
    private commandExecutor: CommandExecutor,
    private aiService: AIService,
    private responseParser: ResponseParser,
    private promptAssembler: PromptAssembler,
    private memoryRetriever: MemoryRetriever | null,
    private gamePack: GamePack,
    private paths: EnginePathConfig,
  ) {}

  async execute(): Promise<FieldRepairResult> {
    const config = readRequiredFieldsConfig(this.gamePack.rules);
    const nsfwMode = this.stateManager.get<boolean>('系统.nsfwMode') === true;

    let report = findIncompleteFields(this.stateManager, this.paths, config, { nsfwMode });
    if (report.total === 0) {
      return { success: true, attempts: 0, remaining: report };
    }

    const maxAttempts = readMaxRetries() + 1;
    let attempts = 0;
    let success = false;

    while (report.total > 0 && attempts < maxAttempts) {
      attempts += 1;
      try {
        await this.runOneAttempt(report, attempts);
      } catch (err) {
        console.error(`[FieldRepair] Attempt ${attempts} failed:`, err);
        break;
      }
      report = findIncompleteFields(this.stateManager, this.paths, config, { nsfwMode });
    }

    success = report.total === 0;
    if (success) {
      console.log(`[FieldRepair] All entities repaired in ${attempts} attempt(s)`);
    } else {
      console.warn(
        `[FieldRepair] ${report.total} entit(ies) still incomplete after ${attempts} attempt(s)`,
      );
    }

    return { success, attempts, remaining: report };
  }

  /**
   * One repair iteration — rebuild step-2 context from current state, swap in
   * the fieldRepair prompt, call AI, execute commands, audit-append.
   */
  private async runOneAttempt(report: FieldRepairReport, attempt: number): Promise<void> {
    const flow = this.gamePack.promptFlows['fieldRepair'];
    if (!flow) {
      console.warn('[FieldRepair] No "fieldRepair" prompt flow in pack — skipping');
      return;
    }

    const variables = this.buildVariables(report);
    const chatHistory = this.loadChatHistory();
    const assembled = this.promptAssembler.assemble(flow, variables, chatHistory);

    // Same enforcement pattern as PrivacyProfileRepairPipeline — append a user
    // message with completeness + no-truncation rules, so the conversation
    // ends on a user turn (Claude's preferred format for command output).
    const enforcement = this.promptAssembler.renderSingle('narratorEnforcement', variables);
    const finalUserContent =
      (enforcement ? `${enforcement}\n\n` : '') +
      `<字段补齐任务>\n` +
      `请立即输出 commands JSON 补齐下列缺失字段。要求：\n` +
      `1. **完整性**：${report.entities.length} 个实体的全部缺失字段必须补齐，不得遗漏。\n` +
      `2. **只补不改**：仅修改缺失字段对应的 path；其他字段保持不动。\n` +
      `3. **贴合世界**：每条 value 必须与 GAME_STATE_JSON / 记忆摘要 / 最近叙事一致，禁止编造冲突设定。\n` +
      `4. **不截断**：即使需要输出大量 commands，也要完整输出，禁止 "(略)" / "(后续类似)" 敷衍。\n` +
      `5. **直接 JSON**：一个合法 JSON 对象，只含 commands 数组；不要 text/memory/action_options/代码围栏/解释/思维链。\n` +
      `</字段补齐任务>\n\n` +
      `缺失清单（重复一次以便对齐）：\n${variables.MISSING_FIELDS_SUMMARY}\n\n` +
      `现在请输出 commands JSON。`;

    const finalMessages: AIMessage[] = [
      ...assembled.messages,
      { role: 'user', content: finalUserContent },
    ];
    const finalSources = [...assembled.messageSources, 'current_input'];
    const generationId = `fieldRepair_${attempt}_${Date.now()}`;

    emitPromptAssemblyDebug({
      flow: `fieldRepair#${attempt}`,
      variables,
      messages: finalMessages,
      messageSources: finalSources,
      generationId,
    });

    const rawResponse = await this.aiService.generate({
      messages: finalMessages,
      usageType: 'field_repair',
    });

    emitPromptResponseDebug({
      flow: `fieldRepair#${attempt}`,
      generationId,
      thinking: extractThinkingFromRaw(rawResponse),
      rawResponse,
    });

    const parsed = this.responseParser.parse(rawResponse);
    if (!parsed.commands || parsed.commands.length === 0) {
      console.warn(`[FieldRepair] Attempt ${attempt}: AI returned no commands`);
      return;
    }

    const result = this.commandExecutor.executeBatch(parsed.commands);
    console.log(
      `[FieldRepair] Attempt ${attempt}: applied ${parsed.commands.length} commands ` +
      `(${result.hasErrors ? 'some errors' : 'all ok'})`,
    );
    appendChangesToLastNarrative(
      this.stateManager,
      this.paths,
      'fieldRepair',
      result.changeLog.changes,
    );
  }

  /**
   * Build the same variable bag used by step-2 context-assembly, plus the
   * repair-specific `MISSING_FIELDS_SUMMARY`. We intentionally skip CoT /
   * Engram plugin vars — the repair prompt doesn't reference them.
   */
  private buildVariables(report: FieldRepairReport): Record<string, string> {
    const gameStateJson = this.buildGameStateJson();
    const memoryBlock = this.buildMemoryBlock();
    return {
      PLAYER_NAME: this.stateManager.get<string>(this.paths.playerName) ?? '',
      CURRENT_LOCATION: this.stateManager.get<string>(this.paths.playerLocation) ?? '',
      GAME_STATE_JSON: gameStateJson,
      MEMORY_BLOCK: memoryBlock,
      USER_INPUT: '',
      MISSING_FIELDS_SUMMARY: formatMissingFieldsSummary(report),
    };
  }

  /** Snapshot the state tree as formatted JSON for the repair prompt. */
  private buildGameStateJson(): string {
    try {
      return JSON.stringify(this.stateManager.getTree(), null, 2);
    } catch {
      return '{}';
    }
  }

  /**
   * Minimal memory block — prefers MemoryRetriever when available; otherwise
   * falls back to a short summary from 记忆.短期 to keep the repair prompt
   * grounded without re-implementing the full retrieval stage.
   */
  private buildMemoryBlock(): string {
    if (this.memoryRetriever) {
      try {
        const retrieved = this.memoryRetriever.retrieve(this.stateManager);
        if (retrieved && retrieved.trim()) return retrieved;
      } catch {
        // swallow — fall through to short-term fallback
      }
    }
    const shortTerm = this.stateManager.get<unknown[]>('记忆.短期') ?? [];
    if (!Array.isArray(shortTerm) || shortTerm.length === 0) return '（暂无短期记忆）';
    return shortTerm
      .slice(-8)
      .map((m) => {
        if (typeof m === 'string') return `- ${m}`;
        if (m && typeof m === 'object') {
          const content = (m as Record<string, unknown>)['内容'] ?? (m as Record<string, unknown>)['content'];
          return typeof content === 'string' ? `- ${content}` : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Load the last few-shot pairs from narrative history, wrapped with the
   * same XML tags `context-assembly` uses, so the AI sees a coherent format.
   */
  private loadChatHistory(): AIMessage[] {
    const narrativeHistory = this.stateManager.get<NarrativeEntry[]>(this.paths.narrativeHistory);
    if (!Array.isArray(narrativeHistory) || narrativeHistory.length === 0) return [];

    const injection = loadShortTermInjectionSettings();
    if (injection.injectionStyle === 'single_assistant_block') return [];

    const keepCount = injection.fewShotPairs * 2;
    const tail = narrativeHistory.slice(-keepCount);
    return tail.map((m): AIMessage => {
      const role = m.role as AIMessage['role'];
      let wrapped = m.content ?? '';
      if (role === 'user') wrapped = `<玩家输入>\n${wrapped}\n</玩家输入>`;
      else if (role === 'assistant') wrapped = `<叙事正文>\n${wrapped}\n</叙事正文>`;
      return { role, content: wrapped };
    });
  }
}
