import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePlotStore } from './plot-store';
import type { PlotNode } from './types';

/** Seed an arc with `titles.length` pending nodes; returns arcId. */
function seedArc(store: ReturnType<typeof usePlotStore>, titles: string[]): string {
  const arc = store.createArc('弧线', '概要');
  for (const title of titles) {
    store.addNode(arc.id, {
      title,
      narrativeGoal: '',
      directive: title,
      completionHint: title,
      completionConditions: [],
      completionMode: 'hint_only',
      activationConditions: [],
      importance: 'skippable',
      opportunityTiers: [],
    });
  }
  return arc.id;
}

function titles(store: ReturnType<typeof usePlotStore>, arcId: string): string[] {
  return store.arcs.find(a => a.id === arcId)!.nodes.map(n => n.title);
}

function nodeByTitle(store: ReturnType<typeof usePlotStore>, arcId: string, title: string): PlotNode {
  return store.arcs.find(a => a.id === arcId)!.nodes.find(n => n.title === title)!;
}

describe('plotStore.moveNode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('moves a pending node up in a draft arc', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B', 'C']);
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'C').id, 0);
    expect(ok).toBe(true);
    expect(titles(store, arcId)).toEqual(['C', 'A', 'B']);
  });

  it('uses final-resting-index semantics when moving down', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B', 'C', 'D']);
    // A should END UP at index 2 — no removal-shift compensation by the caller.
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'A').id, 2);
    expect(ok).toBe(true);
    expect(titles(store, arcId)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('rejects moving a non-pending node', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B']);
    nodeByTitle(store, arcId, 'A').status = 'active';
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'A').id, 1);
    expect(ok).toBe(false);
    expect(titles(store, arcId)).toEqual(['A', 'B']);
  });

  it('rejects dropping into the non-pending prefix (before the active node)', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['done', 'act', 'P1', 'P2']);
    nodeByTitle(store, arcId, 'done').status = 'completed';
    nodeByTitle(store, arcId, 'act').status = 'active';
    // A pending node before the active node would never activate
    // (activateNextPending only scans forward).
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'P2').id, 1);
    expect(ok).toBe(false);
    expect(titles(store, arcId)).toEqual(['done', 'act', 'P1', 'P2']);
  });

  it('allows dropping right after the non-pending prefix', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['done', 'act', 'P1', 'P2']);
    nodeByTitle(store, arcId, 'done').status = 'completed';
    nodeByTitle(store, arcId, 'act').status = 'active';
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'P2').id, 2);
    expect(ok).toBe(true);
    expect(titles(store, arcId)).toEqual(['done', 'act', 'P2', 'P1']);
  });

  it('clamps an out-of-range target to the end', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B', 'C']);
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'A').id, 99);
    expect(ok).toBe(true);
    expect(titles(store, arcId)).toEqual(['B', 'C', 'A']);
  });

  it('returns false for unknown arc or node', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A']);
    expect(store.moveNode('bad-arc', 'x', 0)).toBe(false);
    expect(store.moveNode(arcId, 'bad-node', 0)).toBe(false);
  });

  it('defers the move while an evaluation is running (mutex)', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B']);
    store.setEvaluating(true);
    const ok = store.moveNode(arcId, nodeByTitle(store, arcId, 'B').id, 0);
    expect(ok).toBe(false);
    expect(titles(store, arcId)).toEqual(['A', 'B']);
    store.setEvaluating(false); // flushes pending ops
    expect(titles(store, arcId)).toEqual(['B', 'A']);
  });
});

describe('plotStore.insertNode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('inserts before the first node in a draft arc (afterIndex -1)', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B']);
    const inserted = store.insertNode(arcId, -1, { title: 'X' });
    expect(inserted).not.toBeNull();
    expect(titles(store, arcId)).toEqual(['X', 'A', 'B']);
  });

  it('inserts between two nodes', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A', 'B']);
    store.insertNode(arcId, 0, { title: 'X' });
    expect(titles(store, arcId)).toEqual(['A', 'X', 'B']);
  });

  it('clamps an unreachable position into the reachable zone', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['done', 'act', 'P1']);
    nodeByTitle(store, arcId, 'done').status = 'completed';
    nodeByTitle(store, arcId, 'act').status = 'active';
    // Requested before the completed node — clamped to right after the active node.
    store.insertNode(arcId, -1, { title: 'X' });
    expect(titles(store, arcId)).toEqual(['done', 'act', 'X', 'P1']);
  });

  it('appends when afterIndex is at or beyond the end', () => {
    const store = usePlotStore();
    const arcId = seedArc(store, ['A']);
    store.insertNode(arcId, 5, { title: 'X' });
    expect(titles(store, arcId)).toEqual(['A', 'X']);
  });
});
