<script setup lang="ts">
/**
 * AgaToggle — pill switch toggle.
 *
 * v-model binding for boolean state. Accessible: role="switch" + aria-checked.
 *
 * `showLabel`: render `label` as a VISIBLE, clickable text beside the pill (the
 * whole control — pill or text — toggles on click). This replaces the older
 * `<div class="aga-toggle-row"><AgaToggle :label/><span>…</span></div>` pattern
 * where the adjacent label text was not clickable. Without `showLabel`, `label`
 * is only the aria-label (invisible), i.e. the classic bare pill — that render
 * path is intentionally byte-identical to the pre-showLabel component so every
 * existing plain toggle is unaffected.
 *
 * inheritAttrs:false so pass-through attrs (data-testid, class, …) always land
 * on the inner <button> in BOTH render branches, never on the labeled wrapper.
 */
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  label?: string;
  /** Render `label` as visible, clickable text beside the pill. */
  showLabel?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const attrs = useAttrs();

// In labeled mode a consumer `class`/`style` should style the ROW wrapper (its
// layout: full-width, a top separator, a smaller label font, …), NOT the 36px
// pill. Everything else (data-testid, aria-*, …) still goes to the <button>.
const buttonAttrs = computed(() => {
  if (!props.showLabel) return attrs;
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <!-- Labeled: pill + clickable text (aria-hidden so the switch isn't announced twice). -->
  <span
    v-if="showLabel && label"
    class="aga-toggle-labeled"
    :class="[attrs.class, { 'aga-toggle-labeled--disabled': disabled }]"
    :style="attrs.style"
  >
    <button
      class="aga-toggle"
      :class="{ 'aga-toggle--on': modelValue, 'aga-toggle--disabled': disabled }"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :disabled="disabled"
      v-bind="buttonAttrs"
      @click="toggle"
    >
      <span class="aga-toggle__thumb" />
    </button>
    <span class="aga-toggle-labeled__text" aria-hidden="true" @click="toggle">{{ label }}</span>
  </span>

  <!-- Bare pill (unchanged) -->
  <button
    v-else
    class="aga-toggle"
    :class="{ 'aga-toggle--on': modelValue, 'aga-toggle--disabled': disabled }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    v-bind="$attrs"
    @click="toggle"
  >
    <span class="aga-toggle__thumb" />
  </button>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Thumb `#fff` → `var(--color-text-bone)` (warm bone, never pure white)
   - ON-state raw sage → sage-mixed-into-border for softer engagement
     + faint sage halo so the switch reads as "lamp kindled, not strip lit"
   - `--ease-spring` was aliased to --ease-out per sanctuary "no bounce" rule;
     kept as-is so the transition inherits the brief-compliant ease-out */

.aga-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--color-border);
  cursor: pointer;
  padding: 2px;
  transition: background-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
  flex-shrink: 0;
}

.aga-toggle--on {
  background: color-mix(in oklch, var(--color-sage-400) 70%, var(--color-border));
  box-shadow:
    0 0 8px color-mix(in oklch, var(--color-sage-400) 35%, transparent),
    inset 0 0 6px color-mix(in oklch, var(--color-sage-400) 15%, transparent);
}
.aga-toggle--on::before {
  content: '';
  position: absolute;
  top: 0;
  left: 15%;
  right: 15%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
  border-radius: 1px;
  pointer-events: none;
}
.aga-toggle--disabled { opacity: 0.4; cursor: not-allowed; }
.aga-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

.aga-toggle__thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--color-text-bone);
  transition: transform var(--duration-normal) var(--ease-out);
}

.aga-toggle--on .aga-toggle__thumb {
  transform: translateX(16px);
}

/* Labeled mode — pill + clickable text row. */
.aga-toggle-labeled {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
}
.aga-toggle-labeled__text {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
}
.aga-toggle-labeled--disabled .aga-toggle-labeled__text {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
