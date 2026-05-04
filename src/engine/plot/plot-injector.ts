// Design: docs/design/plot-direction-system.md
/**
 * Plot Direction System — Prompt Variable Builder
 *
 * Constructs PLOT_DIRECTIVE (step1) and PLOT_COMPLETION_HINT + PLOT_GAUGE_INSTRUCTIONS (step2)
 * with sufficient context for the model to understand AND act on the data.
 *
 * Design principle: the model should be able to answer these questions from the injected text:
 *   1. What story arc is this? What happened so far?
 *   2. What should this scene accomplish?
 *   3. What gauges exist, what do they mean, and what are their current values?
 *   4. How should the model report gauge changes? (exact field names + format)
 *   5. What does "node complete" look like?
 */
import type { StateManager } from '../core/state-manager';
import type { EnginePathConfig } from '../pipeline/types';
import type { PlotDirectionState, PlotArc, PlotNode, PlotGauge } from './types';

const MAX_COMPLETED_SUMMARY = 3;

function getActiveArc(state: PlotDirectionState | undefined): PlotArc | null {
  if (!state || state.activeArcIndex == null) return null;
  return state.arcs[state.activeArcIndex] ?? null;
}

function getActiveNode(arc: PlotArc): PlotNode | null {
  return arc.nodes.find(n => n.status === 'active') ?? null;
}

function buildCompletedSummary(arc: PlotArc): string {
  const completed = arc.nodes.filter(n => n.status === 'completed');
  if (completed.length === 0) return '';
  const recent = completed.slice(-MAX_COMPLETED_SUMMARY);
  const prefix = completed.length > MAX_COMPLETED_SUMMARY
    ? `...+${completed.length - MAX_COMPLETED_SUMMARY}, `
    : '';
  return prefix + recent.map(n => n.title).join(', ');
}

function getCurrentOpportunity(node: PlotNode, currentRound: number): string {
  if (!node.activatedAtRound || node.opportunityTiers.length === 0) return '';
  const elapsed = currentRound - node.activatedAtRound;
  let best: string | null = null;
  for (const t of node.opportunityTiers) {
    if (elapsed >= t.afterRounds) best = t.prompt;
  }
  return best ?? '';
}

/**
 * Build the full gauge context block — name, description, value, range.
 * This gives the model semantic understanding of each gauge.
 */
function buildGaugeContext(gauges: PlotGauge[]): string {
  if (gauges.length === 0) return '';
  const lines = gauges.map(g => {
    const range = `${g.min}-${g.max}`;
    const desc = g.description ? ` — ${g.description}` : '';
    return `- ${g.name}: ${g.current}/${g.max}${g.unit} (${range})${desc}`;
  });
  return lines.join('\n');
}

/**
 * Build Step 1 directive — everything the model needs to write the scene.
 */
function buildDirectiveBlock(arc: PlotArc, node: PlotNode, round: number): string {
  const sections: string[] = [];

  // Arc context
  const isFirstRound = node.activatedAtRound === round;
  if (isFirstRound) {
    sections.push(`弧线：${arc.title}`);
    if (arc.synopsis) sections.push(`概要：${arc.synopsis}`);
    sections.push('');
  }

  // Completed nodes
  const completed = buildCompletedSummary(arc);
  if (completed) sections.push(`已完成：${completed}`);

  // Current node — full context
  sections.push(`【当前节点：${node.title}】`);
  if (node.narrativeGoal) sections.push(`目标：${node.narrativeGoal}`);
  sections.push(`引导：${node.directive}`);
  if (node.emotionalTone) sections.push(`基调：${node.emotionalTone}`);

  // Gauges with full descriptions
  const gaugeBlock = buildGaugeContext(arc.gauges);
  if (gaugeBlock) {
    sections.push('');
    sections.push('【剧情度量值】');
    sections.push(gaugeBlock);
    sections.push('你的叙事应自然反映这些数值的含义和变化趋势。');
  }

  // Opportunity hint
  const opp = getCurrentOpportunity(node, round);
  if (opp) {
    sections.push('');
    sections.push(`【引导提示】${opp}`);
  }

  return sections.join('\n');
}

/**
 * Build Step 2 gauge update instructions — exact field names + format.
 * Uses gauge NAME (not internal ID) so the model can match what it saw in Step 1.
 */
function buildGaugeInstructions(gauges: PlotGauge[]): string {
  const updatable = gauges.filter(g => g.aiUpdatable);
  if (updatable.length === 0) return '';

  const lines: string[] = [
    '根据本轮叙事内容，在 gauge_updates 中报告度量值变化：',
  ];

  for (const g of updatable) {
    const desc = g.description ? ` — ${g.description}` : '';
    lines.push(`- "${g.name}": 当前${g.current}/${g.max}${g.unit}${desc}`);
  }

  lines.push('');
  lines.push('格式：gauge_updates: [{ "gauge_id": "度量值名称", "delta": 变化量, "reason": "原因" }]');
  lines.push('注意：gauge_id 填写度量值的名称（如上方引号中的文字），delta 为正数表示增加、负数表示减少。');

  const managed = gauges.filter(g => !g.aiUpdatable);
  if (managed.length > 0) {
    lines.push(`以下度量值由系统管理，请勿修改：${managed.map(g => g.name).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build evaluation context — tells the model what node it's evaluating,
 * what the completion criteria are, and that this is a retrospective
 * assessment of the PREVIOUS round's narrative.
 */
function buildEvalContext(arc: PlotArc, node: PlotNode): string {
  const lines: string[] = [
    `弧线：${arc.title}`,
    `当前节点：${node.title}`,
  ];
  if (node.narrativeGoal) {
    lines.push(`节点目标：${node.narrativeGoal}`);
  }
  return lines.join('\n');
}

export class PlotInjector {
  static buildStep1Variables(
    stateManager: StateManager,
    paths: EnginePathConfig,
  ): Record<string, string> {
    const state = stateManager.get<PlotDirectionState>(paths.plotDirection);
    const arc = getActiveArc(state);
    if (!arc) return {};
    const node = getActiveNode(arc);
    if (!node) return {};
    const round = stateManager.get<number>(paths.roundNumber) ?? 0;

    return {
      PLOT_DIRECTIVE: buildDirectiveBlock(arc, node, round),
    };
  }

  static buildStep2Variables(
    stateManager: StateManager,
    paths: EnginePathConfig,
  ): Record<string, string> {
    const state = stateManager.get<PlotDirectionState>(paths.plotDirection);
    const arc = getActiveArc(state);
    if (!arc) return {};
    const node = getActiveNode(arc);
    if (!node) return {};

    return {
      PLOT_EVAL_CONTEXT: buildEvalContext(arc, node),
      PLOT_COMPLETION_HINT: node.completionHint,
      PLOT_GAUGE_INSTRUCTIONS: buildGaugeInstructions(arc.gauges),
    };
  }

  static buildAllVariables(
    stateManager: StateManager,
    paths: EnginePathConfig,
  ): Record<string, string> {
    return {
      ...PlotInjector.buildStep1Variables(stateManager, paths),
      ...PlotInjector.buildStep2Variables(stateManager, paths),
    };
  }
}
