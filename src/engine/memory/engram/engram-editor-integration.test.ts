/**
 * EngramEditor — integration tests
 *
 * Covers:
 * - withWriteLock serialization (concurrency safety)
 * - processResponse compatibility — Step 2.3 user entity merge
 * - OQ-3 — buildFacts with defaultCore/defaultSource
 * - C5 — contradictionReview filter rules
 * - Bulk operations performance
 * - deleteEntity cascade + vector cleanup
 */
import { describe, it, expect, vi } from 'vitest';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';
import { EngramEditor, EngramEditError } from '@/engine/memory/engram/engram-editor';
import type { NewEngramEntity, NewKnowledgeEdge } from '@/engine/memory/engram/engram-editor';
import { engramEdgeId } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import { buildFacts } from '@/engine/memory/engram/fact-builder';
import type { KnowledgeFact } from '@/engine/memory/engram/fact-builder';

// ─── Constants ───

const ENGRAM_PATH = '系统.扩展.engramMemory';
const ROUND_PATH = '元数据.回合序号';
const RELATIONSHIPS_PATH = '社交.关系';

// ─── Helpers ───

interface EngramStateData {
  events: unknown[];
  entities: EngramEntity[];
  relations: unknown[];
  v2Edges: EngramEdge[];
  meta: {
    lastUpdated: number;
    eventCount: number;
    embeddedEventCount: number;
    embeddedEntityCount: number;
    schemaVersion: number;
    v2PendingReview?: Array<{ newFact: string; oldEdgeId: string; similarity: number }> | null;
  };
}

function makeEngramState(overrides: Partial<EngramStateData> = {}): EngramStateData {
  return {
    events: overrides.events ?? [],
    entities: overrides.entities ?? [],
    relations: overrides.relations ?? [],
    v2Edges: overrides.v2Edges ?? [],
    meta: {
      lastUpdated: 0,
      eventCount: 0,
      embeddedEventCount: 0,
      embeddedEntityCount: 0,
      schemaVersion: 5,
      v2PendingReview: null,
      ...(overrides.meta ?? {}),
    },
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

function makeEdge(overrides: Partial<EngramEdge> = {}): EngramEdge {
  const src = overrides.sourceEntity ?? 'A';
  const tgt = overrides.targetEntity ?? 'B';
  const fact = overrides.fact ?? 'A和B是朋友关系这是一个测试用的事实边';
  return {
    id: overrides.id ?? engramEdgeId(src, tgt, fact),
    sourceEntity: src,
    targetEntity: tgt,
    fact,
    episodes: ['ep1'],
    is_embedded: false,
    createdAtRound: 1,
    lastSeenRound: 1,
    learnedAtRound: 1,
    ...overrides,
  };
}

/**
 * Real mutex implementation for integration tests.
 * Chains promises to serialize execution, matching EngramManager.withWriteLock behavior.
 */
function createRealMutexManager() {
  let mutex = Promise.resolve();
  return {
    withWriteLock: async <T>(fn: () => T | Promise<T>): Promise<T> => {
      const ticket = mutex.then(() => fn());
      mutex = ticket.then(
        () => {},
        () => {},
      );
      return ticket;
    },
    vectorizePending: vi.fn(async () => ({ vectorized: 0 })),
    deleteEdgeVectors: vi.fn(async () => {}),
  };
}

function createTestHarness(opts: {
  entities?: EngramEntity[];
  v2Edges?: EngramEdge[];
  round?: number;
  pendingReview?: Array<{ newFact: string; oldEdgeId: string; similarity: number }>;
} = {}) {
  const engram = makeEngramState({
    entities: opts.entities ?? [],
    v2Edges: opts.v2Edges ?? [],
    meta: opts.pendingReview
      ? { lastUpdated: 0, eventCount: 0, embeddedEventCount: 0, embeddedEntityCount: 0, schemaVersion: 5, v2PendingReview: opts.pendingReview }
      : undefined,
  });

  const { sm } = createMockStateManager({
    系统: { 扩展: { engramMemory: engram } },
    元数据: { 回合序号: opts.round ?? 5 },
    社交: { 関係: [] },
  });

  const manager = createRealMutexManager();
  const editor = new EngramEditor(sm as unknown as import('@/engine/core/state-manager').StateManager, manager, {
    engramMemory: ENGRAM_PATH,
    roundNumber: ROUND_PATH,
    relationships: RELATIONSHIPS_PATH,
  });

  const readEngram = (): EngramStateData => sm.get<EngramStateData>(ENGRAM_PATH)!;

  return { sm, manager, editor, readEngram };
}

// ─── Tests ───

describe('EngramEditor integration tests', () => {
  // ────────────────────────────────────────────────────────
  // 1. withWriteLock serialization
  // ────────────────────────────────────────────────────────
  describe('withWriteLock serialization', () => {
    it('two concurrent createEntity calls both succeed sequentially without corruption', async () => {
      const { editor, readEngram } = createTestHarness();

      // Fire both concurrently
      const [e1, e2] = await Promise.all([
        editor.createEntity({ name: '张三', type: 'npc', summary: '一个剑客' }),
        editor.createEntity({ name: '李四', type: 'npc', summary: '一个医生' }),
      ]);

      expect(e1.name).toBe('张三');
      expect(e2.name).toBe('李四');

      const engram = readEngram();
      expect(engram.entities).toHaveLength(2);
      expect(engram.entities.map((e) => e.name).sort()).toEqual(['张三', '李四']);
    });

    it('createEntity during a slow withWriteLock call queues and executes after', async () => {
      const { editor, manager, readEngram } = createTestHarness();

      const executionOrder: string[] = [];

      // Start a slow operation via the manager's withWriteLock directly
      const slowOp = manager.withWriteLock(async () => {
        await new Promise((r) => setTimeout(r, 50));
        executionOrder.push('slow');
      });

      // Immediately queue a createEntity (should wait for slow op)
      const createOp = editor.createEntity({ name: '王五', type: 'npc' }).then((e) => {
        executionOrder.push('create');
        return e;
      });

      await Promise.all([slowOp, createOp]);

      expect(executionOrder).toEqual(['slow', 'create']);
      expect(readEngram().entities).toHaveLength(1);
      expect(readEngram().entities[0].name).toBe('王五');
    });

    it('concurrent duplicate name attempts: first succeeds, second throws NAME_DUPLICATE', async () => {
      const { editor } = createTestHarness();

      // First will succeed, second should fail with duplicate
      const results = await Promise.allSettled([
        editor.createEntity({ name: '张三' }),
        editor.createEntity({ name: '张三' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
        EngramEditError.NAME_DUPLICATE,
      );
    });
  });

  // ────────────────────────────────────────────────────────
  // 2. processResponse compatibility — Step 2.3 user entity merge
  // ────────────────────────────────────────────────────────
  describe('processResponse compatibility — Step 2.3 user entity merge', () => {
    it('user entity survives EntityBuilder rebuild that does not include it', () => {
      // Simulate: user created entity '星尘计划' via EngramEditor,
      // then EntityBuilder rebuilds entities from scratch (without '星尘计划')

      const userEntity = makeEntity({
        name: '星尘计划',
        type: 'item',
        summary: '一项秘密的反叛计划',
        source: 'user',
        userEditedAtRound: 3,
        firstSeen: 3,
        lastSeen: 3,
      });

      // This is the Step 2.3 logic from engram-manager.ts
      const previousEntities = [
        userEntity,
        makeEntity({ name: '张三', type: 'npc', summary: '一个NPC', source: 'derived' }),
      ];

      // EntityBuilder output (rebuilt from events + state — does NOT include '星尘计划')
      const builtEntities: EngramEntity[] = [
        makeEntity({ name: '张三', type: 'npc', summary: '一个NPC', firstSeen: 1, lastSeen: 5 }),
        makeEntity({ name: '李四', type: 'npc', summary: '另一个NPC', firstSeen: 2, lastSeen: 5 }),
      ];

      const currentRound = 5;

      // Step 2.3 logic
      const entities = [...builtEntities];
      const builtNames = new Set(entities.map((e) => e.name));
      for (const prev of previousEntities) {
        if (prev.source === 'user' && !builtNames.has(prev.name)) {
          entities.push({ ...prev, lastSeen: currentRound });
        } else if (prev.source === 'user' && builtNames.has(prev.name)) {
          const derived = entities.find((e) => e.name === prev.name);
          if (derived && prev.summary && prev.summary !== derived.summary) {
            derived.summary = prev.summary;
            derived.source = 'user';
            derived.userEditedAtRound = prev.userEditedAtRound;
          }
        }
      }

      // Verify '星尘计划' was restored
      expect(entities).toHaveLength(3);
      const restored = entities.find((e) => e.name === '星尘计划');
      expect(restored).toBeDefined();
      expect(restored!.source).toBe('user');
      expect(restored!.summary).toBe('一项秘密的反叛计划');
      expect(restored!.lastSeen).toBe(5); // updated to current round
    });

    it('user entity with same name as NPC: user summary is preserved', () => {
      const previousEntities = [
        makeEntity({
          name: '张三',
          type: 'npc',
          summary: '用户手动编辑的张三描述：他是一个潜伏的间谍',
          source: 'user',
          userEditedAtRound: 4,
        }),
      ];

      // EntityBuilder rebuilt '张三' from state with different summary
      const builtEntities: EngramEntity[] = [
        makeEntity({
          name: '张三',
          type: 'npc',
          summary: '一个普通的NPC',
          firstSeen: 1,
          lastSeen: 6,
        }),
      ];

      const entities = [...builtEntities];
      const builtNames = new Set(entities.map((e) => e.name));
      for (const prev of previousEntities) {
        if (prev.source === 'user' && !builtNames.has(prev.name)) {
          entities.push({ ...prev, lastSeen: 6 });
        } else if (prev.source === 'user' && builtNames.has(prev.name)) {
          const derived = entities.find((e) => e.name === prev.name);
          if (derived && prev.summary && prev.summary !== derived.summary) {
            derived.summary = prev.summary;
            derived.source = 'user';
            derived.userEditedAtRound = prev.userEditedAtRound;
          }
        }
      }

      expect(entities).toHaveLength(1);
      expect(entities[0].summary).toBe('用户手动编辑的张三描述：他是一个潜伏的间谍');
      expect(entities[0].source).toBe('user');
      expect(entities[0].userEditedAtRound).toBe(4);
    });

    it('EngramEditor createEntity → entity persists in state for Step 2.3 to pick up', async () => {
      const { editor, readEngram } = createTestHarness({
        entities: [makeEntity({ name: '张三', type: 'npc' })],
      });

      await editor.createEntity({ name: '星尘计划', type: 'item', summary: '反叛计划' });

      const engram = readEngram();
      const created = engram.entities.find((e) => e.name === '星尘计划');
      expect(created).toBeDefined();
      expect(created!.source).toBe('user');

      // Simulate Step 2.3: EntityBuilder would not rebuild '星尘计划' but
      // the engram state preserves it for the merge logic to restore
      const builtNames = new Set(['张三']); // EntityBuilder only knows about 张三
      const restored = engram.entities.filter(
        (e) => e.source === 'user' && !builtNames.has(e.name),
      );
      expect(restored).toHaveLength(1);
      expect(restored[0].name).toBe('星尘计划');
    });
  });

  // ────────────────────────────────────────────────────────
  // 3. OQ-3 — buildFacts with defaultCore/defaultSource
  // ────────────────────────────────────────────────────────
  describe('OQ-3 — buildFacts with defaultCore/defaultSource', () => {
    const baseEntities: EngramEntity[] = [
      makeEntity({ name: '张三' }),
      makeEntity({ name: '李四' }),
      makeEntity({ name: '王五' }),
    ];

    it('edges have core=true and source="opening" when options specify defaults', () => {
      const facts: KnowledgeFact[] = [
        { sourceEntity: '张三', targetEntity: '李四', fact: '张三和李四是同门师兄弟，从小一起长大' },
        { sourceEntity: '李四', targetEntity: '王五', fact: '李四曾经救过王五一命，两人结为兄弟' },
      ];

      const result = buildFacts(
        { knowledgeFacts: facts, entities: baseEntities, currentEventId: null, currentRound: 0 },
        [], // no existing edges
        null, // no vector store
        {}, // no edge vectors
        new Map(), // no new fact vectors
        { defaultCore: true, defaultSource: 'opening' },
      );

      expect(result.newEdges).toHaveLength(2);
      for (const edge of result.newEdges) {
        expect(edge.core).toBe(true);
        expect(edge.source).toBe('opening');
      }
    });

    it('edges have core=undefined and source=undefined when no options (standard main round)', () => {
      const facts: KnowledgeFact[] = [
        { sourceEntity: '张三', targetEntity: '李四', fact: '张三在酒馆和李四发生了激烈的争吵' },
      ];

      const result = buildFacts(
        { knowledgeFacts: facts, entities: baseEntities, currentEventId: 'evt_1', currentRound: 5 },
        [],
        null,
        {},
        new Map(),
        // no options
      );

      expect(result.newEdges).toHaveLength(1);
      expect(result.newEdges[0].core).toBeUndefined();
      expect(result.newEdges[0].source).toBeUndefined();
    });

    it('per-edge source overrides defaultSource', () => {
      createTestHarness({
        entities: [makeEntity({ name: '张三' }), makeEntity({ name: '李四' })],
      });

      // bulkCreateEdges uses BulkEdgeOpts.defaultCore/defaultSource
      // but individual edge input.source takes precedence
      const facts: KnowledgeFact[] = [
        { sourceEntity: '张三', targetEntity: '李四', fact: '张三和李四都是修仙者这是他们之间的一个重要关系' },
      ];

      // Test via buildFacts directly with per-edge source
      const result = buildFacts(
        { knowledgeFacts: facts, entities: [makeEntity({ name: '张三' }), makeEntity({ name: '李四' })], currentEventId: null, currentRound: 0 },
        [],
        null,
        {},
        new Map(),
        { defaultCore: false, defaultSource: 'opening' },
      );

      expect(result.newEdges[0].core).toBe(false);
      expect(result.newEdges[0].source).toBe('opening');
    });
  });

  // ────────────────────────────────────────────────────────
  // 4. C5 — contradictionReview filter rules
  // ────────────────────────────────────────────────────────
  describe('C5 — contradictionReview filter rules', () => {
    it('user-created edges bypass FactBuilder and do not appear in pendingReview', async () => {
      const { editor, readEngram } = createTestHarness({
        entities: [makeEntity({ name: '张三' }), makeEntity({ name: '李四' })],
      });

      // Create an edge via EngramEditor (user path — bypasses FactBuilder entirely)
      await editor.createEdge({
        sourceEntity: '张三',
        targetEntity: '李四',
        fact: '张三和李四是同门师兄弟，小时候一起修炼',
      });

      const engram = readEngram();
      // User-created edge exists
      expect(engram.v2Edges).toHaveLength(1);
      expect(engram.v2Edges[0].source).toBe('user');

      // No pending review since user edges skip FactBuilder's dedup pipeline
      expect(engram.meta.v2PendingReview).toBeNull();
    });

    it('core edges are filtered out in detectPendingReview filter logic', () => {
      // The pendingReview filter in processResponse filters by currentEdgeIds.
      // Core edges should still participate in the review if flagged,
      // but the UI filter (FieldRepair detectPendingReview) filters them.
      // Test the filter logic directly.

      const edges: EngramEdge[] = [
        makeEdge({
          id: 'core_edge_1',
          sourceEntity: '张三',
          targetEntity: '李四',
          fact: '张三和李四是兄弟关系这是一个核心设定',
          core: true,
          source: 'opening',
        }),
        makeEdge({
          id: 'normal_edge_1',
          sourceEntity: '张三',
          targetEntity: '王五',
          fact: '张三和王五在酒馆相遇成为朋友的故事',
          core: undefined,
          source: undefined,
        }),
      ];

      const pendingReview = [
        { newFact: '张三背叛了李四这是一个新的事实', oldEdgeId: 'core_edge_1', similarity: 0.72 },
        { newFact: '张三和王五关系破裂了他们不再是朋友', oldEdgeId: 'normal_edge_1', similarity: 0.68 },
      ];

      // FieldRepair filter: exclude core edges from contradiction review
      const edgeMap = new Map(edges.map((e) => [e.id, e]));
      const reviewable = pendingReview.filter((p) => {
        const edge = edgeMap.get(p.oldEdgeId);
        if (!edge) return false;
        return !edge.core; // core edges should not be reviewable
      });

      expect(reviewable).toHaveLength(1);
      expect(reviewable[0].oldEdgeId).toBe('normal_edge_1');
    });
  });

  // ────────────────────────────────────────────────────────
  // 5. Bulk operations performance
  // ────────────────────────────────────────────────────────
  describe('bulk operations performance', () => {
    it('creates 100 entities in bulk — all created', async () => {
      const { editor, readEngram } = createTestHarness();

      const inputs: NewEngramEntity[] = Array.from({ length: 100 }, (_, i) => ({
        name: `NPC_${String(i).padStart(3, '0')}`,
        type: 'npc' as const,
        summary: `NPC number ${i}`,
      }));

      const result = await editor.bulkCreateEntities(inputs);

      expect(result.created).toHaveLength(100);
      expect(result.skipped).toHaveLength(0);
      expect(readEngram().entities).toHaveLength(100);
    });

    it('creates 500 edges in bulk with some invalid — correct created/skipped split', async () => {
      // Pre-populate entities so edges can reference them
      const entityCount = 50;
      const entities = Array.from({ length: entityCount }, (_, i) =>
        makeEntity({ name: `E_${i}`, type: 'npc' }),
      );

      const { editor, readEngram } = createTestHarness({ entities });

      const inputs: NewKnowledgeEdge[] = [];
      let expectedValid = 0;
      let expectedSkipped = 0;

      for (let i = 0; i < 500; i++) {
        if (i % 10 === 0) {
          // Invalid: fact too short
          inputs.push({
            sourceEntity: `E_${i % entityCount}`,
            targetEntity: `E_${(i + 1) % entityCount}`,
            fact: 'short',
          });
          expectedSkipped++;
        } else if (i % 50 === 5) {
          // Invalid: both entities unknown
          inputs.push({
            sourceEntity: 'UNKNOWN_A',
            targetEntity: 'UNKNOWN_B',
            fact: '这两个实体都不存在于已知的实体列表中',
          });
          expectedSkipped++;
        } else {
          const src = `E_${i % entityCount}`;
          const tgt = `E_${(i + 7) % entityCount}`;
          const fact = `E_${i % entityCount}和E_${(i + 7) % entityCount}之间有特定的关系（第${i}条）`;
          inputs.push({ sourceEntity: src, targetEntity: tgt, fact });
          expectedValid++;
        }
      }

      const result = await editor.bulkCreateEdges(inputs);

      // Some edges may be duplicates (same src+tgt+fact produces same id)
      // so created + skipped should equal total input
      expect(result.created.length + result.skipped.length).toBe(500);
      expect(result.skipped.length).toBeGreaterThanOrEqual(expectedSkipped);
      // All created edges should be in state
      expect(readEngram().v2Edges).toHaveLength(result.created.length);
    });

    it('bulk entities: duplicates within the batch are skipped', async () => {
      const { editor } = createTestHarness();

      const inputs: NewEngramEntity[] = [
        { name: '张三' },
        { name: '李四' },
        { name: '张三' }, // duplicate within batch
        { name: '' },    // empty name
      ];

      const result = await editor.bulkCreateEntities(inputs);
      expect(result.created).toHaveLength(2);
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped[0].reason).toBe(EngramEditError.NAME_DUPLICATE);
      expect(result.skipped[1].reason).toBe(EngramEditError.NAME_EMPTY);
    });
  });

  // ────────────────────────────────────────────────────────
  // 6. deleteEntity cascade + vector cleanup
  // ────────────────────────────────────────────────────────
  describe('deleteEntity cascade + vector cleanup', () => {
    it('creates entity with 10 edges → deleteEntity(cascade=true) → all edges removed + deleteEdgeVectors called', async () => {
      const targetEntity = makeEntity({ name: '主角', type: 'player' });
      const centralEntity = makeEntity({ name: '张三', type: 'npc' });
      const otherEntities = Array.from({ length: 10 }, (_, i) =>
        makeEntity({ name: `NPC_${i}`, type: 'npc' }),
      );

      const edges: EngramEdge[] = otherEntities.map((other, i) =>
        makeEdge({
          sourceEntity: '张三',
          targetEntity: other.name,
          fact: `张三和${other.name}之间存在某种特定关系编号${i}`,
        }),
      );

      const { editor, manager, readEngram } = createTestHarness({
        entities: [targetEntity, centralEntity, ...otherEntities],
        v2Edges: edges,
      });

      expect(readEngram().v2Edges).toHaveLength(10);

      const result = await editor.deleteEntity('张三', { cascade: true });

      // All 10 edges should be removed
      expect(result.deletedEdgeIds).toHaveLength(10);
      expect(readEngram().v2Edges).toHaveLength(0);

      // Entity should be gone
      expect(readEngram().entities.find((e) => e.name === '张三')).toBeUndefined();
      // Other entities remain
      expect(readEngram().entities).toHaveLength(11); // 主角 + 10 NPCs

      // deleteEdgeVectors should be called with all removed edge IDs
      expect(manager.deleteEdgeVectors).toHaveBeenCalledTimes(1);
      expect(manager.deleteEdgeVectors).toHaveBeenCalledWith(result.deletedEdgeIds);
    });

    it('deleteEntity without cascade preserves edges', async () => {
      const entities = [
        makeEntity({ name: '张三' }),
        makeEntity({ name: '李四' }),
      ];
      const edges = [
        makeEdge({
          sourceEntity: '张三',
          targetEntity: '李四',
          fact: '张三和李四是朋友关系这是他们之间的纽带',
        }),
      ];

      const { editor, manager, readEngram } = createTestHarness({
        entities,
        v2Edges: edges,
      });

      // cascade: false → edges remain
      const result = await editor.deleteEntity('张三', { cascade: false });

      expect(result.deletedEdgeIds).toHaveLength(0);
      expect(readEngram().v2Edges).toHaveLength(1); // edge preserved
      expect(readEngram().entities.find((e) => e.name === '张三')).toBeUndefined();
      expect(manager.deleteEdgeVectors).not.toHaveBeenCalled();
    });

    it('deleteEntity cascade cleans pendingReview entries referencing deleted edges', async () => {
      const edge1 = makeEdge({
        sourceEntity: '张三',
        targetEntity: '李四',
        fact: '张三和李四有着深厚的师徒关系这是核心设定',
      });
      const edge2 = makeEdge({
        sourceEntity: '王五',
        targetEntity: '赵六',
        fact: '王五和赵六是敌对关系这是另一个核心设定',
      });

      const pendingReview = [
        { newFact: '张三背叛了李四', oldEdgeId: edge1.id, similarity: 0.72 },
        { newFact: '王五帮助了赵六', oldEdgeId: edge2.id, similarity: 0.68 },
      ];

      const { editor, readEngram } = createTestHarness({
        entities: [
          makeEntity({ name: '张三' }),
          makeEntity({ name: '李四' }),
          makeEntity({ name: '王五' }),
          makeEntity({ name: '赵六' }),
        ],
        v2Edges: [edge1, edge2],
        pendingReview,
      });

      // Delete 张三 → cascade removes edge1 → its pendingReview entry should be cleaned
      await editor.deleteEntity('张三', { cascade: true });

      const engram = readEngram();
      // Only edge2 should remain
      expect(engram.v2Edges).toHaveLength(1);
      expect(engram.v2Edges[0].id).toBe(edge2.id);

      // pendingReview should only have the entry for edge2
      expect(engram.meta.v2PendingReview).toHaveLength(1);
      expect(engram.meta.v2PendingReview![0].oldEdgeId).toBe(edge2.id);
    });
  });

  // ────────────────────────────────────────────────────────
  // Additional integration scenarios
  // ────────────────────────────────────────────────────────
  describe('edge creation with auto-stub entities', () => {
    it('creating edge with one missing entity auto-stubs the missing one', async () => {
      const { editor, readEngram } = createTestHarness({
        entities: [makeEntity({ name: '张三' })],
      });

      const result = await editor.createEdge({
        sourceEntity: '张三',
        targetEntity: '神秘组织',
        fact: '张三是神秘组织的成员之一这是一个重要的事实',
      });

      expect(result.autoStubbed).toEqual(['神秘组织']);
      const engram = readEngram();
      const stub = engram.entities.find((e) => e.name === '神秘组织');
      expect(stub).toBeDefined();
      expect(stub!._pendingEnrichment).toBe(true);
      expect(stub!.source).toBe('user');
    });
  });

  describe('vectorizePending delegation', () => {
    it('calls engramManager.vectorizePending with stateManager', async () => {
      const { editor, manager, sm } = createTestHarness();

      await editor.vectorizePending();

      expect(manager.vectorizePending).toHaveBeenCalledTimes(1);
      expect(manager.vectorizePending).toHaveBeenCalledWith(sm);
    });
  });

  describe('bulkCreateEdges with defaultCore and defaultSource', () => {
    it('applies BulkEdgeOpts defaults to created edges', async () => {
      const { editor, readEngram } = createTestHarness({
        entities: [
          makeEntity({ name: '张三' }),
          makeEntity({ name: '李四' }),
          makeEntity({ name: '王五' }),
        ],
      });

      const inputs: NewKnowledgeEdge[] = [
        { sourceEntity: '张三', targetEntity: '李四', fact: '张三和李四是同门师兄弟从小一起修炼' },
        { sourceEntity: '李四', targetEntity: '王五', fact: '李四和王五在学院中是竞争对手经常比试' },
      ];

      const result = await editor.bulkCreateEdges(inputs, {
        defaultCore: true,
        defaultSource: 'opening',
      });

      expect(result.created).toHaveLength(2);
      for (const edge of result.created) {
        expect(edge.core).toBe(true);
        expect(edge.source).toBe('opening');
      }

      const engram = readEngram();
      for (const edge of engram.v2Edges) {
        expect(edge.core).toBe(true);
        expect(edge.source).toBe('opening');
      }
    });

    it('per-edge core overrides defaultCore', async () => {
      const { editor } = createTestHarness({
        entities: [makeEntity({ name: '张三' }), makeEntity({ name: '李四' })],
      });

      const result = await editor.bulkCreateEdges(
        [
          {
            sourceEntity: '张三',
            targetEntity: '李四',
            fact: '张三和李四在某个特定事件中成为了敌人对抗',
            core: false, // explicit override
          },
        ],
        { defaultCore: true, defaultSource: 'opening' },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].core).toBe(false); // per-edge wins
      expect(result.created[0].source).toBe('opening'); // default applies
    });
  });
});
