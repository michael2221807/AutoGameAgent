import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngramEditor, EngramEditError } from '@/engine/memory/engram/engram-editor';
import type { NewEngramEntity, NewKnowledgeEdge, EngramManagerLike } from '@/engine/memory/engram/engram-editor';
import { engramEdgeId } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import type { StateManager } from '@/engine/core/state-manager';

// ─── Helpers ───

const ENGRAM_PATH = '系统.扩展.engramMemory';
const ROUND_PATH = '元数据.回合序号';
const RELATIONSHIPS_PATH = '社交.关系';

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

function createEngramState(overrides?: {
  entities?: EngramEntity[];
  v2Edges?: EngramEdge[];
  meta?: Partial<EngramStateData['meta']>;
}): EngramStateData {
  return {
    events: [],
    entities: overrides?.entities ?? [],
    relations: [],
    v2Edges: overrides?.v2Edges ?? [],
    meta: {
      lastUpdated: 0,
      eventCount: 0,
      embeddedEventCount: 0,
      embeddedEntityCount: 0,
      schemaVersion: 5,
      v2PendingReview: overrides?.meta?.v2PendingReview ?? null,
      ...overrides?.meta,
    },
  };
}

function createMockStateManager(opts?: {
  round?: number;
  engram?: EngramStateData;
  relationships?: Array<Record<string, unknown>>;
}): StateManager {
  const store = new Map<string, unknown>();
  store.set(ROUND_PATH, opts?.round ?? 3);
  store.set(ENGRAM_PATH, opts?.engram ?? createEngramState());
  if (opts?.relationships) {
    store.set(RELATIONSHIPS_PATH, opts.relationships);
  }

  return {
    get: vi.fn((path: string) => {
      const val = store.get(path);
      return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
    }),
    set: vi.fn((path: string, value: unknown) => {
      store.set(path, JSON.parse(JSON.stringify(value)));
    }),
  } as unknown as StateManager;
}

function createMockEngramManager(): EngramManagerLike & {
  withWriteLock: ReturnType<typeof vi.fn>;
  vectorizePending: ReturnType<typeof vi.fn>;
  deleteEdgeVectors: ReturnType<typeof vi.fn>;
  deleteEntityVectors: ReturnType<typeof vi.fn>;
} {
  return {
    withWriteLock: vi.fn(async (fn: () => unknown) => fn()),
    vectorizePending: vi.fn(async () => ({ vectorized: 0 })),
    deleteEdgeVectors: vi.fn(async () => {}),
    deleteEntityVectors: vi.fn(async () => {}),
  } as unknown as EngramManagerLike & {
    withWriteLock: ReturnType<typeof vi.fn>;
    vectorizePending: ReturnType<typeof vi.fn>;
    deleteEdgeVectors: ReturnType<typeof vi.fn>;
    deleteEntityVectors: ReturnType<typeof vi.fn>;
  };
}

function makeEntity(name: string, overrides?: Partial<EngramEntity>): EngramEntity {
  return {
    name,
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

function makeEdge(
  src: string,
  tgt: string,
  fact: string,
  overrides?: Partial<EngramEdge>,
): EngramEdge {
  return {
    id: engramEdgeId(src, tgt, fact),
    sourceEntity: src,
    targetEntity: tgt,
    fact,
    episodes: [],
    is_embedded: true,
    createdAtRound: 1,
    lastSeenRound: 1,
    source: 'ai',
    ...overrides,
  };
}

/** Read back the current engram from the state manager mock */
function readEngram(sm: StateManager): EngramStateData {
  return sm.get(ENGRAM_PATH) as EngramStateData;
}

/** Convenience: get the latest saved engram from the set mock */
function lastSavedEngram(sm: StateManager): EngramStateData {
  const calls = (sm.set as ReturnType<typeof vi.fn>).mock.calls
    .filter((c: unknown[]) => c[0] === ENGRAM_PATH);
  if (calls.length === 0) throw new Error('No engram saved');
  return calls[calls.length - 1][1] as EngramStateData;
}

// ─── Tests ───

describe('EngramEditor', () => {
  let sm: StateManager;
  let mgr: ReturnType<typeof createMockEngramManager>;
  let editor: EngramEditor;

  beforeEach(() => {
    sm = createMockStateManager();
    mgr = createMockEngramManager();
    editor = new EngramEditor(sm, mgr);
  });

  // ─── Entity CRUD ───

  describe('createEntity', () => {
    it('creates entity with correct fields', async () => {
      const result = await editor.createEntity({ name: 'Alice', summary: 'A brave warrior' });

      expect(result.name).toBe('Alice');
      expect(result.source).toBe('user');
      expect(result.is_embedded).toBe(false);
      expect(result.summary).toBe('A brave warrior');
      expect(result.firstSeen).toBe(3); // current round
      expect(result.lastSeen).toBe(3);
      expect(result.mentionCount).toBe(0);

      const saved = lastSavedEngram(sm);
      expect(saved.entities).toHaveLength(1);
      expect(saved.entities[0].name).toBe('Alice');
    });

    it('trims whitespace from name', async () => {
      const result = await editor.createEntity({ name: '  Alice  ' });
      expect(result.name).toBe('Alice');
    });

    it('throws NAME_EMPTY for empty name', async () => {
      await expect(editor.createEntity({ name: '' }))
        .rejects.toThrow(EngramEditError.NAME_EMPTY);
    });

    it('throws NAME_EMPTY for whitespace-only name', async () => {
      await expect(editor.createEntity({ name: '   ' }))
        .rejects.toThrow(EngramEditError.NAME_EMPTY);
    });

    it('throws NAME_DUPLICATE for existing name', async () => {
      const existingEntity = makeEntity('Alice');
      sm = createMockStateManager({
        engram: createEngramState({ entities: [existingEntity] }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.createEntity({ name: 'Alice' }))
        .rejects.toThrow(EngramEditError.NAME_DUPLICATE);
    });

    it('infers entity type when not provided', async () => {
      const result = await editor.createEntity({ name: 'SomePlace' });
      // inferEntityType is called — exact type depends on implementation,
      // but it should be one of the valid types
      expect(['player', 'npc', 'location', 'item']).toContain(result.type);
    });

    it('uses provided type over inferred', async () => {
      const result = await editor.createEntity({ name: 'Alice', type: 'location' });
      expect(result.type).toBe('location');
    });

    it('calls vectorizePending when vectorize=immediate', async () => {
      await editor.createEntity({ name: 'Alice' }, { vectorize: 'immediate' });
      expect(mgr.vectorizePending).toHaveBeenCalledWith(sm);
    });

    it('does not call vectorizePending without option', async () => {
      await editor.createEntity({ name: 'Alice' });
      expect(mgr.vectorizePending).not.toHaveBeenCalled();
    });

    it('goes through withWriteLock', async () => {
      await editor.createEntity({ name: 'Alice' });
      expect(mgr.withWriteLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateEntity', () => {
    it('updates summary and resets is_embedded', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice', { summary: 'old', is_embedded: true })],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEntity('Alice', { summary: 'new summary' });

      expect(result.summary).toBe('new summary');
      expect(result.is_embedded).toBe(false);
      expect(result.source).toBe('user');
      expect(result.userEditedAtRound).toBe(3);
    });

    it('keeps is_embedded when summary unchanged', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice', { summary: 'same', is_embedded: true })],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEntity('Alice', { summary: 'same' });
      expect(result.is_embedded).toBe(true);
    });

    it('merges attributes', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice', { attributes: { age: 25 } })],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEntity('Alice', {
        attributes: { weapon: 'sword' },
      });
      expect(result.attributes).toEqual({ age: 25, weapon: 'sword' });
    });

    it('updates type', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice', { type: 'npc' })],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEntity('Alice', { type: 'location' });
      expect(result.type).toBe('location');
    });

    it('throws ENTITY_NOT_FOUND for unknown entity', async () => {
      await expect(editor.updateEntity('Unknown', { summary: 'x' }))
        .rejects.toThrow(EngramEditError.ENTITY_NOT_FOUND);
    });
  });

  describe('renameEntity', () => {
    it('renames entity and cascades to edges', async () => {
      const edge1 = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');
      const edge2 = makeEdge('Charlie', 'Alice', 'Charlie trusts Alice very much today');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob'), makeEntity('Charlie')],
          v2Edges: [edge1, edge2],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.renameEntity('Alice', 'Alicia');

      expect(result.entity.name).toBe('Alicia');
      expect(result.entity.source).toBe('user');
      expect(result.updatedEdgeCount).toBe(2);

      const saved = lastSavedEngram(sm);
      const savedEdge1 = saved.v2Edges.find((e) =>
        e.sourceEntity === 'Alicia' && e.targetEntity === 'Bob');
      expect(savedEdge1).toBeDefined();
      expect(savedEdge1!.id).toBe(engramEdgeId('Alicia', 'Bob', 'Alice knows Bob from school times'));
      expect(savedEdge1!.is_embedded).toBe(false);

      const savedEdge2 = saved.v2Edges.find((e) =>
        e.sourceEntity === 'Charlie' && e.targetEntity === 'Alicia');
      expect(savedEdge2).toBeDefined();
    });

    it('cleans old edge vectors after rename', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');
      const oldId = edge.id;

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.renameEntity('Alice', 'Alicia');

      expect(mgr.deleteEdgeVectors).toHaveBeenCalledWith([oldId]);
    });

    it('throws ENTITY_NOT_FOUND for unknown entity', async () => {
      await expect(editor.renameEntity('Unknown', 'NewName'))
        .rejects.toThrow(EngramEditError.ENTITY_NOT_FOUND);
    });

    it('throws NAME_EMPTY for empty new name', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.renameEntity('Alice', ''))
        .rejects.toThrow(EngramEditError.NAME_EMPTY);
    });

    it('throws RENAME_CONFLICT when new name already exists', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.renameEntity('Alice', 'Bob'))
        .rejects.toThrow(EngramEditError.RENAME_CONFLICT);
    });

    it('allows renaming to same name (no-op)', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.renameEntity('Alice', 'Alice');
      expect(result.entity.name).toBe('Alice');
      expect(result.updatedEdgeCount).toBe(0);
      // No-op rename must not touch entity vectors (pins the `trimmed !== oldName` guard, L-2).
      expect(mgr.deleteEntityVectors).not.toHaveBeenCalled();
    });

    it('does not call deleteEdgeVectors when no edges affected', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.renameEntity('Alice', 'Alicia');
      expect(mgr.deleteEdgeVectors).not.toHaveBeenCalled();
    });
  });

  describe('deleteEntity', () => {
    it('cascade=true removes entity + referencing edges', async () => {
      const edge1 = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');
      const edge2 = makeEdge('Bob', 'Charlie', 'Bob and Charlie are teammates here');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob'), makeEntity('Charlie')],
          v2Edges: [edge1, edge2],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.deleteEntity('Alice', { cascade: true });

      expect(result.deletedEdgeIds).toContain(edge1.id);
      expect(result.deletedEdgeIds).not.toContain(edge2.id);

      const saved = lastSavedEngram(sm);
      expect(saved.entities).toHaveLength(2); // Bob + Charlie remain
      expect(saved.v2Edges).toHaveLength(1); // only edge2 remains
      expect(mgr.deleteEdgeVectors).toHaveBeenCalledWith([edge1.id]);
    });

    it('cascade=false removes only entity, keeps edges', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.deleteEntity('Alice', { cascade: false });

      expect(result.deletedEdgeIds).toHaveLength(0);

      const saved = lastSavedEngram(sm);
      expect(saved.entities).toHaveLength(1); // only Bob remains
      expect(saved.v2Edges).toHaveLength(1); // edge kept
      expect(mgr.deleteEdgeVectors).not.toHaveBeenCalled();
    });

    it('defaults to cascade=true when no options', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.deleteEntity('Alice');

      expect(result.deletedEdgeIds).toHaveLength(1);
    });

    it('throws ENTITY_NOT_FOUND for unknown entity', async () => {
      await expect(editor.deleteEntity('Unknown'))
        .rejects.toThrow(EngramEditError.ENTITY_NOT_FOUND);
    });

    it('cascade cleans pendingReview entries referencing removed edges', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
          meta: {
            v2PendingReview: [
              { newFact: 'some new fact here', oldEdgeId: edge.id, similarity: 0.7 },
              { newFact: 'unrelated fact here', oldEdgeId: 'other-edge-id', similarity: 0.6 },
            ],
          },
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.deleteEntity('Alice', { cascade: true });

      const saved = lastSavedEngram(sm);
      expect(saved.meta.v2PendingReview).toHaveLength(1);
      expect(saved.meta.v2PendingReview![0].oldEdgeId).toBe('other-edge-id');
    });
  });

  // ─── Edge CRUD ───

  describe('createEdge', () => {
    it('creates edge when both entities exist', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const fact = 'Alice and Bob are childhood friends since early days';
      const result = await editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'Bob',
        fact,
      });

      expect(result.edge.sourceEntity).toBe('Alice');
      expect(result.edge.targetEntity).toBe('Bob');
      expect(result.edge.fact).toBe(fact);
      expect(result.edge.id).toBe(engramEdgeId('Alice', 'Bob', fact));
      expect(result.edge.source).toBe('user');
      expect(result.edge.is_embedded).toBe(false);
      expect(result.edge.createdAtRound).toBe(3);
      expect(result.autoStubbed).toBeUndefined();

      const saved = lastSavedEngram(sm);
      expect(saved.v2Edges).toHaveLength(1);
    });

    it('auto-stubs missing entity when one exists', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'NewEntity',
        fact: 'Alice discovered NewEntity in the ancient ruins',
      });

      expect(result.autoStubbed).toEqual(['NewEntity']);

      const saved = lastSavedEngram(sm);
      expect(saved.entities).toHaveLength(2);
      const stubbed = saved.entities.find((e) => e.name === 'NewEntity');
      expect(stubbed).toBeDefined();
      expect(stubbed!._pendingEnrichment).toBe(true);
      expect(stubbed!.source).toBe('user');
    });

    it('throws NO_ENTITY when both entities are missing', async () => {
      await expect(editor.createEdge({
        sourceEntity: 'Unknown1',
        targetEntity: 'Unknown2',
        fact: 'Some fact about unknown entities here today',
      })).rejects.toThrow(EngramEditError.NO_ENTITY);
    });

    it('throws FACT_TOO_SHORT for fact < 10 chars', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'Bob',
        fact: 'short',
      })).rejects.toThrow(EngramEditError.FACT_TOO_SHORT);
    });

    it('does not auto-stub when fact is too short (I1 fix)', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'NewGuy',
        fact: 'tiny',
      })).rejects.toThrow(EngramEditError.FACT_TOO_SHORT);

      // Verify no stub was created (I1 fix: validate fact length BEFORE auto-stub)
      const saved = readEngram(sm);
      expect(saved.entities).toHaveLength(1); // only Alice
    });

    it('throws EDGE_EXISTS for duplicate edge ID', async () => {
      const fact = 'Alice and Bob are childhood friends since early days';
      const existingEdge = makeEdge('Alice', 'Bob', fact);

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [existingEdge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'Bob',
        fact,
      })).rejects.toThrow(EngramEditError.EDGE_EXISTS);
    });

    it('passes core and source from input', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.createEdge({
        sourceEntity: 'Alice',
        targetEntity: 'Bob',
        fact: 'Alice and Bob share a core relationship bond',
        core: true,
        source: 'opening',
      });

      expect(result.edge.core).toBe(true);
      // Note: createEdge always sets source='user', overriding input.source
      expect(result.edge.source).toBe('user');
    });

    it('calls vectorizePending when vectorize=immediate', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.createEdge(
        { sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice and Bob met at the academy today' },
        { vectorize: 'immediate' },
      );

      expect(mgr.vectorizePending).toHaveBeenCalledWith(sm);
    });
  });

  describe('updateEdge', () => {
    it('updates fact — new ID, old vectors cleaned', async () => {
      const oldFact = 'Alice knows Bob from the old academy school';
      const newFact = 'Alice knows Bob from the new military academy now';
      const edge = makeEdge('Alice', 'Bob', oldFact);
      const oldId = edge.id;

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEdge(oldId, { fact: newFact });

      expect(result.edge.fact).toBe(newFact);
      expect(result.edge.id).toBe(engramEdgeId('Alice', 'Bob', newFact));
      expect(result.edge.is_embedded).toBe(false);
      expect(result.edge.source).toBe('user');
      expect(result.oldEdgeId).toBe(oldId);
      expect(mgr.deleteEdgeVectors).toHaveBeenCalledWith([oldId]);
    });

    it('updates core only — no ID change, no vector cleanup', async () => {
      const fact = 'Alice knows Bob from the old academy school';
      const edge = makeEdge('Alice', 'Bob', fact, { core: false });

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEdge(edge.id, { core: true });

      expect(result.edge.core).toBe(true);
      expect(result.edge.id).toBe(edge.id); // same ID
      expect(result.oldEdgeId).toBeUndefined();
      expect(mgr.deleteEdgeVectors).not.toHaveBeenCalled();
    });

    it('updates confidence only', async () => {
      const fact = 'Alice knows Bob from the old academy school';
      const edge = makeEdge('Alice', 'Bob', fact);

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEdge(edge.id, { confidence: 0.9 });

      expect(result.edge.confidence).toBe(0.9);
      expect(result.oldEdgeId).toBeUndefined();
    });

    it('throws EDGE_NOT_FOUND for unknown edge', async () => {
      await expect(editor.updateEdge('nonexistent-id', { core: true }))
        .rejects.toThrow(EngramEditError.EDGE_NOT_FOUND);
    });

    it('throws FACT_TOO_SHORT when new fact is too short', async () => {
      const fact = 'Alice knows Bob from the old academy school';
      const edge = makeEdge('Alice', 'Bob', fact);

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await expect(editor.updateEdge(edge.id, { fact: 'tiny' }))
        .rejects.toThrow(EngramEditError.FACT_TOO_SHORT);
    });

    it('preserves is_embedded when identity unchanged', async () => {
      const fact = 'Alice knows Bob from the old academy school';
      const edge = makeEdge('Alice', 'Bob', fact, { is_embedded: true });

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.updateEdge(edge.id, { core: true });
      expect(result.edge.is_embedded).toBe(true);
    });
  });

  describe('deleteEdge', () => {
    it('removes edge and cleans vectors', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.deleteEdge(edge.id);

      const saved = lastSavedEngram(sm);
      expect(saved.v2Edges).toHaveLength(0);
      expect(mgr.deleteEdgeVectors).toHaveBeenCalledWith([edge.id]);
    });

    it('throws EDGE_NOT_FOUND for unknown edge', async () => {
      await expect(editor.deleteEdge('nonexistent-id'))
        .rejects.toThrow(EngramEditError.EDGE_NOT_FOUND);
    });

    it('cleans pendingReview entries referencing deleted edge', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
          meta: {
            v2PendingReview: [
              { newFact: 'related fact to edge', oldEdgeId: edge.id, similarity: 0.7 },
              { newFact: 'unrelated fact here', oldEdgeId: 'other-edge', similarity: 0.6 },
            ],
          },
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.deleteEdge(edge.id);

      const saved = lastSavedEngram(sm);
      expect(saved.meta.v2PendingReview).toHaveLength(1);
      expect(saved.meta.v2PendingReview![0].oldEdgeId).toBe('other-edge');
    });

    it('handles null pendingReview gracefully', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
          meta: { v2PendingReview: null },
        }),
      });
      editor = new EngramEditor(sm, mgr);

      // Should not throw
      await editor.deleteEdge(edge.id);
      const saved = lastSavedEngram(sm);
      expect(saved.v2Edges).toHaveLength(0);
    });
  });

  describe('markEdgeCore', () => {
    it('toggles core to true', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times', { core: false });

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.markEdgeCore(edge.id, true);
      expect(result.core).toBe(true);

      const saved = lastSavedEngram(sm);
      expect(saved.v2Edges[0].core).toBe(true);
    });

    it('toggles core to false', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times', { core: true });

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.markEdgeCore(edge.id, false);
      expect(result.core).toBe(false);
    });

    it('throws EDGE_NOT_FOUND for unknown edge', async () => {
      await expect(editor.markEdgeCore('nonexistent-id', true))
        .rejects.toThrow(EngramEditError.EDGE_NOT_FOUND);
    });
  });

  // ─── Bulk operations ───

  describe('bulkCreateEntities', () => {
    it('creates multiple entities in batch', async () => {
      const inputs: NewEngramEntity[] = [
        { name: 'Alice' },
        { name: 'Bob', type: 'npc', summary: 'A merchant' },
        { name: 'Castle', type: 'location' },
      ];

      const result = await editor.bulkCreateEntities(inputs);

      expect(result.created).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);
      expect(result.created.map((e) => e.name)).toEqual(['Alice', 'Bob', 'Castle']);

      const saved = lastSavedEngram(sm);
      expect(saved.entities).toHaveLength(3);
    });

    it('skips empty names and duplicates', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const inputs: NewEngramEntity[] = [
        { name: '' },           // empty
        { name: 'Alice' },      // duplicate
        { name: 'Bob' },        // valid
        { name: '  ' },         // whitespace
      ];

      const result = await editor.bulkCreateEntities(inputs);

      expect(result.created).toHaveLength(1);
      expect(result.created[0].name).toBe('Bob');
      expect(result.skipped).toHaveLength(3);
      expect(result.skipped[0].reason).toBe(EngramEditError.NAME_EMPTY);
      expect(result.skipped[1].reason).toBe(EngramEditError.NAME_DUPLICATE);
      expect(result.skipped[2].reason).toBe(EngramEditError.NAME_EMPTY);
    });

    it('does not save when nothing created', async () => {
      const result = await editor.bulkCreateEntities([{ name: '' }]);

      expect(result.created).toHaveLength(0);
      // set should not be called for engram path
      const setCalls = (sm.set as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === ENGRAM_PATH);
      expect(setCalls).toHaveLength(0);
    });

    it('prevents intra-batch duplicates', async () => {
      const inputs: NewEngramEntity[] = [
        { name: 'Alice' },
        { name: 'Alice' },
      ];

      const result = await editor.bulkCreateEntities(inputs);

      expect(result.created).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe(EngramEditError.NAME_DUPLICATE);
    });
  });

  describe('bulkCreateEdges', () => {
    it('creates multiple edges, best-effort with partial failure', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob'), makeEntity('Charlie')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const inputs: NewKnowledgeEdge[] = [
        { sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice and Bob are childhood friends since young' },
        { sourceEntity: 'Alice', targetEntity: 'Charlie', fact: 'short' }, // too short
        { sourceEntity: 'Unknown1', targetEntity: 'Unknown2', fact: 'Both entities are missing from state' }, // no entity
      ];

      const result = await editor.bulkCreateEdges(inputs);

      expect(result.created).toHaveLength(1);
      expect(result.created[0].sourceEntity).toBe('Alice');
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped.find((s) => s.reason === EngramEditError.FACT_TOO_SHORT)).toBeDefined();
      expect(result.skipped.find((s) => s.reason === EngramEditError.NO_ENTITY)).toBeDefined();
    });

    it('applies defaultCore when edge.core is undefined', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{ sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice and Bob share an ancient bond today' }],
        { defaultCore: true },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].core).toBe(true);
    });

    it('edge-level core overrides defaultCore', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{
          sourceEntity: 'Alice',
          targetEntity: 'Bob',
          fact: 'Alice and Bob share an ancient bond today',
          core: false,
        }],
        { defaultCore: true },
      );

      expect(result.created[0].core).toBe(false);
    });

    it('applies defaultSource when edge.source is undefined', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{ sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice and Bob share an ancient bond today' }],
        { defaultSource: 'opening' },
      );

      expect(result.created[0].source).toBe('opening');
    });

    it('edge-level source overrides defaultSource', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{
          sourceEntity: 'Alice',
          targetEntity: 'Bob',
          fact: 'Alice and Bob share an ancient bond today',
          source: 'card-import',
        }],
        { defaultSource: 'opening' },
      );

      expect(result.created[0].source).toBe('card-import');
    });

    it('auto-stubs missing entity in bulk mode', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges([
        { sourceEntity: 'Alice', targetEntity: 'NewGuy', fact: 'Alice met NewGuy at the festival celebration' },
      ]);

      expect(result.created).toHaveLength(1);
      const saved = lastSavedEngram(sm);
      const stub = saved.entities.find((e) => e.name === 'NewGuy');
      expect(stub).toBeDefined();
      expect(stub!._pendingEnrichment).toBe(true);
    });

    it('skips duplicate edge IDs', async () => {
      const fact = 'Alice and Bob share an ancient bond today';
      const existingEdge = makeEdge('Alice', 'Bob', fact);

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [existingEdge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges([
        { sourceEntity: 'Alice', targetEntity: 'Bob', fact },
      ]);

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe(EngramEditError.EDGE_EXISTS);
    });

    it('does not save when nothing created', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.bulkCreateEdges([
        { sourceEntity: 'Unknown1', targetEntity: 'Unknown2', fact: 'Both entities missing from state' },
      ]);

      const setCalls = (sm.set as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === ENGRAM_PATH);
      expect(setCalls).toHaveLength(0);
    });
  });

  // ─── Coverage Stats ───

  describe('getCoverageStats', () => {
    it('returns 100% for empty NPC list + empty engram', () => {
      sm = createMockStateManager({
        relationships: [],
      });
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();

      expect(stats.totalNpcs).toBe(0);
      expect(stats.npcsWithEntity).toBe(0);
      expect(stats.missingNpcNames).toEqual([]);
      expect(stats.coveragePercent).toBe(100);
    });

    it('returns 0% with missing list when NPCs exist but engram is empty', () => {
      sm = createMockStateManager({
        relationships: [
          { '名称': 'Alice' },
          { '名称': 'Bob' },
        ],
      });
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();

      expect(stats.totalNpcs).toBe(2);
      expect(stats.npcsWithEntity).toBe(0);
      expect(stats.missingNpcNames).toEqual(['Alice', 'Bob']);
      expect(stats.coveragePercent).toBe(0);
    });

    it('returns correct partial coverage', () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
        relationships: [
          { '名称': 'Alice' },
          { '名称': 'Bob' },
          { '名称': 'Charlie' },
        ],
      });
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();

      expect(stats.totalNpcs).toBe(3);
      expect(stats.npcsWithEntity).toBe(1);
      expect(stats.missingNpcNames).toEqual(['Bob', 'Charlie']);
      expect(stats.coveragePercent).toBe(33); // Math.round(1/3 * 100)
    });

    it('returns 100% when all NPCs have entities', () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
        relationships: [
          { '名称': 'Alice' },
          { '名称': 'Bob' },
        ],
      });
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();

      expect(stats.totalNpcs).toBe(2);
      expect(stats.npcsWithEntity).toBe(2);
      expect(stats.missingNpcNames).toEqual([]);
      expect(stats.coveragePercent).toBe(100);
    });

    it('ignores NPCs with empty/missing name field', () => {
      sm = createMockStateManager({
        engram: createEngramState(),
        relationships: [
          { '名称': 'Alice' },
          { '名称': '' },       // empty name
          { '名称': '  ' },     // whitespace — will be trimmed to non-empty
          { other: 'data' },    // missing name field
        ],
      });
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();

      // '  ' trims to non-empty so is included; '' and missing are excluded
      // Actually, looking at the code: `name.trim()` is checked — '  ' will pass
      // the `name.trim()` test since '  '.trim() === '' which is falsy
      // Wait, re-read: `typeof name === 'string' && name.trim()` — '  '.trim() is ''
      // which is falsy, so it's excluded
      expect(stats.totalNpcs).toBe(1); // only 'Alice'
    });

    it('handles undefined relationships path gracefully', () => {
      // No relationships set in state
      sm = createMockStateManager();
      editor = new EngramEditor(sm, mgr);

      const stats = editor.getCoverageStats();
      expect(stats.totalNpcs).toBe(0);
      expect(stats.coveragePercent).toBe(100);
    });

    it('uses custom npcNameField from pathOverrides', () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice')],
        }),
        relationships: [
          { 'customName': 'Alice' },
          { 'customName': 'Bob' },
        ],
      });
      editor = new EngramEditor(sm, mgr, { npcNameField: 'customName' });

      const stats = editor.getCoverageStats();
      expect(stats.totalNpcs).toBe(2);
      expect(stats.npcsWithEntity).toBe(1);
    });
  });

  // ─── OQ-3 Signature Extension (FactBuilder) — tested via bulkCreateEdges ───

  describe('OQ-3 FactBuilder signature extension via bulkCreateEdges', () => {
    it('defaultCore=true makes new edges core=true', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{ sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice is the leader of the guild council' }],
        { defaultCore: true },
      );

      expect(result.created[0].core).toBe(true);
    });

    it('defaultSource=opening makes new edge source=opening', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{ sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice is the leader of the guild council' }],
        { defaultSource: 'opening' },
      );

      expect(result.created[0].source).toBe('opening');
    });

    it('without options: core=undefined, source=user', async () => {
      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkCreateEdges(
        [{ sourceEntity: 'Alice', targetEntity: 'Bob', fact: 'Alice is the leader of the guild council' }],
      );

      expect(result.created[0].core).toBeUndefined();
      expect(result.created[0].source).toBe('user');
    });
  });

  // ─── Pending review cleanup (C5) ───

  describe('pendingReview cleanup', () => {
    it('deleteEdge removes matching pendingReview entries', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
          meta: {
            v2PendingReview: [
              { newFact: 'new version of fact', oldEdgeId: edge.id, similarity: 0.8 },
              { newFact: 'another pending fact', oldEdgeId: edge.id, similarity: 0.75 },
              { newFact: 'unrelated pending entry', oldEdgeId: 'other-edge-id', similarity: 0.6 },
            ],
          },
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.deleteEdge(edge.id);

      const saved = lastSavedEngram(sm);
      expect(saved.meta.v2PendingReview).toHaveLength(1);
      expect(saved.meta.v2PendingReview![0].oldEdgeId).toBe('other-edge-id');
    });

    it('deleteEntity cascade removes matching pendingReview entries', async () => {
      const edge1 = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');
      const edge2 = makeEdge('Alice', 'Charlie', 'Alice trusts Charlie a great deal');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob'), makeEntity('Charlie')],
          v2Edges: [edge1, edge2],
          meta: {
            v2PendingReview: [
              { newFact: 'pending for edge1', oldEdgeId: edge1.id, similarity: 0.7 },
              { newFact: 'pending for edge2', oldEdgeId: edge2.id, similarity: 0.65 },
              { newFact: 'unrelated pending fact', oldEdgeId: 'edge-between-bob-charlie', similarity: 0.5 },
            ],
          },
        }),
      });
      editor = new EngramEditor(sm, mgr);

      await editor.deleteEntity('Alice', { cascade: true });

      const saved = lastSavedEngram(sm);
      expect(saved.meta.v2PendingReview).toHaveLength(1);
      expect(saved.meta.v2PendingReview![0].oldEdgeId).toBe('edge-between-bob-charlie');
    });
  });

  // ─── Edge cases / constructor ───

  describe('constructor pathOverrides', () => {
    it('uses default paths when no overrides', async () => {
      const localSm = createMockStateManager();
      const localEditor = new EngramEditor(localSm, mgr);

      await localEditor.createEntity({ name: 'Test' });

      // stateManager.get should be called with the default engram path
      expect(localSm.get).toHaveBeenCalledWith(ENGRAM_PATH);
    });

    it('uses custom paths when overrides provided', async () => {
      const customPaths = {
        engramMemory: 'custom.engram',
        roundNumber: 'custom.round',
        relationships: 'custom.rels',
        npcNameField: 'customName',
      };

      const customStore = new Map<string, unknown>();
      customStore.set('custom.round', 5);
      customStore.set('custom.engram', createEngramState());

      const customSm = {
        get: vi.fn((path: string) => {
          const val = customStore.get(path);
          return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
        }),
        set: vi.fn((path: string, value: unknown) => {
          customStore.set(path, JSON.parse(JSON.stringify(value)));
        }),
      } as unknown as StateManager;

      const customEditor = new EngramEditor(customSm, mgr, customPaths);

      await customEditor.createEntity({ name: 'Test' });

      expect(customSm.get).toHaveBeenCalledWith('custom.engram');
      expect(customSm.set).toHaveBeenCalledWith('custom.engram', expect.any(Object), 'system');
    });
  });

  describe('vectorizePending', () => {
    it('delegates to engramManager.vectorizePending', async () => {
      mgr.vectorizePending.mockResolvedValueOnce({ vectorized: 5 });

      const result = await editor.vectorizePending();

      expect(result).toEqual({ vectorized: 5 });
      expect(mgr.vectorizePending).toHaveBeenCalledWith(sm);
    });
  });

  describe('bulkMarkEdgesCore', () => {
    it('marks multiple edges as core', async () => {
      const edge1 = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');
      const edge2 = makeEdge('Alice', 'Charlie', 'Alice trusts Charlie a great deal');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob'), makeEntity('Charlie')],
          v2Edges: [edge1, edge2],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkMarkEdgesCore([edge1.id, edge2.id], true);

      expect(result.updated).toBe(2);
      expect(result.notFound).toHaveLength(0);

      const saved = lastSavedEngram(sm);
      expect(saved.v2Edges[0].core).toBe(true);
      expect(saved.v2Edges[1].core).toBe(true);
    });

    it('reports notFound for missing edges', async () => {
      const edge = makeEdge('Alice', 'Bob', 'Alice knows Bob from school times');

      sm = createMockStateManager({
        engram: createEngramState({
          entities: [makeEntity('Alice'), makeEntity('Bob')],
          v2Edges: [edge],
        }),
      });
      editor = new EngramEditor(sm, mgr);

      const result = await editor.bulkMarkEdgesCore([edge.id, 'nonexistent-id'], true);

      expect(result.updated).toBe(1);
      expect(result.notFound).toEqual(['nonexistent-id']);
    });

    it('does not save when nothing updated', async () => {
      const result = await editor.bulkMarkEdgesCore(['nonexistent'], true);

      expect(result.updated).toBe(0);
      const setCalls = (sm.set as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === ENGRAM_PATH);
      expect(setCalls).toHaveLength(0);
    });
  });
});
