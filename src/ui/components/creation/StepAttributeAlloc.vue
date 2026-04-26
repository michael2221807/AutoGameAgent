<script setup lang="ts">
/**
 * StepAttributeAlloc — 创角步骤：属性点分配。
 *
 * 显示 step.attributes 中定义的所有属性，每个属性有 +/- 按钮和当前值。
 * 总可分配点数由 step.totalPoints 决定，每个属性上限为 step.perAttributeMax。
 * 不允许低于 0 或超过上限，也不允许总分配超出预算。
 */
import { computed, ref, watch } from 'vue';
import type { CreationStep } from '@/engine/types';

const props = defineProps<{
  step: CreationStep;
  presets: unknown[];
  /** 当前分配状态 — Record<属性名, 分配值> */
  selection: unknown;
  budget: number;
}>();

const emit = defineEmits<{
  select: [value: unknown];
}>();

/** 属性名列表 */
const attributes = computed<string[]>(() => props.step.attributes ?? []);

/** 每个属性的最大值 */
const perMax = computed<number>(() => props.step.perAttributeMax ?? 10);

/** 总可分配点数 */
const totalPoints = computed<number>(() => props.step.totalPoints ?? props.budget);

/** 内部分配状态 — 初始化自 selection prop */
const alloc = ref<Record<string, number>>(buildInitial());

function buildInitial(): Record<string, number> {
  const sel = props.selection;
  const result: Record<string, number> = {};
  for (const attr of (props.step.attributes ?? [])) {
    if (typeof sel === 'object' && sel !== null && attr in (sel as Record<string, unknown>)) {
      const v = (sel as Record<string, number>)[attr];
      result[attr] = typeof v === 'number' ? v : 0;
    } else {
      result[attr] = 0;
    }
  }
  return result;
}

/** selection prop 变更时同步 */
watch(() => props.selection, () => {
  alloc.value = buildInitial();
}, { deep: true });

/** 已分配总点数 */
const allocated = computed<number>(() =>
  Object.values(alloc.value).reduce((s, v) => s + v, 0),
);

/** 剩余可分配点数 */
const remaining = computed<number>(() => totalPoints.value - allocated.value);

/** 增加某个属性 */
function increment(attr: string): void {
  if (remaining.value <= 0) return;
  if (alloc.value[attr] >= perMax.value) return;
  alloc.value[attr]++;
  emitCurrent();
}

/** 减少某个属性 */
function decrement(attr: string): void {
  if (alloc.value[attr] <= 0) return;
  alloc.value[attr]--;
  emitCurrent();
}

/** 重置所有属性为 0 */
function resetAttributes(): void {
  for (const attr of attributes.value) {
    alloc.value[attr] = 0;
  }
  emitCurrent();
}

/** 均等分配所有点数（余数依次分给前几个属性，同时遵守 perAttributeMax） */
function balanceAttributes(): void {
  const keys = attributes.value;
  if (keys.length === 0) return;

  const cap = perMax.value;
  const total = Math.min(totalPoints.value, keys.length * cap);
  const base = Math.floor(total / keys.length);
  const extra = total % keys.length;

  for (let i = 0; i < keys.length; i++) {
    alloc.value[keys[i]] = Math.min(base + (i < extra ? 1 : 0), cap);
  }
  emitCurrent();
}

/** 随机分配：先归零，然后随机投点直到总点数用完或所有属性达上限 */
function randomizeAttributes(): void {
  const keys = attributes.value;
  for (const k of keys) alloc.value[k] = 0;

  let rem = totalPoints.value;
  while (rem > 0) {
    const eligible = keys.filter((k) => alloc.value[k] < perMax.value);
    if (eligible.length === 0) break;
    const pick = eligible[Math.floor(Math.random() * eligible.length)];
    alloc.value[pick]++;
    rem--;
  }
  emitCurrent();
}

/** 发送当前分配状态 */
function emitCurrent(): void {
  emit('select', { ...alloc.value });
}
</script>

<template>
  <div class="step-attr-alloc">
    <div class="step-header">
      <h3 class="step-title">{{ step.label }}</h3>
      <span
        class="points-badge"
        :class="{ empty: remaining === 0, negative: remaining < 0 }"
      >
        剩余点数: <strong>{{ remaining }}</strong> / {{ totalPoints }}
      </span>
    </div>

    <!-- 辅助操作按钮组 -->
    <div class="helper-actions">
      <button class="helper-btn" @click="resetAttributes" title="所有属性归零">
        重置
      </button>
      <button class="helper-btn" @click="balanceAttributes" title="均等分配所有点数">
        均等
      </button>
      <button class="helper-btn" @click="randomizeAttributes" title="随机分配所有点数">
        随机
      </button>
    </div>

    <div class="attr-list">
      <div v-for="attr in attributes" :key="attr" class="attr-row">
        <div class="attr-name-col">
          <span class="attr-name">{{ attr }}</span>
          <span
            v-if="step.attributeDescriptions && step.attributeDescriptions[attr]"
            class="attr-desc"
          >
            {{ step.attributeDescriptions[attr] }}
          </span>
        </div>

        <div class="attr-controls">
          <button
            class="ctrl-btn"
            :disabled="alloc[attr] <= 0"
            @click="decrement(attr)"
          >
            −
          </button>

          <span class="attr-value">{{ alloc[attr] }}</span>

          <!-- 进度条可视化 -->
          <div class="attr-bar">
            <div
              class="attr-bar-fill"
              :style="{ width: `${(alloc[attr] / perMax) * 100}%` }"
            />
          </div>

          <button
            class="ctrl-btn"
            :disabled="alloc[attr] >= perMax || remaining <= 0"
            @click="increment(attr)"
          >
            +
          </button>
        </div>

        <span class="attr-max">/ {{ perMax }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - points-badge: three tint states (normal sage / empty success-sage /
     negative rust); all retokenized
   - ctrl-btn hover: `color: white` on primary fill → sage-100 on sage-muted
   - attr-bar-fill: sage + halo (instrument-readout glow)
   - helper-btn hover: raw rgba indigo → sage color-mix */

.step-attr-alloc {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.step-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.step-title {
  font-family: var(--font-serif-cjk);
  font-size: 1.2rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-text);
}

.points-badge {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  padding: 0.375rem 0.875rem;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.points-badge strong {
  color: var(--color-sage-300);
  font-weight: 600;
}

.points-badge.empty { border-color: color-mix(in oklch, var(--color-success) 40%, var(--color-border)); }
.points-badge.empty strong { color: var(--color-success); }
.points-badge.negative { border-color: color-mix(in oklch, var(--color-danger) 45%, var(--color-border)); }
.points-badge.negative strong { color: var(--color-danger-hover); }

/* ── Helper action buttons ── */

.helper-actions {
  display: flex;
  gap: 0.5rem;
}

.helper-btn {
  padding: 0.375rem 0.875rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}
.helper-btn:hover {
  color: var(--color-sage-300);
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
}

.attr-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.attr-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.625rem 0.875rem;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.attr-name-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 140px;
  flex-shrink: 0;
}

.attr-name {
  font-family: var(--font-serif-cjk);
  font-weight: 500;
  font-size: 0.88rem;
  letter-spacing: 0.06em;
  color: var(--color-text);
}

.attr-desc {
  font-family: var(--font-serif-cjk);
  font-size: 0.7rem;
  color: var(--color-text-umber);
  font-style: italic;
  opacity: 0.85;
  line-height: 1.4;
}

.attr-controls {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.ctrl-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.ctrl-btn:hover:not(:disabled) {
  color: var(--color-sage-100);
  border-color: var(--color-sage-400);
  background: var(--color-sage-muted);
}

.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.attr-value {
  width: 32px;
  text-align: center;
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-sage-300);
  flex-shrink: 0;
}

.attr-bar {
  flex: 1;
  height: 5px;
  background: var(--color-border);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.attr-bar-fill {
  height: 100%;
  background: var(--color-sage-400);
  box-shadow: 0 0 6px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
  border-radius: var(--radius-full);
  transition: width var(--duration-normal) var(--ease-out);
}

.attr-max {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-text-muted);
  flex-shrink: 0;
  width: 36px;
}
</style>
