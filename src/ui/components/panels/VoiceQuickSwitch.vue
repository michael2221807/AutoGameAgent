<script setup lang="ts">
/**
 * VoiceQuickSwitch — status-bar 配音快速切换器 (2026-07-20).
 *
 * App doc: docs/user-guide/pages/game-main.md §3.13 配音（+ §3.1 状态栏右簇）
 *
 * chip 显示「当前音色 · 方言」；点开 popover 就地切音色/方言、开关自动配音、试听。
 * 与设置面板「配音」区共享同一份 aga_tts_settings；改动即存 + 推给活服务，并经
 * 'tts:state' 广播让两处保持同步。照搬 FestivalChip 的 chip→popover 交互模式。
 *
 * 设计文档：docs/design/tts-system-design.md §6.3
 */
import { ref, computed, inject, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import Tooltip from '@/ui/components/shared/Tooltip.vue';
import { eventBus } from '@/engine/core/event-bus';
import { loadTtsSettings, saveTtsSettings } from '@/engine/tts/tts-settings';
import { TTS_RATE_MIN, TTS_RATE_MAX } from '@/engine/tts/types';
import type { TtsSettings, TtsVoiceFavorite, TtsCacheEvent } from '@/engine/tts/types';
import type { TtsService } from '@/engine/tts/tts-service';

defineProps<{ speaking?: boolean }>();

const { t } = useI18n();
const ttsService = inject<TtsService | undefined>('ttsService', undefined);

const settings = ref<TtsSettings>(ttsService?.getSettings() ?? loadTtsSettings());
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// 本回合全配音是否已缓存、可下载(仅假流式/整段模式;经 'tts:cache' 反应式同步)。
const cacheAvailable = ref<boolean>(ttsService?.hasRoundAudio() ?? false);
const downloading = ref(false);

async function downloadRoundAudio(): Promise<void> {
  if (!ttsService || downloading.value) return;
  downloading.value = true;
  try {
    const dl = await ttsService.buildRoundAudioDownload();
    if (!dl) return;
    const url = URL.createObjectURL(dl.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dl.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    eventBus.emit('ui:toast', { type: 'error', message: t('mainGame.voice.downloadErr'), duration: 3000 });
  } finally {
    downloading.value = false;
  }
}

const chipLabel = computed(() => {
  const s = settings.value;
  if (!s.defaultSpeaker) return t('mainGame.voice.noVoice');
  return s.defaultInstruct ? `${s.defaultSpeaker} · ${s.defaultInstruct}` : s.defaultSpeaker;
});

function commit(): void {
  saveTtsSettings(settings.value);
  ttsService?.setSettings({ ...settings.value });
}

function setAutoNarrate(v: boolean): void { settings.value.autoNarrateOnRound = v; commit(); }
function setSpeaker(v: string): void { settings.value.defaultSpeaker = v; commit(); }
function setInstruct(v: string): void { settings.value.defaultInstruct = v; commit(); }
function setVolume(v: number): void { settings.value.volume = v; commit(); }
function setRate(v: number): void { settings.value.rate = v; commit(); }

function applyFavorite(f: TtsVoiceFavorite): void {
  settings.value.defaultSpeaker = f.speaker;
  settings.value.defaultInstruct = f.instruct;
  commit();
}
function isActiveFavorite(f: TtsVoiceFavorite): boolean {
  return f.speaker === settings.value.defaultSpeaker && f.instruct === (settings.value.defaultInstruct ?? '');
}
function favoriteLabel(f: TtsVoiceFavorite): string {
  return f.instruct ? `${f.speaker} · ${f.instruct}` : f.speaker;
}

function preview(): void {
  void ttsService?.speak(t('mainGame.voice.previewText'), 'voice-preview');
}

function toggleOpen(): void { open.value = !open.value; }
function close(): void { open.value = false; }

// Click-outside: close when a click lands outside this component. The listener is
// attached ONLY while the popover is open, and registration is deferred one tick
// so the very click that opened the popover can't immediately close it.
function onDocClick(e: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close();
}
let deferHandle: ReturnType<typeof setTimeout> | null = null;
watch(open, (isOpen) => {
  if (deferHandle) { clearTimeout(deferHandle); deferHandle = null; }
  if (isOpen) {
    deferHandle = setTimeout(() => { document.addEventListener('click', onDocClick); deferHandle = null; }, 0);
  } else {
    document.removeEventListener('click', onDocClick);
  }
});

// Re-sync when settings change anywhere (settings panel, another quick switch).
let unsub: (() => void) | null = null;
let unsubCache: (() => void) | null = null;
onMounted(() => {
  unsub = eventBus.on('tts:state', () => {
    settings.value = ttsService?.getSettings() ?? loadTtsSettings();
  });
  // Round-audio cache availability → show/hide the download button reactively.
  unsubCache = eventBus.on('tts:cache', (p) => {
    cacheAvailable.value = (p as TtsCacheEvent | undefined)?.available ?? false;
  });
});
onBeforeUnmount(() => {
  unsub?.();
  unsubCache?.();
  // Clear a pending deferred-register so it can't add a listener post-unmount.
  if (deferHandle) { clearTimeout(deferHandle); deferHandle = null; }
  document.removeEventListener('click', onDocClick);
});
</script>

<template>
  <div ref="rootRef" class="voice-quick" @click.stop>
    <Tooltip :text="$t('mainGame.voice.chipTitle')" interactive>
      <button
        type="button"
        class="voice-chip"
        :class="{ 'voice-chip--speaking': speaking, 'voice-chip--open': open }"
        data-testid="voice-quick-chip"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @click="toggleOpen"
      >
        <span class="voice-chip__dot" :class="{ 'voice-chip__dot--on': speaking }" />
        <span class="voice-chip__label">{{ chipLabel }}</span>
      </button>
    </Tooltip>

    <Transition name="voice-pop">
      <div v-if="open" class="voice-popover glass-edge" @click.stop>
        <div class="voice-popover__title">{{ $t('mainGame.voice.title') }}</div>

        <div class="voice-row">
          <span class="voice-row__label">{{ $t('mainGame.voice.autoNarrate') }}</span>
          <AgaToggle :model-value="settings.autoNarrateOnRound" @update:model-value="setAutoNarrate" />
        </div>

        <template v-if="settings.favorites.length > 0">
          <div class="voice-row__label voice-row__label--section">{{ $t('mainGame.voice.favorites') }}</div>
          <div class="voice-fav-list">
            <button
              v-for="(f, idx) in settings.favorites"
              :key="idx"
              type="button"
              class="voice-fav"
              :class="{ 'voice-fav--active': isActiveFavorite(f) }"
              @click="applyFavorite(f)"
            >{{ favoriteLabel(f) }}</button>
          </div>
        </template>

        <div class="voice-row voice-row--stack">
          <span class="voice-row__label">{{ $t('mainGame.voice.speaker') }}</span>
          <input
            type="text"
            class="voice-input"
            :value="settings.defaultSpeaker"
            :placeholder="$t('mainGame.voice.speakerPlaceholder')"
            @change="setSpeaker(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="voice-row voice-row--stack">
          <span class="voice-row__label">{{ $t('mainGame.voice.instruct') }}</span>
          <input
            type="text"
            class="voice-input"
            :value="settings.defaultInstruct"
            :placeholder="$t('mainGame.voice.instructPlaceholder')"
            @change="setInstruct(($event.target as HTMLInputElement).value)"
          />
        </div>

        <div class="voice-row">
          <span class="voice-row__label">{{ $t('mainGame.voice.volume') }}</span>
          <div class="voice-slider">
            <input
              type="range" min="0" max="1" step="0.05"
              :value="settings.volume"
              :aria-label="$t('mainGame.voice.volume')"
              @input="setVolume(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="voice-slider__val">{{ Math.round(settings.volume * 100) }}%</span>
          </div>
        </div>
        <div class="voice-row">
          <span class="voice-row__label">{{ $t('mainGame.voice.rate') }}</span>
          <div class="voice-slider">
            <input
              type="range" :min="TTS_RATE_MIN" :max="TTS_RATE_MAX" step="0.1"
              :value="settings.rate"
              :aria-label="$t('mainGame.voice.rate')"
              @input="setRate(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="voice-slider__val">{{ settings.rate.toFixed(1) }}×</span>
          </div>
        </div>

        <button type="button" class="voice-preview-btn" :disabled="!settings.defaultSpeaker" @click="preview">
          {{ $t('mainGame.voice.preview') }}
        </button>

        <!-- 下载本回合全配音 — 仅当本回合音频已缓存(假流式/整段模式)时显示 -->
        <button
          v-if="cacheAvailable"
          type="button"
          class="voice-download-btn"
          data-testid="voice-download-btn"
          :disabled="downloading"
          @click="downloadRoundAudio"
        >
          {{ downloading ? $t('mainGame.voice.downloading') : $t('mainGame.voice.download') }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.voice-quick { position: relative; display: inline-flex; }

.voice-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  max-width: 180px;
  padding: 4px 10px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.voice-chip:hover { background: rgba(255, 255, 255, 0.08); color: var(--color-text); }
.voice-chip--open { background: rgba(255, 255, 255, 0.08); color: var(--color-text); }
.voice-chip__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--color-sage-600);
  flex-shrink: 0;
}
.voice-chip__dot--on {
  background: var(--color-sage-400);
  box-shadow: 0 0 6px var(--color-sage-400);
  animation: voice-blink 1.4s ease-in-out infinite;
}
.voice-chip--speaking { color: var(--color-sage-300); }
.voice-chip__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes voice-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .voice-chip__dot--on { animation: none; } }

.voice-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  z-index: var(--z-dropdown);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-shadow);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
}
.voice-popover__title {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  margin-bottom: var(--space-sm);
  font-weight: 600;
}
.voice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
}
.voice-row--stack { flex-direction: column; align-items: stretch; gap: 4px; }
.voice-row__label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.voice-row__label--section {
  margin-top: var(--space-xs);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.voice-input {
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  padding: 6px 10px;
  font-family: inherit;
  font-size: var(--font-size-sm);
}
.voice-input:focus {
  outline: none;
  border-color: var(--color-sage-500);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}
.voice-slider {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}
.voice-slider input[type=range] {
  accent-color: var(--color-sage-400);
  width: 120px;
}
.voice-slider__val {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--color-amber-300);
  min-width: 40px;
  text-align: right;
}
.voice-fav-list { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-bottom: var(--space-xs); }
.voice-fav {
  border: none;
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.voice-fav:hover { background: rgba(255, 255, 255, 0.08); color: var(--color-text); }
.voice-fav--active { background: var(--color-sage-400); color: oklch(0.16 0.01 95); font-weight: 600; }
.voice-preview-btn {
  width: 100%;
  margin-top: var(--space-sm);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-sage-400);
  color: oklch(0.16 0.01 95);
  padding: 8px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast);
}
.voice-preview-btn:hover:not(:disabled) { background: var(--color-sage-300); }
.voice-preview-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 下载按钮 — 次要动作(轮廓/柔和),不与主试听按钮抢视觉重量 */
.voice-download-btn {
  width: 100%;
  margin-top: var(--space-xs);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 40%, var(--color-border));
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  color: var(--color-amber-300);
  padding: 7px;
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.voice-download-btn:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-amber-400) 16%, transparent);
  color: var(--color-amber-200);
}
.voice-download-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.voice-pop-enter-active, .voice-pop-leave-active { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
.voice-pop-enter-from, .voice-pop-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
