/**
 * Prompt 调试 Pinia Store — 记录最近 N 次 prompt 组装的快照（环形缓冲）
 *
 * B.5 扩展：
 * - snapshots 数组保留最近 10 次，activeSnapshotIndex 指向当前查看的快照
 * - 向后兼容：lastAssembledMessages / lastVariables / lastFlowId 指向最新快照
 *
 * 2026-04-14 扩展：快照新增 `messageSources`（平行数组，每条消息的出处标签），
 * 供 PromptAssemblyPanel 显示"这条消息来自哪"。
 *
 * 对应 STEP-03B M2.7 engine-prompt.ts。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AIMessage } from '../ai/types';
import type { MessageSourceTag } from '../prompt/prompt-assembler';

const MAX_SNAPSHOTS = 10;

export interface PromptSnapshot {
  flowId: string;
  messages: AIMessage[];
  /**
   * 每条消息的来源标签（平行数组，长度与 messages 一致）
   * - `module:<promptId>` —— 来自 prompt flow 中的模块
   * - `history:user` / `history:assistant` —— 来自 narrativeHistory 的对话轮次
   * - `current_input` —— 当前回合用户输入
   * - `placeholder` —— Gemini 兜底占位
   * 2026-04-14 新增，旧快照可能为 undefined（向后兼容）
   */
  messageSources?: MessageSourceTag[];
  variables: Record<string, string>;
  capturedAt: string; // ISO timestamp
  roundNumber?: number;
  /**
   * Correlation id matching the AI request that consumed this assembly.
   * Used by `attachResponse` to locate the snapshot when the response
   * (thinking / raw text) arrives asynchronously.
   */
  generationId?: string;
  /**
   * CoT thinking text extracted from the AI response. Populated when the
   * call completes via `attachResponse`. Undefined before the call returns
   * OR when the flow doesn't emit thinking (non-CoT models / streaming
   * sub-pipelines that don't re-emit).
   */
  thinking?: string;
  /**
   * Raw AI response string (before structured parsing). Useful for debugging
   * parser failures — lets the UI show exactly what the backend returned.
   */
  rawResponse?: string;
}

export const usePromptDebugStore = defineStore('promptDebug', () => {
  /** Ring buffer of recent assembly snapshots (newest-first) */
  const snapshots = ref<PromptSnapshot[]>([]);
  /** Index into snapshots for the panel tab view */
  const activeSnapshotIndex = ref(0);

  /** 向后兼容 — 指向最新快照（或空值） */
  const lastAssembledMessages = computed<AIMessage[]>(() => snapshots.value[0]?.messages ?? []);
  const lastVariables = computed<Record<string, string>>(() => snapshots.value[0]?.variables ?? {});
  const lastFlowId = computed<string>(() => snapshots.value[0]?.flowId ?? '');

  /**
   * 记录一次组装结果（由 ContextAssemblyStage / 子管线调用）
   *
   * 2026-04-14：新增可选 `messageSources` 参数（平行数组）。
   * 旧调用点（子管线）未传则不记录 source，UI 显示 "—"。
   * 2026-04-19：新增可选 `generationId` 参数——对应 AI 请求的 correlation id，
   * 用于后续 `attachResponse` 定位并回填 thinking / rawResponse。
   */
  function recordAssembly(
    flowId: string,
    messages: AIMessage[],
    variables: Record<string, string>,
    roundNumber?: number,
    messageSources?: MessageSourceTag[],
    generationId?: string,
  ): void {
    const snapshot: PromptSnapshot = {
      flowId,
      messages: [...messages],
      messageSources: messageSources ? [...messageSources] : undefined,
      variables: { ...variables },
      capturedAt: new Date().toISOString(),
      roundNumber,
      generationId,
    };
    // Prepend + trim to MAX_SNAPSHOTS
    snapshots.value = [snapshot, ...snapshots.value].slice(0, MAX_SNAPSHOTS);
    activeSnapshotIndex.value = 0; // Always show latest on new assembly
  }

  /**
   * Attach the AI response (thinking + raw text) to a previously recorded
   * snapshot. Matching strategy — in order of preference:
   *   1. exact `generationId` match
   *   2. most-recent snapshot with the same `flowId`
   *
   * No-op if no match is found (late-arriving response after store cleared,
   * emission from a flow that never called `recordAssembly`, etc.).
   */
  function attachResponse(
    match: { generationId?: string; flowId?: string },
    payload: { thinking?: string; rawResponse?: string },
  ): void {
    if (!match.generationId && !match.flowId) return;
    const idx = snapshots.value.findIndex((s) => {
      if (match.generationId && s.generationId === match.generationId) return true;
      if (!match.generationId && match.flowId && s.flowId === match.flowId) return true;
      return false;
    });
    if (idx < 0) return;
    const target = snapshots.value[idx];
    // Preserve existing thinking/rawResponse if payload fields are undefined
    const updated: PromptSnapshot = {
      ...target,
      thinking: payload.thinking ?? target.thinking,
      rawResponse: payload.rawResponse ?? target.rawResponse,
    };
    // Immutable replace — Vue's ref-of-array reactivity requires reassignment
    snapshots.value = snapshots.value.map((s, i) => (i === idx ? updated : s));
  }

  function clearSnapshots(): void {
    snapshots.value = [];
    activeSnapshotIndex.value = 0;
  }

  return {
    snapshots,
    activeSnapshotIndex,
    lastAssembledMessages,
    lastVariables,
    lastFlowId,
    recordAssembly,
    attachResponse,
    clearSnapshots,
  };
});
