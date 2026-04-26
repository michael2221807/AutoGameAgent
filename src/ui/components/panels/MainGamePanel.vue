<script setup lang="ts">
/**
 * MainGamePanel — The primary game conversation interface.
 *
 * This is the most important panel in the game view, where the player
 * reads AI-generated narrative and interacts with the game world.
 *
 * Layout (top to bottom):
 * ┌──────────────────────────────────────────┐
 * │  Round counter + status bar              │
 * ├──────────────────────────────────────────┤
 * │                                          │
 * │  Scrollable message history              │
 * │   - User messages (right-aligned)        │
 * │   - Assistant messages (left-aligned)    │
 * │   - Streaming indicator (typing dots)    │
 * │                                          │
 * ├──────────────────────────────────────────┤
 * │  Action options (clickable buttons)      │
 * ├──────────────────────────────────────────┤
 * │  Input area: textarea + send button      │
 * └──────────────────────────────────────────┘
 *
 * Data flow:
 * - Reads narrative history / round via `DEFAULT_ENGINE_PATHS`（`engine/pipeline/types.ts`）
 * - Sends user input by emitting 'pipeline:user-input' on the eventBus
 * - Listens for 'ai:stream-chunk' events to display streaming text
 * - Listens for 'engine:round-complete' to update action options
 * - Streaming can be cancelled via 'pipeline:cancel' event
 *
 * Key design decisions:
 * 1. Auto-scroll: The message area scrolls to bottom on new messages,
 *    but respects manual scroll-up (won't force scroll if user is reading history).
 * 2. Action options: Displayed as clickable buttons below the last AI message.
 *    Clicking an option sends it as the next user input.
 * 3. Streaming: During AI generation, partial text is accumulated and displayed
 *    in a "typing" bubble. The streaming indicator (animated dots) gives
 *    visual feedback that the AI is working.
 * 4. The textarea auto-grows up to 4 lines, then scrolls internally.
 *
 * Dependencies:
 *   - useGameState()  → reads narrative history, round number
 *   - inject('eventBus') → pipeline communication
 */
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onActivated,
  onBeforeUnmount,
  inject,
} from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import type { EventBus } from '@/engine/core/event-bus';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import Modal from '@/ui/components/common/Modal.vue';
import FormattedText from '@/ui/components/common/FormattedText.vue';
import RoundDivider from '@/ui/components/panels/RoundDivider.vue';
import ThinkingViewer from '@/ui/components/panels/ThinkingViewer.vue';
import CommandsViewer from '@/ui/components/panels/CommandsViewer.vue';
import RawResponseViewer from '@/ui/components/panels/RawResponseViewer.vue';
import WeatherBadge from '@/ui/components/panels/WeatherBadge.vue';
import EnvironmentChips from '@/ui/components/panels/EnvironmentChips.vue';
import FestivalChip from '@/ui/components/panels/FestivalChip.vue';
import {
  findFirstAssistantIdx,
  findLatestAssistantIdx,
  roundForAssistantAt as roundForAssistantAtHelper,
  deriveDisplayMetrics,
  countCjkChars,
  truncate,
  type RoundMetrics,
  type DisplayMetrics,
} from '@/ui/components/panels/round-divider-helpers';

// ─── Types ────────────────────────────────────────────────────

interface DeltaChange {
  path: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * A single message in the chat display.
 * Mirrors the AIMessage shape from the engine but adds display metadata.
 * _delta: optional state changes from this round (display-only, not sent to AI)
 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  _delta?: DeltaChange[];
  // Phase 1 metadata (2026-04-19); all optional for backward compat with
  // narrativeHistory entries saved before this sprint.
  _metrics?: RoundMetrics;
  _thinking?: string;
  _rawResponse?: string;
  _rawResponseStep2?: string;
  _commands?: unknown[];
  _shortTermPreview?: string;
  // Phase 4 metadata (2026-04-19) — polish state for 优化/原文 toggle.
  _polish?: {
    applied: boolean;
    originalText: string;
    model: string;
    durationMs: number;
    manual: boolean;
    polishedAt: number;
  };
}

// ─── Dependencies ─────────────────────────────────────────────

const { useValue } = useGameState();
const eventBus = inject<EventBus>('eventBus');

// ─── Reactive state ───────────────────────────────────────────

/**
 * Narrative history from the state tree.
 * Each entry is an AIMessage with role + content.
 * The `useValue` reactive getter ensures this updates when the state tree changes.
 */
const narrativeHistory = useValue<ChatMessage[]>(DEFAULT_ENGINE_PATHS.narrativeHistory);

import type { NpcBrief } from '@/ui/components/common/FormattedText.vue';

const relationships = useValue<NpcBrief[]>(DEFAULT_ENGINE_PATHS.relationships);
const npcNameList = computed(() => {
  const list = relationships.value;
  if (!Array.isArray(list)) return [];
  return list.map((r) => r.名称).filter((n): n is string => !!n);
});
const npcDataList = computed<NpcBrief[]>(() => {
  const list = relationships.value;
  if (!Array.isArray(list)) return [];
  return list.filter((r) => !!r.名称);
});

/** Current round number */
const roundNumber = useValue<number>(DEFAULT_ENGINE_PATHS.roundNumber);

/**
 * Environment-tags state (P1 2026-04-19) — weather string, festival object,
 * environment tag array. Each is forcibly re-emitted every round by the AI
 * per the P2 prompt contract, so reactive reads here always reflect the
 * current round's declared state.
 */
const weather = useValue<unknown>(DEFAULT_ENGINE_PATHS.weather);
const festival = useValue<unknown>(DEFAULT_ENGINE_PATHS.festival);
const environmentTags = useValue<unknown>(DEFAULT_ENGINE_PATHS.environmentTags);

/** Persisted action options from state tree — survives page refresh */
const persistedActionOptions = useValue<string[]>('元数据.当前行动选项');

/** User input text bound to the textarea */
const userInput = ref('');

/** Whether the AI is currently generating a response (pipeline is running) */
const isGenerating = ref(false);

/** Accumulated streaming text from AI during generation */
const streamingText = ref('');

/**
 * Action options offered by the AI after its response.
 * Displayed as clickable buttons; clicking sends the option text as input.
 *
 * Stored in module-level variable to survive KeepAlive deactivation.
 * Vue 3's KeepAlive with lazy-loaded async components (router lazy import)
 * may not reliably preserve component-scoped refs.
 */
let _savedActionOptions: string[] = [];
let _pendingRollbackInput = '';
const _PENDING_INPUT_KEY = 'aga_pending_input';
let _lastSentInput = localStorage.getItem(_PENDING_INPUT_KEY) ?? '';
const actionOptions = ref<string[]>(_savedActionOptions);

// Collapse/expand the action-options strip. Persisted across sessions so the
// user's preference sticks — long NPC-branch options otherwise eat the
// viewport.
const ACTION_OPTIONS_COLLAPSED_KEY = 'aga_action_options_collapsed';
const actionOptionsCollapsed = ref<boolean>(
  localStorage.getItem(ACTION_OPTIONS_COLLAPSED_KEY) === '1',
);
function toggleActionOptionsCollapsed(): void {
  actionOptionsCollapsed.value = !actionOptionsCollapsed.value;
  localStorage.setItem(ACTION_OPTIONS_COLLAPSED_KEY, actionOptionsCollapsed.value ? '1' : '0');
}

// ─── Streaming timer ──────────────────────────────────────────

/** Timestamp when the current generation started (ms since epoch) */
const generationStartTime = ref<number | null>(null);

/** Elapsed time in milliseconds since generation started */
const generationElapsedMs = ref(0);

/** setInterval handle for the elapsed time ticker */
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// ─── Rollback state ───────────────────────────────────────────

/** Reads the preRoundSnapshot from the state tree — null means no snapshot available */
const preRoundSnapshot = useValue<Record<string, unknown> | null>(
  DEFAULT_ENGINE_PATHS.preRoundSnapshot,
);

/** Whether rollback is possible: snapshot must exist and generation must be idle */
const canRollback = computed(() => !!preRoundSnapshot.value && !isGenerating.value);

/** Whether the rollback confirmation dialog is visible */
const showRollbackConfirm = ref(false);

// ─── Phase 3 viewers (2026-04-19) ──────────────────────────────
// CommandsViewer supersedes the old delta-only modal: it takes both
// `_commands` (AI-requested) and `_delta` (applied) and shows them as
// tabs. Both the Δ badge (in-bubble) and the ☰ button (on RoundDivider,
// current-round only) open CommandsViewer — they just pick different
// initial tabs.

interface ActiveCommandsPayload {
  commands: unknown[];
  delta: DeltaChange[];
  roundNumber: number;
  initialTab: 'commands' | 'delta';
}

const activeCommandsPayload = ref<ActiveCommandsPayload | null>(null);
const showCommandsViewer = ref(false);

const activeThinking = ref<{ text: string; roundNumber: number } | null>(null);
const showThinkingViewer = ref(false);

const activeRaw = ref<{ step1: string; step2: string; roundNumber: number } | null>(null);
const showRawViewer = ref(false);

function openThinkingViewer(msg: ChatMessage): void {
  const round = msg._metrics?.roundNumber ?? 0;
  activeThinking.value = { text: msg._thinking ?? '', roundNumber: round };
  showThinkingViewer.value = true;
}

function openCommandsViewer(msg: ChatMessage, initialTab: 'commands' | 'delta' = 'commands'): void {
  const round = msg._metrics?.roundNumber ?? 0;
  activeCommandsPayload.value = {
    commands: msg._commands ?? [],
    delta: msg._delta ?? [],
    roundNumber: round,
    initialTab,
  };
  showCommandsViewer.value = true;
}

function openRawViewer(msg: ChatMessage): void {
  const round = msg._metrics?.roundNumber ?? 0;
  activeRaw.value = {
    step1: msg._rawResponse ?? '',
    step2: msg._rawResponseStep2 ?? '',
    roundNumber: round,
  };
  showRawViewer.value = true;
}

/**
 * Whether the user has manually scrolled up (away from the bottom).
 * When true, auto-scroll is suppressed to avoid jarring scroll jumps
 * while the user is reading older messages.
 */
const isUserScrolledUp = ref(false);

// ─── Template refs ────────────────────────────────────────────

const messagesContainer = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// ─── Computed ─────────────────────────────────────────────────

/**
 * Messages to display in the chat area.
 * Filters out system messages (those are prompt-internal, not user-facing).
 */
const displayMessages = computed<ChatMessage[]>(() => {
  const history = narrativeHistory.value;
  if (!Array.isArray(history)) return [];
  return history.filter((msg) => msg.role !== 'system');
});

// ─── Round divider placement (Phase 2, 2026-04-19) ─────────────
// Logic delegated to round-divider-helpers.ts so it can be unit-tested
// without Vue test utils.

const firstAssistantIdx = computed<number>(() => findFirstAssistantIdx(displayMessages.value));
const latestAssistantIdx = computed<number>(() => findLatestAssistantIdx(displayMessages.value));
function roundForAssistantAt(idx: number): number {
  return roundForAssistantAtHelper(displayMessages.value, idx);
}
/**
 * Produce `DisplayMetrics` for the divider above an assistant at `idx`.
 * Modern entries use the persisted `_metrics`; legacy entries (saved before
 * Phase 1) get a synthetic pill with `outputTokens` estimated from content
 * and em-dash placeholders for the two un-recoverable fields.
 */
function displayMetricsForAssistantAt(idx: number): DisplayMetrics | undefined {
  const msg = displayMessages.value[idx];
  if (!msg) return undefined;
  return deriveDisplayMetrics(msg, roundForAssistantAt(idx));
}

// ─── Phase 4: 优化 / 原文 toggle state (2026-04-19) ────────────
//
// When a round was polished (`msg._polish.applied === true`), users can click
// the round badge to flip between the polished text (stored in `msg.content`)
// and the pre-polish original (`msg._polish.originalText`). State is stored
// per round-number so each round remembers its own toggle. Uses reactive
// Map so Vue picks up individual key changes.
const showingOriginalForRound = ref<Map<number, boolean>>(new Map());

function toggleOriginalForRound(msg: ChatMessage): void {
  if (!msg._polish?.applied) return;
  const round = msg._metrics?.roundNumber ?? 0;
  if (round <= 0) return;
  const prev = showingOriginalForRound.value.get(round) === true;
  // Create a new Map to trigger reactivity — direct .set() doesn't rerender.
  const next = new Map(showingOriginalForRound.value);
  next.set(round, !prev);
  showingOriginalForRound.value = next;
}

function isShowingOriginalForRound(roundNum: number): boolean {
  return showingOriginalForRound.value.get(roundNum) === true;
}

/**
 * Returns the text to render for an assistant message: polished text by
 * default (in `msg.content`), or the pre-polish original when the user has
 * toggled that round to "原文".
 */
function displayTextForAssistant(msg: ChatMessage): string {
  if (!msg._polish?.applied) return msg.content;
  const round = msg._metrics?.roundNumber;
  if (round == null) return msg.content;
  return isShowingOriginalForRound(round)
    ? (msg._polish.originalText || msg.content)
    : msg.content;
}

/** Display string for the round counter */
const roundDisplay = computed(() => {
  const r = roundNumber.value;
  return typeof r === 'number' && r > 0 ? `第 ${r} 回合` : '游戏开始';
});

/** Whether the send button should be enabled */
const canSend = computed(() => {
  return userInput.value.trim().length > 0 && !isGenerating.value;
});

// ─── Scroll management ───────────────────────────────────────

/**
 * Scroll the message container to the bottom.
 * Only scrolls if the user hasn't manually scrolled up (unless force=true).
 *
 * 2026-04-14：`instant` 参数用于跳过 CSS `scroll-behavior: smooth` 的动画，
 * 适合 mount/onActivated 首次定位到底部的场景（动画会晃眼）。
 * 流式追加内容的场景（新 chunk 到来）则保持默认的平滑滚动。
 */
function scrollToBottom(force = false, instant = false): void {
  if (!messagesContainer.value) return;
  if (!force && isUserScrolledUp.value) return;

  nextTick(() => {
    const el = messagesContainer.value;
    if (!el) return;
    if (instant) {
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (el) el.style.scrollBehavior = prev;
      });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  });
}

/**
 * Track manual scroll position to determine if the user has scrolled up.
 * A small threshold (30px) prevents floating-point rounding issues
 * from breaking the "at bottom" detection.
 */
function onScroll(): void {
  const el = messagesContainer.value;
  if (!el) return;

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  isUserScrolledUp.value = distanceFromBottom > 30;
}

// ─── Input handling ───────────────────────────────────────────

/**
 * Send the current user input to the game pipeline.
 * Emits 'pipeline:user-input' on the event bus with the message text.
 */
function sendMessage(): void {
  const text = userInput.value.trim();
  if (!text || isGenerating.value) return;

  _lastSentInput = text;
  localStorage.setItem(_PENDING_INPUT_KEY, text);
  userInput.value = '';
  resetTextareaHeight();

  if (eventBus) {
    eventBus.emit('pipeline:user-input', { text });
  }
}

/**
 * Fill an action option into the input textarea.
 * The user can review and edit the text before sending.
 * This preserves player agency (Polanyi design principle).
 */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    eventBus?.emit('ui:toast', { type: 'success', message: '已复制到剪贴板' });
  } catch {
    eventBus?.emit('ui:toast', { type: 'error', message: '复制失败' });
  }
}

function selectAction(option: string): void {
  if (isGenerating.value) return;
  userInput.value = option;
  // 不清空 actionOptions — 保持显示，用户可以中途换选
  nextTick(() => {
    textareaRef.value?.focus();
    autoResizeTextarea();
  });
}

/** Cancel the current AI generation */
function cancelGeneration(): void {
  if (eventBus) {
    eventBus.emit('pipeline:cancel', undefined);
  }
}

/** Stop the elapsed-time ticker and reset timer refs */
function stopTimer(): void {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  generationStartTime.value = null;
}

/** Send a rollback request to the engine */
function handleRollback(): void {
  showRollbackConfirm.value = false;
  if (!eventBus) return;

  // Capture the last user input before rollback reverts the state tree.
  // After rollback, narrativeHistory loses the last round's entries,
  // so we grab it now and restore it to the input box on rollback-complete.
  const history = narrativeHistory.value;
  let lastUserInput = '';
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      if ((history[i] as { role: string }).role === 'user') {
        lastUserInput = (history[i] as { content: string }).content;
        break;
      }
    }
  }
  _pendingRollbackInput = lastUserInput;

  eventBus.emit('engine:rollback-requested', undefined);
}

/** Handle keyboard shortcuts in the textarea */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

/**
 * Auto-resize the textarea to fit its content, capped at a max height.
 * This provides a comfortable multi-line input without taking
 * excessive vertical space.
 */
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

// ─── Event bus subscriptions ──────────────────────────────────

/** Cleanup functions for event bus subscriptions */
const unsubscribers: Array<() => void> = [];

// KeepAlive: when user returns from another panel
onActivated(() => {
  // 2026-04-14：必须先把 scroll-behavior 暂时置 auto 再设 scrollTop，
  // 否则 CSS `scroll-behavior: smooth` 会让"瞬间定位到底"变成动画播放一段（晃眼）。
  const el = messagesContainer.value;
  if (el) {
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    // 下一帧再恢复，确保这一次写入是 instant 的；之后的流式滚动等仍可走 smooth
    requestAnimationFrame(() => {
      if (el) el.style.scrollBehavior = prev;
    });
  }
  isUserScrolledUp.value = false; // 切回来一定在底部

  // Restore action options from module-level cache
  if (_savedActionOptions.length > 0 && actionOptions.value.length === 0) {
    actionOptions.value = [..._savedActionOptions];
  }
});

onMounted(() => {
  if (!eventBus) return;

  /*
   * Pipeline lifecycle events:
   * - round-start: clear streaming state, mark generating
   * - stream-chunk: accumulate partial AI text
   * - round-complete: finalize, update action options
   * - ai:error: stop generating on errors
   */
  unsubscribers.push(
    eventBus.on('engine:round-start', () => {
      isGenerating.value = true;
      streamingText.value = '';
      actionOptions.value = [];
      generationStartTime.value = Date.now();
      generationElapsedMs.value = 0;
      elapsedTimer = setInterval(() => {
        if (generationStartTime.value !== null) {
          generationElapsedMs.value = Date.now() - generationStartTime.value;
        }
      }, 100);
    }),
  );

  unsubscribers.push(
    eventBus.on<{ chunk: string }>('ai:stream-chunk', (payload) => {
      if (payload && typeof payload === 'object' && 'chunk' in payload) {
        streamingText.value += (payload as { chunk: string }).chunk;
        scrollToBottom();
      }
    }),
  );

  unsubscribers.push(
    eventBus.on<{ actionOptions?: string[] }>('engine:round-complete', (payload) => {
      stopTimer();
      isGenerating.value = false;
      streamingText.value = '';
      _lastSentInput = '';
      localStorage.removeItem(_PENDING_INPUT_KEY);

      if (
        payload &&
        typeof payload === 'object' &&
        'actionOptions' in payload &&
        Array.isArray((payload as { actionOptions: string[] }).actionOptions)
      ) {
        actionOptions.value = (payload as { actionOptions: string[] }).actionOptions;
      }

      scrollToBottom(true);
    }),
  );

  unsubscribers.push(
    eventBus.on('ai:error', (payload) => {
      stopTimer();
      isGenerating.value = false;
      streamingText.value = '';
      // 恢复用户刚才发送的输入，防止报错后丢失
      if (_lastSentInput) {
        userInput.value = _lastSentInput;
        _lastSentInput = '';
        nextTick(() => autoResizeTextarea());
      }
      const errMsg = (payload as { error?: Error })?.error?.message ?? '未知错误';
      eventBus.emit('ui:toast', {
        type: 'error',
        message: `AI 请求失败：${errMsg}`,
        duration: 5000,
      });
    }),
  );

  unsubscribers.push(
    eventBus.on<{ attempt: number; maxRetries: number }>('ai:retrying', (payload) => {
      isGenerating.value = true;
      const { attempt, maxRetries } = payload ?? { attempt: 0, maxRetries: 0 };
      eventBus.emit('ui:toast', {
        type: 'warning',
        message: `请求失败，正在重试（${attempt}/${maxRetries}）…`,
        duration: 3000,
      });
    }),
  );

  unsubscribers.push(
    eventBus.on('engine:rollback-complete', () => {
      actionOptions.value = [];
      // Restore the rolled-back round's user input so the player can re-submit or edit
      if (_pendingRollbackInput) {
        userInput.value = _pendingRollbackInput;
        _pendingRollbackInput = '';
        nextTick(() => autoResizeTextarea());
      }
    }),
  );

  // Restore pending input that survived a page refresh
  if (!userInput.value && _lastSentInput) {
    userInput.value = _lastSentInput;
    nextTick(() => autoResizeTextarea());
  }

  /* Initial scroll to bottom when the panel mounts —— instant 避免首屏动画 */
  scrollToBottom(true, true);

  // Restore action options from state tree (survives page refresh)
  if (actionOptions.value.length === 0 && Array.isArray(persistedActionOptions.value) && persistedActionOptions.value.length > 0) {
    actionOptions.value = [...persistedActionOptions.value];
    _savedActionOptions = [...persistedActionOptions.value];
  }
});

onBeforeUnmount(() => {
  stopTimer();
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers.length = 0;
});

// ─── Watchers ─────────────────────────────────────────────────

/* Sync action options to module-level cache for KeepAlive survival */
watch(actionOptions, (v) => { _savedActionOptions = [...v]; }, { deep: true });

/* Auto-scroll when new messages are added to the narrative history */
watch(
  () => narrativeHistory.value?.length,
  () => {
    scrollToBottom();
  },
);
</script>

<template>
  <div class="main-game-panel">
    <!-- Status bar: left cluster [round counter][weather][env chips] / right cluster [festival][generating] -->
    <div class="status-bar">
      <div class="status-bar__left">
        <span class="round-counter">{{ roundDisplay }}</span>
        <WeatherBadge :weather="weather" />
        <EnvironmentChips :tags="environmentTags" />
      </div>
      <div class="status-bar__right">
        <FestivalChip :festival="festival" />
        <span v-if="isGenerating" class="status-generating">
          AI 思考中…
        </span>
      </div>
    </div>

    <!-- Messages area —— wrapper 提供 position:relative 以承载浮动按钮 -->
    <div class="messages-area">
      <!-- Scrollable message history -->
      <div
        ref="messagesContainer"
        class="messages-container"
        @scroll="onScroll"
      >
      <!-- Empty state when no messages exist yet -->
      <div v-if="displayMessages.length === 0 && !isGenerating" class="empty-chat">
        <p class="empty-text">游戏尚未开始，输入你的第一个行动</p>
      </div>

      <!-- Message bubbles (each assistant preceded by a RoundDivider, except the opening one) -->
      <template v-for="(msg, idx) in displayMessages" :key="idx">
        <RoundDivider
          v-if="msg.role === 'assistant' && idx !== firstAssistantIdx"
          :round-number="roundForAssistantAt(idx)"
          :metrics="displayMetricsForAssistantAt(idx)"
          :is-current="idx === latestAssistantIdx"
          :has-thinking="!!msg._thinking && msg._thinking.length > 0"
          :has-commands="(msg._commands?.length ?? 0) > 0 || (msg._delta?.length ?? 0) > 0"
          :has-raw="!!msg._rawResponse && msg._rawResponse.length > 0"
          :polish="msg._polish"
          :showing-original="isShowingOriginalForRound(msg._metrics?.roundNumber ?? 0)"
          @view-thinking="openThinkingViewer(msg)"
          @view-commands="openCommandsViewer(msg, 'commands')"
          @view-raw="openRawViewer(msg)"
          @toggle-original="toggleOriginalForRound(msg)"
        />
      <div
        class="message"
        :class="[`message--${msg.role}`]"
      >
        <div class="message-bubble">
          <!--
            2026-04-11 fix：user 消息用纯文本渲染，assistant 才走 FormattedText。
            原因：用户输入里的 `"对话"` 会被 FormattedText 解析为 `.ft-dialogue`
            并用 `color: var(--color-primary)` 上色。但 `.message--user .message-bubble`
            的背景本身就是 `var(--color-primary)`（紫色气泡）—— 紫字渲染在紫底上
            → 用户看到自己输入带引号的内容变成"透明"。

            修复策略：不把用户输入当 AI 叙事处理。用户输入是纯文本，`"` 只是
            引号字面量，没有 dialogue 语义。只有 AI 生成的叙事才需要
            `【环境】`/`"对话"`/`〖判定〗` 富格式解析。
          -->
          <div
            v-if="msg.role === 'user'"
            class="message-text message-text--plain"
          >{{ msg.content }}</div>
          <div v-else class="message-text"><FormattedText :text="displayTextForAssistant(msg)" :npc-names="npcNameList" :npc-data="npcDataList" /></div>

          <!--
            Δ badge — in-bubble fast path to see state changes for this round.
            Unified with the ☰ button on RoundDivider (Phase 3, 2026-04-19):
            both open CommandsViewer but with different initial tabs. The Δ
            badge jumps straight to the "生效变更" (delta) tab since that's
            what the badge's glyph represents.
          -->
          <button
            v-if="msg.role === 'assistant' && msg._delta && msg._delta.length > 0"
            class="delta-badge"
            :aria-label="`查看 ${msg._delta.length} 条状态变更`"
            @click="openCommandsViewer(msg, 'delta')"
          >
            Δ {{ msg._delta.length }}
          </button>
        </div>
        <!--
          Per-turn meta row (Phase 3, 2026-04-19) — hover-reveal footer
          showing CJK word count + short-term memory preview. Port of
          MRJH TurnItem.tsx:527-530; uses AGA's hover opacity transition
          rather than tailwind group-hover.
        -->
        <div
          v-if="msg.role === 'assistant' && (countCjkChars(msg.content) > 0 || msg._shortTermPreview)"
          class="message-meta-bottom"
        >
          <span class="message-meta-bottom__chars">中文字数 · {{ countCjkChars(msg.content) }}字</span>
          <span
            v-if="msg._shortTermPreview"
            class="message-meta-bottom__preview"
            :title="msg._shortTermPreview"
          >记忆 · {{ truncate(msg._shortTermPreview, 40) }}</span>
        </div>
      </div>
      </template>

      <!--
        Streaming indicator: shown during AI generation.
        Displays accumulated text + elapsed timer + animated typing dots.
      -->
      <div v-if="isGenerating" class="message message--assistant message--streaming">
        <div class="message-bubble">
          <div v-if="streamingText" class="message-text"><FormattedText :text="streamingText" :npc-names="npcNameList" :npc-data="npcDataList" /></div>
          <div class="streaming-meta">
            <span class="elapsed-time">{{ (generationElapsedMs / 1000).toFixed(1) }}s</span>
            <span v-if="streamingText.length > 0" class="char-count">· {{ streamingText.length }}字</span>
          </div>
          <div class="typing-indicator" aria-label="AI 正在输入">
            <span class="typing-dot" />
            <span class="typing-dot" />
            <span class="typing-dot" />
          </div>
        </div>
      </div>
      </div>

      <!--
        Scroll-to-bottom floating button —— 聊天类应用常见的"跳到最新"按钮。
        只在用户往上滚超过 30px 阈值后出现；点击瞬时跳到底部（不走 smooth 动画）。
        放在 messages-area 内部、messages-container 外部，position: absolute
        贴在 messages-container 可视区域的右下角。
      -->
      <Transition name="fade-scale">
        <button
          v-if="isUserScrolledUp"
          class="scroll-to-bottom-btn"
          aria-label="滚动到最新消息"
          title="跳到最新消息"
          @click="scrollToBottom(true)"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v10.586l3.293-3.293a1 1 0 111.414 1.414l-5 5a1 1 0 01-1.414 0l-5-5a1 1 0 011.414-1.414L9 14.586V4a1 1 0 011-1z" clip-rule="evenodd" />
          </svg>
        </button>
      </Transition>
    </div>

    <!--
      Action options — displayed after the AI response.
      Each option is a clickable button that sends the text as user input.
      Hidden during generation to prevent premature interaction.
      Includes a collapse toggle so long option lists don't dominate the viewport.
    -->
    <div
      v-if="actionOptions.length > 0 && !isGenerating"
      :class="['action-options', { 'action-options--collapsed': actionOptionsCollapsed }]"
    >
      <button
        class="action-options__toggle"
        :aria-expanded="!actionOptionsCollapsed"
        :aria-label="actionOptionsCollapsed ? '展开行动选项' : '收起行动选项'"
        :title="actionOptionsCollapsed ? '展开行动选项' : '收起行动选项'"
        @click="toggleActionOptionsCollapsed"
      >
        <span class="action-options__hint">
          {{ actionOptionsCollapsed ? `${actionOptions.length} 个行动选项` : '行动选项' }}
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
          v-for="(option, idx) in actionOptions"
          :key="idx"
          class="action-option-row"
        >
          <button
            class="action-copy"
            title="复制文本"
            @click.stop="copyText(option)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/></svg>
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

    <!-- Input area -->
    <div class="input-area">
      <!-- Cancel button visible during generation -->
      <button
        v-if="isGenerating"
        class="cancel-btn"
        @click="cancelGeneration"
        aria-label="取消生成"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        取消
      </button>

      <div class="input-row">
        <!--
          Rollback button: reverts to the start of the previous round.
          Disabled if no snapshot is available or AI is generating.
        -->
        <button
          class="rollback-btn"
          :disabled="!canRollback"
          :title="canRollback ? '回滚到上回合' : '暂无可用快照'"
          aria-label="回滚到上回合"
          @click="showRollbackConfirm = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>

        <textarea
          ref="textareaRef"
          v-model="userInput"
          class="message-input"
          placeholder="输入你的行动…"
          rows="1"
          :disabled="isGenerating"
          @keydown="onKeydown"
          @input="autoResizeTextarea"
        />
        <button
          class="send-btn"
          :disabled="!canSend"
          @click="sendMessage"
          aria-label="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>

    <!-- ── Rollback confirmation modal ── -->
    <Modal v-model="showRollbackConfirm" title="确认回滚">
      <p class="modal-body-text">确定要回滚到上一回合开始前的状态吗？当前回合的所有变化（包括 AI 叙事和状态变更）将被撤销。</p>
      <div class="modal-actions">
        <button class="modal-btn modal-btn--cancel" @click="showRollbackConfirm = false">取消</button>
        <button class="modal-btn modal-btn--confirm" @click="handleRollback">确认回滚</button>
      </div>
    </Modal>

    <!-- ── Phase 3 per-round viewers (2026-04-19) ── -->
    <ThinkingViewer
      v-model="showThinkingViewer"
      :text="activeThinking?.text ?? ''"
      :round-number="activeThinking?.roundNumber ?? 0"
    />
    <CommandsViewer
      v-model="showCommandsViewer"
      :commands="(activeCommandsPayload?.commands ?? []) as any"
      :delta="activeCommandsPayload?.delta ?? []"
      :round-number="activeCommandsPayload?.roundNumber ?? 0"
      :initial-tab="activeCommandsPayload?.initialTab ?? 'commands'"
    />
    <RawResponseViewer
      v-model="showRawViewer"
      :step1="activeRaw?.step1 ?? ''"
      :step2="activeRaw?.step2 ?? ''"
      :round-number="activeRaw?.roundNumber ?? 0"
    />
  </div>
</template>

<style scoped>
/*
 * MainGamePanel — sanctuary migration (2026-04-21)
 *
 * Template + script untouched. Only `<style scoped>` rewritten to match
 * .impeccable.md direction: narrative becomes the light source (serif
 * letter, no bubble chrome), sage + amber beacons only, warm-rust for
 * cancel, full-border judgement cards in FormattedText (no 3px stripe).
 *
 * Preserved: sidebar-reserve dynamic-padding pattern on every full-width
 * bar (see memory project_sidebar_reserve_pattern).
 */
.main-game-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
  overflow: hidden;
}

/* ── Messages area wrapper ──────────────────────────────────────
 * Wrapper around messages-container so we can anchor the floating
 * scroll-to-bottom button at its bottom-right without putting the button
 * inside the scroll container (would make the button scroll with content). */
.messages-area {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* ── Scroll-to-bottom floating button ──────────────────────────
 * Frosted cabin-glass pill. Right anchor follows the sidebar-reserve
 * so the button clears the right-side droplet when it expands. */
.scroll-to-bottom-btn {
  position: absolute;
  right: calc(var(--sidebar-right-reserve, 40px) + 8px);
  bottom: 1rem;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 50%;
  background: color-mix(in oklch, var(--color-surface-elevated) 80%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  transition: right var(--duration-open) var(--ease-droplet),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.scroll-to-bottom-btn:hover {
  color: var(--color-sage-300);
  border-color: color-mix(in oklch, var(--color-sage-400) 40%, transparent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md),
              0 0 14px color-mix(in oklch, var(--color-sage-400) 22%, transparent);
}

.scroll-to-bottom-btn:focus-visible {
  outline: 2px solid var(--color-sage-400);
  outline-offset: 2px;
}

/* 进入/离开动画：淡入 + 轻微缩放 —— 保留现有行为，只在 opacity 上生效，
   不再触发平移动画（保持 sanctuary 的安静感）。*/
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out),
              transform var(--duration-normal) var(--ease-out);
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* ── Status bar ─────────────────────────────────────────────── */

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* Dynamic horizontal padding — sidebar-reserve pattern (shipped 2026-04-20). */
  padding: 0.4rem var(--sidebar-right-reserve, 40px) 0.4rem var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface);
  flex-shrink: 0;
  min-height: 36px;
  gap: 0.75rem;
}

.status-bar__left,
.status-bar__right {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.status-bar__right {
  flex-shrink: 0;
}

.round-counter {
  font-family: var(--font-serif-cjk);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text);
  letter-spacing: 0.08em;
  flex-shrink: 0;
}

.status-generating {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  color: var(--color-sage-300);
  letter-spacing: 0.04em;
}
.status-generating::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-sage-400);
  animation: sage-pulse var(--duration-breath) var(--ease-out) infinite;
}
@keyframes sage-pulse {
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.15); }
}

/* ── Messages container — the reading column ─────────────────── */

.messages-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  /* Dynamic horizontal padding — sidebar-reserve pattern. Vertical 1rem
     preserved so prose breathes above/below chrome bars. */
  padding: 1rem var(--sidebar-right-reserve, 40px) 1rem var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-height: 0;
  scroll-behavior: smooth;
}
/* No `::-webkit-scrollbar` overrides here — the global sanctuary scrollbar
   in tokens.css handles every scrollable surface consistently. */

/* ── Empty chat state ────────────────────────────────────────── */

.empty-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 3.5rem 1.25rem;
}

.empty-text {
  font-family: var(--font-serif-cjk);
  font-size: 0.95rem;
  color: var(--color-text-umber);
  letter-spacing: 0.08em;
  text-align: center;
}

/* ── Message bubbles ──────────────────────────────────────────
 * User  = a tucked-in note on the right (warm surface, sage hint)
 * AI    = pure letter, no bubble chrome (narrative is light source,
 *         per Polanyi principle + .impeccable.md "narrative is the
 *         light source")
 * Streaming = same letter form, plus a soft sage top glyph that
 *             breathes while the AI is generating. No colored
 *             side-stripe (absolute ban). */
.message {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.message--user {
  align-self: flex-end;
  max-width: 68%;
}

.message--assistant {
  align-self: stretch;
  max-width: 100%;
}

.message-bubble {
  font-size: 0.88rem;
  line-height: 1.7;
  word-break: break-word;
}

.message--user .message-bubble {
  padding: 0.6rem 0.9rem;
  border-radius: 14px 14px 4px 14px;
  background: color-mix(in oklch, var(--color-sage-400) 10%, var(--color-surface-elevated));
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 22%, var(--color-border));
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.85rem;
}

.message--assistant .message-bubble {
  padding: 0.25rem 0 0.125rem;
  border-radius: 0;
  background: transparent;
  border: none;
  color: var(--color-text);
  font-family: var(--font-serif-cjk);
  font-size: 0.98rem;
  line-height: var(--narrative-line-height);
  letter-spacing: var(--narrative-letter-spacing);
}

/* Streaming state — a soft sage top-left glyph breathing while the
   AI generates. Replaces the old `border-left: dashed primary` which
   both read as indigo + violated the "no colored side-stripes" rule. */
.message--streaming .message-bubble {
  position: relative;
}
.message--streaming .message-bubble::before {
  content: '';
  position: absolute;
  left: 0;
  top: -2px;
  width: 22px;
  height: 2px;
  background: linear-gradient(90deg,
    color-mix(in oklch, var(--color-sage-400) 70%, transparent),
    transparent);
  border-radius: var(--radius-full);
  animation: sage-pulse var(--duration-breath) var(--ease-out) infinite;
}

/* Per-turn meta row (Phase 3): hover-reveal footer below assistant
   bubbles. Kept at opacity 0 so the narrative stays the focal point;
   parent `.message--assistant` hover fades it in. */
.message-meta-bottom {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-md);
  margin-top: var(--space-xs);
  padding: 0 var(--space-xs);
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-out);
  font-size: 10.5px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.message--assistant:hover .message-meta-bottom {
  opacity: 0.85;
  pointer-events: auto;
}

.message-meta-bottom__chars {
  flex-shrink: 0;
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}

.message-meta-bottom__preview {
  flex: 1;
  min-width: 0;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

.message-text {
  font-size: inherit;
  white-space: pre-wrap;
}

/* User plain-text path (2026-04-11 fix kept intact) — just the
   word-break override; font-family comes from the parent user bubble. */
.message-text--plain {
  word-break: break-word;
}

/* ── Typing indicator — three sage dots breathing ──────────────
   Bounce was replaced with vertical breath + opacity, slowed to the
   sanctuary --duration-breath tempo. Each dot has a faint sage halo
   so they glow like instrument LEDs, not Tailwind primaries. */
.typing-indicator {
  display: inline-flex;
  gap: 4px;
  padding-top: 0.375rem;
  align-items: center;
}

.typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-sage-400);
  animation: typing-breath var(--duration-breath) var(--ease-out) infinite;
  box-shadow: 0 0 6px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
}

.typing-dot:nth-child(2) { animation-delay: 220ms; }
.typing-dot:nth-child(3) { animation-delay: 440ms; }

@keyframes typing-breath {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50%      { opacity: 1;    transform: translateY(-3px); }
}

/* ── Action options ─────────────────────────────────────────── */

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
              box-shadow var(--duration-fast) var(--ease-out);
  white-space: normal;
  word-break: break-word;
  text-align: left;
  max-width: 100%;
  letter-spacing: 0.02em;
}

.action-btn:hover {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 8%, var(--color-surface-elevated));
  color: var(--color-sage-100);
  box-shadow: 0 0 14px color-mix(in oklch, var(--color-sage-400) 18%, transparent);
}
.action-btn--selected {
  border-color: color-mix(in oklch, var(--color-sage-400) 55%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 14%, var(--color-surface-elevated));
  color: var(--color-sage-100);
  font-weight: 500;
}

/* ── Input area ─────────────────────────────────────────────── */

.input-area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* Dynamic horizontal padding — sidebar-reserve pattern. */
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
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.message-input {
  flex: 1;
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
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 12%, transparent);
}

.message-input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Send button — sage beacon outline, not a filled primary block.
   Accents are beacons, not buttons: the send icon glows softly when
   enabled, fills with sage-muted on hover. Never #fff on sage. */
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
  background: var(--color-sage-muted);
  border-color: var(--color-sage-400);
  box-shadow: 0 0 16px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ── Streaming meta (elapsed time + char count) ────────────── */

.streaming-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.elapsed-time {
  font-variant-numeric: tabular-nums;
}

/* Prose char count — no extra font-family override; inherits --font-mono
   from .streaming-meta. */

/* ── Delta badge — sage pill, no indigo ─────────────────────── */

.delta-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 8px;
  padding: 2px 10px;
  background: var(--color-sage-muted);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 28%, transparent);
  border-radius: var(--radius-full);
  font-family: var(--font-sans);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--color-sage-300);
  cursor: pointer;
  line-height: 1.4;
  transition: color var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.delta-badge:hover {
  color: var(--color-sage-100);
  background: color-mix(in oklch, var(--color-sage-400) 22%, transparent);
  box-shadow: 0 0 14px color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* ── Rollback button — amber hover (warmth = confirm-intent cue) ── */

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
  background: color-mix(in oklch, var(--color-amber-400) 6%, transparent);
}

.rollback-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Modal content (rollback confirm) ───────────────────────── */

.modal-body-text {
  font-family: var(--font-serif-cjk);
  font-size: 0.92rem;
  color: var(--color-text);
  line-height: 1.85;
  margin-bottom: 1.25rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.modal-btn {
  padding: 0.44rem 1rem;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.modal-btn--cancel {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.modal-btn--cancel:hover {
  background: color-mix(in oklch, var(--color-text) 4%, transparent);
  color: var(--color-text);
}

.modal-btn--confirm {
  background: color-mix(in oklch, var(--color-danger) 14%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 45%, transparent);
  color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
}

.modal-btn--confirm:hover {
  background: color-mix(in oklch, var(--color-danger) 22%, transparent);
  border-color: color-mix(in oklch, var(--color-danger) 60%, transparent);
}

/* ── Responsive ─────────────────────────────────────────────── */

@media (max-width: 640px) {
  .messages-container {
    padding: 0.75rem;
  }

  .message--user {
    max-width: 82%;
  }

  .input-area {
    padding: 0.5rem 0.75rem;
  }

  .action-options__toggle,
  .action-options__list {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
}
</style>
