import { describe, it, expect } from 'vitest';
import { NpcRelevanceScorer, DEFAULT_NPC_RELEVANCE_CONFIG } from './npc-relevance-scorer';
import type { EngramReadSnapshot, ScoredCandidateTrace } from '../memory/engram/engram-types';
import type { EngramEdge } from '../memory/engram/knowledge-edge';
import type { EngramEntity } from '../memory/engram/entity-builder';

function makeEdge(overrides: Partial<EngramEdge> & Pick<EngramEdge, 'sourceEntity' | 'targetEntity'>): EngramEdge {
  return {
    id: `${overrides.sourceEntity}|${overrides.targetEntity}|test`,
    fact: 'test fact',
    episodes: [],
    is_embedded: false,
    createdAtRound: 1,
    lastSeenRound: overrides.lastSeenRound ?? 10,
    ...overrides,
  };
}

function makeEntity(name: string, type: EngramEntity['type'] = 'npc', lastSeen = 10): EngramEntity {
  return {
    name, type, attributes: {}, firstSeen: 1, lastSeen,
    mentionCount: 1, summary: '', is_embedded: false,
  };
}

function makeCandidate(
  source: ScoredCandidateTrace['source'],
  overrides: Partial<ScoredCandidateTrace> = {},
): ScoredCandidateTrace {
  return {
    text: overrides.text ?? 'test',
    finalScore: 0.8,
    source,
    components: [],
    outcome: overrides.outcome ?? 'injected',
    ...overrides,
  };
}

function makeSnapshot(candidates: ScoredCandidateTrace[]): EngramReadSnapshot {
  return {
    query: 'test query',
    capturedAt: Date.now(),
    totalDurationMs: 10,
    candidates,
    pipeline: {
      vectorEventCount: 0, vectorEntityCount: 0, graphCount: 0,
      afterMerge: 0, afterRerank: 0, injectedCount: candidates.filter(c => c.outcome === 'injected').length,
    },
    config: {
      minScore: 0.3, topK: 20, rerankEnabled: false, rerankTopN: 10,
      embeddingEnabled: true, shortTermWindow: 5, maxCandidates: 20,
      edgeBudget: 10, entityBudget: 5, eventBudget: 5,
    },
  };
}

const PLAYER = '李天命';
const ALL_NPCS = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '郑十一', '冯十二', '陈十三'];

describe('NpcRelevanceScorer', () => {
  const scorer = new NpcRelevanceScorer({ ...DEFAULT_NPC_RELEVANCE_CONFIG, playerAliases: ['玩家'] });

  describe('skip conditions', () => {
    it('skips when NPC count < minNpcCountForFilter', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ['张三', '李四', '王五'],
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(true);
      expect(result.relevantNames).toEqual(new Set(['张三', '李四', '王五']));
    });

    it('skips when Engram has no data (empty entities and edges)', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(true);
      expect(result.relevantNames.size).toBe(ALL_NPCS.length);
    });

    it('skips when all signals produce zero hits (conservative fallback)', () => {
      const result = scorer.score({
        readSnapshot: makeSnapshot([]),
        engramEntities: [makeEntity('unknown_entity')],
        engramEdges: [makeEdge({ sourceEntity: 'X', targetEntity: 'Y', lastSeenRound: 1 })],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(true);
      expect(result.relevantNames.size).toBe(ALL_NPCS.length);
    });
  });

  describe('signal 1: snapshot recall', () => {
    it('extracts NPC from edge candidate text [source→target]', () => {
      const snapshot = makeSnapshot([
        makeCandidate('edge', { text: '[张三→李四] 张三是李四的师父' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(false);
      expect(result.relevantNames.has('张三')).toBe(true);
      expect(result.relevantNames.has('李四')).toBe(true);
    });

    it('filters out player from edge candidate (only keeps NPC side)', () => {
      const snapshot = makeSnapshot([
        makeCandidate('edge', { text: `[${PLAYER}→张三] 主角救了张三` }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('张三')).toBe(true);
      expect(result.relevantNames.has(PLAYER)).toBe(false);
    });

    it('filters out "玩家" alias from edge candidate', () => {
      const snapshot = makeSnapshot([
        makeCandidate('edge', { text: '[玩家→王五] 玩家和王五交谈' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('王五')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('王五')).toBe(true);
      expect(result.relevantNames.has('玩家')).toBe(false);
    });

    it('extracts NPC from entity candidate via entityName', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '赵六', text: '赵六: 铁匠' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('赵六')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('赵六')).toBe(true);
    });

    it('ignores filtered-by-topK candidates', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三', outcome: 'filtered-by-topK' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      // No injected candidates → no hits from snapshot
      // If no other signals hit either, falls back to all
      expect(result.signals.fromSnapshot).toEqual([]);
    });

    it('ignores entity names not in NPC list', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '天剑山', text: '天剑山: 门派所在地' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('天剑山', 'location')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromSnapshot).toEqual([]);
    });

    it('prefers extended edge fields over text parsing', () => {
      const candidate = makeCandidate('edge', { text: '[A→B] irrelevant text' }) as ScoredCandidateTrace & {
        edgeSourceEntity?: string;
        edgeTargetEntity?: string;
      };
      candidate.edgeSourceEntity = '张三';
      candidate.edgeTargetEntity = '李四';

      const snapshot = makeSnapshot([candidate]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三')],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('张三')).toBe(true);
      expect(result.relevantNames.has('李四')).toBe(true);
      expect(result.relevantNames.has('A')).toBe(false);
    });
  });

  describe('signal 2: recent player↔NPC edges (hub countermeasure)', () => {
    it('includes NPC with recent player edge', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 8 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('张三')).toBe(true);
      expect(result.signals.fromRecentActivity).toContain('张三');
    });

    it('excludes NPC with old player edge (outside recency window)', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 2 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      // 张三's edge is at round 2, threshold is 10-5=5 → excluded
      expect(result.signals.fromRecentActivity).not.toContain('张三');
    });

    it('works with "玩家" as player name in edge', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('李四')],
        engramEdges: [
          makeEdge({ sourceEntity: '玩家', targetEntity: '李四', lastSeenRound: 9 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('李四')).toBe(true);
    });

    it('skips invalidated edges', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({
            sourceEntity: PLAYER, targetEntity: '张三',
            lastSeenRound: 9, invalidatedAtRound: 8,
          }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromRecentActivity).not.toContain('张三');
    });

    it('skips edges with invalidAtRound set', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({
            sourceEntity: PLAYER, targetEntity: '张三',
            lastSeenRound: 9, invalidAtRound: 8,
          }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromRecentActivity).not.toContain('张三');
    });

    it('does NOT include NPC↔NPC edges in signal 2 (only player edges)', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三'), makeEntity('李四')],
        engramEdges: [
          makeEdge({ sourceEntity: '张三', targetEntity: '李四', lastSeenRound: 9 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      // NPC↔NPC edges should not appear in signal 2
      expect(result.signals.fromRecentActivity).toEqual([]);
    });
  });

  describe('signal 3: NPC↔NPC BFS (excluding player)', () => {
    it('discovers NPC linked to a seed NPC via NPC↔NPC edge', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四')],
        engramEdges: [
          makeEdge({ sourceEntity: '张三', targetEntity: '李四', lastSeenRound: 5 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('李四')).toBe(true);
      expect(result.signals.fromBfsExpansion).toContain('李四');
    });

    it('does NOT traverse through player node', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四'), makeEntity('王五')],
        engramEdges: [
          makeEdge({ sourceEntity: '张三', targetEntity: PLAYER }),
          makeEdge({ sourceEntity: PLAYER, targetEntity: '王五' }),
          // 张三→PLAYER→王五 path exists but player is excluded from BFS
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromBfsExpansion).not.toContain('王五');
    });

    it('does NOT traverse through "玩家" node', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('赵六')],
        engramEdges: [
          makeEdge({ sourceEntity: '张三', targetEntity: '玩家' }),
          makeEdge({ sourceEntity: '玩家', targetEntity: '赵六' }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromBfsExpansion).not.toContain('赵六');
    });

    it('skips invalidated edges in BFS', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四')],
        engramEdges: [
          makeEdge({
            sourceEntity: '张三', targetEntity: '李四',
            invalidAtRound: 5,
          }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromBfsExpansion).not.toContain('李四');
    });

    it('respects bfsHops=0 (no expansion)', () => {
      const customScorer = new NpcRelevanceScorer({ ...DEFAULT_NPC_RELEVANCE_CONFIG, bfsHops: 0 });

      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = customScorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四')],
        engramEdges: [
          makeEdge({ sourceEntity: '张三', targetEntity: '李四' }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.signals.fromBfsExpansion).toEqual([]);
    });
  });

  describe('signal fusion & conservative behavior', () => {
    it('merges all three signals (union)', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四'), makeEntity('王五'), makeEntity('赵六')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '李四', lastSeenRound: 9 }),
          makeEdge({ sourceEntity: '张三', targetEntity: '王五' }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.relevantNames.has('张三')).toBe(true);  // signal 1
      expect(result.relevantNames.has('李四')).toBe(true);   // signal 2
      expect(result.relevantNames.has('王五')).toBe(true);   // signal 3
      expect(result.relevantNames.has('赵六')).toBe(false);  // none
      expect(result.skipped).toBe(false);
    });

    it('returns skipped=false when at least one NPC is relevant', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 9 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(false);
      expect(result.relevantNames.size).toBeGreaterThan(0);
      expect(result.relevantNames.size).toBeLessThan(ALL_NPCS.length);
    });
  });

  describe('npcSignalCounts', () => {
    it('counts signals per NPC correctly', () => {
      const snapshot = makeSnapshot([
        makeCandidate('entity', { entityName: '张三' }),
        makeCandidate('edge', { text: '[张三→李四] 张三教李四武功' }),
      ]);

      const result = scorer.score({
        readSnapshot: snapshot,
        engramEntities: [makeEntity('张三'), makeEntity('李四')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 9 }),
          makeEdge({ sourceEntity: '张三', targetEntity: '李四' }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      // 张三: fromSnapshot + fromRecentActivity = 2 signals
      expect(result.npcSignalCounts.get('张三')).toBe(2);
      // 李四: fromSnapshot only (already a seed, BFS won't re-discover)
      expect(result.npcSignalCounts.get('李四')).toBe(1);
    });

    it('returns empty map when skipped', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [],
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.npcSignalCounts.size).toBe(0);
    });

    it('NPC with single signal has count=1', () => {
      const result = scorer.score({
        readSnapshot: null,
        engramEntities: [makeEntity('张三')],
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 9 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.npcSignalCounts.get('张三')).toBe(1);
    });
  });

  describe('hub simulation: player connected to ALL NPCs', () => {
    it('with recency gate, only recent player edges pass', () => {
      const edges: EngramEdge[] = ALL_NPCS.map((name, i) =>
        makeEdge({
          sourceEntity: PLAYER,
          targetEntity: name,
          lastSeenRound: i < 3 ? 9 : 2, // first 3 are recent, rest are old
        }),
      );

      const result = scorer.score({
        readSnapshot: null,
        engramEntities: ALL_NPCS.map(n => makeEntity(n)),
        engramEdges: edges,
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(false);
      expect(result.relevantNames.size).toBe(3);
      expect(result.relevantNames.has(ALL_NPCS[0])).toBe(true);
      expect(result.relevantNames.has(ALL_NPCS[1])).toBe(true);
      expect(result.relevantNames.has(ALL_NPCS[2])).toBe(true);
      expect(result.relevantNames.has(ALL_NPCS[5])).toBe(false);
    });
  });

  describe('config customization', () => {
    it('respects custom recentRoundWindow', () => {
      const wideScorer = new NpcRelevanceScorer({ ...DEFAULT_NPC_RELEVANCE_CONFIG, recentRoundWindow: 20 });

      const result = wideScorer.score({
        readSnapshot: null,
        engramEntities: ALL_NPCS.map(n => makeEntity(n)),
        engramEdges: [
          makeEdge({ sourceEntity: PLAYER, targetEntity: '张三', lastSeenRound: 2 }),
        ],
        currentRound: 10,
        allNpcNames: ALL_NPCS,
        playerName: PLAYER,
      });

      // With window=20, threshold=10-20=-10 → all edges pass
      expect(result.relevantNames.has('张三')).toBe(true);
    });

    it('respects custom minNpcCountForFilter', () => {
      const strictScorer = new NpcRelevanceScorer({ ...DEFAULT_NPC_RELEVANCE_CONFIG, minNpcCountForFilter: 50 });

      const result = strictScorer.score({
        readSnapshot: null,
        engramEntities: ALL_NPCS.map(n => makeEntity(n)),
        engramEdges: [],
        currentRound: 10,
        allNpcNames: ALL_NPCS, // 11 < 50
        playerName: PLAYER,
      });

      expect(result.skipped).toBe(true);
    });
  });
});
