import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStateManager } from '@/engine/__test-utils__';

// Mock eventBus before importing CommandExecutor
vi.mock('@/engine/core/event-bus', () => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    eventBus: {
      emit: (event: string, payload?: unknown) => emitted.push({ event, payload }),
      on: () => () => {},
      _emitted: emitted,
      _clear: () => { emitted.length = 0; },
    },
  };
});

// Dynamic import after mock setup
const { CommandExecutor } = await import('@/engine/core/command-executor');
const { eventBus } = await import('@/engine/core/event-bus');

describe('CommandExecutor', () => {
  let sm: ReturnType<typeof createMockStateManager>['sm'];
  let executor: InstanceType<typeof CommandExecutor>;

  beforeEach(() => {
    const mock = createMockStateManager({ 角色: { 属性: { 体力: 100 }, 背包: { 物品: ['剑'] } } });
    sm = mock.sm;
    executor = new CommandExecutor(sm as never, ['角色', '世界', '社交']);
    (eventBus as unknown as { _clear: () => void })._clear();
  });

  describe('single command execution', () => {
    it('set action writes value', () => {
      const result = executor.execute({ action: 'set', key: '角色.名字', value: '张三' });
      expect(result.success).toBe(true);
      expect(sm.get('角色.名字')).toBe('张三');
    });

    it('set trims string values', () => {
      executor.execute({ action: 'set', key: '角色.名字', value: '  张三  ' });
      expect(sm.get('角色.名字')).toBe('张三');
    });

    it('add action increments number', () => {
      executor.execute({ action: 'add', key: '角色.属性.体力', value: 10 });
      expect(sm.get('角色.属性.体力')).toBe(110);
    });

    it('add with negative delta: clamp prevents health reduction', () => {
      // clampNumber(-10) = 0 → add(体力, 0) = 100 (unchanged)
      // Design: add action can only INCREASE values, not decrease.
      // To decrease, AI must use set with calculated value.
      executor.execute({ action: 'add', key: '角色.属性.体力', value: -10 });
      expect(sm.get('角色.属性.体力')).toBe(100);
    });

    it('delete action removes path', () => {
      executor.execute({ action: 'delete', key: '角色.属性.体力' });
      expect(sm.has('角色.属性.体力')).toBe(false);
    });

    it('push action appends to array', () => {
      executor.execute({ action: 'push', key: '角色.背包.物品', value: '盾' });
      const items = sm.get<string[]>('角色.背包.物品');
      expect(items).toContain('盾');
    });

    it('pull action removes from array', () => {
      executor.execute({ action: 'pull', key: '角色.背包.物品', value: '剑' });
      const items = sm.get<string[]>('角色.背包.物品');
      expect(items).not.toContain('剑');
    });

    it('returns error for missing action', () => {
      const result = executor.execute({ key: 'x', value: 1 } as never);
      expect(result.success).toBe(false);
    });

    it('returns error for missing key', () => {
      const result = executor.execute({ action: 'set', value: 1 } as never);
      expect(result.success).toBe(false);
    });
  });

  describe('batch execution', () => {
    it('executes all valid commands', () => {
      const result = executor.executeBatch([
        { action: 'set', key: '角色.名字', value: '李四' },
        { action: 'add', key: '角色.属性.体力', value: 5 },
      ]);
      expect(result.hasErrors).toBe(false);
      expect(result.results).toHaveLength(2);
    });

    it('continues after partial failure', () => {
      const result = executor.executeBatch([
        { action: 'set', key: '角色.名字', value: '王五' },
        { key: 'bad' } as never, // missing action
        { action: 'set', key: '角色.年龄', value: 20 },
      ]);
      expect(result.hasErrors).toBe(true);
      expect(sm.get('角色.名字')).toBe('王五'); // first succeeded
      expect(sm.get('角色.年龄')).toBe(20); // third succeeded
    });

    it('handles empty batch', () => {
      const result = executor.executeBatch([]);
      expect(result.results).toHaveLength(0);
      expect(result.hasErrors).toBe(false);
    });
  });

  describe('path root whitelist', () => {
    it('emits toast for unknown path root', () => {
      executor.execute({ action: 'set', key: '未知根.字段', value: 1 });
      const emitted = (eventBus as unknown as { _emitted: Array<{ event: string }> })._emitted;
      expect(emitted.some((e) => e.event === 'ui:toast')).toBe(true);
    });

    it('does not warn for known root', () => {
      (eventBus as unknown as { _clear: () => void })._clear();
      executor.execute({ action: 'set', key: '角色.名字', value: '测试' });
      const emitted = (eventBus as unknown as { _emitted: Array<{ event: string }> })._emitted;
      expect(emitted.filter((e) => e.event === 'ui:toast')).toHaveLength(0);
    });
  });

  describe('array capacity', () => {
    it('push at capacity evicts oldest (FIFO)', () => {
      const bigArr = Array.from({ length: 200 }, (_, i) => `item${i}`);
      sm.set('角色.背包.物品', bigArr);
      executor.execute({ action: 'push', key: '角色.背包.物品', value: 'new' });
      const items = sm.get<string[]>('角色.背包.物品')!;
      expect(items.length).toBeLessThanOrEqual(200);
      expect(items[items.length - 1]).toBe('new');
      expect(items).not.toContain('item0'); // oldest evicted
    });
  });
});
