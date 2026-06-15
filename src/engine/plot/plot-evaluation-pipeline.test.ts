import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../core/state-manager';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';
import { PlotEvaluationPipeline } from './plot-evaluation-pipeline';
import type { PlotArc, PlotNode, PlotDirectionState } from './types';

/**
 * Regression coverage for the critical-node confirmation gate.
 *
 * Bug (2026-06-14): clicking "确认完成" only set `pendingConfirmation.confirmed`
 * and deferred the actual advancement to the next main round's execute(), so the
 * button appeared to do nothing. `applyConfirmedAdvancement()` makes the UI path
 * advance immediately while reusing the same advanceNode logic as the pipeline.
 */

const PLOT = DEFAULT_ENGINE_PATHS.plotDirection;

function makeNode(over: Partial<PlotNode> & Pick<PlotNode, 'id' | 'arcId'>): PlotNode {
  return {
    title: over.id,
    narrativeGoal: '',
    directive: '',
    completionHint: '',
    completionConditions: [],
    completionMode: 'hint_only',
    activationConditions: [],
    importance: 'critical',
    opportunityTiers: [],
    status: 'pending',
    consecutiveReachedCount: 0,
    ...over,
  };
}

function makeArc(nodes: PlotNode[]): PlotArc {
  return { id: 'arc1', title: 'A', synopsis: '', nodes, gauges: [], status: 'active' };
}

function seed(sm: StateManager, state: PlotDirectionState, round = 5): void {
  sm.loadTree({
    元数据: {
      剧情导向: state,
      回合序号: round,
    },
  });
}

describe('PlotEvaluationPipeline.applyConfirmedAdvancement', () => {
  let sm: StateManager;
  let pipeline: PlotEvaluationPipeline;

  beforeEach(() => {
    sm = new StateManager();
    pipeline = new PlotEvaluationPipeline(sm, DEFAULT_ENGINE_PATHS);
  });

  it('advances the active node and activates the next pending one', () => {
    const n1 = makeNode({ id: 'n1', arcId: 'arc1', status: 'active', activatedAtRound: 1 });
    const n2 = makeNode({ id: 'n2', arcId: 'arc1', status: 'pending' });
    seed(sm, {
      arcs: [makeArc([n1, n2])],
      activeArcIndex: 0,
      pendingConfirmation: { arcId: 'arc1', nodeId: 'n1', evidence: 'e', round: 5, confirmed: true },
    });

    const advanced = pipeline.applyConfirmedAdvancement();
    expect(advanced).toBe(true);

    const after = sm.get<PlotDirectionState>(PLOT)!;
    expect(after.arcs[0].nodes[0].status).toBe('completed');
    expect(after.arcs[0].nodes[0].completedAtRound).toBe(5);
    expect(after.arcs[0].nodes[1].status).toBe('active');
    expect(after.pendingConfirmation).toBeNull();
  });

  it('completes the arc when the confirmed node is the last one', () => {
    const n1 = makeNode({ id: 'n1', arcId: 'arc1', status: 'active', activatedAtRound: 1 });
    seed(sm, {
      arcs: [makeArc([n1])],
      activeArcIndex: 0,
      pendingConfirmation: { arcId: 'arc1', nodeId: 'n1', evidence: '', round: 5, confirmed: true },
    });

    expect(pipeline.applyConfirmedAdvancement()).toBe(true);

    const after = sm.get<PlotDirectionState>(PLOT)!;
    expect(after.arcs[0].nodes[0].status).toBe('completed');
    expect(after.arcs[0].status).toBe('completed');
    expect(after.activeArcIndex).toBeNull();
    expect(after.pendingConfirmation).toBeNull();
  });

  it('does nothing when there is no confirmation', () => {
    const n1 = makeNode({ id: 'n1', arcId: 'arc1', status: 'active' });
    seed(sm, { arcs: [makeArc([n1])], activeArcIndex: 0, pendingConfirmation: null });

    expect(pipeline.applyConfirmedAdvancement()).toBe(false);
    expect(sm.get<PlotDirectionState>(PLOT)!.arcs[0].nodes[0].status).toBe('active');
  });

  it('does not advance an unconfirmed (pending-only) confirmation', () => {
    const n1 = makeNode({ id: 'n1', arcId: 'arc1', status: 'active' });
    seed(sm, {
      arcs: [makeArc([n1])],
      activeArcIndex: 0,
      pendingConfirmation: { arcId: 'arc1', nodeId: 'n1', evidence: '', round: 5 },
    });

    expect(pipeline.applyConfirmedAdvancement()).toBe(false);
    expect(sm.get<PlotDirectionState>(PLOT)!.arcs[0].nodes[0].status).toBe('active');
  });

  it('clears a stale confirmation that no longer matches the active node', () => {
    const n1 = makeNode({ id: 'n1', arcId: 'arc1', status: 'active' });
    seed(sm, {
      arcs: [makeArc([n1])],
      activeArcIndex: 0,
      pendingConfirmation: { arcId: 'arc1', nodeId: 'gone', evidence: '', round: 5, confirmed: true },
    });

    expect(pipeline.applyConfirmedAdvancement()).toBe(false);
    const after = sm.get<PlotDirectionState>(PLOT)!;
    expect(after.arcs[0].nodes[0].status).toBe('active');
    expect(after.pendingConfirmation).toBeNull();
  });

  it('fires the node onComplete world event on confirm', () => {
    const n1 = makeNode({
      id: 'n1',
      arcId: 'arc1',
      status: 'active',
      activatedAtRound: 1,
      onComplete: { worldEvent: { title: '节点达成', description: 'desc' } },
    });
    const n2 = makeNode({ id: 'n2', arcId: 'arc1', status: 'pending' });
    seed(sm, {
      arcs: [makeArc([n1, n2])],
      activeArcIndex: 0,
      pendingConfirmation: { arcId: 'arc1', nodeId: 'n1', evidence: '', round: 5, confirmed: true },
    });

    expect(pipeline.applyConfirmedAdvancement()).toBe(true);
    const events = sm.get<Array<Record<string, unknown>>>(DEFAULT_ENGINE_PATHS.worldEvents) ?? [];
    expect(events.some(e => e['事件名称'] === '节点达成')).toBe(true);
  });
});
