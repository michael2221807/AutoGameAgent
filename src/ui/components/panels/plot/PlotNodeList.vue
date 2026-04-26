<script setup lang="ts">
import { computed } from 'vue';
import type { PlotNode, PlotGauge, GaugeCondition } from '@/engine/plot/types';

const props = defineProps<{
  nodes: PlotNode[];
  gauges: PlotGauge[];
  currentRound: number;
}>();

const emit = defineEmits<{
  (e: 'insert-after', index: number): void;
  (e: 'remove', nodeId: string): void;
  (e: 'select', nodeId: string): void;
}>();

function statusIcon(status: PlotNode['status']): string {
  switch (status) {
    case 'completed': return '\u2705';
    case 'active':    return '\uD83D\uDD35';
    case 'skipped':   return '\u23ED\uFE0F';
    default:          return '\u25CB';
  }
}

function roundInfo(node: PlotNode): string {
  if (node.status !== 'active' || !node.activatedAtRound) return '';
  const elapsed = props.currentRound - node.activatedAtRound;
  const max = node.maxRounds ? `/${node.maxRounds}` : '';
  return `[${elapsed}${max}轮]`;
}

function conditionLabel(cond: GaugeCondition): string {
  const gauge = props.gauges.find(g => g.id === cond.gaugeId);
  const name = gauge?.name ?? cond.gaugeId;
  const opMap: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };
  return `${name}${opMap[cond.operator] ?? '?'}${cond.value}`;
}

const activeNodeCurrentTier = computed(() => {
  const active = props.nodes.find(n => n.status === 'active');
  if (!active || !active.activatedAtRound || active.opportunityTiers.length === 0) return null;
  const elapsed = props.currentRound - active.activatedAtRound;
  let current: number | null = null;
  for (const t of active.opportunityTiers) {
    if (elapsed >= t.afterRounds) current = t.tier;
  }
  return current;
});
</script>

<template>
  <div class="node-list">
    <div
      v-for="(node, idx) in nodes"
      :key="node.id"
      :class="['node-item', `node-item--${node.status}`]"
      @click="emit('select', node.id)"
    >
      <div class="node-item__indicator">
        <span class="node-item__icon">{{ statusIcon(node.status) }}</span>
        <div v-if="idx < nodes.length - 1" class="node-item__line" />
      </div>

      <div class="node-item__body">
        <div class="node-item__header">
          <span class="node-item__title">{{ node.title }}</span>
          <span v-if="node.status === 'active'" class="node-item__round">
            {{ roundInfo(node) }}
          </span>
          <span v-if="node.importance === 'critical'" class="node-item__badge node-item__badge--critical">
            关键
          </span>
        </div>

        <p v-if="node.status === 'active'" class="node-item__goal">
          {{ node.narrativeGoal }}
        </p>

        <div v-if="node.status === 'active' && activeNodeCurrentTier" class="node-item__tier">
          Tier {{ activeNodeCurrentTier }} 引导中
        </div>

        <div v-if="node.activationConditions.length > 0 && node.status === 'pending'" class="node-item__conditions">
          需要：
          <span v-for="(cond, ci) in node.activationConditions" :key="ci" class="node-item__cond-tag">
            {{ conditionLabel(cond) }}
          </span>
        </div>

        <div v-if="node.completionConditions.length > 0 && node.status === 'active'" class="node-item__conditions">
          完成条件：
          <span v-for="(cond, ci) in node.completionConditions" :key="ci" class="node-item__cond-tag">
            {{ conditionLabel(cond) }}
          </span>
        </div>

        <div v-if="node.status === 'completed'" class="node-item__completed-round">
          R{{ node.activatedAtRound }}-R{{ node.completedAtRound }}
        </div>
      </div>

      <div class="node-item__actions">
        <button
          class="node-action-btn node-action-btn--insert"
          title="在此节点后插入"
          @click.stop="emit('insert-after', idx)"
        >+</button>
        <button
          v-if="node.status === 'pending'"
          class="node-action-btn node-action-btn--remove"
          title="移除节点"
          @click.stop="emit('remove', node.id)"
        >&times;</button>
      </div>
    </div>

    <button
      class="insert-btn"
      title="在末尾添加节点"
      @click="emit('insert-after', nodes.length - 1)"
    >+ 添加节点</button>
  </div>
</template>

<style scoped>
.node-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.node-item {
  display: flex;
  gap: 10px;
  padding: 8px 4px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
}
.node-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.node-item__indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 24px;
  flex-shrink: 0;
}
.node-item__icon {
  font-size: 14px;
  line-height: 1;
}
.node-item__line {
  flex: 1;
  width: 1px;
  margin-top: 4px;
  background: var(--color-border-subtle, rgba(255,255,255,0.08));
}

.node-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.node-item__header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-item__title {
  font-size: var(--font-size-md, 14px);
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
  font-family: var(--font-serif-cjk, serif);
}
.node-item--pending .node-item__title {
  color: var(--color-text-secondary, #aaa);
}
.node-item--skipped .node-item__title {
  color: var(--color-text-secondary, #aaa);
  text-decoration: line-through;
}

.node-item__round {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
}

.node-item__badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
}
.node-item__badge--critical {
  background: rgba(255, 160, 80, 0.15);
  color: var(--color-amber-400, #f59e0b);
}

.node-item__goal {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.node-item__tier {
  font-size: 11px;
  color: var(--color-sage-400, #8cb88c);
  font-family: var(--font-mono, monospace);
}

.node-item__conditions {
  font-size: 11px;
  color: var(--color-text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.node-item__cond-tag {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.node-item__completed-round {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
}

.node-item__actions {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
}

.node-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-secondary);
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.node-item:hover .node-action-btn {
  opacity: 1;
}
.node-action-btn--insert:hover {
  color: var(--color-sage-400, #8cb88c);
}
.node-action-btn--remove:hover {
  color: var(--color-danger, #c0392b);
}

.insert-btn {
  margin-top: 4px;
  padding: 6px 12px;
  background: none;
  border: 1px dashed var(--color-border-subtle, rgba(255,255,255,0.1));
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.insert-btn:hover {
  border-color: var(--color-sage-400, #8cb88c);
  color: var(--color-sage-400, #8cb88c);
}
</style>
