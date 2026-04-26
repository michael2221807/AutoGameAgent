<script setup lang="ts">
/**
 * Environment chip strip — status-bar display for `世界.环境` array.
 *
 * Shows comma-joined tag names (capped at 3 with "…+N" overflow suffix)
 * via `formatTagSummary`. Click anywhere on the chip opens the popover
 * which lists ALL tags with full 描述/效果.
 *
 * Component hides itself entirely when there are no valid tags — empty
 * state is communicated by absence rather than by a "无" placeholder,
 * matching the Polanyi "subsidiary recession" principle.
 */
import { ref, computed } from 'vue';
import { formatTagSummary, sanitizeTagList, countOverflow } from './environment-helpers';
import EnvironmentPopover from './EnvironmentPopover.vue';

const props = defineProps<{
  tags: unknown;
}>();

const popoverOpen = ref(false);

const sanitized = computed(() => sanitizeTagList(props.tags));
const summary = computed(() => formatTagSummary(props.tags, 3));
const overflow = computed(() => countOverflow(props.tags, 3));

const hasAny = computed(() => sanitized.value.length > 0);

function open(): void {
  if (hasAny.value) popoverOpen.value = true;
}
</script>

<template>
  <template v-if="hasAny">
    <button
      type="button"
      class="env-chips"
      :title="overflow > 0 ? `共 ${sanitized.length} 个环境标签，点击查看全部` : '点击查看详情'"
      :aria-label="`环境标签：${summary}`"
      aria-haspopup="dialog"
      :aria-expanded="popoverOpen"
      @click="open"
    >
      <span class="env-chips__label">环境</span>
      <span class="env-chips__value">{{ summary }}</span>
    </button>

    <EnvironmentPopover
      v-model="popoverOpen"
      :tags="sanitized"
    />
  </template>
</template>

<style scoped>
.env-chips {
  /* unstyle button base */
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
  max-width: 30ch;
  overflow: hidden;
  text-overflow: ellipsis;
}

.env-chips:hover {
  opacity: 1;
  transform: translateY(-1px);
}

.env-chips:focus-visible {
  outline: 1px dashed var(--color-primary, #d9b674);
  outline-offset: 2px;
  opacity: 1;
}

.env-chips__label {
  font-size: 0.7rem;
  color: var(--color-text-muted, var(--color-text-secondary));
  letter-spacing: 0.05em;
}

.env-chips__value {
  font-weight: 600;
  color: var(--color-text);
  /* Parent .env-chips already clips + ellipsizes; no need to repeat here */
}
</style>
