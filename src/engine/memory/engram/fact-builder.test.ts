import { describe, it, expect } from 'vitest';
import { buildFacts } from '@/engine/memory/engram/fact-builder';
import type { FactBuilderParams } from '@/engine/memory/engram/fact-builder';
import { engramEdgeId } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import type { VectorStore } from '@/engine/memory/engram/vector-store';
import { pruneEdgesV2 } from '@/engine/memory/engram/fact-builder';

// ─── Helpers ───

function makeEntity(
  name: string,
  type: EngramEntity['type'] = 'npc',
): EngramEntity {
  return {
    name,
    type,
    summary: '',
    attributes: {},
    firstSeen: 1,
    lastSeen: 1,
    mentionCount: 1,
    is_embedded: false,
  };
}

function makeEdge(overrides: Partial<EngramEdge> = {}): EngramEdge {
  const base: EngramEdge = {
    id: 'default-id',
    sourceEntity: 'Alice',
    targetEntity: 'Bob',
    fact: 'Alice knows Bob from the academy',
    episodes: ['ep-1'],
    is_embedded: true,
    createdAtRound: 1,
    lastSeenRound: 1,
  };
  return { ...base, ...overrides };
}

function makeMockVectorStore(simValue: number): VectorStore {
  return {
    cosineSimilarity: () => simValue,
  } as unknown as VectorStore;
}

// ─── buildFacts ───

describe('buildFacts', () => {
  it('rejects short facts', () => {
    const params: FactBuilderParams = {
      knowledgeFacts: [{ fact: '短', sourceEntity: 'Alice', targetEntity: 'Bob' }],
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      currentEventId: 'ev-1',
      currentRound: 5,
    };

    const result = buildFacts(params, [], null, {}, new Map());

    expect(result.newEdges).toHaveLength(0);
    expect(result.reinforcedIds).toHaveLength(0);
  });

  it('rejects descriptive phrase entities', () => {
    const params: FactBuilderParams = {
      knowledgeFacts: [
        {
          fact: 'This is a valid fact sentence for testing purposes',
          sourceEntity: '这是一个很长的描述性句子',
          targetEntity: 'Bob',
        },
      ],
      entities: [makeEntity('Bob')],
      currentEventId: 'ev-1',
      currentRound: 5,
    };

    const result = buildFacts(params, [], null, {}, new Map());

    expect(result.newEdges).toHaveLength(0);
  });

  it('rejects when both entities are unknown', () => {
    const params: FactBuilderParams = {
      knowledgeFacts: [
        {
          fact: 'This is a valid fact sentence for testing purposes',
          sourceEntity: 'Unknown1',
          targetEntity: 'Unknown2',
        },
      ],
      entities: [makeEntity('Alice')],
      currentEventId: 'ev-1',
      currentRound: 5,
    };

    const result = buildFacts(params, [], null, {}, new Map());

    expect(result.newEdges).toHaveLength(0);
  });

  it('exact dedup reinforces episodes', () => {
    const fact = 'Alice and Bob trained together at the academy';
    const edgeId = engramEdgeId('Alice', 'Bob', fact);
    const existingEdge = makeEdge({
      id: edgeId,
      sourceEntity: 'Alice',
      targetEntity: 'Bob',
      fact,
      episodes: ['ep-1'],
      lastSeenRound: 3,
    });

    const params: FactBuilderParams = {
      knowledgeFacts: [{ fact, sourceEntity: 'Alice', targetEntity: 'Bob' }],
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      currentEventId: 'ev-2',
      currentRound: 7,
    };

    const result = buildFacts(params, [existingEdge], null, {}, new Map());

    expect(result.newEdges).toHaveLength(0);
    expect(result.reinforcedIds).toContain(edgeId);
    expect(existingEdge.episodes).toContain('ev-2');
    expect(existingEdge.lastSeenRound).toBe(7);
  });

  it('exact dedup reactivates invalidated edge', () => {
    const fact = 'Alice is the student of Bob at the academy grounds';
    const edgeId = engramEdgeId('Alice', 'Bob', fact);
    const invalidatedEdge = makeEdge({
      id: edgeId,
      sourceEntity: 'Alice',
      targetEntity: 'Bob',
      fact,
      episodes: ['ep-1'],
      lastSeenRound: 3,
      invalidatedAtRound: 4,
      invalidAtRound: 4,
      temporalStatus: 'historical' as const,
    });

    const params: FactBuilderParams = {
      knowledgeFacts: [{ fact, sourceEntity: 'Alice', targetEntity: 'Bob' }],
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      currentEventId: 'ev-5',
      currentRound: 5,
    };

    const result = buildFacts(params, [invalidatedEdge], null, {}, new Map());

    expect(result.newEdges).toHaveLength(0);
    expect(result.reinforcedIds).toContain(edgeId);
    expect(invalidatedEdge.invalidatedAtRound).toBeUndefined();
    expect(invalidatedEdge.invalidAtRound).toBeUndefined();
    expect(invalidatedEdge.temporalStatus).toBeUndefined();
    expect(invalidatedEdge.lastSeenRound).toBe(5);
  });

  it('cosine duplicate keeps longer fact and renames ID', () => {
    const shortFact = 'Alice met Bob at the academy grounds';
    const longFact = 'Alice met Bob at the prestigious academy grounds during the entrance ceremony';
    const oldId = engramEdgeId('Alice', 'Bob', shortFact);

    const existingEdge = makeEdge({
      id: oldId,
      sourceEntity: 'Alice',
      targetEntity: 'Bob',
      fact: shortFact,
      episodes: ['ep-1'],
      is_embedded: true,
    });

    const vectorStore = makeMockVectorStore(0.9);
    const edgeVectors: Record<string, number[]> = { [oldId]: [1, 0, 0] };
    const newFactVectors = new Map<string, number[]>([[longFact, [0.9, 0.1, 0]]]);

    const params: FactBuilderParams = {
      knowledgeFacts: [{ fact: longFact, sourceEntity: 'Alice', targetEntity: 'Bob' }],
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      currentEventId: 'ev-2',
      currentRound: 5,
    };

    const result = buildFacts(params, [existingEdge], vectorStore, edgeVectors, newFactVectors);

    expect(result.newEdges).toHaveLength(0);
    expect(result.renamedEdgeIds).toHaveLength(1);
    expect(result.renamedEdgeIds[0].oldId).toBe(oldId);

    const expectedNewId = engramEdgeId('Alice', 'Bob', longFact);
    expect(result.renamedEdgeIds[0].newId).toBe(expectedNewId);
    expect(existingEdge.fact).toBe(longFact);
    expect(existingEdge.id).toBe(expectedNewId);
    expect(existingEdge.is_embedded).toBe(false);
  });

  it('pending review pair produced for similarity 0.5-0.85', () => {
    const existingFact = 'Alice trained at the academy for three years';
    const newFact = 'Alice spent a long time studying at the academy institution';
    const existingId = engramEdgeId('Alice', 'Bob', existingFact);

    const existingEdge = makeEdge({
      id: existingId,
      sourceEntity: 'Alice',
      targetEntity: 'Bob',
      fact: existingFact,
      episodes: ['ep-1'],
    });

    const vectorStore = makeMockVectorStore(0.7);
    const edgeVectors: Record<string, number[]> = { [existingId]: [1, 0, 0] };
    const newFactVectors = new Map<string, number[]>([[newFact, [0.7, 0.3, 0]]]);

    const params: FactBuilderParams = {
      knowledgeFacts: [{ fact: newFact, sourceEntity: 'Alice', targetEntity: 'Bob' }],
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      currentEventId: 'ev-2',
      currentRound: 5,
    };

    const result = buildFacts(params, [existingEdge], vectorStore, edgeVectors, newFactVectors);

    expect(result.newEdges).toHaveLength(1);
    expect(result.newEdges[0].fact).toBe(newFact);

    expect(result.pendingReviewPairs.length).toBeGreaterThanOrEqual(1);
    const pair = result.pendingReviewPairs.find((p) => p.oldEdgeId === existingId);
    expect(pair).toBeDefined();
    expect(pair!.newFact).toBe(newFact);
    expect(pair!.similarity).toBe(0.7);
  });

  it('intra-round duplicate merged', () => {
    const fact1 = 'Alice went to the market to buy supplies yesterday';
    const fact2 = 'Alice visited the market for purchasing supplies and equipment recently';

    const vectorStore = makeMockVectorStore(0.9);
    const newFactVectors = new Map<string, number[]>([
      [fact1, [1, 0, 0]],
      [fact2, [0.95, 0.05, 0]],
    ]);

    const params: FactBuilderParams = {
      knowledgeFacts: [
        { fact: fact1, sourceEntity: 'Alice', targetEntity: 'Market' },
        { fact: fact2, sourceEntity: 'Alice', targetEntity: 'Market' },
      ],
      entities: [makeEntity('Alice'), makeEntity('Market', 'location')],
      currentEventId: 'ev-1',
      currentRound: 5,
    };

    const result = buildFacts(params, [], vectorStore, {}, newFactVectors);

    expect(result.newEdges).toHaveLength(1);
    // fact2 is longer so the merged edge should use fact2
    expect(result.newEdges[0].fact).toBe(fact2);
    expect(result.newEdges[0].id).toBe(engramEdgeId('Alice', 'Market', fact2));
  });
});

// ─── pruneEdgesV2 ───

describe('pruneEdgesV2', () => {
  it('respects capacity', () => {
    const edges = Array.from({ length: 5 }, (_, i) =>
      makeEdge({
        id: `edge-${i}`,
        episodes: ['ep-1'],
        createdAtRound: 1,
        lastSeenRound: 1,
      }),
    );

    const result = pruneEdgesV2(edges, 10, 3);

    expect(result).toHaveLength(3);
  });

  it('invalidated edges score lower', () => {
    const validEdge = makeEdge({
      id: 'valid',
      episodes: ['ep-1'],
      createdAtRound: 1,
      lastSeenRound: 5,
    });
    const invalidatedEdge = makeEdge({
      id: 'invalidated',
      episodes: ['ep-1'],
      createdAtRound: 1,
      lastSeenRound: 5,
      invalidatedAtRound: 4,
    });

    const result = pruneEdgesV2([invalidatedEdge, validEdge], 10, 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid');
  });

  it('multi-episode edges score higher', () => {
    const multiEpisode = makeEdge({
      id: 'multi',
      episodes: ['ep-1', 'ep-2'],
      createdAtRound: 1,
      lastSeenRound: 5,
    });
    const singleEpisode = makeEdge({
      id: 'single',
      episodes: ['ep-1'],
      createdAtRound: 1,
      lastSeenRound: 5,
    });

    const result = pruneEdgesV2([singleEpisode, multiEpisode], 10, 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('multi');
  });
});
