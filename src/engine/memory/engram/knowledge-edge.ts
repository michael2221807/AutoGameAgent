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
  invalidatedAtRound?: number;
}

export function engramEdgeId(source: string, target: string, fact: string): string {
  const factSlug = fact.toLowerCase().replace(/\s+/g, '').slice(0, 40);
  return `${source.toLowerCase()}|${target.toLowerCase()}|${factSlug}`;
}
