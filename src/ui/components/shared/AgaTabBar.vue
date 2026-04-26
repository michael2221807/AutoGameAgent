<script setup lang="ts">
/**
 * AgaTabBar — horizontal tab strip with underline indicator.
 *
 * v-model binding selects active tab by key. Keyboard nav: ← → arrows.
 */
import { ref } from 'vue';

export interface TabItem {
  key: string;
  label: string;
  badge?: string | number;
}

const props = defineProps<{
  tabs: TabItem[];
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', key: string): void;
}>();

const containerRef = ref<HTMLElement | null>(null);

function select(key: string) {
  emit('update:modelValue', key);
}

function onKeydown(e: KeyboardEvent, idx: number) {
  let next = idx;
  if (e.key === 'ArrowRight') next = (idx + 1) % props.tabs.length;
  else if (e.key === 'ArrowLeft') next = (idx - 1 + props.tabs.length) % props.tabs.length;
  else return;

  e.preventDefault();
  const nextKey = props.tabs[next].key;
  emit('update:modelValue', nextKey);

  const buttons = containerRef.value?.querySelectorAll<HTMLButtonElement>('.aga-tab__btn');
  buttons?.[next]?.focus();
}
</script>

<template>
  <div ref="containerRef" class="aga-tab-bar" role="tablist">
    <button
      v-for="(tab, i) in tabs"
      :key="tab.key"
      class="aga-tab__btn"
      :class="{ 'aga-tab__btn--active': modelValue === tab.key }"
      role="tab"
      :aria-selected="modelValue === tab.key"
      :tabindex="modelValue === tab.key ? 0 : -1"
      @click="select(tab.key)"
      @keydown="onKeydown($event, i)"
    >
      {{ tab.label }}
      <span v-if="tab.badge != null" class="aga-tab__badge">{{ tab.badge }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Primary (indigo) → sage-300 active text + sage-400 2px underline
     (the 2px tab-bottom indicator is a functional selection marker, NOT
     an absolute-ban side-stripe — it's the standard underline-tab pattern)
   - Badge: primary-muted bg + primary text → sage-muted bg + sage-300 text
   - Border below tabs: border → border-subtle for a quieter hairline */

.aga-tab-bar {
  display: flex;
  gap: var(--space-2xs);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}

.aga-tab__btn {
  position: relative;
  padding: var(--space-sm) var(--space-md);
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-family: var(--font-sans);
  letter-spacing: 0.04em;
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
  transition: color var(--duration-fast) var(--ease-out);
}

.aga-tab__btn:hover { color: var(--color-text); }

.aga-tab__btn--active {
  color: var(--color-sage-300);
}
.aga-tab__btn--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: var(--space-sm);
  right: var(--space-sm);
  height: 2px;
  background: var(--color-sage-400);
  border-radius: 1px;
}

.aga-tab__badge {
  margin-left: var(--space-xs);
  padding: 1px 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--color-sage-muted);
  color: var(--color-sage-300);
  border-radius: var(--radius-full);
}
</style>
