<script setup lang="ts">
// App doc: docs/user-guide/pages/game-assistant.md
/**
 * AssistantPanel — AI 助手主面板（路由 /game/assistant）
 *
 * 通过左侧 Sidebar "系统" 区入口进入。设计参考 MainGamePanel + GameVariablePanel：
 * - 顶栏：模式 / 历史计数 / 清空 / 撤销
 * - 中部：附件 bar + 对话流（含流式渲染）
 * - 底部：textarea + 发送按钮
 *
 * 用户决策：
 * - 单一 panel 双模式（attach 决定 Mode A vs B）
 * - 清空对话有 confirm dialog
 * - 注入前 confirm dialog
 * - rollback 与主回合 UX 一致
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §6 + Phase 5b。
 */
import { ref, computed, nextTick, watch, onActivated } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Modal from '@/ui/components/common/Modal.vue';
import AttachmentPickerModal from '@/ui/components/assistant/AttachmentPickerModal.vue';
import PayloadPreviewModal from '@/ui/components/assistant/PayloadPreviewModal.vue';
import WeatherPickerModal from '@/ui/components/panels/WeatherPickerModal.vue';
import FestivalEditModal from '@/ui/components/panels/FestivalEditModal.vue';
import EnvironmentArrayEditorModal from '@/ui/components/panels/EnvironmentArrayEditorModal.vue';
import { useAssistant } from '@/ui/composables/useAssistant';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';
import type { EnvTag } from '@/ui/components/panels/assistant-env-attachments';
import type {
  AssistantMessage,
  AttachmentSpec,
  PayloadDraft,
} from '@/engine/services/assistant/types';

const {
  messages,
  streamingContent,
  isSending,
  canRollback,
  settings,
  send,
  clear,
  applyPayload,
  rollback,
  updateSettings,
} = useAssistant();

// ─── Local UI state ──────────────────────────────────

const userInput = ref('');
const attachments = ref<AttachmentSpec[]>([]);
const showPicker = ref(false);
const showClearConfirm = ref(false);
const showSettings = ref(false);
const showPayloadPreview = ref(false);
const previewMessage = ref<AssistantMessage | null>(null);

// P4 env-tags port (2026-04-19): quick-action modals for weather / festival
// / env array. These fire DIRECT state writes (not AI-mediated) — user
// experience: open → fill → apply → status-bar updates immediately.
const showWeatherPicker = ref(false);
const showFestivalEditor = ref(false);
const showEnvEditor = ref(false);

const { get, setValue } = useGameState();
const currentWeather = computed(() => get<string>(DEFAULT_ENGINE_PATHS.weather) ?? '');
const currentFestival = computed(() => get<EnvTag>(DEFAULT_ENGINE_PATHS.festival));
const currentEnvTags = computed(() => get<EnvTag[]>(DEFAULT_ENGINE_PATHS.environmentTags) ?? []);

const messagesContainer = ref<HTMLDivElement | null>(null);

// ─── Auto-attach from query (NPC AI edit) ───────────

const route = useRoute();
const router = useRouter();

function applyEditNpcQuery(): void {
  const npcName = route.query.editNpc as string | undefined;
  if (!npcName) return;

  const defaultContext: AttachmentSpec[] = [
    { path: '元数据.叙事历史', scope: 'context' },
    { path: '世界.描述', scope: 'context' },
    { path: '角色.基础信息', scope: 'context' },
  ];
  const target: AttachmentSpec = {
    path: `社交.关系[名称=${npcName}]`,
    scope: 'target',
  };
  attachments.value = [...defaultContext, target];
  userInput.value = `请帮我完善/修改 ${npcName} 的角色数据`;

  router.replace({ query: {} });
}

onActivated(applyEditNpcQuery);
watch(() => route.query.editNpc, (v) => { if (v) applyEditNpcQuery(); });

// ─── Derived ────────────────────────────────────────

const turnCount = computed<number>(() =>
  messages.value.filter((m) => m.role === 'user').length,
);

const currentMode = computed<'A' | 'B'>(() =>
  attachments.value.some((a) => a.scope === 'target') ? 'B' : 'A',
);

const modeLabel = computed(() =>
  currentMode.value === 'B' ? '数据助手' : '自由对话',
);

const canSend = computed(() => userInput.value.trim().length > 0 && !isSending.value);

// ─── Auto-scroll on new messages ─────────────────────

function scrollToBottom(): void {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(messages, scrollToBottom, { deep: true, flush: 'post' });
watch(streamingContent, scrollToBottom);

// ─── Send ───────────────────────────────────────────

async function onSend(): Promise<void> {
  if (!canSend.value) return;
  const prompt = userInput.value;
  userInput.value = '';
  const att = [...attachments.value];
  // 注入成功后 target attachment 应自动 drop —— 在 useAssistant.send 后
  // refreshSession 会更新；但当前 turn 的 attachments 应该清空
  await send(prompt, att);
  // 用户拍板：drop target after send；context 也清空（与 demo Mode 一致）
  attachments.value = [];
}

function onKeyDown(e: KeyboardEvent): void {
  // Cmd/Ctrl+Enter 发送
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void onSend();
  }
}

// ─── Attachments ────────────────────────────────────

function openPicker(): void {
  showPicker.value = true;
}

function onPickerConfirm(picked: AttachmentSpec[]): void {
  attachments.value = picked;
}

function removeAttachment(path: string): void {
  attachments.value = attachments.value.filter((a) => a.path !== path);
}

// ─── Payload preview ────────────────────────────────

function openPayloadPreview(msg: AssistantMessage): void {
  previewMessage.value = msg;
  showPayloadPreview.value = true;
}

async function onInject(messageId: string, draft: PayloadDraft): Promise<void> {
  await applyPayload(messageId, draft);
}

function onDiscard(messageId: string): void {
  // 把对应消息的 draft 标 discarded —— UI 隐藏注入按钮
  const msg = messages.value.find((m) => m.id === messageId);
  if (msg?.payloadDraft) {
    msg.payloadDraft.status = 'discarded';
  }
}

// ─── Clear ──────────────────────────────────────────

function tryClear(): void {
  if (settings.value.confirmBeforeClear) {
    showClearConfirm.value = true;
  } else {
    void clear();
  }
}

async function doClear(): Promise<void> {
  await clear();
  showClearConfirm.value = false;
  attachments.value = [];
  userInput.value = '';
}

// ─── Rollback ───────────────────────────────────────

async function onRollback(): Promise<void> {
  await rollback();
}

// ─── Settings persistence ───────────────────────────

function onSettingChange(key: 'maxHistoryTurns' | 'confirmBeforeInject' | 'confirmBeforeClear', value: number | boolean): void {
  updateSettings({ [key]: value } as never);
}

// ─── Helpers ────────────────────────────────────────

function attachmentLabelFromPath(path: string): string {
  return path.split('.').slice(-2).join('.');
}

// ─── Env quick-actions (P4 env-tags port 2026-04-19) ──────────
//
// Direct state writes (no AI round-trip). Rollback semantics note: these
// writes are immediate and live. `preRoundSnapshot` is only captured when
// `PreProcessStage` starts a new round — so if a user sets weather, then
// starts a round, the snapshot contains the post-write value and
// `Rollback` can't undo the quick action specifically. This is by design:
// the user performed a deliberate, direct edit (mirrors GameVariablePanel
// manual edits). If undo is needed, the next AI round's force-update
// overwrites anyway, and the user can just apply a new value.

function onApplyWeather(weather: string): void {
  setValue(DEFAULT_ENGINE_PATHS.weather, weather);
  eventBus.emit('ui:toast', {
    type: 'info',
    message: `天气已设为「${weather}」`,
    duration: 1800,
  });
}

function onApplyFestival(festival: EnvTag): void {
  setValue(DEFAULT_ENGINE_PATHS.festival, festival);
  eventBus.emit('ui:toast', {
    type: 'info',
    message: `节日已设为「${festival.名称}」`,
    duration: 1800,
  });
}

function onApplyEnvTags(tags: EnvTag[]): void {
  setValue(DEFAULT_ENGINE_PATHS.environmentTags, tags);
  const msg = tags.length === 0
    ? '环境标签已清空'
    : `环境标签已更新（${tags.length} 条）`;
  eventBus.emit('ui:toast', { type: 'info', message: msg, duration: 1800 });
}

function payloadButtonLabel(draft: PayloadDraft): string {
  const errs = draft.validated.filter((p) => p.status === 'error').length;
  const warns = draft.validated.filter((p) => p.status === 'warn').length;
  const oks = draft.validated.filter((p) => p.status === 'ok').length;
  if (errs > 0) return `📦 注入包 · ${draft.validated.length} patch（${errs} 错误）`;
  if (warns > 0) return `📦 注入包 · ${draft.validated.length} patch（${warns} 警告）`;
  return `📦 注入包就绪 · ${oks} patch 全部 OK`;
}
</script>

<template>
  <div class="assistant-panel">
    <!-- ── Header ── -->
    <header class="ap-header">
      <div class="header-left">
        <h2 class="title">🪄 AI 助手</h2>
        <span class="mode-tag" :data-mode="currentMode">{{ modeLabel }}</span>
        <span class="history-count">历史 {{ turnCount }}/{{ settings.maxHistoryTurns }}</span>
      </div>
      <div class="header-right">
        <button v-if="canRollback" class="action-btn rollback" @click="onRollback">
          ↶ 撤销注入
        </button>
        <button class="action-btn" @click="showSettings = true" title="设置">⚙</button>
        <button class="action-btn danger" :disabled="messages.length === 0" @click="tryClear" title="清空对话">
          🗑
        </button>
      </div>
    </header>

    <!--
      Env quick actions (P4 env-tags port 2026-04-19).
      Disabled during assistant AI turns (`isSending`) to prevent concurrent
      state mutation with a payload-inject. Main-game round state is NOT
      guarded here — if a main-game round is mid-flight, a quick-action
      write is still allowed; the next AI round's force-update will
      reconcile (§四.5 in core.md).
    -->
    <div class="ap-quick-actions">
      <span class="qa-label">环境快捷：</span>
      <button
        type="button"
        class="qa-chip"
        :disabled="isSending"
        title="直接修改 世界.天气 状态"
        @click="showWeatherPicker = true"
      >
        🌤 设置天气
      </button>
      <button
        type="button"
        class="qa-chip"
        :disabled="isSending"
        title="直接修改 世界.节日 状态"
        @click="showFestivalEditor = true"
      >
        🏮 设置节日
      </button>
      <button
        type="button"
        class="qa-chip"
        :disabled="isSending"
        title="直接替换 世界.环境 数组（上限 3 条）"
        @click="showEnvEditor = true"
      >
        🏷 编辑环境标签
      </button>
    </div>

    <!-- ── Attachments bar ── -->
    <div class="ap-attachments">
      <div class="att-list">
        <div v-if="attachments.length === 0" class="att-empty">
          📎 尚未添加附件 · Mode A（自由对话）
        </div>
        <div
          v-for="att in attachments"
          :key="att.path"
          class="att-chip"
          :class="{ 'is-target': att.scope === 'target' }"
        >
          <span class="att-icon">{{ att.scope === 'target' ? '✏' : '📖' }}</span>
          <span class="att-label">{{ attachmentLabelFromPath(att.path) }}</span>
          <span class="att-scope">{{ att.scope === 'target' ? '目标' : '参考' }}</span>
          <button class="att-remove" @click="removeAttachment(att.path)">×</button>
        </div>
      </div>
      <button class="att-add" @click="openPicker" :disabled="isSending">+ 添加附件</button>
    </div>

    <!-- ── Conversation ── -->
    <div ref="messagesContainer" class="ap-messages">
      <div v-if="messages.length === 0 && !isSending" class="msg-empty">
        💬 输入你的需求开始对话。<br/>
        附加游戏数据后，AI 可生成可注入的 patch；不附加时纯文字辅助。
      </div>

      <article
        v-for="msg in messages"
        :key="msg.id"
        class="msg"
        :class="['msg-' + msg.role, msg.systemKind ? 'sys-' + msg.systemKind : '']"
      >
        <div class="msg-header">
          <span class="msg-role">
            {{ msg.role === 'user' ? '🧑 我' : msg.role === 'assistant' ? '🤖 助手' : '⚙ 系统' }}
          </span>
          <span class="msg-time">{{ new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
        </div>

        <div class="msg-content">{{ msg.content }}</div>

        <!-- user message: attachment chips -->
        <div v-if="msg.role === 'user' && msg.attachments && msg.attachments.length > 0" class="msg-attachments">
          <span
            v-for="a in msg.attachments"
            :key="a.path"
            class="msg-att-chip"
            :class="{ 'is-target': a.scope === 'target' }"
          >
            {{ a.scope === 'target' ? '✏' : '📖' }} {{ a.label }}
          </span>
        </div>

        <!-- assistant message: payload draft button -->
        <div v-if="msg.role === 'assistant' && msg.payloadDraft" class="msg-payload">
          <button
            v-if="msg.payloadDraft.status === 'pending'"
            class="payload-btn"
            @click="openPayloadPreview(msg)"
          >
            {{ payloadButtonLabel(msg.payloadDraft) }}
            <span class="payload-summary">{{ msg.payloadDraft.raw.summary }}</span>
          </button>
          <div v-else-if="msg.payloadDraft.status === 'injected'" class="payload-status injected">
            ✓ 已注入 {{ msg.payloadDraft.validated.length }} 个 patch
            <span v-if="msg.payloadDraft.rolledBackAt">（已撤销）</span>
          </div>
          <div v-else class="payload-status discarded">
            ✗ 已丢弃
          </div>
        </div>
      </article>

      <!-- streaming bubble -->
      <article v-if="isSending" class="msg msg-assistant streaming">
        <div class="msg-header">
          <span class="msg-role">🤖 助手</span>
          <span class="msg-time">输入中…</span>
        </div>
        <div class="msg-content">{{ streamingContent || '⌛ 等待 AI 响应…' }}</div>
      </article>
    </div>

    <!-- ── Input bar ── -->
    <div class="ap-input">
      <textarea
        v-model="userInput"
        class="input-textarea"
        placeholder="输入你的需求...  Cmd/Ctrl+Enter 发送"
        :disabled="isSending"
        rows="3"
        @keydown="onKeyDown"
      />
      <button class="send-btn" :disabled="!canSend" @click="onSend">
        {{ isSending ? '生成中…' : '发送' }}
      </button>
    </div>

    <!-- ── Sub-modals ── -->
    <AttachmentPickerModal
      v-model="showPicker"
      :already-attached="attachments"
      @confirm="onPickerConfirm"
    />

    <PayloadPreviewModal
      v-model="showPayloadPreview"
      :message="previewMessage"
      :confirm-before-inject="settings.confirmBeforeInject"
      @inject="onInject"
      @discard="onDiscard"
    />

    <!-- Env quick-action modals (P4 env-tags port 2026-04-19) -->
    <WeatherPickerModal
      v-model="showWeatherPicker"
      :current="currentWeather"
      @apply="onApplyWeather"
    />
    <FestivalEditModal
      v-model="showFestivalEditor"
      :current="currentFestival"
      @apply="onApplyFestival"
    />
    <EnvironmentArrayEditorModal
      v-model="showEnvEditor"
      :current="currentEnvTags"
      @apply="onApplyEnvTags"
    />

    <Modal v-model="showClearConfirm" title="清空对话" width="450px">
      <p>确定要清空当前对话吗？此操作不可撤销。</p>
      <p class="confirm-hint">已注入的数据不会受影响。</p>
      <template #footer>
        <button class="btn btn--secondary" @click="showClearConfirm = false">取消</button>
        <button class="btn btn--danger" @click="doClear">确认清空</button>
      </template>
    </Modal>

    <Modal v-model="showSettings" title="助手设置" width="500px">
      <div class="settings-form">
        <div class="setting-row">
          <label>历史保留 turn 数（1-50）</label>
          <input
            type="number"
            min="1"
            max="50"
            :value="settings.maxHistoryTurns"
            @input="onSettingChange('maxHistoryTurns', Math.max(1, Math.min(50, Number(($event.target as HTMLInputElement).value))))"
          />
          <span class="setting-hint">1 turn = 1 问 + 1 答</span>
        </div>
        <div class="setting-row">
          <label>
            <input
              type="checkbox"
              :checked="settings.confirmBeforeInject"
              @change="onSettingChange('confirmBeforeInject', ($event.target as HTMLInputElement).checked)"
            />
            注入前二次确认
          </label>
        </div>
        <div class="setting-row">
          <label>
            <input
              type="checkbox"
              :checked="settings.confirmBeforeClear"
              @change="onSettingChange('confirmBeforeClear', ($event.target as HTMLInputElement).checked)"
            />
            清空对话前二次确认
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn btn--primary" @click="showSettings = false">关闭</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.assistant-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 var(--sidebar-right-reserve, 40px) 0 var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
  background: var(--color-bg, #1a1a25);
  color: var(--color-text, #e0e0e6);
}

/* Header */
.ap-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border, #2a2a3a);
  background: rgba(255, 255, 255, 0.02);
}
.header-left { display: flex; align-items: center; gap: 12px; }
.title { margin: 0; font-size: 1.1rem; font-weight: 600; }
.mode-tag {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.74rem;
  font-weight: 500;
}
.mode-tag[data-mode="A"] { background: color-mix(in oklch, var(--color-sage-400) 15%, transparent); color: var(--color-primary, #6366f1); }
.mode-tag[data-mode="B"] { background: color-mix(in oklch, var(--color-success) 15%, transparent); color: var(--color-success); }
.history-count { font-size: 0.78rem; color: var(--color-text-secondary, #8888a0); }

.header-right { display: flex; gap: 6px; }
.action-btn {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #2a2a3a);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text, #e0e0e6);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.82rem;
  transition: background 0.15s;
}
.action-btn:hover:not(:disabled) { background: color-mix(in oklch, var(--color-text-bone) 6%, transparent); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.action-btn.rollback { color: var(--color-amber-400); border-color: color-mix(in oklch, var(--color-amber-400) 40%, transparent); }
.action-btn.danger:hover:not(:disabled) { background: color-mix(in oklch, var(--color-danger) 12%, transparent); color: var(--color-danger-hover); border-color: color-mix(in oklch, var(--color-danger) 30%, transparent); }

/* Attachments bar */
/* P4 env-tags port (2026-04-19): quick-action row for weather / festival / env.
   Sits above the AI-attachment bar; deterministic state writes (no AI). */
.ap-quick-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--color-border, #2a2a3a);
}
.qa-label {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
  margin-right: 4px;
  letter-spacing: 0.05em;
}
.qa-chip {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.78rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.qa-chip:hover:not(:disabled) {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}
.qa-chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ap-attachments {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border, #2a2a3a);
  min-height: 48px;
}
.att-list { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; }
.att-empty { font-size: 0.8rem; color: var(--color-text-secondary, #8888a0); opacity: 0.7; }

.att-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent);
  border-radius: 14px;
  font-size: 0.78rem;
}
.att-chip.is-target {
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border-color: color-mix(in oklch, var(--color-success) 40%, transparent);
}
.att-icon { font-size: 0.86rem; }
.att-scope { font-size: 0.7rem; opacity: 0.7; }
.att-remove {
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}

.att-add {
  flex-shrink: 0;
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed var(--color-border, #2a2a3a);
  color: var(--color-text-secondary, #8888a0);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.78rem;
}
.att-add:hover:not(:disabled) { background: color-mix(in oklch, var(--color-text-bone) 6%, transparent); color: var(--color-text, #e0e0e6); }
.att-add:disabled { opacity: 0.4; cursor: not-allowed; }

/* Messages */
.ap-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg-empty {
  margin: auto;
  padding: 40px;
  text-align: center;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.92rem;
  line-height: 1.6;
}

.msg {
  max-width: 90%;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
}
.msg-user { align-self: flex-end; background: color-mix(in oklch, var(--color-sage-400) 8%, transparent); border-color: color-mix(in oklch, var(--color-sage-400) 25%, transparent); }
.msg-assistant { align-self: flex-start; }
.msg-system {
  align-self: center;
  background: color-mix(in oklch, var(--color-amber-400) 6%, transparent);
  border-color: color-mix(in oklch, var(--color-amber-400) 20%, transparent);
  font-size: 0.82rem;
  max-width: 70%;
  text-align: center;
}
.msg.streaming { opacity: 0.85; }
.msg.sys-inject-success { background: color-mix(in oklch, var(--color-success) 8%, transparent); border-color: color-mix(in oklch, var(--color-success) 25%, transparent); }
.msg.sys-inject-failed, .msg.sys-ai-error { background: color-mix(in oklch, var(--color-danger) 8%, transparent); border-color: color-mix(in oklch, var(--color-danger) 25%, transparent); }
.msg.sys-inject-rolled-back { background: color-mix(in oklch, var(--color-amber-400) 10%, transparent); border-color: color-mix(in oklch, var(--color-amber-400) 30%, transparent); }

.msg-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.74rem;
  color: var(--color-text-secondary, #8888a0);
  margin-bottom: 4px;
}
.msg-role { font-weight: 600; }

.msg-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--color-text, #e0e0e6);
}

.msg-attachments {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.msg-att-chip {
  padding: 2px 8px;
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 25%, transparent);
  border-radius: 10px;
  font-size: 0.72rem;
}
.msg-att-chip.is-target {
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border-color: color-mix(in oklch, var(--color-success) 30%, transparent);
}

.msg-payload { margin-top: 10px; }

.payload-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  padding: 10px 14px;
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid var(--color-primary, #6366f1);
  color: var(--color-text, #e0e0e6);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.84rem;
  text-align: left;
  font-weight: 500;
  transition: background 0.15s;
}
.payload-btn:hover { background: color-mix(in oklch, var(--color-sage-400) 18%, transparent); }
.payload-summary {
  font-size: 0.76rem;
  font-weight: 400;
  color: var(--color-text-secondary, #8888a0);
}

.payload-status {
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.78rem;
}
.payload-status.injected { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); }
.payload-status.discarded { background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary, #8888a0); }

/* Input bar */
.ap-input {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border, #2a2a3a);
  background: rgba(255, 255, 255, 0.02);
}

.input-textarea {
  flex: 1;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text, #e0e0e6);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  font-size: 0.86rem;
  font-family: inherit;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
}
.input-textarea:focus { border-color: var(--color-primary, #6366f1); }
.input-textarea:disabled { opacity: 0.6; }

.send-btn {
  padding: 0 24px;
  background: var(--color-primary, #6366f1);
  color: var(--color-text-bone);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.86rem;
  font-weight: 500;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Settings modal */
.settings-form { display: flex; flex-direction: column; gap: 14px; }
.setting-row { display: flex; flex-direction: column; gap: 4px; }
.setting-row label { font-size: 0.84rem; cursor: pointer; }
.setting-row input[type="number"] { width: 80px; padding: 4px 8px; }
.setting-hint { font-size: 0.74rem; color: var(--color-text-secondary, #8888a0); }

.btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.84rem; font-weight: 500; cursor: pointer; }
.btn--primary { background: var(--color-primary, #6366f1); color: var(--color-text-bone); }
.btn--secondary { background: rgba(255, 255, 255, 0.07); color: var(--color-text, #e0e0e6); }
.btn--danger { background: color-mix(in oklch, var(--color-danger) 12%, transparent); color: var(--color-danger-hover); border: 1px solid color-mix(in oklch, var(--color-danger) 30%, transparent); }
.confirm-hint { margin-top: 8px; font-size: 0.8rem; color: var(--color-text-secondary, #8888a0); }

@media (max-width: 767px) {
  .assistant-panel { padding-left: var(--space-md); padding-right: var(--space-md); transition: none; }
}
</style>
