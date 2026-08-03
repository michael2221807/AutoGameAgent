<script setup lang="ts">
// App doc: docs/user-guide/pages/game-main.md §3.14 (语音输入 · STT)
/**
 * AddLexiconTermButton — 主面板「+词」小键:把专有名词快速加进**本存档**自定义词典。
 *
 * 自包含、自门控(mirror MicInputButton):仅当 已配 STT API + 已载入存档 时显示。点开一个
 * 极简内联输入(词 + 加入),加进后端热词偏置用的自定义词典(per-save)。设置区可完整编辑。
 *
 * 词典 CRUD 走 useSttLexicon;词条合法性(2-10 汉字)由引擎 normalizeLexiconTerms 兜底。
 */
import { ref, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import Tooltip from '@/ui/components/shared/Tooltip.vue';
import { eventBus } from '@/engine/core/event-bus';
import { useAPIManagementStore } from '@/engine/stores/engine-api';
import { useSttLexicon } from '@/ui/composables/useSttLexicon';
import { isValidLexiconTerm } from '@/engine/stt/lexicon';
import { MAX_LEXICON_TERMS } from '@/engine/stt/types';

const { t } = useI18n();
const apiStore = useAPIManagementStore();
const lexicon = useSttLexicon();

const sttConfigured = computed(() =>
  apiStore.apiConfigs.some((c) => c.enabled && (c.apiCategory ?? 'llm') === 'stt'));
const visible = computed(() => sttConfigured.value && lexicon.hasSave.value);

const open = ref(false);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

function toggle(): void {
  open.value = !open.value;
  if (open.value) nextTick(() => inputRef.value?.focus());
}
function toast(type: 'success' | 'warning', key: string, params?: Record<string, unknown>): void {
  eventBus.emit('ui:toast', { type, i18nKey: key, message: t(key, params ?? {}), duration: 2200 });
}
function submit(): void {
  const word = draft.value.trim();
  if (!word) return;
  // 区分三种「未加入」原因,给准确提示(reviewer Finding 2)。
  if (!isValidLexiconTerm(word)) { toast('warning', 'stt.lexicon.invalid'); return; }
  if (lexicon.customTerms.value.includes(word)) { toast('warning', 'stt.lexicon.duplicate'); draft.value = ''; return; }
  if (lexicon.customTerms.value.length >= MAX_LEXICON_TERMS) { toast('warning', 'stt.lexicon.full', { max: MAX_LEXICON_TERMS }); return; }
  lexicon.addTerm(word);
  toast('success', 'stt.lexicon.added', { word });
  draft.value = '';
  open.value = false;
}
function close(): void { open.value = false; draft.value = ''; }
</script>

<template>
  <div v-if="visible" class="add-lex">
    <Tooltip :text="$t('stt.lexicon.addTooltip')" interactive>
      <button
        class="add-lex__btn"
        :class="{ 'add-lex__btn--open': open }"
        :aria-label="$t('stt.lexicon.addTooltip')"
        :aria-expanded="open"
        @click="toggle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          <line x1="4" y1="8" x2="10" y2="8" /><line x1="7" y1="5" x2="7" y2="11" />
        </svg>
      </button>
    </Tooltip>

    <Transition name="lex-pop">
      <div v-if="open" class="add-lex__pop" role="dialog" :aria-label="$t('stt.lexicon.addTooltip')">
        <input
          ref="inputRef"
          v-model="draft"
          class="add-lex__input"
          type="text"
          :placeholder="$t('stt.lexicon.addPlaceholder')"
          maxlength="10"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="close"
        />
        <button class="add-lex__confirm" :disabled="!draft.trim()" @click="submit">{{ $t('stt.lexicon.addConfirm') }}</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.add-lex { position: relative; display: inline-flex; }
.add-lex__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 42px; flex-shrink: 0;
  background: transparent; border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  color: var(--color-text-secondary); cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out);
}
.add-lex__btn:hover, .add-lex__btn--open {
  color: var(--color-sage-100);
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: var(--color-sage-muted);
}
/* 内联输入浮层:贴在按钮上方,glass chip 级 */
.add-lex__pop {
  position: absolute; bottom: calc(100% + 8px); right: 0; z-index: var(--z-tooltip, 1000);
  display: flex; align-items: center; gap: 6px; padding: 6px;
  background: color-mix(in oklch, var(--color-surface-elevated) 88%, transparent);
  backdrop-filter: blur(12px) saturate(1.3);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 35%, transparent);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}
.add-lex__input {
  width: 150px; padding: 6px 9px;
  background: var(--color-surface-input); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); color: var(--color-text);
  font-family: var(--font-serif-cjk); font-size: 0.85rem; outline: none;
}
.add-lex__input:focus { border-color: var(--color-sage-400); box-shadow: 0 0 0 3px var(--color-primary-muted); }
.add-lex__confirm {
  padding: 6px 12px; flex-shrink: 0;
  background: var(--color-sage-400); border: none; border-radius: var(--radius-sm);
  color: oklch(0.16 0.01 95); font-size: 0.82rem; font-weight: 600; cursor: pointer;
  transition: filter var(--duration-fast) var(--ease-out);
}
.add-lex__confirm:hover:not(:disabled) { filter: brightness(1.08); }
.add-lex__confirm:disabled { opacity: 0.4; cursor: not-allowed; }

.lex-pop-enter-active, .lex-pop-leave-active { transition: opacity 0.16s var(--ease-out), transform 0.16s var(--ease-out); }
.lex-pop-enter-from, .lex-pop-leave-to { opacity: 0; transform: translateY(4px); }
@media (prefers-reduced-motion: reduce) {
  .lex-pop-enter-active, .lex-pop-leave-active { transition: none; }
}
</style>
