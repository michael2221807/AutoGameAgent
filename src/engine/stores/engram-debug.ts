/**
 * Engram Debug Pinia Store — 保存最近一次 UnifiedRetriever 的调试信息。
 *
 * E.6.2：仅当 EngramConfig.debug = true 时填充；
 * EngramDebugPanel 从此 store 读取「最近检索结果」区域的数据。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { EngramReadSnapshot } from '../memory/engram/engram-types';

/** 一次 retrieve() 调用产生的调试快照 */
export interface RetrieveDebugInfo {
  vectorCandidateCount: number;
  graphCandidateCount: number;
  afterMergeCount: number;
  afterRerankCount: number;
  rerankUsed: boolean;
  embeddingFallback: boolean;
  topScores: Array<{ text: string; score: number; source: string }>;
  capturedAt: string;
}

export const useEngramDebugStore = defineStore('engramDebug', () => {
  /** 最近一次检索调试信息（null = 尚无数据） */
  const lastRetrieve = ref<RetrieveDebugInfo | null>(null);
  /** 最近一次完整读取快照（含评分分解，供 per-round 可视化） */
  const lastReadSnapshot = ref<EngramReadSnapshot | null>(null);

  function recordRetrieve(info: Omit<RetrieveDebugInfo, 'capturedAt'>): void {
    lastRetrieve.value = { ...info, capturedAt: new Date().toISOString() };
  }

  function recordReadSnapshot(snapshot: EngramReadSnapshot): void {
    lastReadSnapshot.value = snapshot;
  }

  function clear(): void {
    lastRetrieve.value = null;
    lastReadSnapshot.value = null;
  }

  return { lastRetrieve, lastReadSnapshot, recordRetrieve, recordReadSnapshot, clear };
});
