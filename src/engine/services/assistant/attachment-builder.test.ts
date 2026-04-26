/**
 * AttachmentBuilder 单元测试
 *
 * 覆盖：
 * - build() 取值 + deep clone（不污染原数据）
 * - NSFW 剥离（nsfwMode=false 时剥离 私密信息 / 角色.身体）
 * - schemaFragment 抽取（沿 path 走 properties / items）
 * - x-assistant-label 优先于 path 末段
 * - 数组类型 label 自动加 "(N 项)"
 * - buildSummary 不含 snapshot
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AttachmentBuilder } from './attachment-builder';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';

function makeMockStateManager(state: Record<string, unknown>): StateManager {
  return {
    get<T>(path: string): T | undefined {
      const segments = path.split('.');
      let cur: unknown = state;
      for (const seg of segments) {
        if (cur && typeof cur === 'object') {
          cur = (cur as Record<string, unknown>)[seg];
        } else return undefined;
      }
      return cur as T;
    },
  } as unknown as StateManager;
}

function makePack(schema?: Record<string, unknown>): GamePack {
  // GamePack.stateSchema 是直接顶级字段
  return {
    stateSchema: schema ?? {},
  } as unknown as GamePack;
}

describe('AttachmentBuilder.build — 基本流程', () => {
  it('取值 + deep clone（mutation 不污染 state）', () => {
    const state = {
      角色: { 基础信息: { 姓名: '李白', 年龄: 30 } },
      系统: { nsfwMode: true }, // 关 nsfw 剥离
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });

    const result = builder.build({ path: '角色.基础信息', scope: 'context' });
    (result.snapshot as Record<string, unknown>)['姓名'] = 'mutated';
    expect((state.角色.基础信息 as Record<string, unknown>)['姓名']).toBe('李白');
  });

  it('支持 $. 前缀（normalizeStatePath）', () => {
    const state = { 角色: { 姓名: '苏墨' }, 系统: { nsfwMode: true } };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '$.角色', scope: 'context' });
    expect(result.path).toBe('角色');
  });

  it('path 不存在时抛错', () => {
    const sm = makeMockStateManager({ 系统: { nsfwMode: true } });
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    expect(() => builder.build({ path: '不存在.的.路径', scope: 'context' })).toThrow();
  });

  it('数组类型 label 含 "(N 项)"', () => {
    const state = {
      社交: { 关系: [{ 名称: 'A' }, { 名称: 'B' }, { 名称: 'C' }] },
      系统: { nsfwMode: true },
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '社交.关系', scope: 'target' });
    expect(result.label).toContain('3 项');
    expect(result.itemCount).toBe(3);
  });
});

describe('AttachmentBuilder — NSFW 剥离', () => {
  it('nsfwMode=true 时不剥离', () => {
    const state = {
      社交: { 关系: [{ 名称: 'A', 私密信息: { secret: 1 } }] },
      系统: { nsfwMode: true },
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '社交.关系', scope: 'target' });
    expect(result.nsfwStripped).toBe(false);
    expect(((result.snapshot as Array<Record<string, unknown>>)[0])['私密信息']).toBeDefined();
  });

  it('nsfwMode=false 时剥离 社交.关系.*.私密信息', () => {
    const state = {
      社交: {
        关系: [
          { 名称: 'A', 私密信息: { secret: 1 } },
          { 名称: 'B', 私密信息: { secret: 2 } },
        ],
      },
      系统: { nsfwMode: false },
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '社交.关系', scope: 'target' });
    expect(result.nsfwStripped).toBe(true);
    const arr = result.snapshot as Array<Record<string, unknown>>;
    expect(arr[0]['名称']).toBe('A');
    expect(arr[0]['私密信息']).toBeUndefined();
    expect(arr[1]['私密信息']).toBeUndefined();
  });

  it('nsfwMode=false + attach 角色.身体 直接整子树为 null', () => {
    const state = {
      角色: { 身体: { 身高: 170, 三围: { 胸围: 90 } } },
      系统: { nsfwMode: false },
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '角色.身体', scope: 'context' });
    expect(result.nsfwStripped).toBe(true);
    expect(result.snapshot).toBeNull();
  });

  it('nsfwMode=false + attach 不含 NSFW 子树 → 不剥离', () => {
    const state = {
      角色: { 基础信息: { 姓名: '李白' } },
      系统: { nsfwMode: false },
    };
    const sm = makeMockStateManager(state);
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const result = builder.build({ path: '角色.基础信息', scope: 'context' });
    expect(result.nsfwStripped).toBe(false);
  });
});

describe('AttachmentBuilder — schemaFragment 抽取', () => {
  const stateSchema = {
    type: 'object',
    properties: {
      社交: {
        type: 'object',
        properties: {
          关系: {
            type: 'array',
            'x-assistant-editable': true,
            'x-assistant-label': '社交关系',
            items: {
              type: 'object',
              properties: {
                名称: { type: 'string' },
                好感度: { type: 'number' },
              },
            },
          },
        },
      },
      系统: { type: 'object' },
    },
  };

  let builder: AttachmentBuilder;
  beforeEach(() => {
    const sm = makeMockStateManager({
      社交: { 关系: [{ 名称: 'A' }] },
      系统: { nsfwMode: true },
    });
    builder = new AttachmentBuilder({
      stateManager: sm,
      gamePack: makePack(stateSchema),
    });
  });

  it('裁出数组 path 的 schema（含 items 子结构）', () => {
    const result = builder.build({ path: '社交.关系', scope: 'target' });
    expect(result.schemaFragment['type']).toBe('array');
    const items = result.schemaFragment['items'] as Record<string, unknown>;
    expect(items?.['type']).toBe('object');
  });

  it('x-assistant-label 优先于 path 末段', () => {
    const result = builder.build({ path: '社交.关系', scope: 'target' });
    expect(result.label.startsWith('社交关系')).toBe(true); // 用 x-assistant-label
  });

  it('schema 中无 x-assistant-label 时 fallback 到 path 末段', () => {
    const sm = makeMockStateManager({
      系统: { nsfwMode: true },
      角色: { 姓名: '李白' },
    });
    const noLabelBuilder = new AttachmentBuilder({
      stateManager: sm,
      gamePack: makePack({ properties: { 角色: { type: 'object', properties: { 姓名: {} } } } }),
    });
    const result = noLabelBuilder.build({ path: '角色.姓名', scope: 'context' });
    expect(result.label).toBe('姓名');
  });

  it('gamePack=null 时 schemaFragment 是空对象', () => {
    const sm = makeMockStateManager({ 角色: { 姓名: 'X' }, 系统: { nsfwMode: true } });
    const noPackBuilder = new AttachmentBuilder({ stateManager: sm, gamePack: null });
    const result = noPackBuilder.build({ path: '角色.姓名', scope: 'context' });
    expect(result.schemaFragment).toEqual({});
  });
});

describe('AttachmentBuilder.buildSummary — 历史回放用', () => {
  it('不含 snapshot / schemaFragment / nsfwStripped', () => {
    const sm = makeMockStateManager({});
    const builder = new AttachmentBuilder({ stateManager: sm, gamePack: makePack() });
    const summary = builder.buildSummary('社交.关系', 'target', [{ a: 1 }, { b: 2 }]);
    expect(summary).toEqual({
      path: '社交.关系',
      label: expect.stringContaining('2 项'),
      scope: 'target',
      itemCount: 2,
    });
  });
});
