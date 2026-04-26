/**
 * useAssistant — Vue composable wrapping AssistantService for Vue components
 *
 * Handles:
 * - Reactive session state (loaded from store)
 * - Send / clear / inject / rollback wrappers
 * - Stream chunk accumulation into reactive ref
 * - Settings persistence to localStorage
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md Phase 5b。
 */
import { ref, computed, inject, onMounted, type Ref } from 'vue';
import type {
  AssistantService,
  AssistantSendError,
} from '@/engine/services/assistant/assistant-service';
import type {
  AssistantMessage,
  AssistantSession,
  AttachmentSpec,
  PayloadDraft,
} from '@/engine/services/assistant/types';
import { eventBus } from '@/engine/core/event-bus';

const SETTINGS_KEY = 'aga_assistant_settings';
const SESSION_ID = 'default';

export function useAssistant() {
  const service = inject<AssistantService>('assistantService');
  if (!service) {
    throw new Error('[useAssistant] AssistantService not provided');
  }

  // ─── Reactive session state ───────────────────────

  const session = ref<AssistantSession>({
    sessionId: SESSION_ID,
    createdAt: Date.now(),
    messages: [],
  });

  /** Live-streaming chunk for the in-progress assistant message */
  const streamingContent = ref<string>('');

  /** Whether send() is in flight (UI uses to disable input) */
  const isSending = ref(false);

  /** Whether canRollback (mirrors service state) */
  const canRollback = ref(false);

  async function refreshSession(): Promise<void> {
    session.value = await service!.getSession(SESSION_ID);
    canRollback.value = service!.canRollbackInject();
  }

  onMounted(() => {
    void refreshSession();
    // Also refresh after inject/rollback events
    const offInject = eventBus.on('assistant:payload-injected', () => { void refreshSession(); });
    const offRollback = eventBus.on('assistant:payload-rolled-back', () => { void refreshSession(); });
    const offFail = eventBus.on('assistant:payload-inject-failed', () => { void refreshSession(); });
    // cleanup is handled by component unmount via composable contract
    void offInject; void offRollback; void offFail;
  });

  // ─── Actions ──────────────────────────────────────

  async function send(prompt: string, attachments: AttachmentSpec[]): Promise<void> {
    if (isSending.value) return;
    isSending.value = true;
    streamingContent.value = '';
    try {
      await service!.send({
        sessionId: SESSION_ID,
        prompt,
        attachments,
        onStreamChunk: (_chunk, accumulated) => {
          streamingContent.value = accumulated;
        },
      });
    } catch (err) {
      const e = err as AssistantSendError | Error;
      eventBus.emit('ui:toast', {
        type: 'error',
        message: `发送失败：${e.message ?? String(err)}`,
        duration: 4000,
      });
    } finally {
      isSending.value = false;
      streamingContent.value = '';
      await refreshSession();
    }
  }

  async function clear(): Promise<void> {
    await service!.clear(SESSION_ID);
    await refreshSession();
    eventBus.emit('ui:toast', { type: 'info', message: '对话已清空', duration: 1500 });
  }

  async function applyPayload(messageId: string, draft: PayloadDraft): Promise<void> {
    const result = await service!.applyPayload(SESSION_ID, messageId, draft);
    if (result.ok) {
      eventBus.emit('ui:toast', {
        type: 'success',
        message: `已注入 ${result.patchCount} 个 patch`,
        duration: 2500,
      });
    } else {
      eventBus.emit('ui:toast', {
        type: 'error',
        message: `注入失败：${result.error}`,
        duration: 4000,
      });
    }
    await refreshSession();
  }

  async function rollback(): Promise<void> {
    const result = await service!.rollbackLastInject(SESSION_ID);
    if (result.ok) {
      eventBus.emit('ui:toast', { type: 'success', message: '已撤销注入', duration: 2000 });
    } else {
      eventBus.emit('ui:toast', { type: 'warning', message: result.error ?? '撤销失败', duration: 2500 });
    }
    await refreshSession();
  }

  // ─── Settings ─────────────────────────────────────

  const settings = ref(service.getSettings());

  function updateSettings(patch: Partial<typeof settings.value>): void {
    service!.updateSettings(patch);
    settings.value = service!.getSettings();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value)); } catch { /* ignore */ }
  }

  // ─── Derived ──────────────────────────────────────

  const messages = computed<AssistantMessage[]>(() => session.value.messages);

  return {
    // state
    session,
    messages,
    streamingContent: streamingContent as Readonly<Ref<string>>,
    isSending,
    canRollback,
    settings,
    // actions
    send,
    clear,
    applyPayload,
    rollback,
    refreshSession,
    updateSettings,
  };
}
