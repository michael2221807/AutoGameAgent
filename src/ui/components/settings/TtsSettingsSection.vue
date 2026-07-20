<script setup lang="ts">
/**
 * 配音（TTS）设置区 — SettingsPanel 的一个可导航子区（id="settings-audio"）。
 *
 * 全局配音偏好落 localStorage `aga_tts_settings`（经 collectLocalStorageSettings
 * 自动进备份/云同步）。改动即存 + 推给活的 TtsService（setSettings），使
 * orchestrator 自动配音 / 主面板播放立刻用上新配置，无需刷新。
 *
 * 设计文档：docs/design/tts-system-design.md §6.2
 * App doc：docs/user-guide/pages/game-main.md §3.13 配音
 */
import { ref, inject, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import AgaButton from '@/ui/components/shared/AgaButton.vue';
import AgaSelect from '@/ui/components/shared/AgaSelect.vue';
import type { SelectOption } from '@/ui/components/shared/AgaSelect.vue';
import { eventBus } from '@/engine/core/event-bus';
import { loadTtsSettings, saveTtsSettings } from '@/engine/tts/tts-settings';
import { TTS_RATE_MIN, TTS_RATE_MAX } from '@/engine/tts/types';
import type { TtsSettings, TtsVoiceFavorite } from '@/engine/tts/types';
import type { TtsService } from '@/engine/tts/tts-service';

const { t } = useI18n();
const ttsService = inject<TtsService | undefined>('ttsService', undefined);

const settings = ref<TtsSettings>(loadTtsSettings());

/** 服务端音色列表（/speakers 拉取；空 = 未拉取或不可用，退回自由输入） */
const remoteSpeakers = ref<string[]>([]);
const loadingSpeakers = ref(false);

const speakerOptions = ref<SelectOption[]>([]);
function rebuildSpeakerOptions(): void {
  const opts: SelectOption[] = remoteSpeakers.value.map((s) => ({ label: s, value: s }));
  // Keep the current custom value selectable even if not in the fetched list.
  if (settings.value.defaultSpeaker && !remoteSpeakers.value.includes(settings.value.defaultSpeaker)) {
    opts.unshift({ label: settings.value.defaultSpeaker, value: settings.value.defaultSpeaker });
  }
  speakerOptions.value = opts;
}

// Re-sync when settings change anywhere (quick-switch chip, backup import via
// TtsService.reloadSettings). Without this the local copy goes stale and a later
// edit here would silently revert changes made elsewhere.
let unsub: (() => void) | null = null;
onMounted(() => {
  rebuildSpeakerOptions();
  unsub = eventBus.on('tts:state', () => {
    settings.value = ttsService?.getSettings() ?? loadTtsSettings();
    rebuildSpeakerOptions();
  });
});
onBeforeUnmount(() => {
  unsub?.();
});

/** 单点持久化 + 推给活服务。任何字段改动后都走这里。 */
function commit(): void {
  saveTtsSettings(settings.value);
  ttsService?.setSettings({ ...settings.value });
}

function setEnabled(v: boolean): void { settings.value.enabled = v; commit(); }
function setAutoNarrate(v: boolean): void { settings.value.autoNarrateOnRound = v; commit(); }
function setMode(mode: 'stream' | 'full'): void { settings.value.transmissionMode = mode; commit(); }
function setRate(v: number): void { settings.value.rate = v; commit(); }
function setVolume(v: number): void { settings.value.volume = v; commit(); }
function setDefaultSpeaker(v: string): void { settings.value.defaultSpeaker = v; rebuildSpeakerOptions(); commit(); }
function setDefaultInstruct(v: string): void { settings.value.defaultInstruct = v; commit(); }

async function fetchSpeakers(): Promise<void> {
  if (!ttsService) return;
  loadingSpeakers.value = true;
  try {
    const list = await ttsService.listSpeakers();
    remoteSpeakers.value = list.map((s) => s.name);
    rebuildSpeakerOptions();
    if (remoteSpeakers.value.length === 0) {
      eventBus.emit('ui:toast', { type: 'warning', message: t('settings.audio.speaker.fetchEmpty'), duration: 2500 });
    } else {
      eventBus.emit('ui:toast', { type: 'success', message: t('settings.audio.speaker.fetchOk', { n: remoteSpeakers.value.length }), duration: 2000 });
    }
  } catch {
    eventBus.emit('ui:toast', { type: 'error', message: t('settings.audio.speaker.fetchErr'), duration: 3000 });
  } finally {
    loadingSpeakers.value = false;
  }
}

// ── 常用音色收藏 ──
function isFavorited(): boolean {
  return settings.value.favorites.some(
    (f) => f.speaker === settings.value.defaultSpeaker && f.instruct === (settings.value.defaultInstruct ?? ''),
  );
}
function addFavorite(): void {
  const speaker = settings.value.defaultSpeaker.trim();
  if (!speaker || isFavorited()) return;
  settings.value.favorites.push({ speaker, instruct: settings.value.defaultInstruct ?? '' });
  commit();
}
function applyFavorite(f: TtsVoiceFavorite): void {
  settings.value.defaultSpeaker = f.speaker;
  settings.value.defaultInstruct = f.instruct;
  rebuildSpeakerOptions();
  commit();
}
function removeFavorite(idx: number): void {
  settings.value.favorites.splice(idx, 1);
  commit();
}

function favoriteLabel(f: TtsVoiceFavorite): string {
  return f.instruct ? `${f.speaker} · ${f.instruct}` : f.speaker;
}
</script>

<template>
  <section id="settings-audio" class="settings-section">
    <h3 class="section-title">{{ $t('settings.audio.sectionTitle') }}</h3>
    <p class="setting-desc" style="margin-bottom: 12px; opacity: 0.7">
      {{ $t('settings.audio.desc') }}
    </p>

    <!-- 总开关 -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{{ $t('settings.audio.enabled.label') }}</span>
        <span class="setting-desc">{{ $t('settings.audio.enabled.desc') }}</span>
      </div>
      <AgaToggle :model-value="settings.enabled" @update:model-value="setEnabled" />
    </div>

    <template v-if="settings.enabled">
      <!-- 自动配音 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.autoNarrate.label') }}</span>
          <span class="setting-desc">{{ $t('settings.audio.autoNarrate.desc') }}</span>
        </div>
        <AgaToggle :model-value="settings.autoNarrateOnRound" @update:model-value="setAutoNarrate" />
      </div>

      <!-- 传输模式 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.mode.label') }}</span>
          <span class="setting-desc">{{ $t('settings.audio.mode.desc') }}</span>
        </div>
        <div class="tts-segment" role="group" :aria-label="$t('settings.audio.mode.label')">
          <button
            type="button"
            class="tts-segment__btn"
            :class="{ 'tts-segment__btn--active': settings.transmissionMode === 'stream' }"
            :aria-pressed="settings.transmissionMode === 'stream'"
            @click="setMode('stream')"
          >{{ $t('settings.audio.mode.stream') }}</button>
          <button
            type="button"
            class="tts-segment__btn"
            :class="{ 'tts-segment__btn--active': settings.transmissionMode === 'full' }"
            :aria-pressed="settings.transmissionMode === 'full'"
            @click="setMode('full')"
          >{{ $t('settings.audio.mode.full') }}</button>
        </div>
      </div>

      <!-- 语速 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.rate.label') }} ({{ settings.rate.toFixed(1) }}×)</span>
          <span class="setting-desc">{{ $t('settings.audio.rate.desc') }}</span>
        </div>
        <input
          type="range" class="form-range" :min="TTS_RATE_MIN" :max="TTS_RATE_MAX" step="0.1"
          :value="settings.rate"
          :aria-label="$t('settings.audio.rate.label')"
          @input="setRate(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <!-- 音量 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.volume.label') }} ({{ Math.round(settings.volume * 100) }}%)</span>
        </div>
        <input
          type="range" class="form-range" min="0" max="1" step="0.05"
          :value="settings.volume"
          :aria-label="$t('settings.audio.volume.label')"
          @input="setVolume(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="setting-subsection-header">{{ $t('settings.audio.subsection.voice') }}</div>

      <!-- 默认音色 speaker -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.speaker.label') }}</span>
          <span class="setting-desc">{{ $t('settings.audio.speaker.desc') }}</span>
        </div>
        <div class="tts-speaker-control">
          <AgaSelect
            v-if="speakerOptions.length > 0"
            :model-value="settings.defaultSpeaker"
            :options="speakerOptions"
            @update:model-value="setDefaultSpeaker"
          />
          <input
            v-else
            type="text"
            class="form-input form-input--sm"
            :value="settings.defaultSpeaker"
            :placeholder="$t('settings.audio.speaker.placeholder')"
            @change="setDefaultSpeaker(($event.target as HTMLInputElement).value)"
          />
          <AgaButton size="sm" variant="secondary" :disabled="loadingSpeakers" @click="fetchSpeakers">
            {{ loadingSpeakers ? $t('settings.audio.speaker.fetching') : $t('settings.audio.speaker.fetch') }}
          </AgaButton>
        </div>
      </div>

      <!-- 允许在拉取到列表后仍手动改 speaker -->
      <div v-if="speakerOptions.length > 0" class="setting-row setting-row--indent">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.speaker.manualLabel') }}</span>
        </div>
        <input
          type="text"
          class="form-input form-input--sm"
          :value="settings.defaultSpeaker"
          :placeholder="$t('settings.audio.speaker.placeholder')"
          @change="setDefaultSpeaker(($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 默认风格/方言 instruct -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.instruct.label') }}</span>
          <span class="setting-desc">{{ $t('settings.audio.instruct.desc') }}</span>
        </div>
        <input
          type="text"
          class="form-input form-input--sm"
          :value="settings.defaultInstruct"
          :placeholder="$t('settings.audio.instruct.placeholder')"
          @change="setDefaultInstruct(($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 常用音色收藏 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('settings.audio.favorites.label') }}</span>
          <span class="setting-desc">{{ $t('settings.audio.favorites.desc') }}</span>
        </div>
        <AgaButton size="sm" variant="secondary" :disabled="!settings.defaultSpeaker.trim() || isFavorited()" @click="addFavorite">
          {{ $t('settings.audio.favorites.add') }}
        </AgaButton>
      </div>
      <div v-if="settings.favorites.length > 0" class="tts-favorites">
        <div v-for="(f, idx) in settings.favorites" :key="idx" class="tts-favorite-chip">
          <button type="button" class="tts-favorite-chip__apply" @click="applyFavorite(f)">{{ favoriteLabel(f) }}</button>
          <button
            type="button"
            class="tts-favorite-chip__remove"
            :aria-label="$t('settings.audio.favorites.remove')"
            @click="removeFavorite(idx)"
          >×</button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* ── Shared settings-section layout (scoped styles don't cascade from
   SettingsPanel to this child component, so re-declare them here to match the
   other sections — same pattern as EngramSettingsSection). ── */
.settings-section {
  flex-shrink: 0;
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  position: relative;
}
.section-title {
  margin: 0 0 14px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  gap: 14px;
}
.setting-row + .setting-row {
  border-top: 1px solid color-mix(in oklch, var(--color-text-umber) 5%, transparent);
}
.setting-row--indent { padding-left: 20px; }
.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.setting-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
}
.setting-desc {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}
.setting-subsection-header {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-top: var(--space-sm);
  margin-top: var(--space-sm);
  border-top: 1px solid var(--color-border-subtle);
}
.form-input {
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border);
  border-radius: 7px;
  color: var(--color-text);
  font-size: 0.84rem;
  font-family: inherit;
  outline: none;
}
.form-input:focus {
  border-color: var(--color-sage-400);
  box-shadow: 0 0 0 3px var(--color-primary-muted);
}
.form-input--sm { width: 180px; flex-shrink: 0; }
.form-range {
  width: 140px;
  accent-color: var(--color-sage-400);
  cursor: pointer;
  flex-shrink: 0;
}

.tts-segment {
  display: inline-flex;
  background: var(--color-surface-input);
  border-radius: var(--radius-md);
  padding: 2px;
  flex-shrink: 0;
}
.tts-segment__btn {
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--duration-fast) var(--ease-out);
}
.tts-segment__btn--active {
  background: var(--color-sage-400);
  color: oklch(0.16 0.01 95);
  font-weight: 600;
}

.tts-speaker-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}
.tts-speaker-control :deep(.aga-select),
.tts-speaker-control .form-input--sm {
  min-width: 160px;
}

.tts-favorites {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: var(--space-xs) 0 var(--space-md);
  padding-left: var(--space-sm);
}
.tts-favorite-chip {
  display: inline-flex;
  align-items: center;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.tts-favorite-chip__apply {
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 5px 10px;
  font-size: var(--font-size-sm);
  cursor: pointer;
  font-family: inherit;
  transition: color var(--duration-fast);
}
.tts-favorite-chip__apply:hover { color: var(--color-text); }
.tts-favorite-chip__remove {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 5px 9px 5px 4px;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: color var(--duration-fast);
}
.tts-favorite-chip__remove:hover { color: var(--color-danger); }
</style>
