import { describe, it, expect } from 'vitest';
import { buildGraphElements, filterVisibility, type GraphFilterState } from './engram-graph-builder';
import type { EngramEntity } from './entity-builder';
import type { EngramEventNode } from './event-builder';
import type { EngramEdge } from './knowledge-edge';

function makeEntity(overrides: Partial<EngramEntity> & { name: string }): EngramEntity {
  return {
    type: 'npc',
    summary: '',
    is_embedded: true,
    firstSeen: 0,
    lastSeen: 5,
    mentionCount: 1,
    attributes: {},
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EngramEventNode> & { id: string }): EngramEventNode {
  return {
    text: 'event text',
    summary: 'event summary',
    subject: 'A',
    action: 'does',
    is_embedded: true,
    roundNumber: 1,
    tags: [],
    structured_kv: { event: '', role: [], location: [], time_anchor: '', causality: '', logic: [] },
    mentionedEntities: [],
    ...overrides,
  };
}

function makeEdge(overrides: Partial<EngramEdge> & { id: string; sourceEntity: string; targetEntity: string; fact: string }): EngramEdge {
  return {
    episodes: ['evt1'],
    is_embedded: true,
    createdAtRound: 1,
    lastSeenRound: 1,
    ...overrides,
  };
}

describe('buildGraphElements', () => {
  it('creates entity nodes with correct data', () => {
    const entities = [makeEntity({ name: '张三', type: 'player', summary: '主角', firstSeen: 0, lastSeen: 5, mentionCount: 10 })];
    const els = buildGraphElements(entities, [], []);

    expect(els).toHaveLength(1);
    const node = els[0];
    expect(node.group).toBe('nodes');
    expect(node.data.id).toBe('entity_张三');
    expect(node.data.label).toBe('张三');
    expect(node.data.nodeCategory).toBe('player');
    expect(node.data.bg).toBe('#8a9e6c');
    expect(node.data.shape).toBe('ellipse');
    expect(node.data.w).toBe(64);
    expect(node.data.h).toBe(40);
  });

  it('truncates location labels to last segment', () => {
    const entities = [makeEntity({ name: '东荒大陆·青云山脉·小村庄', type: 'location' })];
    const els = buildGraphElements(entities, [], []);

    expect(els[0].data.label).toBe('小村庄');
    expect(els[0].data.fullLabel).toBe('东荒大陆·青云山脉·小村庄');
  });

  it('creates event nodes', () => {
    const events = [makeEvent({ id: 'evt_r3', roundNumber: 3, summary: '关键事件' })];
    const els = buildGraphElements([], events, []);

    expect(els).toHaveLength(1);
    expect(els[0].data.nodeCategory).toBe('event');
    expect(els[0].data.label).toBe('第3轮');
    expect(els[0].data.roundNumber).toBe(3);
  });

  it('creates fact edges with correct category', () => {
    const entities = [makeEntity({ name: 'A' }), makeEntity({ name: 'B' })];
    const edges = [makeEdge({ id: 'e1', sourceEntity: 'A', targetEntity: 'B', fact: '这是一条测试事实边' })];
    const els = buildGraphElements(entities, [], edges);

    const factEdge = els.find((e) => e.group === 'edges' && e.data.edgeCategory === 'fact');
    expect(factEdge).toBeDefined();
    expect(factEdge!.data.source).toBe('entity_A');
    expect(factEdge!.data.target).toBe('entity_B');
    expect(factEdge!.data.fullFact).toBe('这是一条测试事实边');
    expect(factEdge!.data.label).toBe('这是一条测试事实边'.slice(0, 10));
  });

  it('skips fact edges with non-existent entity endpoints', () => {
    const entities = [makeEntity({ name: 'A' })];
    const edges = [makeEdge({ id: 'e1', sourceEntity: 'A', targetEntity: '不存在', fact: '悬空边' })];
    const els = buildGraphElements(entities, [], edges);
    const factEdges = els.filter((e) => e.group === 'edges' && (e.data.edgeCategory === 'fact' || e.data.edgeCategory === 'invalidated'));
    expect(factEdges).toHaveLength(0);
  });

  it('marks invalidated edges correctly', () => {
    const entities = [makeEntity({ name: 'A' }), makeEntity({ name: 'B' })];
    const edges = [makeEdge({ id: 'e1', sourceEntity: 'A', targetEntity: 'B', fact: '已失效的事实', invalidatedAtRound: 5 })];
    const els = buildGraphElements(entities, [], edges);

    const edge = els.find((e) => e.group === 'edges');
    expect(edge!.data.edgeCategory).toBe('invalidated');
    expect(edge!.data.invalidatedAtRound).toBe(5);
  });

  it('creates MENTIONS edges only for existing entities', () => {
    const entities = [makeEntity({ name: 'A' })];
    const events = [makeEvent({ id: 'evt1', mentionedEntities: ['A', '不存在的实体'] })];
    const els = buildGraphElements(entities, events, []);

    const mentions = els.filter((e) => e.group === 'edges' && e.data.edgeCategory === 'mentions');
    expect(mentions).toHaveLength(1);
    expect(mentions[0].data.target).toBe('entity_A');
  });

  it('handles empty inputs', () => {
    const els = buildGraphElements([], [], []);
    expect(els).toHaveLength(0);
  });
});

describe('filterVisibility', () => {
  const entities = [
    makeEntity({ name: 'A', type: 'player', firstSeen: 0, lastSeen: 10 }),
    makeEntity({ name: 'B', type: 'npc', firstSeen: 3, lastSeen: 8 }),
    makeEntity({ name: 'C', type: 'location', firstSeen: 5, lastSeen: 12 }),
  ];
  const events = [
    makeEvent({ id: 'evt1', roundNumber: 2, mentionedEntities: ['A'] }),
    makeEvent({ id: 'evt2', roundNumber: 7, mentionedEntities: ['A', 'B'] }),
  ];
  const edges = [
    makeEdge({ id: 'e1', sourceEntity: 'A', targetEntity: 'B', fact: '事实1', createdAtRound: 3 }),
    makeEdge({ id: 'e2', sourceEntity: 'B', targetEntity: 'C', fact: '事实2', createdAtRound: 6, invalidatedAtRound: 9 }),
  ];
  const allElements = buildGraphElements(entities, events, edges);

  const fullFilter: GraphFilterState = {
    roundMax: 15,
    nodeTypes: { player: true, npc: true, location: true, item: true, event: true },
    showFactEdges: true,
    showMentions: true,
    showInvalidated: true,
  };

  it('shows all elements when no filters applied', () => {
    const vis = filterVisibility(allElements, fullFilter);
    for (const el of allElements) {
      expect(vis.get(el.data.id as string)).toBe(true);
    }
  });

  it('hides NPC nodes when npc filter is off', () => {
    const vis = filterVisibility(allElements, { ...fullFilter, nodeTypes: { ...fullFilter.nodeTypes, npc: false } });
    expect(vis.get('entity_A')).toBe(true);
    expect(vis.get('entity_B')).toBe(false);
    // Edge from A→B should also be hidden (target not visible)
    expect(vis.get('fact_e1')).toBe(false);
  });

  it('filters by round range', () => {
    const vis = filterVisibility(allElements, { ...fullFilter, roundMax: 4 });
    // Entity B firstSeen=3, should be visible at round 4
    expect(vis.get('entity_B')).toBe(true);
    // Entity C firstSeen=5, should be hidden at round 4
    expect(vis.get('entity_C')).toBe(false);
    // Event at round 7 should be hidden
    expect(vis.get('event_evt2')).toBe(false);
    // Event at round 2 should be visible
    expect(vis.get('event_evt1')).toBe(true);
    // Edge e1 createdAtRound=3, visible
    expect(vis.get('fact_e1')).toBe(true);
    // Edge e2 createdAtRound=6, hidden
    expect(vis.get('fact_e2')).toBe(false);
  });

  it('hides MENTIONS when toggle is off', () => {
    const vis = filterVisibility(allElements, { ...fullFilter, showMentions: false });
    const mentionEls = allElements.filter((e) => (e.data.edgeCategory as string) === 'mentions');
    for (const m of mentionEls) {
      expect(vis.get(m.data.id as string)).toBe(false);
    }
  });

  it('hides invalidated edges when toggle is off', () => {
    const vis = filterVisibility(allElements, { ...fullFilter, showInvalidated: false });
    expect(vis.get('fact_e2')).toBe(false);
    expect(vis.get('fact_e1')).toBe(true);
  });

  it('hides fact edges when toggle is off', () => {
    const vis = filterVisibility(allElements, { ...fullFilter, showFactEdges: false });
    expect(vis.get('fact_e1')).toBe(false);
  });

  it('edges require both endpoints visible', () => {
    // Hide events → MENTIONS edges from events should be hidden
    const vis = filterVisibility(allElements, { ...fullFilter, nodeTypes: { ...fullFilter.nodeTypes, event: false } });
    const mentionEls = allElements.filter((e) => (e.data.edgeCategory as string) === 'mentions');
    for (const m of mentionEls) {
      expect(vis.get(m.data.id as string)).toBe(false);
    }
  });
});
