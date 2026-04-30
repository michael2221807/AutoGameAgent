/**
 * Engram Graph Element Builder — constructs Cytoscape elements from Engram data.
 *
 * Pure function: no side effects, no DOM, no Vue reactivity.
 * Used by EngramDebugPanel for visualization and by unit tests for validation.
 */
import type { EngramEventNode } from './event-builder';
import type { EngramEntity } from './entity-builder';
import { isEdgeCurrentlyValid, type EngramEdge } from './knowledge-edge';

export interface GraphElement {
  group: 'nodes' | 'edges';
  data: Record<string, unknown>;
}

export interface GraphFilterState {
  roundMax: number;
  nodeTypes: Record<string, boolean>;
  showFactEdges: boolean;
  showMentions: boolean;
  showInvalidated: boolean;
}

export const NODE_COLORS: Record<string, string> = {
  player: '#8a9e6c',
  npc: '#7aab78',
  location: '#d4a44c',
  item: '#6b9e8a',
  event: '#5b8def',
};

export const NODE_SHAPES: Record<string, string> = {
  player: 'ellipse',
  npc: 'ellipse',
  location: 'diamond',
  item: 'round-rectangle',
  event: 'ellipse',
};

export const NODE_SIZES: Record<string, [number, number]> = {
  player: [64, 40],
  npc: [52, 34],
  location: [52, 34],
  item: [46, 30],
  event: [26, 26],
};

export function buildGraphElements(
  entities: EngramEntity[],
  events: EngramEventNode[],
  v2Edges: EngramEdge[],
): GraphElement[] {
  const els: GraphElement[] = [];
  const entityNames = new Set(entities.map((e) => e.name));

  for (const e of entities) {
    const isLocation = e.type === 'location';
    const [w, h] = NODE_SIZES[e.type] ?? [50, 32];
    els.push({
      group: 'nodes',
      data: {
        id: `entity_${e.name}`,
        label: isLocation ? (e.name.split('·').pop() ?? e.name) : e.name,
        fullLabel: e.name,
        nodeCategory: e.type,
        summary: e.summary,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
        mentionCount: e.mentionCount,
        embedded: e.is_embedded,
        bg: NODE_COLORS[e.type] ?? '#7a8590',
        shape: NODE_SHAPES[e.type] ?? 'ellipse',
        w,
        h,
      },
    });
  }

  for (const ev of events) {
    const [w, h] = NODE_SIZES.event;
    els.push({
      group: 'nodes',
      data: {
        id: `event_${ev.id}`,
        label: `第${ev.roundNumber ?? 0}轮`,
        fullLabel: ev.summary || ev.text.slice(0, 40),
        nodeCategory: 'event',
        roundNumber: ev.roundNumber ?? 0,
        summary: ev.text.slice(0, 100),
        mentionedEntities: ev.mentionedEntities ?? [],
        embedded: ev.is_embedded,
        bg: NODE_COLORS.event,
        shape: NODE_SHAPES.event,
        w,
        h,
      },
    });
  }

  for (const edge of v2Edges) {
    if (!entityNames.has(edge.sourceEntity) || !entityNames.has(edge.targetEntity)) continue;
    const cat = isEdgeCurrentlyValid(edge) ? 'fact' : 'invalidated';
    els.push({
      group: 'edges',
      data: {
        id: `fact_${edge.id}`,
        source: `entity_${edge.sourceEntity}`,
        target: `entity_${edge.targetEntity}`,
        edgeCategory: cat,
        label: edge.fact.slice(0, 10),
        fullFact: edge.fact,
        episodes: edge.episodes.length,
        createdAtRound: edge.createdAtRound,
        lastSeenRound: edge.lastSeenRound,
        invalidatedAtRound: edge.invalidatedAtRound ?? null,
        embedded: edge.is_embedded,
      },
    });
  }

  for (const ev of events) {
    for (const entName of ev.mentionedEntities ?? []) {
      if (!entityNames.has(entName)) continue;
      els.push({
        group: 'edges',
        data: {
          id: `mention_${ev.id}_${entName}`,
          source: `event_${ev.id}`,
          target: `entity_${entName}`,
          edgeCategory: 'mentions',
          roundNumber: ev.roundNumber ?? 0,
        },
      });
    }
  }

  return els;
}

export function filterVisibility(
  elements: GraphElement[],
  filter: GraphFilterState,
): Map<string, boolean> {
  const visibility = new Map<string, boolean>();
  const visibleNodes = new Set<string>();

  for (const el of elements) {
    if (el.group !== 'nodes') continue;
    const id = el.data.id as string;
    const cat = el.data.nodeCategory as string;
    let vis = filter.nodeTypes[cat] ?? false;
    if (cat === 'event') {
      vis = vis && (el.data.roundNumber as number) <= filter.roundMax;
    } else {
      vis = vis && (el.data.firstSeen as number) <= filter.roundMax;
    }
    visibility.set(id, vis);
    if (vis) visibleNodes.add(id);
  }

  for (const el of elements) {
    if (el.group !== 'edges') continue;
    const id = el.data.id as string;
    const cat = el.data.edgeCategory as string;
    const srcVis = visibleNodes.has(el.data.source as string);
    const tgtVis = visibleNodes.has(el.data.target as string);

    let typeVis = false;
    if (cat === 'fact') typeVis = filter.showFactEdges;
    else if (cat === 'invalidated') typeVis = filter.showInvalidated;
    else if (cat === 'mentions') typeVis = filter.showMentions;

    let inRange = true;
    if (cat === 'fact' || cat === 'invalidated') {
      inRange = (el.data.createdAtRound as number) <= filter.roundMax;
    } else if (cat === 'mentions') {
      inRange = (el.data.roundNumber as number) <= filter.roundMax;
    }

    visibility.set(id, srcVis && tgtVis && typeVis && inRange);
  }

  return visibility;
}
