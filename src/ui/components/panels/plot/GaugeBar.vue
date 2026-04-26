<script setup lang="ts">
import { computed } from 'vue';
import type { PlotGauge } from '@/engine/plot/types';

const props = defineProps<{
  gauge: PlotGauge;
  compact?: boolean;
}>();

const pct = computed(() => {
  const range = props.gauge.max - props.gauge.min;
  if (range <= 0) return 0;
  return Math.round(((props.gauge.current - props.gauge.min) / range) * 100);
});

const displayValue = computed(() => {
  if (props.gauge.unit === '%') return `${pct.value}%`;
  return `${props.gauge.current}${props.gauge.unit}`;
});

const barColor = computed(() => props.gauge.color ?? 'var(--color-sage-400)');
</script>

<template>
  <div :class="['gauge-bar', { 'gauge-bar--compact': compact }]">
    <div class="gauge-bar__header">
      <span class="gauge-bar__name">{{ gauge.name }}</span>
      <span class="gauge-bar__value">{{ displayValue }}</span>
    </div>
    <div class="gauge-bar__track">
      <div
        class="gauge-bar__fill"
        :style="{ width: pct + '%', backgroundColor: barColor }"
      />
    </div>
  </div>
</template>

<style scoped>
.gauge-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gauge-bar--compact {
  gap: 2px;
}
.gauge-bar__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--font-size-xs, 12px);
}
.gauge-bar__name {
  color: var(--color-text-secondary, #aaa);
  font-family: var(--font-serif-cjk, serif);
}
.gauge-bar__value {
  color: var(--color-text, #e0e0e6);
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  font-size: 11px;
}
.gauge-bar__track {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.gauge-bar--compact .gauge-bar__track {
  height: 4px;
}
.gauge-bar__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease-out;
  min-width: 2px;
}
</style>
