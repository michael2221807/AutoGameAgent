<script setup lang="ts">
// App doc: docs/user-guide/pages/game-main.md §3.14 (语音输入 · STT)
/**
 * 语音输入（STT）设置区 — SettingsPanel 的一个可导航子区（id="settings-voice-input"）。
 *
 * 全局偏好落 localStorage `aga_stt_settings`（经 collectLocalStorageSettings 自动进
 * 备份/云同步）。改动即存;麦克风组件下次录音读最新值。保存后派发
 * `aga:stt-settings-changed` 让在场的 MicInputButton 立即刷新显隐（enabled 开关）。
 *
 * 设计文档：docs/design/stt-streaming-handoff.md §5
 * App doc：docs/user-guide/pages/game-main.md §3.14 语音输入
 */
import { ref, inject } from 'vue';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import { loadSttSettings, saveSttSettings } from '@/engine/stt/stt-settings';
import type { SttSettings, SttInputMode, SttLatencyProfile } from '@/engine/stt/types';
import type { SttService } from '@/engine/stt/stt-service';

const stt = inject<SttService | undefined>('sttService', undefined);
const settings = ref<SttSettings>(loadSttSettings());

/** 单点持久化 + 通知在场麦克风组件刷新显隐。 */
function commit(): void {
  saveSttSettings(settings.value);
  window.dispatchEvent(new CustomEvent('aga:stt-settings-changed'));
}

function setEnabled(v: boolean): void { settings.value.enabled = v; commit(); }
function setMode(mode: SttInputMode): void { settings.value.mode = mode; commit(); }
function setLatency(lat: SttLatencyProfile): void { settings.value.latency = lat; commit(); }
function setFirstUseHint(v: boolean): void { settings.value.firstUseHint = v; commit(); }

/** 流式服务是否探到（用于「实时听写」不可用时的提示）。 */
const streamReady = ref<boolean>(!!stt?.isStreamReady());

/**
 * 浏览器是否开放麦克风。getUserMedia 仅在「安全上下文」可用（https 或
 * localhost/127.0.0.1）；通过局域网 IP + http 访问时 navigator.mediaDevices 为
 * undefined → 麦克风键会被隐藏。此时给出明确提示，避免「静默消失、无从排查」。
 */
const mediaSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
</script>

<template>
  <section id="settings-voice-input" class="settings-section">
    <h3 class="section-title">{{ $t('stt.settings.sectionTitle') }}</h3>
    <p class="setting-desc" style="margin-bottom: 12px; opacity: 0.7">
      {{ $t('stt.settings.desc') }}
    </p>

    <!-- 总开关 -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{{ $t('stt.settings.enabled.label') }}</span>
        <span class="setting-desc">{{ $t('stt.settings.enabled.desc') }}</span>
      </div>
      <AgaToggle :model-value="settings.enabled" @update:model-value="setEnabled" />
    </div>

    <template v-if="settings.enabled">
      <!-- 不安全上下文警告：浏览器禁用了麦克风(局域网 IP + http 等) -->
      <div v-if="!mediaSupported" class="setting-row setting-row--indent">
        <span class="setting-desc" style="color: var(--color-danger)">{{ $t('stt.settings.insecureContext') }}</span>
      </div>

      <!-- 输入模式 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('stt.settings.mode.label') }}</span>
          <span class="setting-desc">{{ $t('stt.settings.mode.desc') }}</span>
        </div>
        <div class="stt-segment" role="group" :aria-label="$t('stt.settings.mode.label')">
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.mode === 'auto' }"
            :aria-pressed="settings.mode === 'auto'"
            @click="setMode('auto')"
          >{{ $t('stt.settings.mode.auto') }}</button>
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.mode === 'stream' }"
            :aria-pressed="settings.mode === 'stream'"
            @click="setMode('stream')"
          >{{ $t('stt.settings.mode.stream') }}</button>
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.mode === 'record' }"
            :aria-pressed="settings.mode === 'record'"
            @click="setMode('record')"
          >{{ $t('stt.settings.mode.record') }}</button>
        </div>
      </div>

      <!-- 流式不可用提示 -->
      <div v-if="(settings.mode === 'stream' || settings.mode === 'auto') && !streamReady" class="setting-row setting-row--indent">
        <span class="setting-desc" style="color: var(--color-amber-400)">{{ $t('stt.settings.streamUnavailable') }}</span>
      </div>

      <!-- 实时听写延迟档（仅 stream/auto 生效） -->
      <div v-if="settings.mode !== 'record'" class="setting-row setting-row--indent">
        <div class="setting-info">
          <span class="setting-label">{{ $t('stt.settings.latency.label') }}</span>
          <span class="setting-desc">{{ $t('stt.settings.latency.desc') }}</span>
        </div>
        <div class="stt-segment" role="group" :aria-label="$t('stt.settings.latency.label')">
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.latency === 'fast' }"
            :aria-pressed="settings.latency === 'fast'"
            @click="setLatency('fast')"
          >{{ $t('stt.settings.latency.fast') }}</button>
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.latency === 'balanced' }"
            :aria-pressed="settings.latency === 'balanced'"
            @click="setLatency('balanced')"
          >{{ $t('stt.settings.latency.balanced') }}</button>
          <button
            type="button" class="stt-segment__btn"
            :class="{ 'stt-segment__btn--active': settings.latency === 'stable' }"
            :aria-pressed="settings.latency === 'stable'"
            @click="setLatency('stable')"
          >{{ $t('stt.settings.latency.stable') }}</button>
        </div>
      </div>

      <!-- 首次转写提示 -->
      <div class="setting-row setting-row--indent">
        <div class="setting-info">
          <span class="setting-label">{{ $t('stt.settings.firstUseHint.label') }}</span>
          <span class="setting-desc">{{ $t('stt.settings.firstUseHint.desc') }}</span>
        </div>
        <AgaToggle :model-value="settings.firstUseHint" @update:model-value="setFirstUseHint" />
      </div>

      <div class="setting-subsection-header">{{ $t('stt.settings.language.label') }}</div>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('stt.settings.language.auto') }}</span>
          <span class="setting-desc">{{ $t('stt.settings.language.desc') }}</span>
        </div>
        <span class="setting-desc" style="font-family: var(--font-mono, monospace)">auto</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* ── Shared settings-section layout (与 TtsSettingsSection 一致,scoped 不级联故重声明) ── */
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
.stt-segment {
  display: inline-flex;
  background: var(--color-surface-input);
  border-radius: var(--radius-md);
  padding: 2px;
  flex-shrink: 0;
}
.stt-segment__btn {
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
.stt-segment__btn--active {
  background: var(--color-sage-400);
  color: oklch(0.16 0.01 95);
  font-weight: 600;
}
</style>
