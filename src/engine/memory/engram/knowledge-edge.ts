/**
 * Engram V2 — Graphiti-aligned edge (fact-bearing)
 * Design doc: docs/architecture/engram-v2-graphiti-alignment.md §3.1
 */

export interface EngramEdge {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  fact: string;
  episodes: string[];
  is_embedded: boolean;
  createdAtRound: number;
  lastSeenRound: number;
  /** @deprecated Use invalidAtRound. Kept as alias for backward compatibility. */
  invalidatedAtRound?: number;
  /** When the engine first learned this fact (defaults to createdAtRound for old edges) */
  learnedAtRound?: number;
  /** When the fact became true in the story, if known */
  validAtRound?: number;
  /** When the fact stopped being true in the story */
  invalidAtRound?: number;
  /** AI confidence score (0-1) */
  confidence?: number;
  /** Edge status for temporal queries */
  temporalStatus?: 'historical' | 'superseded';
}

export function isEdgeCurrentlyValid(edge: EngramEdge): boolean {
  if (edge.temporalStatus === 'historical' || edge.temporalStatus === 'superseded') return false;
  return edge.invalidAtRound == null && edge.invalidatedAtRound == null;
}

export function engramEdgeId(source: string, target: string, fact: string): string {
  const factSlug = fact.toLowerCase().replace(/\s+/g, '').slice(0, 40);
  return `${source.toLowerCase()}|${target.toLowerCase()}|${factSlug}`;
}
