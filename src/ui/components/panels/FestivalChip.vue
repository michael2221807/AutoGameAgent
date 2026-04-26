<script setup lang="ts">
/**
 * Festival chip — status-bar display for `世界.节日` single-object.
 *
 * Visible only when `isFestivalVisible` returns true (hidden for the default
 * `{名称:"平日", 描述:"", 效果:""}` state). Clicking opens FestivalPopover
 * with 描述 + 效果.
 */
import { ref, computed } from 'vue';
import { isFestivalVisible, normalizeFestival } from './environment-helpers';
import FestivalPopover from './FestivalPopover.vue';

const props = defineProps<{
  festival: unknown;
}>();

const popoverOpen = ref(false);

/**
 * Single source of truth for visibility. `normalizeFestival` returns null
 * for the same cases `isFestivalVisible` returns false, EXCEPT it would
 * accept the default `平日` as valid data. We gate on `isFestivalVisible`
 * (which correctly hides the default `平日`) and use the normalized object
 * only when we've already decided to render.
 */
const visible = computed(() => isFestivalVisible(props.festival));
const normalized = computed(() => (visible.value ? normalizeFestival(props.festival) : null));

function open(): void {
  if (normalized.value) popoverOpen.value = true;
}
</script>

<template>
  <template v-if="normalized">
    <button
      type="button"
      class="festival-chip"
      :title="`节日：${normalized.名称}，点击查看详情`"
      :aria-label="`节日 ${normalized.名称}`"
      aria-haspopup="dialog"
      :aria-expanded="popoverOpen"
      @click="open"
    >
      <span class="festival-chip__label">节日</span>
      <span class="festival-chip__value">{{ normalized.名称 }}</span>
    </button>

    <FestivalPopover
      v-model="popoverOpen"
      :festival="normalized"
    />
  </template>
</template>

<style scoped>
.festival-chip {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;

  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  opacity: 0.7;
  transition: opacity 0.18s ease, transform 0.18s ease;
  user-select: none;
  white-space: nowrap;
}

.festival-chip:hover {
  opacity: 1;
  transform: translateY(-1px);
}

.festival-chip:focus-visible {
  outline: 1px dashed var(--color-primary, #d9b674);
  outline-offset: 2px;
  opacity: 1;
}

.festival-chip__label {
  font-size: 0.7rem;
  color: var(--color-text-muted, var(--color-text-secondary));
  letter-spacing: 0.05em;
}

.festival-chip__value {
  font-weight: 600;
  color: var(--color-text);
}
</style>
