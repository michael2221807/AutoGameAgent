// Architecture: docs/architecture/engram-v2-graphiti-alignment.md
/**
 * FactBuilder — V2 knowledge fact extraction, validation, and dedup.
 *
 * Replaces KnowledgeEdgeBuilder for Engram V2 (Graphiti alignment).
 * Each fact is a complete natural-language sentence connecting two entities.
 *
 * Design doc: docs/architecture/engram-v2-graphiti-alignment.md §3.2.4
 */
import type { EngramEdge } from './knowledge-edge';
import { engramEdgeId, isEdgeCurrentlyValid } from './knowledge-edge';
import type { EngramEntity } from './entity-builder';
import type { VectorStore } from './vector-store';

export interface KnowledgeFact {
  fact: string;
  sourceEntity: string;
  targetEntity: string;
}

export interface FactBuilderParams {
  knowledgeFacts: KnowledgeFact[];
  entities: EngramEntity[];
  currentEventId: string | null;
  currentRound: number;
}

export interface FactBuildResult {
  newEdges: EngramEdge[];
  reinforcedIds: string[];
  pendingReviewPairs: Array<{ newFact: string; oldEdgeId: string; similarity: number }>;
  renamedEdgeIds: Array<{ oldId: string; newId: string }>;
}

export function buildFacts(
  params: FactBuilderParams,
  existingEdges: EngramEdge[],
  vectorStore: VectorStore | null,
  edgeVectors: Record<string, number[]>,
  newFactVectors: Map<string, number[]>,
): FactBuildResult {
  const { knowledgeFacts, entities, currentEventId, currentRound } = params;
  const entityNames = new Set(entities.map((e) => e.name));

  const edgeMap = new Map(existingEdges.map((e) => [e.id, e]));
  const newEdges: EngramEdge[] = [];
  const reinforcedIds: string[] = [];
  const pendingReviewPairs: FactBuildResult['pendingReviewPairs'] = [];
  const renamedEdgeIds: FactBuildResult['renamedEdgeIds'] = [];
  const reviewedEdgeIds = new Set<string>();

  for (const kf of knowledgeFacts) {
    // Step 1: Pre-filter
    if (kf.fact.length < 10) continue;
    // Both entities unknown → reject
    if (!entityNames.has(kf.sourceEntity) && !entityNames.has(kf.targetEntity)) continue;
    // Reject descriptive phrases masquerading as entity names
    // Heuristic: unknown entity + contains sentence-like markers (commas, verbs, particles)
    const isSentenceLike = (s: string) => s.length > 6 && /[，。了的被在过着得让把将与从]/.test(s);
    if (!entityNames.has(kf.sourceEntity) && isSentenceLike(kf.sourceEntity)) continue;
    if (!entityNames.has(kf.targetEntity) && isSentenceLike(kf.targetEntity)) continue;

    const id = engramEdgeId(kf.sourceEntity, kf.targetEntity, kf.fact);

    // Step 2: Exact dedup
    const existing = edgeMap.get(id);
    if (existing) {
      if (currentEventId && !existing.episodes.includes(currentEventId)) {
        existing.episodes.push(currentEventId);
      }
      existing.lastSeenRound = currentRound;
      if (!isEdgeCurrentlyValid(existing)) {
        existing.invalidatedAtRound = undefined;
        existing.invalidAtRound = undefined;
        existing.temporalStatus = undefined;
      }
      reinforcedIds.push(id);
      continue;
    }

    // Step 3: Same-entity-pair semantic dedup
    const newVec = newFactVectors.get(kf.fact);
    let isDuplicate = false;

    if (newVec && vectorStore) {
      const srcLower = kf.sourceEntity.toLowerCase();
      const tgtLower = kf.targetEntity.toLowerCase();

      for (const edge of existingEdges) {
        if (!isEdgeCurrentlyValid(edge)) continue;
        const eSrc = edge.sourceEntity.toLowerCase();
        const eTgt = edge.targetEntity.toLowerCase();
        const sameEntityPair = (eSrc === srcLower && eTgt === tgtLower) || (eSrc === tgtLower && eTgt === srcLower);
        if (!sameEntityPair) continue;

        const oldVec = edgeVectors[edge.id];
        if (!oldVec) continue;

        const sim = vectorStore.cosineSimilarity(newVec, oldVec);
        if (sim > 0.85) {
          // Duplicate — reinforce existing, use longer fact text
          if (kf.fact.length > edge.fact.length) {
            const oldId = edge.id;
            edge.fact = kf.fact;
            edge.id = engramEdgeId(edge.sourceEntity, edge.targetEntity, edge.fact);
            edge.is_embedded = false;
            edgeMap.delete(oldId);
            edgeMap.set(edge.id, edge);
            renamedEdgeIds.push({ oldId, newId: edge.id });
            delete edgeVectors[oldId];
          }
          if (currentEventId && !edge.episodes.includes(currentEventId)) {
            edge.episodes.push(currentEventId);
          }
          edge.lastSeenRound = currentRound;
          reinforcedIds.push(edge.id);
          isDuplicate = true;
          break;
        } else if (sim > 0.5) {
          if (!reviewedEdgeIds.has(edge.id)) {
            pendingReviewPairs.push({ newFact: kf.fact, oldEdgeId: edge.id, similarity: sim });
            reviewedEdgeIds.add(edge.id);
          }
        }
      }
    }

    if (isDuplicate) continue;

    // Step 4: Broader semantic search (all edges, not just same entity pair) — top-10 cap
    if (newVec && vectorStore) {
      const broadCandidates: Array<{ edgeId: string; sim: number }> = [];
      for (const edge of existingEdges) {
        if (!isEdgeCurrentlyValid(edge)) continue;
        const oldVec = edgeVectors[edge.id];
        if (!oldVec) continue;
        const srcLower = kf.sourceEntity.toLowerCase();
        const tgtLower = kf.targetEntity.toLowerCase();
        const eSrc = edge.sourceEntity.toLowerCase();
        const eTgt = edge.targetEntity.toLowerCase();
        if ((eSrc === srcLower && eTgt === tgtLower) || (eSrc === tgtLower && eTgt === srcLower)) continue;

        const sim = vectorStore.cosineSimilarity(newVec, oldVec);
        if (sim > 0.5) {
          broadCandidates.push({ edgeId: edge.id, sim });
        }
      }
      broadCandidates.sort((a, b) => b.sim - a.sim);
      for (const bc of broadCandidates.slice(0, 10)) {
        if (!reviewedEdgeIds.has(bc.edgeId)) {
          pendingReviewPairs.push({ newFact: kf.fact, oldEdgeId: bc.edgeId, similarity: bc.sim });
          reviewedEdgeIds.add(bc.edgeId);
        }
      }
    }

    // Step 4.5: Intra-round dedup — check against edges created earlier THIS round
    if (newVec && vectorStore) {
      let intraRoundDup = false;
      for (const ne of newEdges) {
        const neVec = newFactVectors.get(ne.fact);
        if (!neVec) continue;
        const sim = vectorStore.cosineSimilarity(newVec, neVec);
        if (sim > 0.85) {
          if (kf.fact.length > ne.fact.length) {
            ne.fact = kf.fact;
            ne.id = engramEdgeId(ne.sourceEntity, ne.targetEntity, ne.fact);
            ne.is_embedded = false;
          }
          if (currentEventId && !ne.episodes.includes(currentEventId)) {
            ne.episodes.push(currentEventId);
          }
          reinforcedIds.push(ne.id);
          intraRoundDup = true;
          break;
        }
      }
      if (intraRoundDup) continue;
    }

    // Step 5: Create new edge
    newEdges.push({
      id,
      sourceEntity: kf.sourceEntity,
      targetEntity: kf.targetEntity,
      fact: kf.fact,
      episodes: currentEventId ? [currentEventId] : [],
      is_embedded: false,
      createdAtRound: currentRound,
      lastSeenRound: currentRound,
      learnedAtRound: currentRound,
    });
  }

  return { newEdges, reinforcedIds, pendingReviewPairs, renamedEdgeIds };
}

export function pruneEdgesV2(
  edges: EngramEdge[],
  currentRound: number,
  capacity: number = 800,
): EngramEdge[] {
  // Invalidated edges decay faster
  const scored = edges.map((e) => {
    const age = Math.max(0, currentRound - e.lastSeenRound);
    const isInvalidated = !isEdgeCurrentlyValid(e);
    const decayRate = isInvalidated ? 0.9 : 0.97;
    const invalidPenalty = isInvalidated ? 0.3 : 1.0;
    const score = Math.pow(decayRate, age / 10) * (e.episodes.length > 1 ? 1.2 : 1.0) * invalidPenalty;
    return { edge: e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, capacity).map((s) => s.edge);
}
