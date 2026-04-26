import { describe, it, expect, vi } from 'vitest';
import { makeShortTerm, makeMidTerm, makeLongTerm } from '@/engine/__test-utils__/fixtures';

// Mock the dependencies that MemoryCompilerModule imports
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));
vi.mock('@/engine/core/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { MemoryCompilerModule } = await import('@/engine/behaviors/memory-compiler');

function createMockMemoryManager(
  short = [makeShortTerm({ round: 1, summary: '玩家进入茶馆。' })],
  mid = [makeMidTerm({ 记忆主体: '玩家在茶馆与老板娘对话（重要性:6）' })],
  long = [makeLongTerm({ category: '故事主线', content: '玩家开始了修仙之路。' })],
) {
  return {
    getShortTermEntries: () => short,
    getMidTermEntries: () => mid,
    getLongTermEntries: () => long,
  };
}

describe('MemoryCompilerModule', () => {
  it('compiles SHORT_TERM_MEMORY variable', () => {
    const mm = createMockMemoryManager();
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    expect(vars['SHORT_TERM_MEMORY']).toContain('玩家进入茶馆');
  });

  it('compiles MID_TERM_MEMORY variable', () => {
    const mm = createMockMemoryManager();
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    expect(vars['MID_TERM_MEMORY']).toContain('茶馆');
  });

  it('compiles LONG_TERM_MEMORY variable', () => {
    const mm = createMockMemoryManager();
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    expect(vars['LONG_TERM_MEMORY']).toContain('修仙');
  });

  it('compiles MEMORY_SUMMARY variable', () => {
    const mm = createMockMemoryManager();
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    expect(vars['MEMORY_SUMMARY']).toBeDefined();
    expect(vars['MEMORY_SUMMARY'].length).toBeGreaterThan(0);
  });

  it('handles empty memory layers', () => {
    const mm = createMockMemoryManager([], [], []);
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    // Should produce empty or placeholder strings, not crash
    expect(typeof vars['SHORT_TERM_MEMORY']).toBe('string');
    expect(typeof vars['MID_TERM_MEMORY']).toBe('string');
    expect(typeof vars['LONG_TERM_MEMORY']).toBe('string');
  });

  it('includes 已精炼 tag for refined mid-term entries', () => {
    const mm = createMockMemoryManager(
      [],
      [makeMidTerm({ 记忆主体: '精炼后的记忆', 已精炼: true })],
      [],
    );
    const compiler = new MemoryCompilerModule(mm as never);
    const vars: Record<string, string> = {};
    compiler.onContextAssembly(null as never, vars);
    expect(vars['MID_TERM_MEMORY']).toContain('已精炼');
  });
});
