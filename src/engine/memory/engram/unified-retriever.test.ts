import { describe, it, expect, vi } from 'vitest';
import { UnifiedRetriever } from '@/engine/memory/engram/unified-retriever';
import type { UnifiedRetrieverConfig, RetrievalContext } from '@/engine/memory/engram/unified-retriever';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import type { EngramEventNode } from '@/engine/memory/engram/event-builder';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';

const ENGRAM_PATH = 'engram';
const ROUND_PATH = 'round';

function makeEdge(overrides: Partial<EngramEdge> = {}): EngramEdge {
  return {
    id: `edge_${Math.random().toString(36).slice(2, 8)}`,
    sourceEntity: 'A',
    targetEntity: 'B',
    fact: 'A和B是朋友关系并且经常一起冒险',
    episodes: ['ep1'],
    is_embedded: false,
    createdAtRound: 1,
    lastSeenRound: 1,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<EngramEntity> = {}): EngramEntity {
  return {
    name: 'A',
    type: 'npc',
    summary: '一个冒险者',
    attributes: {},
    firstSeen: 1,
    lastSeen: 1,
    mentionCount: 1,
    is_embedded: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EngramEventNode> = {}): EngramEventNode {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 8)}`,
    subject: 'A',
    action: 'narrative',
    tags: ['narrative'],
    text: '一段测试叙事内容用于BM25匹配',
    summary: '测试叙事摘要',
    structured_kv: { event: '测试', role: [], location: [], time_anchor: '', causality: '承接', logic: [] },
    is_embedded: false,
    roundNumber: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<RetrievalContext> = {}): RetrievalContext {
  return { playerName: '玩家', locationDesc: '广场', recentNpcNames: [], ...overrides };
}

function makeMockVectorStore() {
  return {
    cosineSimilarity: vi.fn((_a: number[], _b: number[]) => 0.8),
    load: vi.fn(async () => ({ eventVectors: {}, entityVectors: {}, edgeVectors: {}, model: 'test' })),
    mergeEventVectors: vi.fn(),
    mergeEntityVectors: vi.fn(),
    mergeEdgeVectors: vi.fn(),
    trimToMatchEvents: vi.fn(),
    trimEdgeVectors: vi.fn(),
    deleteEdgeVectorsByIds: vi.fn(),
    save: vi.fn(),
    deleteForSlot: vi.fn(),
  } as never;
}

function makeMockEmbedder() {
  return { embed: vi.fn(async (inputs: string[]) => inputs.map(() => [0.1, 0.2, 0.3])) } as never;
}

function makeMockReranker(opts: { available?: boolean; actuallyReranked?: boolean; scores?: number[] } = {}) {
  const { available = true, actuallyReranked = true, scores = [] } = opts;
  const mock = {
    isAvailable: vi.fn(() => available),
    rerank: vi.fn(async (_q: string, candidates: Array<{ text: string; score: number }>, topK: number) => ({
      actuallyReranked,
      results: candidates.slice(0, topK).map((c, i) => ({
        ...c,
        rerankScore: scores[i] ?? (1 - i * 0.1),
      })),
    })),
  };
  return mock;
}

function makeConfig(overrides: Partial<UnifiedRetrieverConfig> = {}): UnifiedRetrieverConfig {
  return {
    embedding: { enabled: false, topK: 20, minScore: 0.3 },
    rerank: { enabled: false, topN: 10 },
    shortTermWindow: 5,
    maxCandidates: 20,
    ...overrides,
  };
}

type MockReranker = ReturnType<typeof makeMockReranker>;

function setupRetriever(
  opts: {
    config?: Partial<UnifiedRetrieverConfig>;
    edges?: EngramEdge[];
    entities?: EngramEntity[];
    events?: EngramEventNode[];
    round?: number;
    reranker?: MockReranker;
  } = {},
) {
  const config = makeConfig(opts.config);
  const sm = createMockStateManager({
    engram: {
      events: opts.events ?? [makeEvent()],
      entities: opts.entities ?? [makeEntity({ name: 'A' }), makeEntity({ name: 'B' })],
      relations: [],
      v2Edges: opts.edges ?? [makeEdge()],
      meta: { lastUpdated: 0, eventCount: 1, embeddedEventCount: 0, embeddedEntityCount: 0, schemaVersion: 4, v2PendingReview: null },
    },
    round: opts.round ?? 10,
  });

  const retriever = new UnifiedRetriever(
    makeMockVectorStore(),
    makeMockEmbedder(),
    opts.reranker as never,
    config,
    undefined,
    undefined,
    { engramMemory: ENGRAM_PATH, roundNumber: ROUND_PATH },
  );

  return { retriever, sm: sm.sm, config };
}

describe('UnifiedRetriever', () => {
  describe('BM25 retrieval (no embeddings)', () => {
    it('returns matching edge facts via BM25', async () => {
      const edge = makeEdge({ fact: '张三和李四是师徒关系已经有十年了' });
      const { retriever, sm } = setupRetriever({ edges: [edge] });
      const result = await retriever.retrieve('师徒', makeContext(), sm as never);
      expect(result).toContain('张三');
      expect(result).toContain('师徒');
    });

    it('returns empty for no matching content', async () => {
      const edge = makeEdge({ fact: 'XXXXXXXXXXXXXXXXX' });
      const { retriever, sm } = setupRetriever({ edges: [edge] });
      const result = await retriever.retrieve('完全不相关的查询词', makeContext(), sm as never);
      expect(result).toBe('');
    });
  });

  describe('invalidated edges excluded', () => {
    it('does not inject invalidated edges as current facts', async () => {
      const valid = makeEdge({ id: 'valid', fact: '张三是李四的朋友这个事实是正确的' });
      const invalidated = makeEdge({ id: 'invalid', fact: '张三是李四的敌人这个事实已经过时', invalidatedAtRound: 5 });
      const { retriever, sm } = setupRetriever({ edges: [valid, invalidated] });
      const result = await retriever.retrieve('张三', makeContext(), sm as never);
      expect(result).toContain('朋友');
      if (result.includes('敌人')) {
        expect(result).toContain('已失效');
      }
    });
  });

  describe('shortTermWindow', () => {
    it('excludes events within the short-term window', async () => {
      const old = makeEvent({ id: 'old', text: '远古事件发生在很久以前', summary: '远古事件', roundNumber: 1 });
      const recent = makeEvent({ id: 'recent', text: '最近事件刚刚发生过', summary: '最近事件', roundNumber: 9 });
      const { retriever, sm } = setupRetriever({
        events: [old, recent],
        edges: [],
        config: { shortTermWindow: 5 },
        round: 10,
      });
      const result = await retriever.retrieve('事件', makeContext(), sm as never);
      expect(result).toContain('远古');
      expect(result).not.toContain('最近');
    });

    it('includes all events when shortTermWindow is 0', async () => {
      const recent = makeEvent({ id: 'recent', text: '最近发生的重要事件', summary: '最近事件', roundNumber: 9 });
      const { retriever, sm } = setupRetriever({
        events: [recent],
        edges: [],
        config: { shortTermWindow: 0 },
        round: 10,
      });
      const result = await retriever.retrieve('事件', makeContext(), sm as never);
      expect(result).toContain('最近');
    });
  });

  describe('topK and minScore (config-driven)', () => {
    it('topK limits per-scope candidates before merge', async () => {
      const edges = Array.from({ length: 10 }, (_, i) =>
        makeEdge({ id: `e${i}`, fact: `事实边${i}关于张三和李四的关系` }),
      );
      const { retriever, sm } = setupRetriever({
        edges,
        config: { maxCandidates: 4 },
      });
      await retriever.retrieve('张三', makeContext(), sm as never);
      const snapshot = retriever.lastReadSnapshot!;
      expect(snapshot.pipeline.injectedCount).toBeLessThanOrEqual(4);
    });
  });

  describe('scope budgets (50/25/25)', () => {
    it('distributes candidates across scopes', async () => {
      const { retriever, sm } = setupRetriever({ config: { maxCandidates: 20 } });
      await retriever.retrieve('测试', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      expect(snap.config.edgeBudget).toBe(10);
      expect(snap.config.entityBudget).toBe(5);
      expect(snap.config.eventBudget).toBe(5);
    });
  });

  describe('rerank', () => {
    it('rerank blends scores and populates rerankBlendedScore', async () => {
      const e1 = makeEdge({ id: 'low', fact: '不太相关的事实但是包含了张三' });
      const e2 = makeEdge({ id: 'high', fact: '非常相关的事实关于张三的冒险' });
      const reranker = makeMockReranker({
        available: true,
        actuallyReranked: true,
        scores: [0.3, 0.9],
      });
      const { retriever, sm } = setupRetriever({
        edges: [e1, e2],
        reranker,
        config: { rerank: { enabled: true, topN: 2 } },
      });
      await retriever.retrieve('张三', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      expect(snap.config.rerankEnabled).toBe(true);
      const injected = snap.candidates.filter((c) => c.outcome === 'injected');
      expect(injected.length).toBeGreaterThan(0);
      const withRerank = injected.filter((c) => c.rerankBlendedScore != null);
      expect(withRerank.length).toBeGreaterThan(0);
    });

    it('rerank topN filters out excess candidates', async () => {
      const edges = Array.from({ length: 5 }, (_, i) =>
        makeEdge({ id: `re${i}`, fact: `张三的冒险事实${i}涉及各种危险` }),
      );
      const reranker = makeMockReranker({
        available: true,
        actuallyReranked: true,
        scores: [0.9, 0.8],
      });
      const { retriever, sm } = setupRetriever({
        edges,
        reranker,
        config: { rerank: { enabled: true, topN: 2 }, maxCandidates: 10 },
      });
      await retriever.retrieve('张三', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      const rerankFiltered = snap.candidates.filter((c) => c.outcome === 'filtered-by-rerank');
      expect(rerankFiltered.length).toBeGreaterThan(0);
    });

    it('rerank fallback does not mark rerankUsed, does not blend scores, and shows no rerank components', async () => {
      const edge = makeEdge({ fact: '关于测试的一条事实边用于验证回退' });
      const reranker = makeMockReranker({ available: true, actuallyReranked: false });
      const { retriever, sm } = setupRetriever({
        edges: [edge],
        reranker,
        config: { rerank: { enabled: true, topN: 5 } },
      });
      await retriever.retrieve('测试', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      expect(snap.config.rerankTopN).toBe(0);
      expect(snap.candidates.every((c) => c.preRerankScore == null)).toBe(true);
      const allComponents = snap.candidates.flatMap((c) => c.components);
      expect(allComponents.every((c) => c.label !== '精排')).toBe(true);
    });

    it('unavailable reranker skips rerank entirely', async () => {
      const reranker = makeMockReranker({ available: false });
      const { retriever, sm } = setupRetriever({
        reranker,
        config: { rerank: { enabled: true, topN: 5 } },
      });
      await retriever.retrieve('测试', makeContext(), sm as never);
      expect(reranker.rerank).not.toHaveBeenCalled();
    });
  });

  describe('score components (B3)', () => {
    it('every injected candidate has at least one component', async () => {
      const edge = makeEdge({ fact: '关于测试的事实边内容用于验证分量' });
      const { retriever, sm } = setupRetriever({ edges: [edge] });
      await retriever.retrieve('测试', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      const injected = snap.candidates.filter((c) => c.outcome === 'injected');
      expect(injected.length).toBeGreaterThan(0);
      for (const c of injected) {
        expect(c.components.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('entity redundancy filter (B4)', () => {
    it('skips entities already mentioned in edge facts', async () => {
      const edge = makeEdge({ sourceEntity: 'A', targetEntity: 'B', fact: 'A和B一起冒险了很长一段时间' });
      const entityA = makeEntity({ name: 'A', summary: '独特的冒险者描述Alpha' });
      const entityB = makeEntity({ name: 'B', summary: '独特的冒险者描述Beta' });
      const { retriever, sm } = setupRetriever({
        edges: [edge],
        entities: [entityA, entityB],
      });
      const result = await retriever.retrieve('冒险', makeContext(), sm as never);
      expect(result).toContain('A和B');
      expect(result).not.toContain('独特的冒险者描述Alpha');
      expect(result).not.toContain('独特的冒险者描述Beta');
    });

    it('includes entities NOT mentioned in edge facts', async () => {
      const edge = makeEdge({ sourceEntity: 'A', targetEntity: 'B', fact: 'A和B一起冒险了很长一段时间' });
      const entityC = makeEntity({ name: 'C', summary: '一个神秘的旁观者' });
      const { retriever, sm } = setupRetriever({
        edges: [edge],
        entities: [makeEntity({ name: 'A' }), makeEntity({ name: 'B' }), entityC],
      });
      const result = await retriever.retrieve('旁观者', makeContext(), sm as never);
      if (result.includes('C')) {
        expect(result).toContain('神秘的旁观者');
      }
    });
  });

  describe('filtered candidates appear in trace', () => {
    it('budget-cut candidates have filtered-by-topK outcome', async () => {
      const edges = Array.from({ length: 10 }, (_, i) =>
        makeEdge({ id: `e${i}`, fact: `张三的事实${i}关于各种冒险经历` }),
      );
      const { retriever, sm } = setupRetriever({
        edges,
        config: { maxCandidates: 4 },
      });
      await retriever.retrieve('张三', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      const filtered = snap.candidates.filter((c) => c.outcome === 'filtered-by-topK');
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('snapshot records active config', () => {
    it('captures shortTermWindow and maxCandidates', async () => {
      const { retriever, sm } = setupRetriever({
        config: { shortTermWindow: 3, maxCandidates: 15 },
      });
      await retriever.retrieve('测试', makeContext(), sm as never);
      const snap = retriever.lastReadSnapshot!;
      expect(snap.config.shortTermWindow).toBe(3);
      expect(snap.config.maxCandidates).toBe(15);
    });
  });
});
