/**
 * Engram import builder — Story 6 P3.
 *
 * A game card carries ONLY the engram entities + knowledge edges (events / legacy
 * relations / vectors are stripped at export). This rebuilds the COMPLETE engram state
 * block that `EngramManager.loadEngram` expects, ready to be written into the imported
 * save's state tree at the engram path (P5 orchestrates the write + re-embed).
 *
 * ⚠️ The events:[] trap — `EngramManager.loadEngram` (engram-manager.ts:675) returns
 * `createEmpty()` (silently discarding the ENTIRE graph) unless `Array.isArray(raw.events)`.
 * So `events` MUST be written as an array. The card has no events → `events: []`.
 *
 * On import every entity/edge is (re)stamped `source: 'card-import'` (uniform provenance)
 * and `is_embedded: false` — the importer re-embeds via `vectorizePending` after the new
 * slot is activated (P5). When no embedder is configured, re-embedding is skipped and the
 * import reports `retrievalDegraded` (P5); the graph still loads, retrieval is just degraded.
 *
 * Engine-layer rule: operates purely on engram types; no game-specific field paths.
 */
import type { EngramEntity } from './entity-builder';
import type { EngramEdge } from './knowledge-edge';
import type { EngramEventNode } from './event-builder';
import type { EngramRelation } from './engram-types';
import { ENGRAM_SCHEMA_VERSION } from './engram-types';

/** Card-side engram payload (mirrors `GameCardBundle.engram`). */
export interface CardEngramPayload {
  entities: EngramEntity[];
  knowledgeEdges: EngramEdge[];
}

/** The full engram state block shape that `EngramManager.loadEngram` reads back. */
export interface ImportedEngramState {
  /** ALWAYS empty on import — but MUST be an array, or loadEngram drops the whole graph. */
  events: EngramEventNode[];
  entities: EngramEntity[];
  /** Legacy relations — always empty on import (v2Edges carry relationships). */
  relations: EngramRelation[];
  v2Edges: EngramEdge[];
  meta: {
    lastUpdated: number;
    eventCount: number;
    embeddedEventCount: number;
    embeddedEntityCount: number;
    schemaVersion: number;
    /** Always null on import — no in-flight edge-review pairs to carry over (aligns with EngramStateData). */
    v2PendingReview?: null;
  };
}

/**
 * Build the engram state block to write into an imported save's state tree.
 *
 * @param payload The card's engram (entities + knowledgeEdges).
 * @param now     Timestamp for `meta.lastUpdated` (injected for deterministic tests; 0 by
 *                default — a safe sentinel that sorts before any real timestamp, so it is
 *                always overwritten on the first solidify, consistent with `createEmpty`).
 */
export function buildImportedEngramState(
  payload: CardEngramPayload,
  now = 0,
): ImportedEngramState {
  const srcEntities = Array.isArray(payload?.entities) ? payload.entities : [];
  const srcEdges = Array.isArray(payload?.knowledgeEdges) ? payload.knowledgeEdges : [];

  const entities: EngramEntity[] = srcEntities.map((e) => ({
    ...e,
    source: 'card-import',
    is_embedded: false,
  }));
  const v2Edges: EngramEdge[] = srcEdges.map((e) => ({
    ...e,
    source: 'card-import',
    is_embedded: false,
  }));

  return {
    events: [], // ← the trap guard: MUST be an array
    entities,
    relations: [],
    v2Edges,
    meta: {
      lastUpdated: now,
      eventCount: 0,
      embeddedEventCount: 0,
      embeddedEntityCount: 0,
      schemaVersion: ENGRAM_SCHEMA_VERSION,
      v2PendingReview: null,
    },
  };
}
