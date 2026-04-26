/**
 * Plot Direction System — Type Definitions
 *
 * Data model for the Waypoint Narrative system: arcs, nodes, gauges,
 * conditions, and events. All game-specific content (directive text,
 * gauge descriptions) is opaque string data — the engine never interprets it.
 */

// ═══════════════════════════════════════════════════════════════
//  PlotArc — top-level container
// ═══════════════════════════════════════════════════════════════

export type PlotArcStatus = 'draft' | 'active' | 'completed' | 'abandoned';

export interface PlotArc {
  id: string;
  title: string;
  synopsis: string;
  nodes: PlotNode[];
  gauges: PlotGauge[];
  status: PlotArcStatus;
}

// ═══════════════════════════════════════════════════════════════
//  PlotGauge — global progress bar / meter
// ═══════════════════════════════════════════════════════════════

export interface PlotGauge {
  id: string;
  name: string;
  description: string;

  min: number;
  max: number;
  current: number;
  initialValue: number;

  unit: string;
  color?: string;
  showInMainPanel: boolean;

  aiUpdatable: boolean;
  maxDeltaPerRound: number;
  autoDecrement?: number;
  lastAutoDecrementRound?: number;

  onMinReached?: PlotNodeEvent;
  onMaxReached?: PlotNodeEvent;
  boundaryFiredAtRound?: number;
}

export const DEFAULT_GAUGE_MAX_DELTA = 25;

// ═══════════════════════════════════════════════════════════════
//  PlotNode — single story waypoint
// ═══════════════════════════════════════════════════════════════

export type PlotNodeStatus = 'pending' | 'active' | 'completed' | 'skipped';

export type CompletionMode = 'hint_only' | 'hint_and_gauges' | 'gauges_only';

export interface PlotNode {
  id: string;
  arcId: string;

  title: string;
  narrativeGoal: string;
  directive: string;

  completionHint: string;
  completionConditions: GaugeCondition[];
  completionMode: CompletionMode;

  activationConditions: GaugeCondition[];

  maxRounds?: number;
  importance: 'critical' | 'skippable';

  opportunityTiers: OpportunityTier[];

  emotionalTone?: string;

  onComplete?: PlotNodeEvent;
  onActivate?: PlotNodeEvent;
  onSkip?: PlotNodeEvent;

  status: PlotNodeStatus;
  activatedAtRound?: number;
  completedAtRound?: number;
  consecutiveReachedCount: number;
}

// ═══════════════════════════════════════════════════════════════
//  Condition & Opportunity types
// ═══════════════════════════════════════════════════════════════

export type GaugeOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

export interface GaugeCondition {
  gaugeId: string;
  operator: GaugeOperator;
  value: number;
}

export interface OpportunityTier {
  tier: 1 | 2 | 3;
  afterRounds: number;
  prompt: string;
}

// ═══════════════════════════════════════════════════════════════
//  PlotNodeEvent — side-effects on node lifecycle transitions
// ═══════════════════════════════════════════════════════════════

export interface PlotNodeEvent {
  worldEvent?: {
    title: string;
    description: string;
    type?: string;
  };
  gaugeEffects?: {
    gaugeId: string;
    action: 'set' | 'add';
    value: number;
  }[];
  flags?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
//  PlotEvaluation — AI response extension field
// ═══════════════════════════════════════════════════════════════

export interface PlotEvaluation {
  node_reached: boolean;
  confidence: number;
  evidence: string;
  gauge_updates?: {
    gauge_id: string;
    delta: number;
    reason: string;
  }[];
}

export interface PlotEvalLog {
  round: number;
  nodeId: string;
  evaluation: PlotEvaluation | null;
  opportunityTier: 1 | 2 | 3 | null;
  action: 'none' | 'count_increment' | 'count_reset' | 'advance' | 'skip' | 'timeout';
}

// ═══════════════════════════════════════════════════════════════
//  Plot state tree shape (stored at 元数据.剧情导向)
// ═══════════════════════════════════════════════════════════════

/**
 * Persisted shape at 元数据.剧情导向.
 *
 * Note: `_lastEvaluation` is a transient write-only field written directly to the
 * state tree path `元数据.剧情导向._lastEvaluation` by PostProcess and consumed
 * by PlotEvaluationPipeline. It is NOT managed by the store's load/snapshot cycle.
 */
export interface PlotDirectionState {
  arcs: PlotArc[];
  activeArcIndex: number | null;
  pendingConfirmation?: PendingNodeConfirmation | null;
}

export interface PendingNodeConfirmation {
  arcId: string;
  nodeId: string;
  evidence: string;
  round: number;
  confirmed?: boolean;
}

// ═══════════════════════════════════════════════════════════════
//  Utility
// ═══════════════════════════════════════════════════════════════

export function evaluateGaugeCondition(
  condition: GaugeCondition,
  gauges: PlotGauge[],
): boolean {
  const gauge = gauges.find(g => g.id === condition.gaugeId);
  if (!gauge) return false;

  switch (condition.operator) {
    case 'gt':  return gauge.current > condition.value;
    case 'gte': return gauge.current >= condition.value;
    case 'lt':  return gauge.current < condition.value;
    case 'lte': return gauge.current <= condition.value;
    case 'eq':  return gauge.current === condition.value;
    case 'neq': return gauge.current !== condition.value;
    default:    return false;
  }
}

function validateGaugeUpdates(
  raw: unknown,
): PlotEvaluation['gauge_updates'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid: NonNullable<PlotEvaluation['gauge_updates']> = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['gauge_id'] !== 'string' || typeof r['delta'] !== 'number') continue;
    valid.push({
      gauge_id: r['gauge_id'],
      delta: r['delta'],
      reason: typeof r['reason'] === 'string' ? r['reason'] : '',
    });
  }
  return valid.length > 0 ? valid : undefined;
}

export function extractPlotEvaluation(
  customFields: Record<string, unknown> | undefined,
): PlotEvaluation | null {
  if (!customFields) return null;
  const raw = customFields['plot_evaluation'];
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['node_reached'] !== 'boolean') return null;
  if (typeof obj['confidence'] !== 'number') return null;
  return {
    node_reached: obj['node_reached'] as boolean,
    confidence: obj['confidence'] as number,
    evidence: typeof obj['evidence'] === 'string' ? obj['evidence'] : '',
    gauge_updates: validateGaugeUpdates(obj['gauge_updates']),
  };
}

export function generatePlotId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
