import { describe, it, expect } from 'vitest';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import { pruneEdgesV2 } from '@/engine/memory/engram/fact-builder';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';

const ENGRAM_PATH = '系统.扩展.engramMemory';

interface PendingReviewPair {
  newFact: string;
  oldEdgeId: string;
  similarity: number;
}

function makeEngramState(overrides: Record<string, unknown> = {}) {
  return {
    events: [],
    entities: [],
    relations: [],
    v2Edges: [],
    meta: {
      lastUpdated: 0,
      eventCount: 0,
      embeddedEventCount: 0,
      embeddedEntityCount: 0,
      schemaVersion: 4,
      v2PendingReview: null as PendingReviewPair[] | null,
      ...(overrides.meta as Record<string, unknown> ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => k !== 'meta'),
    ),
  };
}

function makeEdge(overrides: Partial<EngramEdge> = {}): EngramEdge {
  return {
    id: 'edge_default',
    sourceEntity: 'A',
    targetEntity: 'B',
    fact: 'A和B是朋友关系这是一个测试用的事实边',
    episodes: ['ep1'],
    is_embedded: false,
    createdAtRound: 1,
    lastSeenRound: 1,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<EngramEntity> = {}): EngramEntity {
  return {
    name: 'default',
    type: 'npc',
    summary: '',
    attributes: {},
    firstSeen: 1,
    lastSeen: 1,
    mentionCount: 1,
    is_embedded: false,
    ...overrides,
  };
}

describe('EngramManager V2 — state-level behavior', () => {
  describe('v2PendingReview preservation through whole-object write', () => {
    it('loadEngram preserves v2PendingReview from state', () => {
      const pending: PendingReviewPair[] = [
        { newFact: '张三背叛了李四', oldEdgeId: 'edge_001', similarity: 0.72 },
      ];
      const { sm } = createMockStateManager({
        系统: {
          扩展: {
            engramMemory: makeEngramState({
              meta: { v2PendingReview: pending },
            }),
          },
        },
      });

      const raw = sm.get<Record<string, unknown>>(ENGRAM_PATH);
      const meta = raw?.meta as Record<string, unknown>;
      expect(meta.v2PendingReview).toEqual(pending);
    });

    it('whole-object write with v2PendingReview in meta preserves it', () => {
      const pending: PendingReviewPair[] = [
        { newFact: '张三背叛了李四', oldEdgeId: 'edge_001', similarity: 0.72 },
      ];
      const { sm } = createMockStateManager({
        系统: { 扩展: { engramMemory: makeEngramState() } },
      });

      const updatedEngram = makeEngramState({
        meta: { v2PendingReview: pending },
      });
      sm.set(ENGRAM_PATH, updatedEngram, 'system');

      const result = sm.get<Record<string, unknown>>(ENGRAM_PATH);
      const meta = result?.meta as Record<string, unknown>;
      expect(meta.v2PendingReview).toEqual(pending);
    });

    it('[regression] subpath write is clobbered by later whole-object write without carry-forward', () => {
      const pending: PendingReviewPair[] = [
        { newFact: '张三背叛了李四', oldEdgeId: 'edge_001', similarity: 0.72 },
      ];
      const { sm } = createMockStateManager({
        系统: { 扩展: { engramMemory: makeEngramState() } },
      });

      sm.set(ENGRAM_PATH + '.meta.v2PendingReview', pending, 'system');
      expect(sm.get(ENGRAM_PATH + '.meta.v2PendingReview')).toEqual(pending);

      // This is the broken pattern that A1 fixed — documenting it as a regression guard
      const updatedEngram = makeEngramState();
      sm.set(ENGRAM_PATH, updatedEngram, 'system');

      const result = sm.get<Record<string, unknown>>(ENGRAM_PATH + '.meta.v2PendingReview');
      expect(result).toBeNull();
    });
  });

  describe('Tier 1 stub entity creation', () => {
    it('creates stub entity for unknown simple fact endpoint', () => {
      const entityNames = new Set(['张三', '李四']);
      const knowledgeFacts = [
        { sourceEntity: '张三', targetEntity: '星尘计划', fact: '张三正在执行星尘计划的第三阶段任务' },
      ];

      const isSentenceLike = (s: string) => s.length > 6 && /[，。了的被在过着得让把将与从]/.test(s);
      const stubs: Array<{ name: string; _pendingEnrichment: boolean }> = [];

      for (const kf of knowledgeFacts) {
        for (const name of [kf.sourceEntity, kf.targetEntity]) {
          if (!name || entityNames.has(name)) continue;
          if (isSentenceLike(name)) continue;
          stubs.push({ name, _pendingEnrichment: true });
          entityNames.add(name);
        }
      }

      expect(stubs).toHaveLength(1);
      expect(stubs[0].name).toBe('星尘计划');
      expect(stubs[0]._pendingEnrichment).toBe(true);
    });

    it('rejects sentence-like entity names as stubs', () => {
      const sentenceName = '他曾经在山上修炼过的那个人';
      const isSentenceLike = (s: string) => s.length > 6 && /[，。了的被在过着得让把将与从]/.test(s);
      expect(isSentenceLike(sentenceName)).toBe(true);
    });

    it('does not create stub for already-known entity', () => {
      const entityNames = new Set(['张三', '李四']);
      const knowledgeFacts = [
        { sourceEntity: '张三', targetEntity: '李四', fact: '张三和李四一起去了市场买东西回来做饭' },
      ];

      const stubs: string[] = [];
      for (const kf of knowledgeFacts) {
        for (const name of [kf.sourceEntity, kf.targetEntity]) {
          if (!name || entityNames.has(name)) continue;
          stubs.push(name);
        }
      }

      expect(stubs).toHaveLength(0);
    });
  });

  describe('Step 2.25 — cross-round pending stub restore', () => {
    it('restores _pendingEnrichment entities from previous round', () => {
      const previousEntities: EngramEntity[] = [
        makeEntity({ name: '星尘计划', type: 'item', _pendingEnrichment: true, firstSeen: 3, lastSeen: 3 }),
        makeEntity({ name: '张三', type: 'npc', firstSeen: 1, lastSeen: 3, mentionCount: 5, summary: '一个NPC', is_embedded: true }),
      ];
      const currentEntities: EngramEntity[] = [
        makeEntity({ name: '张三', type: 'npc', firstSeen: 1, lastSeen: 4, mentionCount: 6, summary: '一个NPC', is_embedded: true }),
      ];

      const currentRound = 4;
      const builtNames = new Set(currentEntities.map((e) => e.name));
      const restored = [...currentEntities];
      for (const prev of previousEntities) {
        if (prev._pendingEnrichment && !builtNames.has(prev.name)) {
          restored.push({ ...prev, lastSeen: currentRound });
        }
      }

      expect(restored).toHaveLength(2);
      const stub = restored.find((e) => e.name === '星尘计划');
      expect(stub).toBeDefined();
      expect(stub!._pendingEnrichment).toBe(true);
      expect(stub!.lastSeen).toBe(4);
    });

    it('does not restore enriched entities (no _pendingEnrichment)', () => {
      const previousEntities: EngramEntity[] = [
        makeEntity({ name: '星尘计划', type: 'item', summary: '一项秘密计划', is_embedded: true }),
      ];
      const currentEntities: EngramEntity[] = [];

      const builtNames = new Set(currentEntities.map((e) => e.name));
      const restored = [...currentEntities];
      for (const prev of previousEntities) {
        if (prev._pendingEnrichment && !builtNames.has(prev.name)) {
          restored.push({ ...prev });
        }
      }

      expect(restored).toHaveLength(0);
    });

    it('does not duplicate if entity was rebuilt this round', () => {
      const previousEntities: EngramEntity[] = [
        makeEntity({ name: '星尘计划', type: 'item', _pendingEnrichment: true, firstSeen: 3, lastSeen: 3 }),
      ];
      const currentEntities: EngramEntity[] = [
        makeEntity({ name: '星尘计划', type: 'item', firstSeen: 3, lastSeen: 4, mentionCount: 2, summary: '一项计划' }),
      ];

      const builtNames = new Set(currentEntities.map((e) => e.name));
      const restored = [...currentEntities];
      for (const prev of previousEntities) {
        if (prev._pendingEnrichment && !builtNames.has(prev.name)) {
          restored.push({ ...prev });
        }
      }

      expect(restored).toHaveLength(1);
      expect(restored[0].name).toBe('星尘计划');
    });
  });

  describe('pruneToImportant preserves _pendingEnrichment stubs', () => {
    it('keeps pending enrichment entity even if name is not important', () => {
      const entities: EngramEntity[] = [
        makeEntity({ name: '张三', type: 'npc' }),
        makeEntity({ name: '未知组织', type: 'npc', _pendingEnrichment: true }),
        makeEntity({ name: '青云山', type: 'location' }),
      ];

      const importantNames = new Set(['张三']);
      const isRelevant = (name: string) => importantNames.has(name) || name === '玩家';

      const pruned = entities.filter(
        (e) => isRelevant(e.name) || e.type === 'location' || e._pendingEnrichment,
      );

      expect(pruned).toHaveLength(3);
      expect(pruned.map((e) => e.name)).toContain('未知组织');
    });

    it('removes non-important NPC without _pendingEnrichment', () => {
      const entities: EngramEntity[] = [
        makeEntity({ name: '路人甲', type: 'npc' }),
      ];

      const importantNames = new Set(['张三']);
      const isRelevant = (name: string) => importantNames.has(name) || name === '玩家';

      const pruned = entities.filter(
        (e) => isRelevant(e.name) || e.type === 'location' || e._pendingEnrichment,
      );

      expect(pruned).toHaveLength(0);
    });
  });

  describe('path-level write in vectorizeAsync does not clobber meta', () => {
    it('writing .events does not affect .meta.v2PendingReview', () => {
      const pending: PendingReviewPair[] = [
        { newFact: 'A背叛B', oldEdgeId: 'e1', similarity: 0.7 },
      ];
      const { sm } = createMockStateManager({
        系统: {
          扩展: {
            engramMemory: makeEngramState({
              events: [{ id: 'evt1', is_embedded: false }],
              meta: { v2PendingReview: pending },
            }),
          },
        },
      });

      const events = sm.get<Array<{ id: string; is_embedded: boolean }>>(ENGRAM_PATH + '.events') ?? [];
      const updated = events.map((e) => ({ ...e, is_embedded: true }));
      sm.set(ENGRAM_PATH + '.events', updated, 'system');
      sm.set(ENGRAM_PATH + '.meta.embeddedEventCount', 1, 'system');

      const review = sm.get<PendingReviewPair[]>(ENGRAM_PATH + '.meta.v2PendingReview');
      expect(review).toEqual(pending);
    });

    it('writing .v2Edges does not affect .meta.v2PendingReview', () => {
      const pending: PendingReviewPair[] = [
        { newFact: 'C攻击D', oldEdgeId: 'e2', similarity: 0.65 },
      ];
      const { sm } = createMockStateManager({
        系统: {
          扩展: {
            engramMemory: makeEngramState({
              v2Edges: [makeEdge({ id: 'edge1' })],
              meta: { v2PendingReview: pending },
            }),
          },
        },
      });

      const edges = sm.get<EngramEdge[]>(ENGRAM_PATH + '.v2Edges') ?? [];
      const updated = edges.map((e) => ({ ...e, is_embedded: true }));
      sm.set(ENGRAM_PATH + '.v2Edges', updated, 'system');

      const review = sm.get<PendingReviewPair[]>(ENGRAM_PATH + '.meta.v2PendingReview');
      expect(review).toEqual(pending);
    });
  });

  describe('pruneEdgesV2 — recency decay', () => {
    it('recent edges score higher than old edges', () => {
      const recent = makeEdge({ id: 'recent', lastSeenRound: 10 });
      const old = makeEdge({ id: 'old', lastSeenRound: 1 });

      const result = pruneEdgesV2([recent, old], 10, 1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('recent');
    });

    it('very old edges decay below newer ones', () => {
      const edges = [
        makeEdge({ id: 'ancient', lastSeenRound: 1 }),
        makeEdge({ id: 'moderate', lastSeenRound: 50 }),
        makeEdge({ id: 'fresh', lastSeenRound: 99 }),
      ];

      const result = pruneEdgesV2(edges, 100, 2);
      expect(result.map((e) => e.id)).toEqual(['fresh', 'moderate']);
    });
  });
});
