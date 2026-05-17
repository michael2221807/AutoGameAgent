<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

const ACTION_OPTIONS_COLLAPSED_KEY = 'aga_action_options_collapsed';

const props = withDefaults(defineProps<{
  actionOptions?: string[];
  isGenerating: boolean;
  canRollback: boolean;
}>(), {
  actionOptions: () => [],
});

const emit = defineEmits<{
  (e: 'send', text: string): void;
  (e: 'copy-option', text: string): void;
  (e: 'cancel-generation'): void;
  (e: 'request-rollback'): void;
}>();

const userInput = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const actionOptionsCollapsed = ref<boolean>(
  localStorage.getItem(ACTION_OPTIONS_COLLAPSED_KEY) === '1',
);

const canSend = computed(() => userInput.value.trim().length > 0 && !props.isGenerating);

function toggleActionOptionsCollapsed(): void {
  actionOptionsCollapsed.value = !actionOptionsCollapsed.value;
  localStorage.setItem(ACTION_OPTIONS_COLLAPSED_KEY, actionOptionsCollapsed.value ? '1' : '0');
}

function autoResizeTextarea(): void {
  const el = textareaRef.value;
  if (!el) return;

  el.style.height = 'auto';
  const maxHeight = 120;
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}

function resetTextareaHeight(): void {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
}

function sendMessage(): void {
  const text = userInput.value.trim();
  if (!text || props.isGenerating) return;

  userInput.value = '';
  resetTextareaHeight();
  emit('send', text);
}

function selectAction(option: string): void {
  if (props.isGenerating) return;
  userInput.value = option;
  nextTick(() => {
    textareaRef.value?.focus();
    autoResizeTextarea();
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function restoreInput(text: string): void {
  userInput.value = text;
  nextTick(() => autoResizeTextarea());
}

onBeforeUnmount(() => {
  resetTextareaHeight();
});

defineExpose({
  restoreInput,
});
</script>

<template>
  <div
    v-if="props.actionOptions.length > 0 && !props.isGenerating"
    :class="['action-options', { 'action-options--collapsed': actionOptionsCollapsed }]"
  >
    <button
      class="action-options__toggle"
      :aria-expanded="!actionOptionsCollapsed"
      :aria-label="actionOptionsCollapsed ? $t('mainGame.composer.expandActions') : $t('mainGame.composer.collapseActions')"
      :title="actionOptionsCollapsed ? $t('mainGame.composer.expandActions') : $t('mainGame.composer.collapseActions')"
      @click="toggleActionOptionsCollapsed"
    >
      <span class="action-options__hint">
        {{ actionOptionsCollapsed ? $t('mainGame.composer.actionCountHint', { n: props.actionOptions.length }) : $t('mainGame.composer.actionLabel') }}
      </span>
      <svg
        class="action-options__chevron"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <div class="action-options__list" aria-hidden="false">
      <div
        v-for="(option, idx) in props.actionOptions"
        :key="idx"
        class="action-option-row"
      >
        <button
          class="action-copy"
          :title="$t('mainGame.composer.copyText')"
          @click.stop="emit('copy-option', option)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>
        </button>
        <button
          :class="['action-btn', { 'action-btn--selected': userInput === option }]"
          @click="selectAction(option)"
        >
          {{ option }}
        </button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <button
      v-if="props.isGenerating"
      class="cancel-btn"
      @click="emit('cancel-generation')"
      :aria-label="$t('mainGame.composer.cancelAriaLabel')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
      {{ $t('mainGame.composer.cancelLabel') }}
    </button>

    <div class="input-row">
      <button
        class="rollback-btn"
        :disabled="!props.canRollback"
        :title="props.canRollback ? $t('mainGame.composer.rollbackTitle') : $t('mainGame.composer.rollbackUnavailable')"
        :aria-label="$t('mainGame.composer.rollbackAriaLabel')"
        @click="emit('request-rollback')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      <textarea
        ref="textareaRef"
        v-model="userInput"
        class="message-input"
        :placeholder="$t('mainGame.composer.inputPlaceholder')"
        rows="1"
        :disabled="props.isGenerating"
        @keydown="onKeydown"
        @input="autoResizeTextarea"
      />
      <button
        class="send-btn"
        :disabled="!canSend"
        @click="sendMessage"
        :aria-label="$t('mainGame.composer.sendAriaLabel')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Desktop/shared base: extracted intact from MainGamePanel so typing only
   updates this composer subtree, not the full narrative history. */
.action-options {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--color-border-subtle);
  background: var(--color-surface);
  flex-shrink: 0;
}

.action-options__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 6px var(--sidebar-right-reserve, 40px) 6px var(--sidebar-left-reserve, 40px);
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  cursor: pointer;
  opacity: 0.7;
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet),
              opacity var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.action-options__toggle:hover {
  opacity: 1;
  color: var(--color-sage-300);
}
.action-options--collapsed .action-options__toggle {
  padding-top: 10px;
  padding-bottom: 10px;
  opacity: 0.9;
}
.action-options__hint {
  font-variant-numeric: tabular-nums;
}
.action-options__chevron {
  flex-shrink: 0;
  transition: transform var(--duration-normal) var(--ease-out);
}
.action-options--collapsed .action-options__chevron {
  transform: rotate(-180deg);
}

.action-options__list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.25rem var(--sidebar-right-reserve, 40px) 0.65rem var(--sidebar-left-reserve, 40px);
  max-height: 60vh;
  opacity: 1;
  overflow: hidden;
  transition: max-height var(--duration-normal) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out),
              padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}
.action-options--collapsed .action-options__list {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  pointer-events: none;
}

.action-option-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.action-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin-top: 3px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0.4;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}
.action-option-row:hover .action-copy { opacity: 0.85; }
.action-copy:hover {
  opacity: 1;
  color: var(--color-sage-300);
  border-color: color-mix(in oklch, var(--color-sage-400) 25%, transparent);
  background: var(--color-sage-muted);
}

.action-btn {
  padding: 0.42rem 0.85rem;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-family: var(--font-serif-cjk);
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
  white-space: normal;
  word-break: break-word;
  text-align: left;
  max-width: 100%;
  letter-spacing: 0.02em;
}

.action-btn:hover {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: linear-gradient(180deg,
    color-mix(in oklch, var(--color-sage-400) 10%, var(--color-surface-elevated)),
    color-mix(in oklch, var(--color-sage-400) 5%, var(--color-surface-elevated)));
  color: var(--color-sage-100);
  box-shadow: 0 0 14px color-mix(in oklch, var(--color-sage-400) 18%, transparent);
  transform: translateY(-1px);
}
.action-btn--selected {
  border-color: color-mix(in oklch, var(--color-sage-400) 55%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 14%, var(--color-surface-elevated));
  color: var(--color-sage-100);
  font-weight: 500;
}

.input-area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem var(--sidebar-right-reserve, 40px) 0.75rem var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
  border-top: 1px solid var(--color-border-subtle);
  background: var(--color-surface);
  flex-shrink: 0;
}

.cancel-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  align-self: center;
  padding: 0.3rem 0.85rem;
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 40%, transparent);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.cancel-btn:hover {
  background: color-mix(in oklch, var(--color-danger) 18%, transparent);
  border-color: color-mix(in oklch, var(--color-danger) 60%, transparent);
  box-shadow: inset 0 0 12px color-mix(in oklch, var(--color-danger) 12%, transparent);
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.message-input {
  flex: 1;
  box-sizing: border-box;
  padding: 0.55rem 0.85rem;
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  font-family: var(--font-serif-cjk);
  font-size: 0.92rem;
  line-height: 1.6;
  letter-spacing: 0.01em;
  resize: none;
  outline: none;
  min-height: 42px;
  max-height: 120px;
  overflow-y: auto;
  transition: border-color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.message-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-style: italic;
}

.message-input:focus {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 3%, var(--color-surface-input));
  box-shadow:
    0 0 0 3px color-mix(in oklch, var(--color-sage-400) 12%, transparent),
    0 0 16px color-mix(in oklch, var(--color-sage-400) 8%, transparent),
    inset 0 0 12px color-mix(in oklch, var(--color-sage-400) 4%, transparent);
}

.message-input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  background: transparent;
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  border-radius: var(--radius-lg);
  color: var(--color-sage-300);
  cursor: pointer;
  flex-shrink: 0;
  transition: color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}

.send-btn:hover:not(:disabled) {
  color: var(--color-sage-100);
  background: linear-gradient(135deg,
    color-mix(in oklch, var(--color-sage-400) 18%, transparent),
    color-mix(in oklch, var(--color-sage-400) 10%, transparent));
  border-color: var(--color-sage-400);
  box-shadow:
    0 0 16px color-mix(in oklch, var(--color-sage-400) 30%, transparent),
    0 0 6px color-mix(in oklch, var(--color-sage-400) 15%, transparent),
    var(--lumi-inset-highlight);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.rollback-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 42px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out);
}

.rollback-btn:hover:not(:disabled) {
  color: var(--color-amber-400);
  border-color: color-mix(in oklch, var(--color-amber-400) 45%, transparent);
  background: linear-gradient(135deg,
    color-mix(in oklch, var(--color-amber-400) 10%, transparent),
    color-mix(in oklch, var(--color-amber-400) 5%, transparent));
  box-shadow: 0 0 12px color-mix(in oklch, var(--color-amber-400) 18%, transparent);
}

.rollback-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Mobile baseline: touch targets and safe-area spacing. */
@media (max-width: 767px) {
  .action-options__toggle {
    padding-left: var(--space-md);
    padding-right: var(--space-md);
  }
  .action-options__list {
    padding-left: var(--space-md);
    padding-right: var(--space-md);
  }
  .input-area {
    padding-left: var(--space-sm);
    padding-right: var(--space-sm);
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
  }
  .action-btn {
    min-height: 44px;
  }
}

/* Small phone refinements: tighter side padding, same controls. */
@media (max-width: 640px) {
  .input-area {
    padding: 0.5rem 0.75rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
  }
  .action-options__toggle,
  .action-options__list {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
}
</style>
