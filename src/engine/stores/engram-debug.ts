/**
 * Engram Debug Pinia Store — 保存最近一次 UnifiedRetriever 的调试信息。
 *
 * E.6.2：仅当 EngramConfig.debug = true 时填充；
 * EngramDebugPanel 从此 store 读取「最近检索结果」区域的数据。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 一次 retrieve() 调用产生的调试快照 */
export interface RetrieveDebugInfo {
  vectorCandidateCount: number;
  graphCandidateCount: number;
  triplesCandidateCount: number;
  afterMergeCount: number;
  afterRerankCount: number;
  rerankUsed: boolean;
  embeddingFallback: boolean;
  topScores: Array<{ text: string; score: number; source: string }>;
  /** ISO 时间戳，用于面板显示 */
  capturedAt: string;
}

export const useEngramDebugStore = defineStore('engramDebug', () => {
  /** 最近一次检索调试信息（null = 尚无数据） */
  const lastRetrieve = ref<RetrieveDebugInfo | null>(null);

  function recordRetrieve(info: Omit<RetrieveDebugInfo, 'capturedAt'>): void {
    lastRetrieve.value = { ...info, capturedAt: new Date().toISOString() };
  }

  function clear(): void {
    lastRetrieve.value = null;
  }

  return { lastRetrieve, recordRetrieve, clear };
});
