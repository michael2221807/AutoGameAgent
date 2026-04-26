<script setup lang="ts">
/**
 * AgaButton — AGA design system primary button primitive.
 *
 * Variants: primary (default), secondary, danger, ghost.
 * Sizes: sm, md (default), lg.
 * Supports: disabled state, loading state, icon slot.
 * Uses AGA design tokens from tokens.css.
 */
defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
}>();
</script>

<template>
  <button
    class="aga-btn"
    :class="[
      `aga-btn--${variant ?? 'primary'}`,
      `aga-btn--${size ?? 'md'}`,
      { 'aga-btn--loading': loading },
    ]"
    :disabled="disabled || loading"
    v-bind="$attrs"
  >
    <span v-if="loading" class="aga-btn__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Principle: "Accents are beacons, not buttons." Filled-sage + #fff text
     was a loud B2B-SaaS primary. Rewritten: Primary = sage-muted fill +
     sage-100 text + sage outline + sage halo on hover. Never #fff.
   - Danger: filled-rust + #fff → warm-rust translucent muted (matches
     MainGamePanel cancel-btn language).
   - Spinner: 600ms → 800ms (sanctuary "slower than web default"). */

.aga-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}

.aga-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Sizes */
.aga-btn--sm { padding: var(--space-2xs) var(--space-sm); font-size: var(--font-size-xs); }
.aga-btn--md { padding: var(--space-xs) var(--space-md); font-size: var(--font-size-sm); }
.aga-btn--lg { padding: var(--space-sm) var(--space-lg); font-size: var(--font-size-md); }

/* Primary — sage beacon (muted fill + sage-100 text + glow on hover) */
.aga-btn--primary {
  background: var(--color-sage-muted);
  color: var(--color-sage-100);
  border-color: color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}
.aga-btn--primary:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-sage-400) 22%, transparent);
  border-color: var(--color-sage-400);
  box-shadow: 0 0 16px color-mix(in oklch, var(--color-sage-400) 28%, transparent);
}

/* Secondary — neutral outline + bone text, warms to sage on hover */
.aga-btn--secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text);
}
.aga-btn--secondary:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  color: var(--color-sage-100);
  background: color-mix(in oklch, var(--color-sage-400) 5%, transparent);
}

/* Danger — warm rust muted, never filled + #fff */
.aga-btn--danger {
  background: color-mix(in oklch, var(--color-danger) 12%, transparent);
  border-color: color-mix(in oklch, var(--color-danger) 40%, transparent);
  color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
}
.aga-btn--danger:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-danger) 22%, transparent);
  border-color: color-mix(in oklch, var(--color-danger) 60%, transparent);
}

/* Ghost — transparent, warms to sage on hover */
.aga-btn--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.aga-btn--ghost:hover:not(:disabled) {
  background: var(--color-sage-muted);
  color: var(--color-sage-300);
}

/* Loading spinner */
.aga-btn--loading { pointer-events: none; }
.aga-btn__spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--radius-full);
  animation: aga-spin 0.8s linear infinite;
}
@keyframes aga-spin { to { transform: rotate(360deg); } }
</style>
