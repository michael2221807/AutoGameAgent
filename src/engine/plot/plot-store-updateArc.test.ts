import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePlotStore } from './plot-store';

describe('plotStore.updateArc', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('updates title of an existing arc', () => {
    const store = usePlotStore();
    store.createArc('原标题', '概要');
    const arcId = store.arcs[0].id;

    const ok = store.updateArc(arcId, { title: '新标题' });
    expect(ok).toBe(true);
    expect(store.arcs[0].title).toBe('新标题');
    expect(store.arcs[0].synopsis).toBe('概要');
  });

  it('updates synopsis of an existing arc', () => {
    const store = usePlotStore();
    store.createArc('标题', '原概要');
    const arcId = store.arcs[0].id;

    const ok = store.updateArc(arcId, { synopsis: '新概要' });
    expect(ok).toBe(true);
    expect(store.arcs[0].title).toBe('标题');
    expect(store.arcs[0].synopsis).toBe('新概要');
  });

  it('updates both title and synopsis', () => {
    const store = usePlotStore();
    store.createArc('a', 'b');
    const arcId = store.arcs[0].id;

    const ok = store.updateArc(arcId, { title: 'x', synopsis: 'y' });
    expect(ok).toBe(true);
    expect(store.arcs[0].title).toBe('x');
    expect(store.arcs[0].synopsis).toBe('y');
  });

  it('returns false for non-existent arcId', () => {
    const store = usePlotStore();
    const ok = store.updateArc('bad-id', { title: 'x' });
    expect(ok).toBe(false);
  });

  it('does not affect nodes or gauges', () => {
    const store = usePlotStore();
    store.createArc('t', 's');
    const arcId = store.arcs[0].id;
    store.addNode(arcId, {
      title: 'node1',
      directive: 'd',
      completionHint: 'h',
      narrativeGoal: 'g',
      completionMode: 'hint_only',
      importance: 'critical',
      completionConditions: [],
      activationConditions: [],
      opportunityTiers: [],
    });
    store.addGauge(arcId, {
      name: 'gauge1',
      description: 'g',
      min: 0,
      max: 100,
      current: 50,
      initialValue: 50,
      unit: '%',
      showInMainPanel: false,
      aiUpdatable: true,
      maxDeltaPerRound: 10,
    });

    store.updateArc(arcId, { title: '改名' });

    expect(store.arcs[0].nodes).toHaveLength(1);
    expect(store.arcs[0].gauges).toHaveLength(1);
    expect(store.arcs[0].nodes[0].title).toBe('node1');
  });

  it('snapshot reflects updated values', () => {
    const store = usePlotStore();
    store.createArc('t', 's');
    const arcId = store.arcs[0].id;
    store.updateArc(arcId, { title: '快照标题', synopsis: '快照概要' });

    const snapshot = store.toStateSnapshot();
    expect(snapshot.arcs[0].title).toBe('快照标题');
    expect(snapshot.arcs[0].synopsis).toBe('快照概要');
  });
});
