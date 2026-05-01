<script setup lang="ts">
/**
 * RegenerateSameModal — "同提示词重新生成" dialog.
 *
 * Shown when the user clicks "生成同款" on a queue task, gallery card, scene
 * history card, or player archive card. Displays the captured positive +
 * negative prompts (read-only) alongside a backend selector so the user can
 * regenerate with the same prompts on a DIFFERENT backend (cross-model).
 *
 * Emits `confirm` with the chosen backend; caller owns calling
 * `ImageService.regenerateFromPrompts` with its own subject-specific params.
 */
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { ImageBackendType } from '@/engine/image/types';
import AgaSelect, { type SelectOption } from '@/ui/components/shared/AgaSelect.vue';

const props = defineProps<{
  /** Short subject label: NPC name, '场景', '主角', etc. */
  subjectLabel: string;
  /** Secondary label row: composition + size + original backend */
  subtitle?: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  /** Original backend — pre-selected in the selector. */
  initialBackend: ImageBackendType;
  /** Disable confirm while request is in flight. */
  busy?: boolean;
  /** Available backend options (filtered by configured APIs). Falls back to all if empty. */
  availableBackends?: SelectOption[];
}>();

const emit = defineEmits<{
  (e: 'confirm', payload: { backend: ImageBackendType }): void;
  (e: 'cancel'): void;
}>();

const chosenBackend = ref<ImageBackendType>(props.initialBackend);

watch(() => props.availableBackends, (opts) => {
  if (opts?.length && !opts.some((o) => o.value === chosenBackend.value)) {
    chosenBackend.value = (opts[0].value || props.initialBackend) as ImageBackendType;
  }
}, { immediate: true });

const ALL_BACKENDS: SelectOption[] = [
  { label: 'NovelAI', value: 'novelai' },
  { label: 'OpenAI DALL-E', value: 'openai' },
  { label: 'SD-WebUI', value: 'sd_webui' },
  { label: 'ComfyUI', value: 'comfyui' },
  { label: 'Civitai', value: 'civitai' },
];
const backendOptions = computed(() =>
  props.availableBackends?.length ? props.availableBackends : ALL_BACKENDS,
);

const dialogRef = ref<HTMLElement | null>(null);

function confirm() {
  if (props.busy) return;
  emit('confirm', { backend: chosenBackend.value });
}
function cancel() {
  if (props.busy) return;
  emit('cancel');
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel();
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  const firstBtn = dialogRef.value?.querySelector<HTMLButtonElement>('button');
  firstBtn?.focus();
});
onUnmounted(() => { document.removeEventListener('keydown', onKeydown); });
</script>

<template>
  <Teleport to="body">
    <div class="regen-overlay" @click.self="cancel">
      <div ref="dialogRef" class="regen-dialog" role="dialog" aria-label="同提示词重新生成">
        <header class="regen-header">
          <div class="regen-title-col">
            <h3 class="regen-title">生成同款</h3>
            <div class="regen-subject">
              <span class="regen-subject-main">{{ subjectLabel }}</span>
              <span v-if="subtitle" class="regen-subject-sub">{{ subtitle }}</span>
            </div>
          </div>
          <button type="button" class="regen-close" aria-label="关闭" @click="cancel">×</button>
        </header>

        <section class="regen-body">
          <div class="regen-field-row">
            <label class="regen-label">生成后端</label>
            <AgaSelect v-model="chosenBackend" :options="backendOptions" />
            <p class="regen-hint">可跨模型切换；相同提示词会被直接交给选中的后端。</p>
          </div>

          <div class="regen-meta">
            <span class="regen-meta-chip">尺寸 {{ width }} × {{ height }}</span>
            <span class="regen-meta-chip">原后端 {{ initialBackend }}</span>
          </div>

          <div class="regen-prompt-block">
            <div class="regen-prompt-label">正向提示词</div>
            <pre class="regen-prompt-text">{{ positivePrompt || '（空）' }}</pre>
          </div>
          <div v-if="negativePrompt" class="regen-prompt-block">
            <div class="regen-prompt-label">负面提示词</div>
            <pre class="regen-prompt-text regen-prompt-text--neg">{{ negativePrompt }}</pre>
          </div>
        </section>

        <footer class="regen-footer">
          <button type="button" class="regen-btn regen-btn--ghost" :disabled="busy" @click="cancel">取消</button>
          <button type="button" class="regen-btn regen-btn--primary" :disabled="busy || !positivePrompt" @click="confirm">
            {{ busy ? '生成中…' : '开始生成' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.regen-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  padding: var(--space-md);
}

.regen-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: min(560px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.regen-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-xl) var(--space-md) var(--space-xl);
  border-bottom: 1px solid var(--color-border);
}
.regen-title-col { display: flex; flex-direction: column; gap: var(--space-2xs); min-width: 0; }
.regen-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}
.regen-subject { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: baseline; }
.regen-subject-main { font-size: var(--font-size-md); color: var(--color-text); font-weight: 500; }
.regen-subject-sub { font-size: var(--font-size-sm); color: var(--color-text-secondary); }

.regen-close {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 1.6em;
  line-height: 1;
  padding: 0 var(--space-2xs);
  transition: color var(--duration-fast);
}
.regen-close:hover { color: var(--color-text); }

.regen-body {
  padding: var(--space-lg) var(--space-xl);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.regen-field-row { display: flex; flex-direction: column; gap: var(--space-2xs); }
.regen-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); font-weight: 500; }
.regen-hint { font-size: var(--font-size-xs); color: var(--color-text-muted); margin: 0; }

.regen-meta { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.regen-meta-chip {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-xs);
}

.regen-prompt-block { display: flex; flex-direction: column; gap: var(--space-2xs); }
.regen-prompt-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); font-weight: 500; }
.regen-prompt-text {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
.regen-prompt-text--neg { color: var(--color-text-secondary); }

.regen-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-xl) var(--space-lg) var(--space-xl);
  border-top: 1px solid var(--color-border);
}
.regen-btn {
  padding: var(--space-xs) var(--space-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-family: var(--font-sans);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color var(--duration-fast), border-color var(--duration-fast);
}
.regen-btn:disabled { cursor: not-allowed; opacity: 0.6; }
.regen-btn--ghost {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}
.regen-btn--ghost:hover:not(:disabled) { border-color: var(--color-text-muted); }
.regen-btn--primary { background: color-mix(in oklch, var(--color-sage-400) 18%, transparent); color: var(--color-sage-100); border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent); }
.regen-btn--primary:hover:not(:disabled) { background: var(--color-primary-hover); }
</style>
