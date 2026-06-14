<script setup lang="ts">
/**
 * SessionModeBadge — the single visual language for session mode (Story 9 v2).
 *
 * Used identically in the TopBar (as the toggle's content) AND the card-writing
 * guide header, so the persistent indicator and the guide are visually linked
 * (PM P-A: 不能各做各的). Presentational only — it renders icon + localized label
 * + mode colour; callers wire interaction (the TopBar wraps it in the toggle
 * button). State comes from useSessionMode, shared everywhere.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SessionType } from '@/engine/types/persistence';
// App doc: docs/user-guide/pages/game-card-guide.md §4.20.1

const props = withDefaults(
  defineProps<{
    mode: SessionType;
    /** sm = compact (top bar), md = prominent (guide header) */
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);

const { t } = useI18n();

const label = computed(() =>
  props.mode === 'worldBuilding'
    ? t('layout.topbar.modeBadgeWorldBuilding')
    : t('layout.topbar.modeBadgePlay'),
);
</script>

<template>
  <span class="mode-badge" :class="[`mode-badge--${mode}`, `mode-badge--${size}`]">
    <!-- worldBuilding → pencil; play → play triangle -->
    <svg v-if="mode === 'worldBuilding'" viewBox="0 0 20 20" fill="currentColor" :width="size === 'md' ? 16 : 14" :height="size === 'md' ? 16 : 14" aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
    <svg v-else viewBox="0 0 20 20" fill="currentColor" :width="size === 'md' ? 16 : 14" :height="size === 'md' ? 16 : 14" aria-hidden="true">
      <path d="M6 4l10 6-10 6V4z" />
    </svg>
    <span class="mode-badge__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  font-family: var(--font-sans);
  font-weight: 600;
  white-space: nowrap;
  line-height: 1;
  transition: color var(--duration-normal, 0.24s) var(--ease-out, ease),
              background var(--duration-normal, 0.24s) var(--ease-out, ease);
}

.mode-badge--sm {
  padding: 5px 10px;
  font-size: 0.76rem;
}
.mode-badge--md {
  padding: 7px 14px;
  font-size: 0.9rem;
}

/* Play mode — neutral/quiet (subsidiary). */
.mode-badge--play {
  color: var(--color-text-secondary);
  background: color-mix(in oklch, var(--color-text) 7%, transparent);
}

/* Writing mode — lit sage beacon, unmistakable across every panel. */
.mode-badge--worldBuilding {
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 32%, transparent);
}
</style>
