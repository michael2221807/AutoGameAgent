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
import { isEdgeCurrentlyValid, type EngramEdge } from '../../memory/engram/knowledge-edge';
import type { EngramEntity } from '../../memory/engram/entity-builder';
import { loadEngramConfig } from '../../memory/engram/engram-config';
import { eventBus } from '../../core/event-bus';
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

export interface EdgeReviewDetail {
  edgeId: string;
  fact: string;
  reason: string;
}

export interface EdgeReviewResult {
  reviewed: number;
  invalidated: number;
  kept: number;
  invalidatedEdges: EdgeReviewDetail[];
  keptEdges: EdgeReviewDetail[];
}

export interface EntityEnrichResult {
  enriched: number;
  remaining: number;
  entityNames: string[];
}

export interface FieldRepairResult {
  success: boolean;
  attempts: number;
  remaining: FieldRepairReport;
  entityEnrichResult?: EntityEnrichResult;
  edgeReviewResult?: EdgeReviewResult;
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

    const maxAttempts = readMaxRetries() + 1;
    let attempts = 0;
    let success = report.total === 0;

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
    if (success && attempts > 0) {
      console.log(`[FieldRepair] All entities repaired in ${attempts} attempt(s)`);
    } else {
      console.warn(
        `[FieldRepair] ${report.total} entit(ies) still incomplete after ${attempts} attempt(s)`,
      );
    }

    const engramConfig = loadEngramConfig();

    // ── Entity enrichment — fill summaries for stub entities with _pendingEnrichment ──
    let entityEnrichResult: EntityEnrichResult | undefined;
    if (engramConfig.knowledgeEdgeMode === 'active') {
      try {
        entityEnrichResult = await this.runEntityEnrichment();
      } catch (err) {
        console.warn('[FieldRepair] Entity enrichment failed (non-blocking):', err);
      }
    }

    // ── Edge review — runs after field repair, triggered by v2PendingReview ──
    let edgeReviewResult: EdgeReviewResult | undefined;
    if (engramConfig.knowledgeEdgeMode === 'active') {
      try {
        edgeReviewResult = await this.runEdgeReview();
      } catch (err) {
        console.warn('[FieldRepair] Edge review failed (non-blocking):', err);
        eventBus.emit('ui:toast', {
          type: 'warning',
          message: '知识边审查失败（不影响本回合）',
          duration: 3000,
        });
      }
    }

    return { success, attempts, remaining: report, entityEnrichResult, edgeReviewResult };
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

  // ═══════════════════════════════════════════════════════════════
  //  Edge Review (Sprint D)
  // ═══════════════════════════════════════════════════════════════

  private async runEdgeReview(): Promise<EdgeReviewResult | undefined> {
    const engramPath = this.paths.engramMemory;
    const pending = this.stateManager.get<Array<{ newFact: string; oldEdgeId: string; similarity: number }>>(
      engramPath + '.meta.v2PendingReview',
    );
    if (!Array.isArray(pending) || pending.length === 0) return undefined;

    const v2Edges = this.stateManager.get<EngramEdge[]>(engramPath + '.v2Edges') ?? [];
    if (v2Edges.length === 0) return undefined;

    const edgeMap = new Map(v2Edges.map((e) => [e.id, e]));
    const matchedEdges: EngramEdge[] = [];
    const matchedPairs: Array<{ newFact: string; oldEdgeId: string; similarity: number }> = [];
    for (const pair of pending) {
      const edge = edgeMap.get(pair.oldEdgeId);
      if (edge && isEdgeCurrentlyValid(edge)) {
        matchedEdges.push(edge);
        matchedPairs.push(pair);
      }
    }
    if (matchedEdges.length === 0) return undefined;

    const reviewList = matchedPairs
      .map((p) => {
        const old = edgeMap.get(p.oldEdgeId)!;
        return `- 新事实「${p.newFact}」与旧边「${old.sourceEntity}→${old.targetEntity}: ${old.fact}」（相似度=${p.similarity.toFixed(2)}）`;
      })
      .join('\n');
    const edgeList = matchedEdges
      .map((e) => `- [${e.id}] ${e.sourceEntity}→${e.targetEntity}: ${e.fact}（第${e.lastSeenRound}轮）`)
      .join('\n');

    const edgeReviewPrompt = this.gamePack.prompts['edgeReview'];
    const promptTemplate = edgeReviewPrompt
      ? edgeReviewPrompt
        .replace('{{REVIEW_EDGES_LIST}}', reviewList)
        .replace('{{MATCHED_EDGES}}', edgeList)
      : this.buildDefaultEdgeReviewPrompt(reviewList, edgeList);

    const gameStateJson = this.buildGameStateJson();
    const memoryBlock = this.buildMemoryBlock();
    const chatHistory = this.loadChatHistory();

    const systemContent =
      `## 当前游戏状态\n\n\`\`\`json\n${gameStateJson}\n\`\`\`\n\n` +
      `## 记忆摘要\n\n${memoryBlock}`;

    const messages: AIMessage[] = [
      { role: 'system', content: systemContent },
      ...chatHistory,
      { role: 'user', content: promptTemplate },
    ];

    const generationId = `edgeReview_${Date.now()}`;
    emitPromptAssemblyDebug({
      flow: 'edgeReview',
      variables: { REVIEW_EDGES_LIST: reviewList, MATCHED_EDGES: edgeList },
      messages,
      messageSources: ['system_context', ...chatHistory.map(() => 'history'), 'edgeReview'],
      generationId,
    });

    const rawResponse = await this.aiService.generate({
      messages,
      usageType: 'field_repair',
    });

    emitPromptResponseDebug({
      flow: 'edgeReview',
      generationId,
      thinking: extractThinkingFromRaw(rawResponse),
      rawResponse,
    });

    const updates = this.parseEdgeUpdates(rawResponse);
    if (!updates) {
      console.warn('[EdgeReview] Failed to parse AI response — preserving pending pairs for retry');
      return undefined;
    }

    // AI responded successfully — clear pending regardless of whether any edges were invalidated
    this.stateManager.set(engramPath + '.meta.v2PendingReview', null, 'system');

    if (updates.length === 0) {
      console.log('[EdgeReview] No edge updates returned by AI');
      const allKept: EdgeReviewDetail[] = matchedEdges.map((e) => ({ edgeId: e.id, fact: e.fact, reason: '' }));
      return { reviewed: matchedEdges.length, invalidated: 0, kept: matchedEdges.length, invalidatedEdges: [], keptEdges: allKept };
    }

    const currentRound = this.stateManager.get<number>(this.paths.roundNumber) ?? 0;
    const clonedEdges = v2Edges.map((e) => ({ ...e }));
    const clonedMap = new Map(clonedEdges.map((e) => [e.id, e]));
    const invalidatedEdges: EdgeReviewDetail[] = [];
    const auditChanges: Array<{ path: string; action: 'set'; oldValue: unknown; newValue: unknown; timestamp: number }> = [];
    const processedIds = new Set<string>();

    for (const update of updates) {
      if (update.action !== 'invalidate') continue;
      const edge = clonedMap.get(update.edge_id);
      if (!edge || edge.invalidAtRound != null || edge.invalidatedAtRound != null) continue;

      edge.invalidatedAtRound = currentRound;
      edge.invalidAtRound = currentRound;
      edge.temporalStatus = 'historical';
      invalidatedEdges.push({ edgeId: edge.id, fact: edge.fact, reason: update.reason });
      processedIds.add(edge.id);
      auditChanges.push({
        path: `${engramPath}.v2Edges[id=${update.edge_id}].invalidAtRound`,
        action: 'set', oldValue: undefined, newValue: currentRound, timestamp: Date.now(),
      });
    }

    if (invalidatedEdges.length > 0) {
      this.stateManager.set(engramPath + '.v2Edges', clonedEdges, 'system');
      if (auditChanges.length > 0) {
        appendChangesToLastNarrative(this.stateManager, this.paths, 'edgeReview', auditChanges);
      }
      if (invalidatedEdges.length > 0) {
        console.log(`[EdgeReview] Invalidated ${invalidatedEdges.length} edge(s)`);
      }
    }

    const keptEdges: EdgeReviewDetail[] = matchedEdges
      .filter((e) => !processedIds.has(e.id))
      .map((e) => {
        const u = updates.find((up) => up.edge_id === e.id);
        return { edgeId: e.id, fact: e.fact, reason: u?.reason ?? '' };
      });

    return {
      reviewed: matchedEdges.length,
      invalidated: invalidatedEdges.length,
      kept: keptEdges.length,
      invalidatedEdges,
      keptEdges,
    };
  }

  private parseEdgeUpdates(raw: string): Array<{ edge_id: string; action: string; reason: string }> | null {
    try {
      // Strip thinking tags
      const cleaned = raw.replace(/<(?:think|thinking|reasoning|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|thought)>/gi, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace < 0 || lastBrace <= firstBrace) return null;
      const json = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      const updates = json.edge_updates;
      if (!Array.isArray(updates)) return null;
      return updates
        .filter((u): u is Record<string, unknown> => u != null && typeof u === 'object')
        .filter((u) => typeof u.edge_id === 'string' && typeof u.action === 'string')
        .map((u) => ({
          edge_id: (u.edge_id as string).trim().toLowerCase().replace(/^\[|\]$/g, ''),
          action: (u.action as string).trim(),
          reason: typeof u.reason === 'string' ? (u.reason as string).trim() : '',
        }));
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Entity Enrichment (Tier 2)
  // ═══════════════════════════════════════════════════════════════

  private async runEntityEnrichment(): Promise<EntityEnrichResult | undefined> {
    const engramPath = this.paths.engramMemory;
    const entities = this.stateManager.get<EngramEntity[]>(engramPath + '.entities') ?? [];
    const pending = entities.filter((e) => e._pendingEnrichment === true);
    if (pending.length === 0) return undefined;

    const nameList = pending.map((e) => `- ${e.name}`).join('\n');

    const enrichPrompt = this.gamePack.prompts['entityEnrich'];
    const promptTemplate = enrichPrompt
      ? enrichPrompt.replace('{{MISSING_ENTITIES}}', nameList)
      : this.buildDefaultEntityEnrichPrompt(nameList);

    const gameStateJson = this.buildGameStateJson();
    const memoryBlock = this.buildMemoryBlock();
    const chatHistory = this.loadChatHistory();

    const systemContent =
      `## 当前游戏状态\n\n\`\`\`json\n${gameStateJson}\n\`\`\`\n\n` +
      `## 记忆摘要\n\n${memoryBlock}`;

    const messages: AIMessage[] = [
      { role: 'system', content: systemContent },
      ...chatHistory,
      { role: 'user', content: promptTemplate },
    ];

    const generationId = `entityEnrich_${Date.now()}`;
    emitPromptAssemblyDebug({
      flow: 'entityEnrich',
      variables: { MISSING_ENTITIES: nameList },
      messages,
      messageSources: ['system_context', ...chatHistory.map(() => 'history'), 'entityEnrich'],
      generationId,
    });

    const rawResponse = await this.aiService.generate({
      messages,
      usageType: 'field_repair',
    });

    emitPromptResponseDebug({
      flow: 'entityEnrich',
      generationId,
      thinking: extractThinkingFromRaw(rawResponse),
      rawResponse,
    });

    const descriptions = this.parseEntityDescriptions(rawResponse);
    if (!descriptions || descriptions.length === 0) {
      console.log('[EntityEnrich] No descriptions returned by AI');
      return { enriched: 0, remaining: pending.length, entityNames: pending.map((e) => e.name) };
    }

    // Read-modify-write to avoid race with vectorizeAsync
    const currentEntities = this.stateManager.get<EngramEntity[]>(engramPath + '.entities') ?? [];
    const descMap = new Map(descriptions.map((d) => [d.name, d.summary]));
    let enriched = 0;

    const updated = currentEntities.map((e) => {
      if (!e._pendingEnrichment) return e;
      const summary = descMap.get(e.name);
      if (summary && summary.length > 0) {
        enriched++;
        const currentRound = this.stateManager.get<number>(this.paths.roundNumber) ?? 0;
        const { _pendingEnrichment: _, ...rest } = e;
        return { ...rest, summary, is_embedded: false, enrichedAtRound: currentRound };
      }
      return e;
    });

    if (enriched > 0) {
      this.stateManager.set(engramPath + '.entities', updated, 'system');
      console.log(`[EntityEnrich] Enriched ${enriched} entity(s) with descriptions`);
    }

    const remaining = pending.length - enriched;
    return { enriched, remaining, entityNames: descriptions.map((d) => d.name) };
  }

  private parseEntityDescriptions(raw: string): Array<{ name: string; summary: string }> | null {
    try {
      const cleaned = raw.replace(/<(?:think|thinking|reasoning|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|thought)>/gi, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace < 0 || lastBrace <= firstBrace) return null;
      const json = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
      const descs = json.entity_descriptions;
      if (!Array.isArray(descs)) return null;
      return descs
        .filter((d): d is Record<string, unknown> => d != null && typeof d === 'object')
        .filter((d) => typeof d.name === 'string' && typeof d.summary === 'string')
        .map((d) => ({ name: (d.name as string).trim(), summary: (d.summary as string).trim() }))
        .filter((d) => d.name && d.summary);
    } catch (err) {
      console.warn('[EntityEnrich] Failed to parse AI response:', err);
      return null;
    }
  }

  private buildDefaultEntityEnrichPrompt(nameList: string): string {
    return (
      `<实体描述补全任务>\n` +
      `以下实体出现在知识图谱的事实边中，但系统中缺少它们的描述。\n` +
      `请根据游戏状态和最近叙事，为每个实体提供一句简短描述。\n\n` +
      `${nameList}\n\n` +
      `输出格式：\n` +
      `{"entity_descriptions": [\n` +
      `  {"name": "实体名", "summary": "一句话描述"},\n` +
      `  ...\n` +
      `]}\n\n` +
      `要求：\n` +
      `- 每个实体都必须有 summary\n` +
      `- summary 必须贴合当前游戏世界观和叙事\n` +
      `- 直接输出 JSON，不要解释\n` +
      `</实体描述补全任务>`
    );
  }

  private buildDefaultEdgeReviewPrompt(reviewList: string, edgeList: string): string {
    return (
      `<知识边审查任务>\n` +
      `本回合 AI 标记了以下实体对的记忆可能需要更新：\n${reviewList}\n\n` +
      `以下是这些实体对之间的全部已有知识边：\n${edgeList}\n\n` +
      `请判断每条边的状态：\n` +
      `- "keep"：事实仍然成立\n` +
      `- "invalidate"：事实已不成立\n\n` +
      `输出格式：{"edge_updates": [{"edge_id": "...", "action": "keep|invalidate", "reason": "..."}]}\n` +
      `</知识边审查任务>`
    );
  }
}
