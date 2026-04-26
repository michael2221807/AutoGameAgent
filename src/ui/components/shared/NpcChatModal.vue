<script setup lang="ts">
/**
 * NpcChatModal — NPC 私聊对话窗口（§7.2）
 *
 * 独立于主回合的 1:1 聊天界面。样式参考 `MainGamePanel` 的 bubble 设计。
 *
 * 设计 intent 见 `H:\ming\docs\design note` 第五节：
 * - 与主故事异步进行
 * - UI 在 NPC 页面与其对话，通过 llm 处理
 * - 仅改变此 NPC 的信息
 * - 需要更新 NPC 的记忆让 NPC 在主线中能记得
 *
 * 本组件本身不处理 AI 调用 — 它只负责渲染消息和调用注入的 `npcChatPipeline`。
 * 所有消息历史从状态树 `社交.关系[].私聊历史` 读取（通过 useGameState），
 * pipeline 负责 append 新消息和调 AI；本组件只等待 `chat()` 返回并刷新。
 *
 * Props:
 *   - modelValue: 控制 modal 显示（v-model）
 *   - npc: 目标 NPC 对象（包含 名称/类型/好感度/描述 等字段）
 */
import { ref, computed, watch, nextTick, inject } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';
import FormattedText from '@/ui/components/common/FormattedText.vue';
import type { NpcChatPipeline, NpcChatMessage } from '@/engine/pipeline/sub-pipelines/npc-chat';

interface NpcForChat {
  名称: string;
  类型?: string;
  好感度?: number;
  位置?: string;
  描述?: string;
  私聊历史?: NpcChatMessage[];
  [key: string]: unknown;
}

const props = defineProps<{
  modelValue: boolean;
  npc: NpcForChat | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const npcChatPipeline = inject<NpcChatPipeline | null>('npcChatPipeline', null);
const { useValue } = useGameState();

// ─── 响应式读取 NPC 私聊历史 ─────────────────────────────────
//
// 我们不在组件内独立存储消息 — 直接从状态树读。
// pipeline.chat() 调用会 setValue 更新整个 关系 数组 → Pinia reactive 触发 computed 重算 → UI 自动刷新。
const relationships = useValue<NpcForChat[]>(DEFAULT_ENGINE_PATHS.relationships);

const currentNpc = computed<NpcForChat | null>(() => {
  if (!props.npc) return null;
  const list = Array.isArray(relationships.value) ? relationships.value : [];
  return list.find((n) => n.名称 === props.npc!.名称) ?? props.npc;
});

/**
 * CR-R16 (2026-04-11)：目标 NPC 从关系数组中消失时自动关闭本 modal。
 *
 * 触发场景：
 * - 主回合 AI 指令把该 NPC 删除（`社交.关系` 数组 splice）
 * - 玩家在其他面板手动删除该 NPC
 * - NPC 名称被 rename（触发的 find 失败）
 *
 * 不直接用 `currentNpc.value === null` 因为 currentNpc 有 fallback 到 props.npc，
 * 只有当 list 已加载但 find 返回 undefined 时才算"真的被删除"。
 */
watch(
  () => {
    if (!props.modelValue || !props.npc) return false;
    const list = Array.isArray(relationships.value) ? relationships.value : [];
    // relationships 尚未就绪时不算被删除
    if (!Array.isArray(relationships.value)) return false;
    return !list.some((n) => n.名称 === props.npc!.名称);
  },
  (deleted) => {
    if (!deleted) return;
    eventBus.emit('ui:toast', {
      type: 'warning',
      message: `NPC「${props.npc?.名称 ?? ''}」已不存在，自动关闭私聊`,
      duration: 2500,
    });
    emit('update:modelValue', false);
  },
);

const chatHistory = computed<NpcChatMessage[]>(() => {
  const history = currentNpc.value?.私聊历史;
  return Array.isArray(history) ? history : [];
});

// ─── 输入与发送状态 ──────────────────────────────────────────

const userInput = ref('');
const isSending = ref(false);
const errorMsg = ref<string | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);

/**
 * CR-R14 (2026-04-11)：流式逐字显示状态
 *
 * 发送时 pipeline.chat() 启用流式，每收到 chunk 都追加到 `streamingText`。
 * UI 在 pending 气泡里渲染 streamingText（使用 FormattedText）以实现
 * 和 MainGamePanel 一致的打字机体验。
 *
 * 响应完成后 pipeline 会把最终完整文本 append 到状态树的 `私聊历史`，
 * chatHistory computed 自动刷新，此时我们清空 streamingText 避免双重显示。
 *
 * 和主回合流式的区别：
 * - 主回合走 eventBus:ai:stream-chunk（全局 PipelineRunner 发射）
 * - NpcChat 走 per-call 的 onStreamChunk 回调（pipeline 不上总线 — 私聊是侧线流）
 */
const streamingText = ref('');

function close(): void {
  emit('update:modelValue', false);
  // 不清空 userInput — 用户可能只是切 tab 再回来
  errorMsg.value = null;
}

async function sendMessage(): Promise<void> {
  const text = userInput.value.trim();
  if (!text) return;
  if (isSending.value) return;

  if (!npcChatPipeline) {
    eventBus.emit('ui:toast', {
      type: 'error',
      message: 'NPC 私聊管线未就绪',
      duration: 2000,
    });
    return;
  }

  if (!props.npc) return;

  isSending.value = true;
  errorMsg.value = null;
  streamingText.value = '';
  // 清空 input — 消息文本会立即通过 pipeline append 到状态树并反映在 UI 上
  userInput.value = '';

  try {
    // CR-R14: 传入 onStreamChunk 让 pipeline 走流式；每收到 chunk 就追加到
    // streamingText 并滚到底部。pipeline 响应完成后把最终文本 append 到
    // 状态树的 `私聊历史`，此时 chatHistory computed 触发重算，我们清空
    // streamingText 避免"最终气泡 + 流式气泡"重复显示同一段文字。
    const handleChunk = (chunk: string): void => {
      streamingText.value += chunk;
      void nextTick().then(scrollToBottom);
    };

    const result = await npcChatPipeline.chat(props.npc.名称, text, handleChunk);
    if (!result.success) {
      errorMsg.value = result.error ?? 'AI 调用失败';
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    isSending.value = false;
    streamingText.value = '';
    // 等待 DOM 更新后滚到底部
    await nextTick();
    scrollToBottom();
  }
}

// ─── 滚动管理 ────────────────────────────────────────────────

function scrollToBottom(): void {
  const el = messagesContainer.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

// 打开 modal / 切换 NPC / 收到新消息 → 滚到底部
watch(
  () => [props.modelValue, props.npc?.名称, chatHistory.value.length],
  async () => {
    if (props.modelValue) {
      await nextTick();
      scrollToBottom();
    }
  },
  { immediate: true },
);

// ─── Enter 发送 ──────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  // Shift+Enter: 换行（textarea 原生处理）
  // Enter: 发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void sendMessage();
  }
}

// ─── 辅助：格式化时间戳 ───────────────────────────────────────

/**
 * CR-R28 (2026-04-11)：date-aware timestamp
 *
 * 旧实现只显示 HH:mm，同一时间在不同日子产生的消息看起来一样。
 * 新规则：
 *   - 今天        → "HH:mm"
 *   - 昨天        → "昨天 HH:mm"
 *   - 同一年其他  → "M月D日 HH:mm"
 *   - 更早        → "YYYY-M-D HH:mm"
 *
 * 使用本地时区；比较按"年月日"粒度而非毫秒差。
 */
function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const hhmm = `${hh}:${mm}`;

  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, now)) return hhmm;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${hhmm}`;

  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
  }
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${hhmm}`;
}

// ─── 辅助：好感度颜色 ────────────────────────────────────────

function affinityColor(value: number | undefined): string {
  const v = typeof value === 'number' ? value : 50;
  if (v <= 30) return 'var(--color-danger, #ef4444)';
  if (v <= 60) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-success, #22c55e)';
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue && npc" class="npc-chat-overlay" @click.self="close">
        <div class="npc-chat-modal" role="dialog" aria-labelledby="npc-chat-title">
          <!-- ─── Header ─── -->
          <header class="chat-header">
            <div class="npc-avatar">{{ npc.名称.charAt(0) }}</div>
            <div class="header-info">
              <h3 id="npc-chat-title" class="npc-name">与 {{ npc.名称 }} 私聊</h3>
              <div class="npc-meta">
                <span v-if="npc.类型" class="meta-chip">{{ npc.类型 }}</span>
                <span v-if="npc.位置" class="meta-location">📍 {{ npc.位置 }}</span>
                <span
                  v-if="typeof currentNpc?.好感度 === 'number'"
                  class="meta-affinity"
                  :style="{ color: affinityColor(currentNpc.好感度) }"
                >
                  ♡ {{ currentNpc.好感度 }}
                </span>
              </div>
            </div>
            <button class="btn-close" @click="close" aria-label="关闭">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <!-- ─── Message list ─── -->
          <div ref="messagesContainer" class="chat-messages">
            <div v-if="chatHistory.length === 0" class="chat-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>还没有对话 — 输入点什么开始吧</p>
            </div>

            <div
              v-for="(msg, idx) in chatHistory"
              :key="idx"
              :class="['chat-message', msg.role === 'user' ? 'chat-message--user' : 'chat-message--npc']"
            >
              <div class="chat-bubble">
                <FormattedText :text="msg.content" />
              </div>
              <span class="chat-timestamp">{{ formatTimestamp(msg.timestamp) }}</span>
            </div>

            <!-- CR-R14: 流式气泡 — 有 chunk 时显示 streamingText，否则显示 loading dots -->
            <div v-if="isSending" class="chat-message chat-message--npc">
              <div v-if="streamingText" class="chat-bubble">
                <FormattedText :text="streamingText" />
              </div>
              <div v-else class="chat-bubble chat-bubble--loading">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          </div>

          <!-- ─── Error banner ─── -->
          <Transition name="slide">
            <div v-if="errorMsg" class="chat-error" role="alert">
              <span>{{ errorMsg }}</span>
              <button class="btn-error-dismiss" @click="errorMsg = null" aria-label="关闭错误提示">&times;</button>
            </div>
          </Transition>

          <!-- ─── Input area ─── -->
          <footer class="chat-input-area">
            <textarea
              v-model="userInput"
              class="chat-textarea"
              :placeholder="`对 ${npc.名称} 说点什么…（Enter 发送，Shift+Enter 换行）`"
              rows="2"
              :disabled="isSending"
              @keydown="onKeydown"
            />
            <button
              class="btn-send"
              :disabled="!userInput.trim() || isSending"
              @click="sendMessage"
            >
              {{ isSending ? '发送中…' : '发送' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ── */
.npc-chat-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--glass-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  backdrop-filter: var(--glass-overlay-blur);
  -webkit-backdrop-filter: var(--glass-overlay-blur);
}

/* ── Modal container ── */
.npc-chat-modal {
  width: 100%;
  max-width: 560px;
  height: 100%;
  max-height: 720px;
  background: var(--glass-bg);
  border: none;
  border-radius: 12px;
  box-shadow: var(--glass-shadow);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.chat-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--color-surface, #1c1c28);
  border-bottom: 1px solid var(--color-border, #2a2a3a);
}

.npc-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 25%, transparent);
  font-weight: 700;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.header-info {
  flex: 1;
  min-width: 0;
}

.npc-name {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.npc-meta {
  display: flex;
  gap: 10px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  align-items: center;
  flex-wrap: wrap;
}

.meta-chip {
  padding: 1px 8px;
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  color: var(--color-sage-400);
  border-radius: 10px;
  font-weight: 600;
}

.meta-location {
  opacity: 0.85;
}

.meta-affinity {
  font-weight: 600;
}

.btn-close {
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.btn-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text, #e0e0e6);
  border-color: var(--color-border, #2a2a3a);
}

/* ── Messages area ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-messages::-webkit-scrollbar { width: 6px; }
.chat-messages::-webkit-scrollbar-track { background: transparent; }
.chat-messages::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--color-text-umber) 35%, transparent);
  border-radius: 3px;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
  font-size: 0.85rem;
}

/* ── Message bubbles ── */
.chat-message {
  display: flex;
  flex-direction: column;
  max-width: 78%;
  gap: 2px;
}
.chat-message--user {
  align-self: flex-end;
  align-items: flex-end;
}
.chat-message--npc {
  align-self: flex-start;
  align-items: flex-start;
}

.chat-bubble {
  padding: 9px 13px;
  border-radius: 14px;
  line-height: 1.6;
  word-break: break-word;
  font-size: 0.88rem;
}

.chat-message--user .chat-bubble {
  background: color-mix(in oklch, var(--color-sage-400) 16%, var(--color-surface));
  color: var(--color-text-bone);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-bottom-right-radius: 4px;
}

.chat-message--npc .chat-bubble {
  background: var(--color-surface, #1c1c28);
  border: 1px solid var(--color-border, #2a2a3a);
  color: var(--color-text, #e0e0e6);
  border-bottom-left-radius: 4px;
}

.chat-timestamp {
  font-size: 0.65rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
  padding: 0 4px;
}

/* ── Typing indicator ── */
.chat-bubble--loading {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 11px 14px;
}
.chat-bubble--loading .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-secondary, #8888a0);
  animation: bounce 1.2s infinite;
}
.chat-bubble--loading .dot:nth-child(2) { animation-delay: 0.15s; }
.chat-bubble--loading .dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* ── Error banner ── */
.chat-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(239, 68, 68, 0.12);
  border-top: 1px solid var(--color-danger, #ef4444);
  color: var(--color-danger, #ef4444);
  font-size: 0.78rem;
}
.chat-error span { flex: 1; }
.btn-error-dismiss {
  background: transparent;
  border: none;
  color: var(--color-danger, #ef4444);
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0 4px;
}

/* ── Input area ── */
.chat-input-area {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-surface, #1c1c28);
  border-top: 1px solid var(--color-border, #2a2a3a);
  align-items: flex-end;
}

.chat-textarea {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  padding: 10px 12px;
  background: var(--color-bg, #17171f);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  color: var(--color-text, #e0e0e6);
  font-size: 0.88rem;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s ease;
}
.chat-textarea:focus {
  border-color: var(--color-sage-400);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 20%, transparent);
}
.chat-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-send {
  padding: 10px 18px;
  background: color-mix(in oklch, var(--color-sage-400) 18%, transparent);
  color: var(--color-sage-100);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent);
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.btn-send:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-sage-400) 28%, transparent);
  box-shadow: 0 0 12px color-mix(in oklch, var(--color-sage-400) 20%, transparent);
}
.btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.fade-enter-active .npc-chat-modal, .fade-leave-active .npc-chat-modal {
  transition: transform 0.2s ease;
}
.fade-enter-from .npc-chat-modal {
  transform: scale(0.96);
}

.slide-enter-active, .slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from, .slide-leave-to {
  opacity: 0;
  max-height: 0;
}

/* ── Responsive ── */
@media (max-width: 600px) {
  .npc-chat-overlay { padding: 0; }
  .npc-chat-modal {
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
}
</style>
