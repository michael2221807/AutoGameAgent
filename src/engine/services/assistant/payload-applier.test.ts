/**
 * PayloadApplier 单元测试
 *
 * 覆盖：
 * - 5 种 op 翻译为正确的 Command 序列
 * - replace-item 找不到 match 时退化为 push（保险）
 * - remove-item 找不到 match 时返回空 command 列表
 * - replace-array value 非数组 → 空
 * - apply() 空 patches → ok=true commandCount=0
 * - apply() 调 commandExecutor.executeBatch
 */
import { describe, it, expect, vi } from 'vitest';
import { PayloadApplier } from './payload-applier';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { ValidatedPatch } from './types';

function makeSm(state: Record<string, unknown>): StateManager {
  return {
    get<T>(path: string): T | undefined {
      const segs = path.split('.').filter(Boolean);
      let cur: unknown = state;
      for (const s of segs) {
        if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[s];
        else return undefined;
      }
      return cur as T;
    },
  } as unknown as StateManager;
}

function makeExecutor() {
  const calls: Array<{ commands: unknown[] }> = [];
  const exec = {
    executeBatch(commands: unknown[]) {
      calls.push({ commands });
      return { results: commands.map((c) => ({ success: true, command: c })), changeLog: { changes: [], source: 'command', timestamp: 0 }, hasErrors: false };
    },
  } as unknown as CommandExecutor;
  return { exec, calls };
}

function ok(p: Omit<ValidatedPatch, 'status' | 'issues'>): ValidatedPatch {
  return { ...p, status: 'ok', issues: [] } as ValidatedPatch;
}

describe('PayloadApplier.translateOne — 5 op 翻译', () => {
  const sm = makeSm({
    社交: { 关系: [{ 名称: '王五', 类型: '朋友', 好感度: 50 }] },
  });
  const { exec } = makeExecutor();
  const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });

  it('set-field → 1 个 set command', () => {
    const cmds = applier.translateOne(ok({
      target: '角色.姓名', op: 'set-field', value: '李白',
    }));
    expect(cmds).toEqual([{ action: 'set', key: '角色.姓名', value: '李白' }]);
  });

  it('append-item → 1 个 push command', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'append-item', value: { 名称: '苏墨' },
    }));
    expect(cmds).toEqual([{ action: 'push', key: '社交.关系', value: { 名称: '苏墨' } }]);
  });

  it('remove-item match found → 1 个 pull command (含完整匹配项)', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'remove-item',
      match: { by: '名称', value: '王五' },
    }));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].action).toBe('pull');
    expect((cmds[0].value as Record<string, unknown>)['名称']).toBe('王五');
  });

  it('remove-item match not found → 空数组（no-op）', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'remove-item',
      match: { by: '名称', value: '不存在' },
    }));
    expect(cmds).toEqual([]);
  });

  it('replace-item match found → pull + push (2 步事务)', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'replace-item',
      match: { by: '名称', value: '王五' },
      value: { 名称: '王五', 类型: '朋友', 好感度: 99 },
    }));
    expect(cmds).toHaveLength(2);
    expect(cmds[0].action).toBe('pull');
    expect(cmds[1].action).toBe('push');
    expect((cmds[1].value as Record<string, unknown>)['好感度']).toBe(99);
  });

  it('replace-item match not found → 退化为 push (保险)', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'replace-item',
      match: { by: '名称', value: '不存在' },
      value: { 名称: '不存在', 类型: '朋友', 好感度: 0 },
    }));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].action).toBe('push');
  });

  it('replace-array → 1 set([]) + N push', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'replace-array',
      value: [{ 名称: 'A' }, { 名称: 'B' }, { 名称: 'C' }],
    }));
    expect(cmds).toHaveLength(4);
    expect(cmds[0]).toEqual({ action: 'set', key: '社交.关系', value: [] });
    expect(cmds[1].action).toBe('push');
    expect(cmds[2].action).toBe('push');
    expect(cmds[3].action).toBe('push');
  });

  it('replace-array value 非数组 → 空', () => {
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'replace-array',
      value: 'not-an-array',
    }));
    expect(cmds).toEqual([]);
  });

  it('支持 $. 前缀路径', () => {
    const cmds = applier.translateOne(ok({
      target: '$.角色.姓名', op: 'set-field', value: '李白',
    }));
    expect(cmds[0].key).toBe('角色.姓名'); // normalized
  });
});

describe('PayloadApplier — insert-item（反污染核心测试）', () => {
  const stateTemplate = () => ({
    社交: {
      关系: [
        { 名称: '王五', 类型: '朋友', 好感度: 50 },
        { 名称: '苏婉', 类型: '恋人', 好感度: 80 },
        { 名称: '张三', 类型: '中立', 好感度: 0 },
      ],
    },
  });

  it('at=start → 插入在数组头 + 其他项逐字节不变', () => {
    const sm = makeSm(stateTemplate());
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'start' },
      value: { 名称: '苏墨', 类型: '朋友', 好感度: 60 },
    }));
    expect(cmds).toHaveLength(1);
    expect(cmds[0].action).toBe('set');
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    expect(newArr).toHaveLength(4);
    expect(newArr[0]['名称']).toBe('苏墨');
    // 关键：其他项逐字节不变
    expect(newArr[1]).toEqual({ 名称: '王五', 类型: '朋友', 好感度: 50 });
    expect(newArr[2]).toEqual({ 名称: '苏婉', 类型: '恋人', 好感度: 80 });
    expect(newArr[3]).toEqual({ 名称: '张三', 类型: '中立', 好感度: 0 });
  });

  it('at=end → 插入在尾部 + 其他项不变', () => {
    const sm = makeSm(stateTemplate());
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'end' },
      value: { 名称: 'Z', 类型: '敌人', 好感度: -20 },
    }));
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    expect(newArr).toHaveLength(4);
    expect(newArr[3]['名称']).toBe('Z');
    expect(newArr[0]).toEqual({ 名称: '王五', 类型: '朋友', 好感度: 50 });
  });

  it('before=王五 → 插入在王五之前（index 0）', () => {
    const sm = makeSm(stateTemplate());
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { before: { by: '名称', value: '王五' } },
      value: { 名称: '新人', 类型: '中立', 好感度: 10 },
    }));
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    expect(newArr[0]['名称']).toBe('新人');
    expect(newArr[1]['名称']).toBe('王五');
  });

  it('after=王五 → 插入在王五之后（index 1）', () => {
    const sm = makeSm(stateTemplate());
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { after: { by: '名称', value: '王五' } },
      value: { 名称: '新人', 类型: '中立', 好感度: 10 },
    }));
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    expect(newArr[0]['名称']).toBe('王五');
    expect(newArr[1]['名称']).toBe('新人');
    expect(newArr[2]['名称']).toBe('苏婉');
  });

  it('before/after match 找不到 → fallback 到末尾', () => {
    const sm = makeSm(stateTemplate());
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { before: { by: '名称', value: '不存在' } },
      value: { 名称: 'Z', 类型: '朋友', 好感度: 0 },
    }));
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    expect(newArr[3]['名称']).toBe('Z'); // fallback 在尾部
    expect(newArr[0]['名称']).toBe('王五'); // 其他项未动
  });

  it('target 在状态树中不是数组 → 从空数组插入', () => {
    const sm = makeSm({ 社交: { 关系: null } as Record<string, unknown> });
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'end' },
      value: { 名称: 'X' },
    }));
    const newArr = cmds[0].value as unknown[];
    expect(newArr).toHaveLength(1);
  });

  it('反污染保证：插入新项不会修改其他 item 的 reference（deep clone）', () => {
    const original = stateTemplate();
    const sm = makeSm(original);
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'start' },
      value: { 名称: 'Z', 类型: '朋友', 好感度: 0 },
    }));
    const newArr = cmds[0].value as Array<Record<string, unknown>>;
    // 修改 newArr 里的项不应污染 original
    (newArr[1]['好感度'] as number) = 999;
    expect((original.社交.关系[0] as Record<string, unknown>)['好感度']).toBe(50);
  });

  it('缺 position（应被 validator 拦但防御）→ 空数组', () => {
    const sm = makeSm({});
    const { exec } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const cmds = applier.translateOne(ok({
      target: '社交.关系', op: 'insert-item', value: {},
      // position 故意省略，模拟 validator 被绕过的防御场景
    }) as unknown as ValidatedPatch);
    expect(cmds).toEqual([]);
  });
});

describe('PayloadApplier.apply — 整体流程', () => {
  it('空 patches → ok=true commandCount=0', () => {
    const sm = makeSm({});
    const { exec, calls } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const result = applier.apply([]);
    expect(result.ok).toBe(true);
    expect(result.commandCount).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('调 commandExecutor.executeBatch 一次（含全部翻译后的 commands）', () => {
    const sm = makeSm({ 社交: { 关系: [] } });
    const { exec, calls } = makeExecutor();
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    applier.apply([
      ok({ target: '角色.姓名', op: 'set-field', value: '李白' }),
      ok({ target: '社交.关系', op: 'append-item', value: { 名称: 'X' } }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].commands).toHaveLength(2);
  });

  it('executeBatch 报告 hasErrors → ok=false + error', () => {
    const sm = makeSm({});
    const exec = {
      executeBatch: vi.fn().mockReturnValue({
        results: [{ success: false, command: {}, error: 'fail' }],
        changeLog: { changes: [], source: 'command', timestamp: 0 },
        hasErrors: true,
      }),
    } as unknown as CommandExecutor;
    const applier = new PayloadApplier({ stateManager: sm, commandExecutor: exec });
    const result = applier.apply([
      ok({ target: '角色.姓名', op: 'set-field', value: 'X' }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
