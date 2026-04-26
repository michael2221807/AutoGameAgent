<script setup lang="ts">
/**
 * AgaSelect — custom dropdown select with keyboard navigation.
 *
 * Generic over option type via `options` + `optionLabel` + `optionValue`.
 * Supports: keyboard nav (↑↓ + Enter + Escape), click-outside close, ARIA.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

const props = defineProps<{
  modelValue: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const isOpen = ref(false);
const highlightIdx = ref(-1);
const triggerRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue);
  return opt?.label ?? props.placeholder ?? '选择...';
});

function toggle() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    highlightIdx.value = props.options.findIndex((o) => o.value === props.modelValue);
  }
}

function close() { isOpen.value = false; }

function select(opt: SelectOption) {
  if (opt.disabled) return;
  emit('update:modelValue', opt.value);
  close();
  triggerRef.value?.focus();
}

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
    return;
  }

  if (e.key === 'Escape') { e.preventDefault(); close(); triggerRef.value?.focus(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); highlightIdx.value = Math.min(highlightIdx.value + 1, props.options.length - 1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); highlightIdx.value = Math.max(highlightIdx.value - 1, 0); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const opt = props.options[highlightIdx.value];
    if (opt && !opt.disabled) select(opt);
  }
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (!triggerRef.value?.contains(target) && !listRef.value?.contains(target)) {
    close();
  }
}

onMounted(() => document.addEventListener('click', onClickOutside, true));
onUnmounted(() => document.removeEventListener('click', onClickOutside, true));
</script>

<template>
  <div class="aga-select" :class="{ 'aga-select--disabled': disabled, 'aga-select--open': isOpen }">
    <button
      ref="triggerRef"
      class="aga-select__trigger"
      :disabled="disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="aga-select__label">{{ selectedLabel }}</span>
      <span class="aga-select__arrow">▾</span>
    </button>
    <Transition name="aga-dropdown">
      <ul v-if="isOpen" ref="listRef" class="aga-select__list" role="listbox" @keydown="onKeydown">
        <li
          v-for="(opt, i) in options"
          :key="opt.value"
          class="aga-select__option"
          :class="{
            'aga-select__option--selected': opt.value === modelValue,
            'aga-select__option--highlight': i === highlightIdx,
            'aga-select__option--disabled': opt.disabled,
          }"
          role="option"
          :aria-selected="opt.value === modelValue"
          @click="select(opt)"
          @mouseenter="highlightIdx = i"
        >
          {{ opt.label }}
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Trigger open/hover border: primary → sage-mix + sage 3px ring on open
   - Dropdown list: solid elevated bg → frosted cabin-glass (92% alpha + blur)
   - Selected option gains a ✓ prefix + sage color (was plain primary color)
   - Highlight: primary-muted → sage-muted for consistency */

.aga-select { position: relative; display: inline-block; min-width: 140px; }
.aga-select--disabled { opacity: 0.4; pointer-events: none; }

.aga-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-family: var(--font-sans);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.aga-select--open .aga-select__trigger,
.aga-select__trigger:hover {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
}
.aga-select--open .aga-select__trigger {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 10%, transparent);
}

.aga-select__arrow {
  font-size: 0.7em;
  color: var(--color-text-muted);
  transition: transform var(--duration-normal) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.aga-select--open .aga-select__arrow {
  transform: rotate(180deg);
  color: var(--color-sage-300);
}

.aga-select__list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow);
  max-height: 240px;
  overflow-y: auto;
  z-index: var(--z-dropdown);
  list-style: none;
  padding: var(--space-2xs) 0;
  margin: 0;
}

.aga-select__option {
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.aga-select__option--highlight {
  background: var(--color-sage-muted);
  color: var(--color-sage-100);
}
.aga-select__option--selected {
  color: var(--color-sage-300);
  font-weight: 500;
}
.aga-select__option--selected::before {
  content: '✓';
  margin-right: 6px;
  color: var(--color-sage-400);
}
.aga-select__option--disabled { opacity: 0.4; pointer-events: none; }

/* Dropdown transition */
.aga-dropdown-enter-active { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
.aga-dropdown-leave-active { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
.aga-dropdown-enter-from,
.aga-dropdown-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
