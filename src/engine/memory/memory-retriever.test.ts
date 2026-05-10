import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '@/engine/memory/memory-retriever';
import type { MemoryPathConfig } from '@/engine/memory/memory-manager';
import { StateManager } from '@/engine/core/state-manager';

function makeConfig(): MemoryPathConfig {
  return {
    shortTermPath: '记忆.短期',
    midTermPath: '记忆.中期',
    longTermPath: '记忆.长期',
    implicitMidTermPath: '记忆.隐式中期',
    shortTermCapacity: 5,
    midTermRefineThreshold: 25,
    longTermSummaryThreshold: 50,
    longTermSummarizeCount: 50,
    midTermKeep: 0,
    longTermCap: 30,
  };
}

function makeShortTermEntries(summaries: string[]) {
  return summaries.map((s, i) => ({ summary: s, round: i + 1, timestamp: Date.now() }));
}

function makeStateWithShortTerm(summaries: string[]): StateManager {
  const sm = new StateManager();
  sm.set('记忆.短期', makeShortTermEntries(summaries), 'system');
  return sm;
}

describe('MemoryRetriever.retrieve — skipShortTerm', () => {
  it('includes short-term memory by default', () => {
    const retriever = new MemoryRetriever(makeConfig());
    const sm = makeStateWithShortTerm(['第一轮叙事内容', '第二轮叙事内容']);

    const result = retriever.retrieve(sm);

    expect(result).toContain('短期记忆');
    expect(result).toContain('第一轮叙事内容');
    expect(result).toContain('第二轮叙事内容');
  });

  it('includes short-term memory when ctx provided without skipShortTerm', () => {
    const retriever = new MemoryRetriever(makeConfig());
    const sm = makeStateWithShortTerm(['叙事内容']);

    const result = retriever.retrieve(sm, { playerName: '张三' });

    expect(result).toContain('短期记忆');
    expect(result).toContain('叙事内容');
  });

  it('skips short-term memory when skipShortTerm = true', () => {
    const retriever = new MemoryRetriever(makeConfig());
    const sm = makeStateWithShortTerm(['第一轮叙事内容', '第二轮叙事内容']);

    const result = retriever.retrieve(sm, { skipShortTerm: true });

    expect(result).not.toContain('短期记忆');
    expect(result).not.toContain('第一轮叙事内容');
    expect(result).not.toContain('第二轮叙事内容');
  });

  it('still includes mid/long-term when skipShortTerm = true', () => {
    const retriever = new MemoryRetriever(makeConfig());
    const sm = new StateManager();
    sm.set('记忆.短期', makeShortTermEntries(['短期叙事']), 'system');
    sm.set('记忆.中期', [{
      相关角色: ['玩家'],
      事件时间: '1-01-01-08-00',
      记忆主体: '中期记忆内容',
    }], 'system');
    sm.set('记忆.长期', [{ content: '长期记忆内容', category: '世界观' }], 'system');

    const result = retriever.retrieve(sm, { skipShortTerm: true });

    expect(result).not.toContain('短期叙事');
    expect(result).toContain('中期记忆内容');
    expect(result).toContain('长期记忆内容');
  });
});
