<script setup lang="ts">
/**
 * Tooltip — the project's single hover-hint primitive (Story 5 / U12).
 *
 * Per CLAUDE.md §8: ALL hover hints must use this component. Do NOT stack bare
 * `title=` attributes or hand-roll tooltips. Glass chip-grade surface (light blur,
 * no full glass recipe). The 800ms reveal delay is CSS-only (no JS timers) so it
 * stays smooth on low-end devices.
 *
 * Usage:  <Tooltip :text="$t('save.export.nsfw.hint')"><InfoIcon /></Tooltip>
 */
import { computed, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Single-sentence hint (Polanyi: one sentence, ≤ ~100 chars). */
    text: string;
    /** Bubble side relative to the trigger. */
    position?: 'top' | 'bottom' | 'left' | 'right';
    /** Reveal delay in ms (default 800 — appears only on a deliberate hover). */
    delay?: number;
  }>(),
  { position: 'top', delay: 800 },
);

// Vue 3.5 useId() → collision-free, SSR/HMR-safe id for aria-describedby (no globalThis mutation).
const tipId = `tt-${useId()}`;

const styleVars = computed(() => ({ '--tt-delay': `${props.delay}ms` }));
</script>

<template>
  <span
    class="tt-wrap"
    :class="`tt-wrap--${position}`"
    tabindex="0"
    :aria-describedby="tipId"
    :style="styleVars"
  >
    <slot />
    <span :id="tipId" class="tt-bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<style scoped>
.tt-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
  outline: none;
}

.tt-bubble {
  position: absolute;
  z-index: var(--z-tooltip);
  width: max-content;
  max-width: 240px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text, #ece7df);
  /* chip-grade: readable dark surface + light blur, no full glass recipe */
  background: rgba(25, 24, 22, 0.92);
  backdrop-filter: blur(6px) saturate(1.2);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  /* hide is immediate; show waits --tt-delay (CSS-only, no JS timer) */
  transition: opacity 0.14s var(--ease-out), visibility 0s linear 0.14s;
}

.tt-wrap:hover .tt-bubble,
.tt-wrap:focus-visible .tt-bubble {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.14s var(--ease-out) var(--tt-delay, 800ms),
    visibility 0s linear var(--tt-delay, 800ms);
}

.tt-wrap--top .tt-bubble    { bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); }
.tt-wrap--bottom .tt-bubble { top: calc(100% + 6px);    left: 50%; transform: translateX(-50%); }
.tt-wrap--left .tt-bubble   { right: calc(100% + 6px);  top: 50%;  transform: translateY(-50%); }
.tt-wrap--right .tt-bubble  { left: calc(100% + 6px);   top: 50%;  transform: translateY(-50%); }

@media (prefers-reduced-motion: reduce) {
  .tt-bubble,
  .tt-wrap:hover .tt-bubble,
  .tt-wrap:focus-visible .tt-bubble {
    transition: none;
  }
}
</style>
