<script setup lang="ts">
/**
 * AgaLoader — loading indicator. Pulsing dots (not a spinner — Polanyi: organic, not mechanical).
 */
defineProps<{
  size?: 'sm' | 'md' | 'lg';
}>();
</script>

<template>
  <div class="aga-loader" :class="`aga-loader--${size ?? 'md'}`" role="status" aria-label="加载中">
    <span class="aga-loader__dot" />
    <span class="aga-loader__dot" />
    <span class="aga-loader__dot" />
  </div>
</template>

<style scoped>
.aga-loader { display: inline-flex; gap: var(--space-xs); align-items: center; }
.aga-loader--sm .aga-loader__dot { width: 4px; height: 4px; }
.aga-loader--md .aga-loader__dot { width: 6px; height: 6px; }
.aga-loader--lg .aga-loader__dot { width: 8px; height: 8px; }

.aga-loader__dot {
  border-radius: var(--radius-full);
  /* Sage with soft halo — instrument-LED glow, not Tailwind primary. */
  background: var(--color-sage-400);
  box-shadow: 0 0 6px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
  animation: aga-loader-breath var(--duration-breath) var(--ease-out) infinite;
}
/* 220ms cascade matches MainGamePanel's typing dots — unified tempo. */
.aga-loader__dot:nth-child(2) { animation-delay: 220ms; }
.aga-loader__dot:nth-child(3) { animation-delay: 440ms; }

@keyframes aga-loader-breath {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1.05); }
}
</style>
