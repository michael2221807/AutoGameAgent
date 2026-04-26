<script setup lang="ts">
/**
 * AgaToggle — pill switch toggle.
 *
 * v-model binding for boolean state. Accessible: role="switch" + aria-checked.
 */
const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    class="aga-toggle"
    :class="{ 'aga-toggle--on': modelValue, 'aga-toggle--disabled': disabled }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
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
  box-shadow: 0 0 8px color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}
.aga-toggle--disabled { opacity: 0.4; cursor: not-allowed; }

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
</style>
