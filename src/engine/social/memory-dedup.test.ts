import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStateManager } from '@/engine/__test-utils__';
import { isDuplicateMemory, buildMemoryPushDedupGuard } from './memory-dedup';

// CommandExecutor needs eventBus mock
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: () => {}, on: () => () => {} },
}));

const { CommandExecutor } = await import('@/engine/core/command-executor');

describe('isDuplicateMemory', () => {
  describe('string entries (legacy format)', () => {
    it('detects exact duplicate strings', () => {
      const existing = ['初次在茶馆相遇', '与师父论道'];
      expect(isDuplicateMemory('初次在茶馆相遇', existing)).toBe(true);
    });

    it('detects near-duplicate strings', () => {
      const existing = ['为周淑兰诊断左膝中度骨性节炎，右膝轻度退变，开药保守治疗'];
      expect(isDuplicateMemory(
        '为周淑兰诊断左膝骨性节炎，右膝退变，保守治疗',
        existing,
      )).toBe(true);
    });

    it('allows unrelated entries', () => {
      const existing = ['初次在茶馆相遇'];
      expect(isDuplicateMemory('在道场切磋武艺', existing)).toBe(false);
    });
  });

  describe('object entries (new format: { 内容, 时间 })', () => {
    it('detects duplicate when new is string and existing is object', () => {
      const existing = [{ 内容: '初次在茶馆相遇', 时间: '1-01-15' }];
      expect(isDuplicateMemory('初次在茶馆相遇', existing)).toBe(true);
    });

    it('detects duplicate when new is object and existing is string', () => {
      const existing = ['初次在茶馆相遇'];
      expect(isDuplicateMemory(
        { 内容: '初次在茶馆相遇', 时间: '1-01-20' },
        existing,
      )).toBe(true);
    });

    it('detects near-duplicate between two objects', () => {
      const existing = [
        { 内容: '为周淑兰诊断左膝中度骨性节炎，开药保守治疗', 时间: '1-03-10' },
      ];
      expect(isDuplicateMemory(
        { 内容: '为周淑兰诊断左膝骨性节炎，保守治疗', 时间: '1-03-11' },
        existing,
      )).toBe(true);
    });

    it('detects duplicate with English keys {content, time}', () => {
      const existing = [{ content: '初次在茶馆相遇', time: '1-01-15' }];
      expect(isDuplicateMemory('初次在茶馆相遇', existing)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty candidate', () => {
      expect(isDuplicateMemory('', ['some text'])).toBe(false);
    });

    it('returns false for empty existing array', () => {
      expect(isDuplicateMemory('some text', [])).toBe(false);
    });

    it('returns false for null entry', () => {
      expect(isDuplicateMemory(null, ['something'])).toBe(false);
    });

    it('returns false for numeric entry', () => {
      expect(isDuplicateMemory(42, ['some text'])).toBe(false);
    });

    it('handles mixed format arrays', () => {
      const existing = [
        '旧格式记忆',
        { 内容: '新格式记忆', 时间: '1-01-01' },
        null,
        42,
      ];
      expect(isDuplicateMemory('旧格式记忆', existing)).toBe(true);
      expect(isDuplicateMemory('新格式记忆', existing)).toBe(true);
      expect(isDuplicateMemory('完全不同的事', existing)).toBe(false);
    });
  });
});

describe('buildMemoryPushDedupGuard', () => {
  const guard = buildMemoryPushDedupGuard('记忆');

  it('allows push to non-memory paths', () => {
    expect(guard('社交.事件.事件记录', 'any value', [])).toBe(true);
  });

  it('allows push to bare field name without dot prefix', () => {
    // "记忆" does not end with ".记忆", so guard must not activate
    expect(guard('记忆', '任何内容', ['existing'])).toBe(true);
  });

  it('allows push to memory path when no duplicate', () => {
    const existing = ['初次在茶馆相遇'];
    expect(guard('社交.关系[名称=周淑兰].记忆', '在道场切磋武艺', existing)).toBe(true);
  });

  it('suppresses push to memory path when duplicate exists', () => {
    const existing = ['初次在茶馆相遇'];
    expect(guard('社交.关系[名称=周淑兰].记忆', '初次在茶馆相遇', existing)).toBe(false);
  });

  it('suppresses push to memory path when near-duplicate exists', () => {
    const existing = ['为周淑兰诊断左膝中度骨性节炎，右膝轻度退变，开药保守治疗'];
    expect(guard(
      '社交.关系[名称=周淑兰].记忆',
      '为周淑兰诊断左膝骨性节炎，右膝退变，保守治疗',
      existing,
    )).toBe(false);
  });

  it('allows push to memory path with empty existing array', () => {
    expect(guard('社交.关系[名称=周淑兰].记忆', '新记忆', [])).toBe(true);
  });

  it('handles object-format existing entries', () => {
    const existing = [{ 内容: '初次在茶馆相遇', 时间: '1-01-15' }];
    expect(guard('社交.关系[名称=周淑兰].记忆', '初次在茶馆相遇', existing)).toBe(false);
  });
});

describe('end-to-end: real guard through CommandExecutor', () => {
  let sm: ReturnType<typeof createMockStateManager>['sm'];
  let executor: InstanceType<typeof CommandExecutor>;

  beforeEach(() => {
    const mock = createMockStateManager({
      社交: { 关系: [{ 名称: '周淑兰', 记忆: [] }] },
    });
    sm = mock.sm;
    const guard = buildMemoryPushDedupGuard('记忆');
    executor = new CommandExecutor(sm as never, null, guard);
  });

  it('prevents same memory from being pushed twice', () => {
    const cmd = { action: 'push' as const, key: '社交.关系.0.记忆', value: '初次在茶馆相遇' };
    executor.execute(cmd);
    executor.execute(cmd);
    executor.execute(cmd);
    expect(sm.get<string[]>('社交.关系.0.记忆')).toHaveLength(1);
  });

  it('prevents near-duplicate from being pushed', () => {
    executor.execute({
      action: 'push', key: '社交.关系.0.记忆',
      value: '为周淑兰诊断左膝中度骨性节炎，右膝轻度退变，开药保守治疗',
    });
    executor.execute({
      action: 'push', key: '社交.关系.0.记忆',
      value: '为周淑兰诊断左膝骨性节炎，右膝退变，保守治疗',
    });
    expect(sm.get<string[]>('社交.关系.0.记忆')).toHaveLength(1);
  });

  it('allows distinct memories through', () => {
    executor.execute({
      action: 'push', key: '社交.关系.0.记忆', value: '初次在茶馆相遇',
    });
    executor.execute({
      action: 'push', key: '社交.关系.0.记忆', value: '在道场切磋武艺',
    });
    executor.execute({
      action: 'push', key: '社交.关系.0.记忆', value: '深夜长谈人生哲理',
    });
    expect(sm.get<string[]>('社交.关系.0.记忆')).toHaveLength(3);
  });

  it('does not block pushes to non-memory paths', () => {
    const mock = createMockStateManager({
      社交: { 事件: { 事件记录: ['event1'] } },
    });
    const guard = buildMemoryPushDedupGuard('记忆');
    const exec = new CommandExecutor(mock.sm as never, null, guard);
    exec.execute({ action: 'push', key: '社交.事件.事件记录', value: 'event1' });
    // Non-memory paths allow duplicates
    expect(mock.sm.get<string[]>('社交.事件.事件记录')).toHaveLength(2);
  });
});
