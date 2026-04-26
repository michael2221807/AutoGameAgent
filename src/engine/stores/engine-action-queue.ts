import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { QueuedAction } from '../types';

/**
 * Action queue store — player panel operations (equip, use, discard, etc.)
 * are queued here and consumed by the PreProcessStage on the next AI round.
 *
 * 结构上与 `IActionQueueConsumer`（pipeline/types）一致：`consumeActions(): QueuedAction[]`。
 * PreProcessStage 内再 `formatActions`，避免在 store 中硬编码面向 AI 的文案。
 */
export const useActionQueueStore = defineStore('actionQueue', () => {
  const actions = ref<QueuedAction[]>([]);

  function addAction(action: QueuedAction): void {
    actions.value.push(action);
    persistToLocalStorage();
  }

  /**
   * Consume all queued actions, returning structured data, then clear.
   * Formatting into prompt text is deferred to the PromptAssembler/caller
   * to maintain engine/content separation (no hardcoded locale strings).
   */
  function consumeActions(): QueuedAction[] {
    if (actions.value.length === 0) return [];
    const consumed = [...actions.value];
    actions.value = [];
    persistToLocalStorage();
    return consumed;
  }

  function clear(): void {
    actions.value = [];
    persistToLocalStorage();
  }

  function loadFromLocalStorage(): void {
    try {
      const saved = localStorage.getItem('aga_action_queue');
      if (saved) {
        const parsed = JSON.parse(saved) as QueuedAction[];
        const oneHourAgo = Date.now() - 3_600_000;
        actions.value = parsed.filter(a => a.createdAt > oneHourAgo);
      }
    } catch { /* ignore corrupt data */ }
  }

  function persistToLocalStorage(): void {
    localStorage.setItem('aga_action_queue', JSON.stringify(actions.value));
  }

  return { actions, addAction, consumeActions, clear, loadFromLocalStorage };
});
