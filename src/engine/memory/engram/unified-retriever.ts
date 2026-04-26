/**
 * 统一检索器 — 混合检索：向量近邻 + 图遍历 + 语义三元组 + NPC 位置规则 + 可选重排
 *
 * E.2 升级：
 * - 完整评分公式（keyword × 0.45 + recency × 0.25 + context × 0.30）
 * - 向量分数混合（event × 0.72 + vector × 0.55，仅 embedding 启用时）
 * - semanticTripleCandidates()：从 系统.扩展.语义记忆.triples 取高 importance 三元组
 * - npcLocationRules()：当前地点 NPC 规则注入
 * - topK / minScore 由外部 EngramEmbeddingConfig 控制（非硬编码 20）
 *
 * 对应 STEP-03B M3.6 Engram 数据流（UnifiedRetriever 混合检索）。
 */
import type { StateManager } from '../../core/state-manager';
import type { VectorStore, VectorStoreData } from './vector-store';
import type { Embedder } from './embedder';
import type { Reranker, RerankCandidate } from './reranker';
import type { EngramEventNode } from './event-builder';
import type { EngramEntity } from './entity-builder';
import type { EngramRelation } from './relation-builder';
import type { EngramEmbeddingConfig, EngramRerankConfig } from './engram-types';

// ─── 类型定义 ───

/** 检索时的场景上下文 — 告诉检索器"当前在什么情境下" */
export interface RetrievalContext {
  /** 玩家名（用于图遍历起点和 boost） */
  playerName: string;
  /** 当前位置描述（用于位置相关的 boost） */
  locationDesc: string;
  /** 最近交互的 NPC 名单（用于图遍历起点） */
  recentNpcNames: string[];
  /** 输出的最大行数限制（预算控制） */
  maxLines: number;
}

/** 检索候选项 — 内部使用，最终转换为文本输出 */
interface RetrievalCandidate {
  /** 候选文本 */
  text: string;
  /** 综合得分（考虑了相似度、新鲜度、上下文相关度） */
  score: number;
  /** 来源（vector / graph），用于结果多样性控制 */
  source: 'vector' | 'graph';
  /** 关联的事件 ID（如果有） */
  eventId?: string;
  /** 关联的实体名（如果有） */
  entityName?: string;
}

/** Engram 状态数据结构（存储在状态树中的数据格式） */
interface EngramStateData {
  events?: EngramEventNode[];
  entities?: EngramEntity[];
  relations?: EngramRelation[];
  meta?: Record<string, unknown>;
}

/** 语义三元组（来自 系统.扩展.语义记忆.triples） */
interface SemanticTriple {
  subject: string;
  predicate: string;
  object: string;
  importance?: number;
  timestamp?: string;
}

/** NPC 关系条目（社交.关系 数组元素） */
interface NpcRelation {
  名称: string;
  位置?: string;
  描述?: string;
  [key: string]: unknown;
}

/** UnifiedRetriever 配置（来自 EngramConfig 的子集） */
export interface UnifiedRetrieverConfig {
  embedding: EngramEmbeddingConfig;
  rerank: EngramRerankConfig;
}

/**
 * 调试记录器接口 — 解耦 UnifiedRetriever 与 Pinia store
 *
 * 生产环境注入 useEngramDebugStore()，测试中可注入 mock。
 * 使用接口而非直接导入 engram-debug.ts，避免引擎层依赖 UI store。
 */
export interface IDebugRecorder {
  recordRetrieve(info: {
    vectorCandidateCount: number;
    graphCandidateCount: number;
    triplesCandidateCount: number;
    afterMergeCount: number;
    afterRerankCount: number;
    rerankUsed: boolean;
    embeddingFallback: boolean;
    topScores: Array<{ text: string; score: number; source: string }>;
  }): void;
}

export class UnifiedRetriever {
  constructor(
    private vectorStore: VectorStore,
    private embedder: Embedder,
    private reranker?: Reranker,
    private configOrGetter?: UnifiedRetrieverConfig | (() => UnifiedRetrieverConfig | undefined),
    private debugRecorder?: IDebugRecorder,
    private getActiveSlot?: () => { profileId: string; slotId: string } | null,
  ) {}

  /** 动态读取配置：支持静态对象或 getter 函数（每次调用都读最新值） */
  private get config(): UnifiedRetrieverConfig | undefined {
    if (typeof this.configOrGetter === 'function') return this.configOrGetter();
    return this.configOrGetter;
  }

  /**
   * 执行混合检索
   *
   * 将向量近邻、图遍历、语义三元组、NPC 位置规则的结果合并、
   * 去重、评分后返回格式化文本。
   */
  async retrieve(
    query: string,
    context: RetrievalContext,
    stateManager: StateManager,
  ): Promise<string> {
    const engramPath = '系统.扩展.engramMemory';
    const engram = stateManager.get<EngramStateData>(engramPath);
    if (!engram?.events?.length) return '';

    const events = engram.events;
    const entities = engram.entities ?? [];
    const relations = engram.relations ?? [];

    // 阶段1：向量近邻检索（embedding 启用时）—— 2026-04-14 扩展为 events + entities 双路
    const embeddingEnabled = this.config?.embedding?.enabled !== false;
    const vectorCandidates = embeddingEnabled
      ? await this.vectorSearch(query, events, stateManager, entities)
      : [];

    // 阶段2：图遍历检索
    const graphCandidates = this.graphTraversal(context, events, entities, relations);

    // 阶段3：语义三元组候选（E.2）
    const tripleCandidates = this.semanticTripleCandidates(query, stateManager);

    // 阶段4：NPC 位置规则（E.2）
    const npcCandidates = this.npcLocationRules(context, stateManager);

    // 合并所有候选并去重
    const merged = this.mergeCandidates(vectorCandidates, [
      ...graphCandidates,
      ...tripleCandidates,
      ...npcCandidates,
    ]);

    // 阶段5：可选重排序
    //
    // 2026-04-19 修复：以前直接把 `context.maxLines`（硬编码 20）当作 rerank
    // 的 topK 传下去，结果用户配的 `config.rerank.topN` 完全没被读 —— rerank
    // 永远返回 20 条，直接打脸"只留最相关 3 条"这种设置。
    //
    // 正确语义：
    //   - rerank 开启 → 目标是 `config.rerank.topN`（用户想要精炼的条数）
    //   - rerank 关闭 → 目标退回 `context.maxLines`（上层 prompt 预算上限）
    //   - 无论哪条路径，最终 slice 都再叠一层 `maxLines` 安全帽
    const rerankEnabled = this.config?.rerank.enabled === true && this.reranker != null;
    const rerankTarget = rerankEnabled
      ? Math.min(this.config?.rerank.topN ?? context.maxLines, context.maxLines)
      : context.maxLines;
    const ranked = await this.applyReranking(query, merged, rerankTarget);

    // E.6.2 — 仅注入了 debugRecorder 时记录检索快照（构造注入，避免动态 import 耦合 Pinia）
    this.debugRecorder?.recordRetrieve({
      vectorCandidateCount: vectorCandidates.length,
      graphCandidateCount: graphCandidates.length,
      triplesCandidateCount: tripleCandidates.length,
      afterMergeCount: merged.length,
      afterRerankCount: ranked.length,
      rerankUsed: !!this.reranker && merged.length > 0,
      embeddingFallback: embeddingEnabled && vectorCandidates.length === 0,
      topScores: ranked.slice(0, 5).map((c) => ({
        text: c.text.length > 80 ? c.text.slice(0, 80) + '…' : c.text,
        score: c.score,
        source: c.source,
      })),
    });

    // 格式化输出
    return this.formatResults(ranked, context.maxLines);
  }

  /**
   * 向量近邻检索（E.2 升级 + 2026-04-14 entity 向量扩展）
   *
   * **双路检索**：
   * 1. Event 向量：query → cosine(eventVectors) + keyword/recency/context boost
   * 2. Entity 向量（新增）：query → cosine(entityVectors)，text 用实体的 summary
   *    （`{name}: {description}` 或最新相关 event 的 summary）
   *
   * 评分公式（event 路径）：finalScore = eventScore × 0.72 + vectorScore × 0.55
   *   其中 eventScore = keywordMatch × 0.45 + recencyDecay × 0.25 + contextBoost × 0.30
   * 评分公式（entity 路径）：finalScore = vectorScore × 0.85 + nameMatch × 0.15
   *   直接以向量相似度为主，因为 entity 没有时间戳/叙事 context 可算。
   *
   * 旧版本只检索 eventVectors，永远不会命中 entity 的 description → name 这类纯实体 query
   * （如 "张三是谁"）。新版本两路并行。
   */
  private async vectorSearch(
    query: string,
    events: EngramEventNode[],
    _stateManager: StateManager,
    entities: EngramEntity[] = [],
  ): Promise<RetrievalCandidate[]> {
    let vectorData: VectorStoreData | undefined;

    try {
      const slot = this.getActiveSlot?.();
      if (slot?.profileId && slot?.slotId) {
        vectorData = await this.vectorStore.load(slot.profileId, slot.slotId);
      }
    } catch {
      return [];
    }

    const hasEventVectors = vectorData && Object.keys(vectorData.eventVectors).length > 0;
    const hasEntityVectors = vectorData && Object.keys(vectorData.entityVectors).length > 0;
    if (!vectorData || (!hasEventVectors && !hasEntityVectors)) {
      return [];
    }

    let queryVector: number[];
    try {
      const vectors = await this.embedder.embed([query]);
      queryVector = vectors[0];
      if (!queryVector || queryVector.length === 0) return [];
    } catch {
      return [];
    }

    const topK = this.config?.embedding?.topK ?? 20;
    const minScore = this.config?.embedding?.minScore ?? 0.3;

    const scored: RetrievalCandidate[] = [];

    // ── Path 1: Event vectors ──
    if (hasEventVectors) {
      for (const event of events) {
        const eventVector = vectorData.eventVectors[event.id];
        if (!eventVector) continue;

        const vectorScore = this.vectorStore.cosineSimilarity(queryVector, eventVector);
        const kwScore = this.keywordMatch(query, event.text);
        const recency = this.recencyDecay(event.roundNumber);
        const ctxBoost = this.contextBoost(query, event);

        const eventScore = kwScore * 0.45 + recency * 0.25 + ctxBoost * 0.30;
        const finalScore = eventScore * 0.72 + vectorScore * 0.55;

        if (finalScore >= minScore) {
          // 优先使用 summary（含元数据），回退到 text
          const emitText = typeof event.summary === 'string' && event.summary.trim().length > 0
            ? event.summary
            : event.text;
          scored.push({
            text: emitText,
            score: finalScore,
            source: 'vector',
            eventId: event.id,
          });
        }
      }
    }

    // ── Path 2: Entity vectors（2026-04-14 新增） ──
    if (hasEntityVectors && entities.length > 0) {
      for (const entity of entities) {
        const entityVector = vectorData.entityVectors[entity.name];
        if (!entityVector) continue;

        const vectorScore = this.vectorStore.cosineSimilarity(queryVector, entityVector);
        // name match boost：query 包含 entity name 直接拉高
        const nameMatch = query.includes(entity.name) ? 1.0 : 0.0;
        const finalScore = vectorScore * 0.85 + nameMatch * 0.15;

        if (finalScore >= minScore) {
          const text = entity.description
            ? `${entity.name}: ${entity.description}`
            : entity.name;
          scored.push({
            text,
            score: finalScore,
            source: 'vector',
            entityName: entity.name,
          });
        }
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * 图遍历检索
   *
   * BFS 从玩家 + 最近 NPC 出发，最大 2 跳，收集相关事件。
   * 得分 = 关系权重 × 距离衰减（1/depth）。
   */
  private graphTraversal(
    context: RetrievalContext,
    events: EngramEventNode[],
    _entities: EngramEntity[],
    relations: EngramRelation[],
  ): RetrievalCandidate[] {
    const startNames = new Set<string>([
      context.playerName,
      ...context.recentNpcNames,
    ]);

    const visited = new Set<string>();
    const entityScores = new Map<string, number>();

    let frontier = Array.from(startNames);
    for (const name of frontier) {
      entityScores.set(name, 1.0);
      visited.add(name);
    }

    for (let depth = 1; depth <= 2; depth++) {
      const nextFrontier: string[] = [];
      const depthDecay = 1 / (depth + 1);

      for (const currentName of frontier) {
        for (const rel of relations) {
          let neighbor: string | undefined;
          if (rel.fromName === currentName && !visited.has(rel.toName)) {
            neighbor = rel.toName;
          } else if (rel.toName === currentName && !visited.has(rel.fromName)) {
            neighbor = rel.fromName;
          }

          if (neighbor) {
            visited.add(neighbor);
            nextFrontier.push(neighbor);
            const score = rel.weight * depthDecay;
            entityScores.set(
              neighbor,
              Math.max(entityScores.get(neighbor) ?? 0, score),
            );
          }
        }
      }

      frontier = nextFrontier;
    }

    const candidates: RetrievalCandidate[] = [];
    for (const event of events) {
      const subjectScore = entityScores.get(event.subject) ?? 0;
      const objectScore = event.object ? (entityScores.get(event.object) ?? 0) : 0;
      const maxScore = Math.max(subjectScore, objectScore);

      if (maxScore > 0) {
        candidates.push({
          text: event.text,
          score: maxScore,
          source: 'graph',
          eventId: event.id,
        });
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  /**
   * 语义三元组候选（E.2 新增）
   *
   * 从 系统.扩展.语义记忆.triples 读取高 importance 三元组，
   * 将其格式化为候选文本，按关键词匹配 + importance + 时间衰减评分。
   */
  private semanticTripleCandidates(
    query: string,
    stateManager: StateManager,
  ): RetrievalCandidate[] {
    const triples = stateManager.get<SemanticTriple[]>('系统.扩展.语义记忆.triples') ?? [];

    return triples
      .filter((t) => t && t.subject && t.predicate && t.object)
      .map((t) => {
        const text = `${t.subject} ${t.predicate} ${t.object}`;
        const kwScore  = this.keywordMatch(query, text);
        const impScore = ((t.importance ?? 5) / 10) * 0.15;
        const recency  = this.recencyDecayFromTimestamp(t.timestamp) * 0.05;
        return {
          text,
          score: kwScore * 0.5 + impScore + recency,
          source: 'graph' as const,
        };
      })
      .filter((c) => c.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  /**
   * NPC 位置规则候选（E.2 新增）
   *
   * 检查当前地点的 NPC（社交.关系 数组），
   * 将与当前位置匹配的 NPC 注入候选集，提高地点相关记忆的优先级。
   */
  private npcLocationRules(
    context: RetrievalContext,
    stateManager: StateManager,
  ): RetrievalCandidate[] {
    const currentLoc = context.locationDesc;
    if (!currentLoc) return [];

    const npcs = stateManager.get<NpcRelation[]>('社交.关系') ?? [];

    return npcs
      .filter((n) => n.位置 && n.位置.includes(currentLoc))
      .map((n) => ({
        text: `${n.名称} 当前在 ${n.位置}${n.描述 ? `（${n.描述}）` : ''}`,
        score: 0.1 + this.keywordMatch(context.playerName, n.名称) * 0.35,
        source: 'graph' as const,
      }));
  }

  /**
   * 合并候选集并去重
   *
   * 同一事件被多个来源召回时，融合分数（最高不超过 1.0）。
   */
  private mergeCandidates(
    primary: RetrievalCandidate[],
    secondary: RetrievalCandidate[],
  ): RetrievalCandidate[] {
    const seen = new Map<string, RetrievalCandidate>();

    for (const c of primary) {
      const key = c.eventId ?? c.text;
      seen.set(key, c);
    }

    for (const c of secondary) {
      const key = c.eventId ?? c.text;
      const existing = seen.get(key);
      if (existing) {
        // 同一事件被多方法召回 → 融合分数
        // CR-10 修复：使用 Math.max 确保合并分数不低于主分（secondary 低分不拉低高质量 vector 主分）
        const blended = existing.score * 0.6 + c.score * 0.4;
        existing.score = Math.min(1.0, Math.max(existing.score, blended));
      } else {
        seen.set(key, c);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score);
  }

  /**
   * 应用可选的重排序
   *
   * @param limit 返回条数上限。调用方负责传对：rerank 开启时传 `config.rerank.topN`，
   *              关闭时传 `context.maxLines`。函数内部不再猜——避免历史上那种
   *              `topK` 其实是 `maxLines` 的命名陷阱。
   */
  private async applyReranking(
    query: string,
    candidates: RetrievalCandidate[],
    limit: number,
  ): Promise<RetrievalCandidate[]> {
    if (!this.reranker || candidates.length === 0) {
      return candidates.slice(0, limit);
    }

    const rerankInput: RerankCandidate[] = candidates.map((c) => ({
      text: c.text,
      score: c.score,
      source: c.source,
    }));

    const reranked = await this.reranker.rerank(query, rerankInput, limit);

    return reranked.map((r) => {
      const original = candidates.find((c) => c.text === r.text);
      // E.3 score mixing: base × 0.7 + rerank × 0.4
      const baseScore = original?.score ?? r.score;
      const blendedScore = Math.min(1.0, baseScore * 0.7 + r.rerankScore * 0.4);
      return {
        text: r.text,
        score: blendedScore,
        source: (original?.source ?? 'vector') as 'vector' | 'graph',
        eventId: original?.eventId,
        entityName: original?.entityName,
      };
    });
  }

  /**
   * 格式化检索结果为可注入 prompt 的文本
   */
  private formatResults(candidates: RetrievalCandidate[], maxLines: number): string {
    if (candidates.length === 0) return '';

    const lines = candidates
      .slice(0, maxLines)
      .map((c, i) => `${i + 1}. ${c.text}`);

    return lines.join('\n');
  }

  // ─── 评分辅助方法 ───

  /**
   * 关键词匹配分数（0-1）
   *
   * 计算 query 中出现在 text 中的词比例（简单 bag-of-words）。
   *
   * CR-9 修复：同时按空白和 CJK 字符边界分词，确保中文文本（无空格）
   * 也能产生有效 token，与 pseudoEmbed 的 tokenizer 保持一致。
   */
  private keywordMatch(query: string, text: string): number {
    if (!query || !text) return 0;
    // 按空白或 CJK 字符（\u4e00-\u9fff）边界分词
    const queryTokens = query.toLowerCase()
      .split(/[\s\u4e00-\u9fff]+/)
      .concat(query.match(/[\u4e00-\u9fff]/g) ?? [])
      .filter((t) => t.length > 0);
    if (queryTokens.length === 0) return 0;

    const textLower = text.toLowerCase();
    const matches = queryTokens.filter((t) => textLower.includes(t)).length;
    return matches / queryTokens.length;
  }

  /**
   * 时间衰减（基于事件 round 号）
   *
   * 越新的事件分数越高，采用指数衰减：score = e^(-0.05 × age)
   * age = 0 → 1.0；age = 10 → ~0.61；age = 50 → ~0.08；age = 100 → ~0.007
   */
  private recencyDecay(round?: number): number {
    if (round == null || round <= 0) return 0.5;
    return Math.exp(-0.05 * Math.max(0, round));
  }

  /**
   * 基于 ISO 时间戳的时间衰减（用于语义三元组）
   */
  private recencyDecayFromTimestamp(timestamp?: string): number {
    if (!timestamp) return 0.5;
    try {
      const ageMs = Date.now() - new Date(timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      return Math.exp(-0.1 * ageDays);
    } catch {
      return 0.5;
    }
  }

  /**
   * 上下文 boost：事件主体/客体出现在 query 中则加权
   */
  private contextBoost(query: string, event: EngramEventNode): number {
    const q = query.toLowerCase();
    let boost = 0;
    if (event.subject && q.includes(event.subject.toLowerCase())) boost += 0.5;
    if (event.object && q.includes(event.object.toLowerCase())) boost += 0.3;
    return Math.min(1.0, boost);
  }
}
