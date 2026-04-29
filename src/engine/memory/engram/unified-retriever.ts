/**
 * 统一检索器 — V2 Graphiti 对齐架构
 *
 * 3 scope × (Cosine + BM25) + RRF + BFS 二次展开
 * 设计文档: engram-v2-graphiti-alignment.md §3.3
 */
import type { StateManager } from '../../core/state-manager';
import type { VectorStore, VectorStoreData } from './vector-store';
import type { Embedder } from './embedder';
import type { Reranker } from './reranker';
import type { EngramEventNode } from './event-builder';
import type { EngramEntity } from './entity-builder';
import type { EngramEdge } from './knowledge-edge';
import { bm25Score, rrfMerge } from './search-utils';
import type {
  EngramEmbeddingConfig,
  EngramRerankConfig,
  EngramReadSnapshot,
  ScoredCandidateTrace,
} from './engram-types';

// ─── 类型定义 ───

/** 检索时的场景上下文 */
export interface RetrievalContext {
  playerName: string;
  locationDesc: string;
  recentNpcNames: string[];
  maxLines: number;
}

/** Engram 状态数据结构（从状态树读取） */
interface EngramStateData {
  events?: EngramEventNode[];
  entities?: EngramEntity[];
  v2Edges?: EngramEdge[];
  meta?: Record<string, unknown>;
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
    afterMergeCount: number;
    afterRerankCount: number;
    rerankUsed: boolean;
    embeddingFallback: boolean;
    topScores: Array<{ text: string; score: number; source: string }>;
  }): void;
  recordReadSnapshot(snapshot: EngramReadSnapshot): void;
}

export class UnifiedRetriever {
  lastReadSnapshot: EngramReadSnapshot | null = null;
  private readonly engramPath: string;
  private readonly roundNumberPath: string;

  constructor(
    private vectorStore: VectorStore,
    private embedder: Embedder,
    _reranker?: Reranker,
    private configOrGetter?: UnifiedRetrieverConfig | (() => UnifiedRetrieverConfig | undefined),
    private debugRecorder?: IDebugRecorder,
    private getActiveSlot?: () => { profileId: string; slotId: string } | null,
    paths?: { engramMemory?: string; roundNumber?: string },
  ) {
    this.engramPath = paths?.engramMemory ?? '系统.扩展.engramMemory';
    this.roundNumberPath = paths?.roundNumber ?? '元数据.回合序号';
  }

  /** 动态读取配置：支持静态对象或 getter 函数（每次调用都读最新值） */
  private get config(): UnifiedRetrieverConfig | undefined {
    if (typeof this.configOrGetter === 'function') return this.configOrGetter();
    return this.configOrGetter;
  }

  /**
   * V2 检索入口 — 3 scope × (Cosine + BM25) + RRF + BFS
   */
  async retrieve(
    query: string,
    context: RetrievalContext,
    stateManager: StateManager,
  ): Promise<string> {
    const retrieveStart = performance.now();
    const engram = stateManager.get<EngramStateData>(this.engramPath);
    if (!engram?.events?.length) return '';

    const events = engram.events;
    const entities = engram.entities ?? [];
    const v2Edges = engram.v2Edges ?? [];
    const currentRound = stateManager.get<number>(this.roundNumberPath) ?? 0;

    return this.retrieveV2(
      query, context, events, entities, v2Edges, currentRound, retrieveStart, stateManager,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  V2 retrieval: 3 scope × (Cosine + BM25) + RRF + BFS
  //  Design doc: engram-v2-graphiti-alignment.md §3.3
  // ═══════════════════════════════════════════════════════════════

  private async retrieveV2(
    query: string,
    context: RetrievalContext,
    events: EngramEventNode[],
    entities: EngramEntity[],
    v2Edges: EngramEdge[],
    currentRound: number,
    retrieveStart: number,
    _stateManager: StateManager,
  ): Promise<string> {
    const LIMIT = 20;
    const embeddingEnabled = this.config?.embedding?.enabled !== false;

    // One embedding call for the query, reused by all scopes
    let queryVec: number[] | null = null;
    let vectorData: VectorStoreData | undefined;
    if (embeddingEnabled) {
      try {
        const slot = this.getActiveSlot?.();
        if (slot?.profileId && slot?.slotId) {
          vectorData = await this.vectorStore.load(slot.profileId, slot.slotId);
        }
        const vecs = await this.embedder.embed([query]);
        queryVec = vecs[0]?.length > 0 ? vecs[0] : null;
      } catch { /* embedding failure → cosine paths produce empty lists */ }
    }

    const validEdges = v2Edges.filter((e) => e.invalidatedAtRound == null);

    // ── Scope 1: Edge search (Cosine + BM25 + BFS) ──
    const edgeCosineIds: string[] = [];
    const edgeBm25Ids: string[] = [];

    if (queryVec && vectorData?.edgeVectors) {
      const scored = validEdges
        .map((e) => {
          const vec = vectorData!.edgeVectors[e.id];
          if (!vec) return null;
          return { id: e.id, score: this.vectorStore.cosineSimilarity(queryVec!, vec) };
        })
        .filter((x): x is { id: string; score: number } => x != null && x.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIMIT);
      edgeCosineIds.push(...scored.map((s) => s.id));
    }

    const bm25Scored = validEdges
      .map((e) => ({ id: e.id, score: bm25Score(query, e.fact) }))
      .filter((s) => s.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT);
    edgeBm25Ids.push(...bm25Scored.map((s) => s.id));

    // BFS expansion from Cosine + BM25 seed entities
    const bfsSeedEntities = new Set<string>();
    const edgeMap = new Map(validEdges.map((e) => [e.id, e]));
    for (const id of [...edgeCosineIds, ...edgeBm25Ids]) {
      const edge = edgeMap.get(id);
      if (edge) {
        bfsSeedEntities.add(edge.sourceEntity);
        bfsSeedEntities.add(edge.targetEntity);
      }
    }
    // Always include player + recent NPCs as seeds
    bfsSeedEntities.add(context.playerName);
    for (const npc of context.recentNpcNames) bfsSeedEntities.add(npc);

    const bfsEdgeIdSet = new Set<string>();
    const cosineAndBm25Set = new Set([...edgeCosineIds, ...edgeBm25Ids]);
    const visited = new Set(bfsSeedEntities);
    let frontier = Array.from(bfsSeedEntities);
    const adjacency = new Map<string, EngramEdge[]>();
    for (const e of validEdges) {
      const addTo = (n: string) => {
        const list = adjacency.get(n);
        if (list) list.push(e); else adjacency.set(n, [e]);
      };
      addTo(e.sourceEntity);
      addTo(e.targetEntity);
    }

    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const edge of (adjacency.get(node) ?? [])) {
          if (!bfsEdgeIdSet.has(edge.id) && !cosineAndBm25Set.has(edge.id)) {
            bfsEdgeIdSet.add(edge.id);
          }
          const neighbor = edge.sourceEntity === node ? edge.targetEntity : edge.sourceEntity;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }

    const bfsEdgeIds = Array.from(bfsEdgeIdSet).slice(0, LIMIT);
    const edgeRrf = rrfMerge([edgeCosineIds, edgeBm25Ids, bfsEdgeIds]);
    const topEdges = edgeRrf.slice(0, context.maxLines);

    // ── Scope 2: Entity search (Cosine + BM25) ──
    const entityCosineIds: string[] = [];
    const entityBm25Ids: string[] = [];

    if (queryVec && vectorData?.entityVectors) {
      const scored = entities
        .map((e) => {
          const vec = vectorData!.entityVectors[e.name];
          if (!vec) return null;
          return { id: e.name, score: this.vectorStore.cosineSimilarity(queryVec!, vec) };
        })
        .filter((x): x is { id: string; score: number } => x != null && x.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIMIT);
      entityCosineIds.push(...scored.map((s) => s.id));
    }

    const entityBm25 = entities
      .map((e) => ({ id: e.name, score: bm25Score(query, `${e.name} ${e.summary}`) }))
      .filter((s) => s.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT);
    entityBm25Ids.push(...entityBm25.map((s) => s.id));

    const entityRrf = rrfMerge([entityCosineIds, entityBm25Ids]);
    const topEntities = entityRrf.slice(0, 5);

    // ── Scope 3: Event search (Cosine + BM25) ──
    const SHORT_TERM_WINDOW = 5;
    // Exclude events from the most recent 5 rounds (already in short-term memory context)
    const searchableEvents = events.filter(
      (e) => e.roundNumber == null || currentRound - e.roundNumber >= SHORT_TERM_WINDOW,
    );
    const eventCosineIds: string[] = [];
    const eventBm25Ids: string[] = [];

    if (queryVec && vectorData?.eventVectors) {
      const scored = searchableEvents
        .map((e) => {
          const vec = vectorData!.eventVectors[e.id];
          if (!vec) return null;
          return { id: e.id, score: this.vectorStore.cosineSimilarity(queryVec!, vec) };
        })
        .filter((x): x is { id: string; score: number } => x != null && x.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIMIT);
      eventCosineIds.push(...scored.map((s) => s.id));
    }

    const eventBm25 = searchableEvents
      .map((e) => ({ id: e.id, score: bm25Score(query, e.summary || e.text) }))
      .filter((s) => s.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT);
    eventBm25Ids.push(...eventBm25.map((s) => s.id));

    const eventRrf = rrfMerge([eventCosineIds, eventBm25Ids]);
    const topEvents = eventRrf.slice(0, 5);

    // ── Format output ──
    const lines: string[] = [];
    const entityMap = new Map(entities.map((e) => [e.name, e]));
    const eventMap = new Map(events.map((e) => [e.id, e]));

    if (topEdges.length > 0) {
      lines.push('相关事实：');
      for (let i = 0; i < topEdges.length; i++) {
        const edge = edgeMap.get(topEdges[i].id);
        if (edge) {
          lines.push(`${i + 1}. [${edge.sourceEntity}→${edge.targetEntity}] ${edge.fact}（第${edge.lastSeenRound}轮）`);
        }
      }
    }

    if (topEntities.length > 0) {
      lines.push('');
      lines.push('相关角色：');
      for (const te of topEntities) {
        const entity = entityMap.get(te.id);
        if (entity) {
          const desc = entity.summary ? `：${entity.summary}` : '';
          lines.push(`- ${entity.name}${desc}`);
        }
      }
    }

    if (topEvents.length > 0) {
      lines.push('');
      lines.push('相关事件：');
      for (const te of topEvents) {
        const evt = eventMap.get(te.id);
        if (evt) {
          const text = (evt.midTermSummary || evt.text).slice(0, 150);
          lines.push(`- ${text}（第${evt.roundNumber ?? 0}轮）`);
        }
      }
    }

    const result = lines.join('\n').trim();

    // Build candidates for debug snapshot
    const candidates: ScoredCandidateTrace[] = [];
    for (const te of topEdges) {
      const edge = edgeMap.get(te.id);
      if (edge) candidates.push({
        text: `[${edge.sourceEntity}→${edge.targetEntity}] ${edge.fact}`.slice(0, 150),
        finalScore: te.score, source: 'edge', components: [], outcome: 'injected',
        roundNumber: edge.lastSeenRound,
      });
    }
    for (const te of topEntities) {
      const entity = entityMap.get(te.id);
      if (entity) candidates.push({
        text: `${entity.name}: ${entity.summary ?? ''}`.slice(0, 150),
        finalScore: te.score, source: 'entity', components: [], outcome: 'injected',
        entityName: entity.name,
      });
    }
    for (const te of topEvents) {
      const evt = eventMap.get(te.id);
      if (evt) candidates.push({
        text: (evt.midTermSummary || evt.text).slice(0, 150),
        finalScore: te.score, source: 'event', components: [], outcome: 'injected',
        eventId: evt.id, roundNumber: evt.roundNumber,
      });
    }

    const readSnapshot: EngramReadSnapshot = {
      query,
      capturedAt: Date.now(),
      totalDurationMs: performance.now() - retrieveStart,
      candidates,
      pipeline: {
        vectorEventCount: eventCosineIds.length,
        vectorEntityCount: entityCosineIds.length,
        graphCount: edgeCosineIds.length + edgeBm25Ids.length,
        afterMerge: topEdges.length + topEntities.length + topEvents.length,
        afterRerank: topEdges.length + topEntities.length + topEvents.length,
        injectedCount: topEdges.length + topEntities.length + topEvents.length,
      },
      config: {
        minScore: this.config?.embedding?.minScore ?? 0.3,
        topK: this.config?.embedding?.topK ?? 20,
        rerankEnabled: false,
        rerankTopN: 0,
        embeddingEnabled,
      },
    };
    this.lastReadSnapshot = readSnapshot;
    this.debugRecorder?.recordReadSnapshot(readSnapshot);

    this.debugRecorder?.recordRetrieve({
      vectorCandidateCount: eventCosineIds.length + entityCosineIds.length,
      graphCandidateCount: edgeCosineIds.length + edgeBm25Ids.length + bfsEdgeIds.length,
      afterMergeCount: topEdges.length + topEntities.length + topEvents.length,
      afterRerankCount: topEdges.length + topEntities.length + topEvents.length,
      rerankUsed: false,
      embeddingFallback: embeddingEnabled && eventCosineIds.length === 0 && entityCosineIds.length === 0,
      topScores: topEdges.slice(0, 5).map((e) => {
        const edge = edgeMap.get(e.id);
        return { text: edge?.fact.slice(0, 80) ?? e.id, score: e.score, source: 'edge' };
      }),
    });

    return result;
  }

}
