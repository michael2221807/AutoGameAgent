// Design: docs/design/plot-direction-system.md
/**
 * Plot Direction System — Pinia Store
 *
 * Manages arc CRUD, single-active-arc constraint, hot-swap operations,
 * gauge management, and evaluation log ring buffer.
 *
 * Persistent state lives in the game state tree (元数据.剧情导向).
 * Evaluation logs are in-memory only (non-persisted).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  PlotArc,
  PlotNode,
  PlotGauge,
  PlotEvalLog,
  PlotDirectionState,
} from './types';
import { generatePlotId, DEFAULT_GAUGE_MAX_DELTA } from './types';

const EVAL_LOG_MAX = 30;

export const usePlotStore = defineStore('plot-direction', () => {
  // ─── Reactive state ───
  const arcs = ref<PlotArc[]>([]);
  const activeArcIndex = ref<number | null>(null);
  const pendingConfirmation = ref<import('./types').PendingNodeConfirmation | null>(null);
  const evaluationLog = ref<PlotEvalLog[]>([]);
  let _evaluating = false;
  let _pendingOps: Array<() => void> = [];

  // ─── Computed ───
  const activeArc = computed<PlotArc | null>(() =>
    activeArcIndex.value !== null ? arcs.value[activeArcIndex.value] ?? null : null,
  );

  const activeNode = computed<PlotNode | null>(() => {
    const arc = activeArc.value;
    if (!arc) return null;
    return arc.nodes.find(n => n.status === 'active') ?? null;
  });

  const hasActiveArc = computed(() => activeArc.value?.status === 'active');

  // ─── State tree sync ───

  function loadFromState(state: PlotDirectionState | undefined): void {
    if (!state) {
      arcs.value = [];
      activeArcIndex.value = null;
      return;
    }
    arcs.value = state.arcs ?? [];
    activeArcIndex.value = state.activeArcIndex ?? null;
    pendingConfirmation.value = state.pendingConfirmation ?? null;
  }

  function toStateSnapshot(): PlotDirectionState {
    return {
      arcs: arcs.value,
      activeArcIndex: activeArcIndex.value,
      pendingConfirmation: pendingConfirmation.value,
    };
  }

  // ─── Arc CRUD ───

  function createArc(title: string, synopsis: string): PlotArc {
    const arc: PlotArc = {
      id: generatePlotId('arc'),
      title,
      synopsis,
      nodes: [],
      gauges: [],
      status: 'draft',
    };
    arcs.value.push(arc);
    return arc;
  }

  function deleteArc(arcId: string): boolean {
    const idx = arcs.value.findIndex(a => a.id === arcId);
    if (idx === -1) return false;
    const arc = arcs.value[idx];
    if (arc.status === 'active') return false;
    arcs.value.splice(idx, 1);
    if (activeArcIndex.value !== null) {
      if (idx < activeArcIndex.value) activeArcIndex.value--;
      else if (idx === activeArcIndex.value) activeArcIndex.value = null;
    }
    return true;
  }

  function activateArc(arcId: string, currentRound?: number): boolean {
    if (arcs.value.some(a => a.status === 'active')) return false;
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc || (arc.status !== 'draft' && arc.status !== 'abandoned')) return false;
    if (arc.nodes.length === 0) return false;

    // When reactivating an abandoned arc, restore skipped nodes to pending
    if (arc.status === 'abandoned') {
      for (const node of arc.nodes) {
        if (node.status === 'skipped') {
          node.status = 'pending';
          node.consecutiveReachedCount = 0;
        }
      }
    }

    arc.status = 'active';
    activeArcIndex.value = arcs.value.indexOf(arc);

    const first = arc.nodes.find(n => n.status === 'pending');
    if (first) {
      first.status = 'active';
      if (currentRound != null) {
        first.activatedAtRound = currentRound;
      }
    }
    return true;
  }

  function abandonArc(arcId: string): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc || arc.status !== 'active') return false;
    arc.status = 'abandoned';
    arc.nodes.forEach(n => {
      if (n.status === 'active') n.status = 'skipped';
    });
    activeArcIndex.value = null;
    return true;
  }

  function completeArc(arcId: string): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc || arc.status !== 'active') return false;
    arc.status = 'completed';
    activeArcIndex.value = null;
    return true;
  }

  function reviseArc(arcId: string, fromNodeIndex: number): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return false;
    for (let i = fromNodeIndex; i < arc.nodes.length; i++) {
      const node = arc.nodes[i];
      node.status = 'pending';
      node.activatedAtRound = undefined;
      node.completedAtRound = undefined;
      node.consecutiveReachedCount = 0;
    }
    // Re-activate first pending if arc is active and no active node
    if (arc.status === 'active' && !arc.nodes.some(n => n.status === 'active')) {
      const first = arc.nodes.find(n => n.status === 'pending');
      if (first) first.status = 'active';
    }
    return true;
  }

  // ─── Node CRUD + Hot-Swap ───

  function _withMutex(fn: () => void): void {
    if (_evaluating) {
      _pendingOps.push(fn);
    } else {
      fn();
    }
  }

  function flushPendingOps(): void {
    const ops = _pendingOps.splice(0);
    for (const op of ops) op();
  }

  function addNode(arcId: string, node: Omit<PlotNode, 'id' | 'arcId' | 'status' | 'consecutiveReachedCount'>): PlotNode | null {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return null;

    const full: PlotNode = {
      ...node,
      id: generatePlotId('node'),
      arcId,
      status: 'pending',
      consecutiveReachedCount: 0,
      completionConditions: node.completionConditions ?? [],
      activationConditions: node.activationConditions ?? [],
      completionMode: node.completionMode ?? 'hint_only',
      opportunityTiers: node.opportunityTiers ?? [],
      importance: node.importance ?? 'skippable',
    };
    arc.nodes.push(full);
    return full;
  }

  function insertNode(arcId: string, afterIndex: number, node: Partial<PlotNode>): PlotNode | null {
    let result: PlotNode | null = null;
    _withMutex(() => {
      const arc = arcs.value.find(a => a.id === arcId);
      if (!arc) return;

      const full: PlotNode = {
        id: generatePlotId('node'),
        arcId,
        title: node.title ?? '',
        narrativeGoal: node.narrativeGoal ?? '',
        directive: node.directive ?? '',
        completionHint: node.completionHint ?? '',
        completionConditions: node.completionConditions ?? [],
        completionMode: node.completionMode ?? 'hint_only',
        activationConditions: node.activationConditions ?? [],
        maxRounds: node.maxRounds,
        importance: node.importance ?? 'skippable',
        opportunityTiers: node.opportunityTiers ?? [],
        emotionalTone: node.emotionalTone,
        onComplete: node.onComplete,
        onActivate: node.onActivate,
        onSkip: node.onSkip,
        status: 'pending',
        consecutiveReachedCount: 0,
      };

      const insertAt = Math.min(afterIndex + 1, arc.nodes.length);
      arc.nodes.splice(insertAt, 0, full);
      result = full;
    });
    return result;
  }

  function removeNode(arcId: string, nodeId: string): boolean {
    let removed = false;
    _withMutex(() => {
      const arc = arcs.value.find(a => a.id === arcId);
      if (!arc) return;
      const idx = arc.nodes.findIndex(n => n.id === nodeId);
      if (idx === -1) return;
      if (arc.nodes[idx].status !== 'pending') return;
      arc.nodes.splice(idx, 1);
      removed = true;
    });
    return removed;
  }

  function moveNode(arcId: string, nodeId: string, newIndex: number): boolean {
    let moved = false;
    _withMutex(() => {
      const arc = arcs.value.find(a => a.id === arcId);
      if (!arc) return;
      const idx = arc.nodes.findIndex(n => n.id === nodeId);
      if (idx === -1 || arc.nodes[idx].status !== 'pending') return;

      const lastCompletedIdx = arc.nodes.reduce(
        (max, n, i) => (n.status === 'completed' || n.status === 'skipped' ? i : max), -1,
      );
      if (newIndex <= lastCompletedIdx) return;

      const [node] = arc.nodes.splice(idx, 1);
      const clamped = Math.min(newIndex, arc.nodes.length);
      arc.nodes.splice(clamped, 0, node);
      moved = true;
    });
    return moved;
  }

  function updateNode(arcId: string, nodeId: string, updates: Partial<PlotNode>): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return false;
    const node = arc.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    const { id: _id, arcId: _arcId, status: _status, ...safe } = updates;
    Object.assign(node, safe);
    return true;
  }

  // ─── Gauge CRUD ───

  function addGauge(arcId: string, gauge: Omit<PlotGauge, 'id'>): PlotGauge | null {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return null;

    const full: PlotGauge = {
      ...gauge,
      id: generatePlotId('gauge'),
      maxDeltaPerRound: gauge.maxDeltaPerRound ?? DEFAULT_GAUGE_MAX_DELTA,
    };
    arc.gauges.push(full);
    return full;
  }

  function removeGauge(arcId: string, gaugeId: string): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return false;
    const idx = arc.gauges.findIndex(g => g.id === gaugeId);
    if (idx === -1) return false;
    arc.gauges.splice(idx, 1);
    return true;
  }

  function updateGauge(arcId: string, gaugeId: string, updates: Partial<PlotGauge>): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return false;
    const gauge = arc.gauges.find(g => g.id === gaugeId);
    if (!gauge) return false;
    const { id: _id, ...safe } = updates;
    Object.assign(gauge, safe);
    return true;
  }

  function resetGauge(arcId: string, gaugeId: string): boolean {
    const arc = arcs.value.find(a => a.id === arcId);
    if (!arc) return false;
    const gauge = arc.gauges.find(g => g.id === gaugeId);
    if (!gauge) return false;
    gauge.current = gauge.initialValue;
    gauge.boundaryFiredAtRound = undefined;
    return true;
  }

  // ─── Confirmation gate (critical nodes) ───

  /**
   * Player confirms critical node advancement.
   * Sets a `_confirmed` transient flag — the PlotEvaluationPipeline reads this
   * on the next execution and performs the actual advanceNode() with full
   * side-effects (onComplete, onActivate events, activationConditions check).
   * This avoids duplicating advancement logic between store and pipeline.
   */
  function confirmNodeAdvancement(): boolean {
    if (!pendingConfirmation.value) return false;
    // Mark as confirmed — pipeline will handle the actual transition
    pendingConfirmation.value = { ...pendingConfirmation.value, confirmed: true } as typeof pendingConfirmation.value;
    return true;
  }

  function rejectNodeAdvancement(): void {
    const pc = pendingConfirmation.value;
    if (!pc) return;
    const arc = arcs.value.find(a => a.id === pc.arcId);
    if (arc) {
      const node = arc.nodes.find(n => n.id === pc.nodeId);
      if (node) node.consecutiveReachedCount = 0;
    }
    pendingConfirmation.value = null;
  }

  // ─── Evaluation log (in-memory only) ───

  function pushEvalLog(entry: PlotEvalLog): void {
    evaluationLog.value.push(entry);
    if (evaluationLog.value.length > EVAL_LOG_MAX) {
      evaluationLog.value.shift();
    }
  }

  function clearEvalLog(): void {
    evaluationLog.value = [];
  }

  // ─── Evaluation mutex ───

  function setEvaluating(v: boolean): void {
    _evaluating = v;
    if (!v) flushPendingOps();
  }

  // ─── Reset ───

  function $reset(): void {
    arcs.value = [];
    activeArcIndex.value = null;
    evaluationLog.value = [];
    _evaluating = false;
    _pendingOps = [];
  }

  return {
    arcs,
    activeArcIndex,
    pendingConfirmation,
    evaluationLog,
    activeArc,
    activeNode,
    hasActiveArc,

    loadFromState,
    toStateSnapshot,

    createArc,
    deleteArc,
    activateArc,
    abandonArc,
    completeArc,
    reviseArc,

    addNode,
    insertNode,
    removeNode,
    moveNode,
    updateNode,

    addGauge,
    removeGauge,
    updateGauge,
    resetGauge,

    confirmNodeAdvancement,
    rejectNodeAdvancement,

    pushEvalLog,
    clearEvalLog,
    setEvaluating,

    $reset,
  };
});
