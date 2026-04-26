/**
 * Plot Direction System — Evaluation Sub-Pipeline
 *
 * Dispatched by GameOrchestrator after each main round. Reads the AI's
 * plot_evaluation from the state tree transient path, applies gauge updates,
 * checks boundary events, evaluates completion conditions, and advances
 * the node chain when appropriate.
 *
 * All mutations are performed on a deep-cloned working copy and written
 * back atomically at the end to avoid partial-state reactive emissions.
 *
 * Sprint Plot-1 P3
 */
import type { StateManager } from '../core/state-manager';
import type { EnginePathConfig } from '../pipeline/types';
import type {
  PlotDirectionState,
  PlotArc,
  PlotNode,
  PlotEvaluation,
  PlotEvalLog,
  PlotNodeEvent,
} from './types';
import { evaluateGaugeCondition } from './types';
import _cloneDeep from 'lodash-es/cloneDeep';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_OPPORTUNITY_MAX_TIER = 3;

interface PlotSettingsFromState {
  enabled?: boolean;
  criticalConfirmGate?: boolean;
  confidenceThreshold?: number;
  opportunityMaxTier?: number;
  autoAdvanceSkippable?: boolean;
}

export class PlotEvaluationPipeline {
  constructor(
    private stateManager: StateManager,
    private paths: EnginePathConfig,
  ) {}

  private getSettings(): PlotSettingsFromState {
    return this.stateManager.get<PlotSettingsFromState>('系统.设置.plot') ?? {};
  }

  async execute(): Promise<boolean> {
    const settings = this.getSettings();

    // Kill switch: if plot system is disabled, skip entirely
    if (settings.enabled === false) return false;

    const rawState = this.stateManager.get<PlotDirectionState>(this.paths.plotDirection);
    if (!rawState || rawState.activeArcIndex == null) return false;

    // Deep clone to avoid partial-state reactive emissions (R-Issue2)
    const state = _cloneDeep(rawState);

    const arcIdx = state.activeArcIndex;
    if (arcIdx == null) return false;
    const arc = state.arcs[arcIdx];
    if (!arc || arc.status !== 'active') return false;

    const node = arc.nodes.find((n: PlotNode) => n.status === 'active');
    if (!node) return false;

    const round = this.stateManager.get<number>(this.paths.roundNumber) ?? 0;

    if (node.activatedAtRound == null) {
      node.activatedAtRound = round;
    }

    // ── 0. Check for pending player confirmation (GAP-03 review fix) ──
    if (state.pendingConfirmation?.confirmed) {
      const pc = state.pendingConfirmation;
      if (pc.nodeId === node.id) {
        this.advanceNode(state, arc, node, round);
        state.pendingConfirmation = null;
        // Write back and return — this round's evaluation is consumed by the advancement
        this.stateManager.set(this.paths.plotDirection, state, 'system');
        return true;
      }
      state.pendingConfirmation = null;
    }

    // Read and clear transient evaluation
    const lastEval = this.stateManager.get<PlotEvaluation | null>(
      this.paths.plotDirection + '._lastEvaluation',
    ) ?? null;

    // ── 1. Apply gauge updates from AI ──
    if (lastEval?.gauge_updates) {
      this.applyGaugeUpdates(arc, lastEval.gauge_updates);
    }

    // ── 2. Apply autoDecrement ──
    this.applyAutoDecrements(arc, round);

    // ── 3. Evaluate node completion ──
    let action: PlotEvalLog['action'] = 'none';
    const elapsed = round - (node.activatedAtRound ?? round);

    const confidenceThreshold = settings.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

    // Reset on null eval too — "consecutive" means no gaps (R-Issue3)
    if (lastEval && lastEval.node_reached && lastEval.confidence >= confidenceThreshold) {
      node.consecutiveReachedCount++;
      action = 'count_increment';
    } else {
      if (node.consecutiveReachedCount > 0) {
        node.consecutiveReachedCount = 0;
        action = 'count_reset';
      }
    }

    // ── 4. Check advancement conditions ──
    const gaugesMet = node.completionConditions.length === 0 ||
      node.completionConditions.every((c: import('./types').GaugeCondition) => evaluateGaugeCondition(c, arc.gauges));

    const hintMet = node.completionMode === 'gauges_only'
      ? true
      : node.consecutiveReachedCount >= (node.importance === 'critical' ? 2 : 1);

    const shouldAdvance =
      (node.completionMode === 'hint_only' && hintMet) ||
      (node.completionMode === 'hint_and_gauges' && hintMet && gaugesMet) ||
      (node.completionMode === 'gauges_only' && gaugesMet);

    if (shouldAdvance) {
      const autoAdvanceSkippable = settings.autoAdvanceSkippable !== false;
      if (node.importance === 'skippable' && !autoAdvanceSkippable) {
        // User disabled auto-advance for skippable nodes — treat like critical
        action = 'none';
      } else if (node.importance === 'critical' && (settings.criticalConfirmGate !== false)) {
        state.pendingConfirmation = {
          arcId: arc.id,
          nodeId: node.id,
          evidence: lastEval?.evidence ?? '',
          round,
        };
        action = 'advance';
      } else {
        this.advanceNode(state, arc, node, round);
        action = 'advance';
      }
    }

    // ── 5. Check maxRounds timeout ──
    if (action === 'none' && node.maxRounds && elapsed >= node.maxRounds) {
      if (node.importance === 'skippable') {
        this.skipNode(state, arc, node, round);
        action = 'skip';
      } else {
        action = 'timeout';
      }
    }

    // ── 6. Check gauge boundary events (after all gauge mutations including onComplete effects) ──
    this.checkBoundaryEvents(arc, round);

    // ── 7. Determine current opportunity tier ──
    const maxTier = (settings.opportunityMaxTier ?? DEFAULT_OPPORTUNITY_MAX_TIER) as 1 | 2 | 3;
    const activeNode = arc.nodes.find((n: PlotNode) => n.status === 'active');
    const activeElapsed = activeNode?.activatedAtRound != null ? round - activeNode.activatedAtRound : 0;
    const opportunityTier = activeNode ? this.getCurrentTier(activeNode, activeElapsed, maxTier) : null;

    // ── 8. Build log entry ──
    const logEntry: PlotEvalLog = {
      round,
      nodeId: node.id,
      evaluation: lastEval,
      opportunityTier,
      action,
    };

    // ── 9. Atomic write-back ──
    this.stateManager.set(this.paths.plotDirection, state, 'system');

    // Write transient fields via sub-paths (outside the persisted PlotDirectionState type)
    this.stateManager.set(this.paths.plotDirection + '._lastEvaluation', null, 'system');

    // Append eval log as sub-path ring buffer (use copy to avoid mutating live ref)
    const logPath = this.paths.plotDirection + '._evalLog';
    const existingLog = this.stateManager.get<PlotEvalLog[]>(logPath) ?? [];
    const newLog = [...existingLog, logEntry];
    if (newLog.length > 30) newLog.splice(0, newLog.length - 30);
    this.stateManager.set(logPath, newLog, 'system');

    return true;
  }

  private applyGaugeUpdates(
    arc: PlotArc,
    updates: NonNullable<PlotEvaluation['gauge_updates']>,
  ): void {
    for (const update of updates) {
      // Match by name (what the model sees) OR by id (internal fallback)
      const gauge = arc.gauges.find(g => g.name === update.gauge_id || g.id === update.gauge_id);
      if (!gauge || !gauge.aiUpdatable) continue;

      const clampedDelta = Math.max(
        -gauge.maxDeltaPerRound,
        Math.min(gauge.maxDeltaPerRound, update.delta),
      );
      if (clampedDelta !== update.delta) {
        console.debug(`[PlotEval] gauge "${gauge.id}" delta clamped: ${update.delta} → ${clampedDelta}`);
      }
      gauge.current = Math.max(gauge.min, Math.min(gauge.max, gauge.current + clampedDelta));
    }
  }

  private applyAutoDecrements(arc: PlotArc, round: number): void {
    for (const gauge of arc.gauges) {
      if (gauge.autoDecrement == null) continue;
      if (gauge.lastAutoDecrementRound != null && gauge.lastAutoDecrementRound >= round) continue;

      const before = gauge.current;
      gauge.current = Math.max(gauge.min, Math.min(gauge.max, gauge.current - gauge.autoDecrement));
      gauge.lastAutoDecrementRound = round;
      if (gauge.current !== before) {
        console.debug(`[PlotEval] gauge "${gauge.id}" auto-decrement: ${before} → ${gauge.current}`);
      }
    }
  }

  private checkBoundaryEvents(arc: PlotArc, round: number): void {
    for (const gauge of arc.gauges) {
      if (gauge.boundaryFiredAtRound != null && gauge.boundaryFiredAtRound >= round) continue;

      if (gauge.current <= gauge.min && gauge.onMinReached) {
        this.fireNodeEvent(arc, gauge.onMinReached, round);
        gauge.boundaryFiredAtRound = round;
      } else if (gauge.current >= gauge.max && gauge.onMaxReached) {
        this.fireNodeEvent(arc, gauge.onMaxReached, round);
        gauge.boundaryFiredAtRound = round;
      }
    }
  }

  /**
   * Fires a PlotNodeEvent: applies gauge effects and writes world events.
   * Uses EnginePathConfig for world event path — no hardcoded Chinese field names.
   */
  private fireNodeEvent(arc: PlotArc, event: PlotNodeEvent, round: number): void {
    if (event.gaugeEffects) {
      for (const effect of event.gaugeEffects) {
        const gauge = arc.gauges.find(g => g.id === effect.gaugeId);
        if (!gauge) continue;
        if (effect.action === 'set') {
          gauge.current = Math.max(gauge.min, Math.min(gauge.max, effect.value));
        } else {
          gauge.current = Math.max(gauge.min, Math.min(gauge.max, gauge.current + effect.value));
        }
      }
    }

    if (event.worldEvent) {
      // GAP-13 fix: use field names matching EventPanel.normalizeEvent()
      const gameTime = this.stateManager.get<Record<string, unknown>>(this.paths.gameTime);
      const timeStr = gameTime
        ? `${gameTime['年'] ?? ''}年${gameTime['月'] ?? ''}月${gameTime['日'] ?? ''}日`
        : '';
      this.stateManager.push(this.paths.worldEvents, {
        id: `plot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        事件名称: event.worldEvent.title,
        事件描述: event.worldEvent.description,
        事件类型: event.worldEvent.type ?? '剧情',
        回合: round,
        发生时间: timeStr,
      }, 'system');
    }
  }

  private advanceNode(state: PlotDirectionState, arc: PlotArc, node: PlotNode, round: number): void {
    node.status = 'completed';
    node.completedAtRound = round;

    // Fire onComplete event (R-Issue6)
    if (node.onComplete) {
      this.fireNodeEvent(arc, node.onComplete, round);
    }

    this.activateNextPending(state, arc, node, round);
  }

  private skipNode(state: PlotDirectionState, arc: PlotArc, node: PlotNode, round: number): void {
    node.status = 'skipped';
    node.completedAtRound = round;

    // Fire onSkip event (R-Issue6)
    if (node.onSkip) {
      this.fireNodeEvent(arc, node.onSkip, round);
    }

    this.activateNextPending(state, arc, node, round);
  }

  private activateNextPending(state: PlotDirectionState, arc: PlotArc, currentNode: PlotNode, round: number): void {
    const nextIdx = arc.nodes.indexOf(currentNode) + 1;
    let activated = false;
    for (let i = nextIdx; i < arc.nodes.length; i++) {
      const next = arc.nodes[i];
      if (next.status !== 'pending') continue;

      const condsMet = next.activationConditions.length === 0 ||
        next.activationConditions.every((c: import('./types').GaugeCondition) => evaluateGaugeCondition(c, arc.gauges));

      if (condsMet) {
        next.status = 'active';
        next.activatedAtRound = round;

        // Fire onActivate event
        if (next.onActivate) {
          this.fireNodeEvent(arc, next.onActivate, round);
        }

        activated = true;
        break;
      }
    }

    // Check if all nodes are done → complete arc (R-Issue4: use state param)
    if (!activated) {
      const allDone = arc.nodes.every((n: PlotNode) => n.status === 'completed' || n.status === 'skipped');
      if (allDone) {
        arc.status = 'completed';
        state.activeArcIndex = null;
      }
    }
  }

  private getCurrentTier(node: PlotNode, elapsed: number, maxTier: 1 | 2 | 3 = 3): 1 | 2 | 3 | null {
    if (node.opportunityTiers.length === 0) return null;
    let best: 1 | 2 | 3 | null = null;
    for (const t of node.opportunityTiers) {
      if (elapsed >= t.afterRounds && t.tier <= maxTier) best = t.tier;
    }
    return best;
  }
}
