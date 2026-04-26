/**
 * PayloadValidator 单元测试
 *
 * 覆盖：
 * - Shape 层：每个 op 的字段要求
 * - Path 层：blocklist + 不在 schema + 未标 x-assistant-editable
 * - Schema 层：type / required / minimum / maximum / enum
 * - Referential 层：match 找不到、append 同名冲突
 *
 * 用 mock GamePack with 简化 schema + mock StateManager。
 */
import { describe, it, expect } from 'vitest';
import { PayloadValidator, validateValueAgainstSchema } from './payload-validator';
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import type { AssistantPatch } from './types';

const SCHEMA = {
  type: 'object',
  properties: {
    社交: {
      type: 'object',
      properties: {
        关系: {
          type: 'array',
          'x-assistant-editable': true,
          items: {
            type: 'object',
            required: ['名称', '类型'],
            properties: {
              名称: { type: 'string' },
              类型: { type: 'string', enum: ['朋友', '敌人', '中立'] },
              好感度: { type: 'number', minimum: -100, maximum: 100 },
            },
          },
        },
      },
    },
    角色: {
      type: 'object',
      properties: {
        基础信息: {
          type: 'object',
          'x-assistant-editable': true,
          properties: {
            姓名: { type: 'string' },
            年龄: { type: 'number', minimum: 0, maximum: 200 },
          },
        },
      },
    },
    元数据: { type: 'object' }, // 黑名单内
    系统: { type: 'object' },   // 黑名单内
    隐藏: { type: 'object', properties: { x: { type: 'string' } } }, // 不带 editable
  },
};

function makeMockSm(state: Record<string, unknown>): StateManager {
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

const PACK: GamePack = { stateSchema: SCHEMA } as unknown as GamePack;

function makeValidator(state: Record<string, unknown> = {}, pack: GamePack = PACK): PayloadValidator {
  return new PayloadValidator({ stateManager: makeMockSm(state), gamePack: pack });
}

// ─── Shape 层 ─────────────────────────────────────────────

describe('PayloadValidator — Shape 层', () => {
  const v = makeValidator();

  it('set-field 缺 value → error', () => {
    const r = v.validateOne({ target: '社交.关系', op: 'set-field' } as AssistantPatch);
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('value'))).toBe(true);
  });

  it('replace-array value 不是数组 → error', () => {
    const r = v.validateOne({ target: '社交.关系', op: 'replace-array', value: { not: 'array' } });
    expect(r.status).toBe('error');
  });

  it('replace-item 缺 match → error', () => {
    const r = v.validateOne({ target: '社交.关系', op: 'replace-item', value: {} });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('match'))).toBe(true);
  });

  it('remove-item 缺 match → error', () => {
    const r = v.validateOne({ target: '社交.关系', op: 'remove-item' });
    expect(r.status).toBe('error');
  });

  it('append-item 缺 value → error', () => {
    const r = v.validateOne({ target: '社交.关系', op: 'append-item' } as AssistantPatch);
    expect(r.status).toBe('error');
  });
});

// ─── Path 层 ──────────────────────────────────────────────

describe('PayloadValidator — Path 层', () => {
  const v = makeValidator();

  it('黑名单路径 → error', () => {
    const r = v.validateOne({ target: '元数据.叙事历史', op: 'set-field', value: [] });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('黑名单'))).toBe(true);
  });

  it('系统.* 路径 → error', () => {
    const r = v.validateOne({ target: '系统.api', op: 'set-field', value: 'x' });
    expect(r.status).toBe('error');
  });

  it('schema 中不存在的路径 → error', () => {
    const r = v.validateOne({ target: '不存在.的.路径', op: 'set-field', value: 'x' });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('不存在'))).toBe(true);
  });

  it('schema 存在但未标 x-assistant-editable → error', () => {
    const r = v.validateOne({ target: '隐藏.x', op: 'set-field', value: 'X' });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('未授权') || m.includes('editable'))).toBe(true);
  });

  it('父节点标 editable 时子节点也允许', () => {
    const r = v.validateOne({ target: '角色.基础信息.姓名', op: 'set-field', value: '李白' });
    // 角色.基础信息 标了 editable，所以 .姓名 可写
    expect(r.status).not.toBe('error');
  });

  it('支持 $. 前缀', () => {
    const r = v.validateOne({ target: '$.角色.基础信息.姓名', op: 'set-field', value: '李白' });
    expect(r.status).not.toBe('error');
  });
});

// ─── Schema 层 ────────────────────────────────────────────

describe('PayloadValidator — Schema 层', () => {
  const v = makeValidator();

  it('set-field 类型不匹配 → error', () => {
    const r = v.validateOne({ target: '角色.基础信息.姓名', op: 'set-field', value: 123 });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('string'))).toBe(true);
  });

  it('set-field number 范围超出 → error', () => {
    const r = v.validateOne({ target: '角色.基础信息.年龄', op: 'set-field', value: 999 });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('maximum'))).toBe(true);
  });

  it('append-item 缺必填字段 → error', () => {
    const r = v.validateOne({
      target: '社交.关系',
      op: 'append-item',
      value: { 名称: 'X' }, // 缺 类型
    });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('类型'))).toBe(true);
  });

  it('append-item enum 值非法 → error', () => {
    const r = v.validateOne({
      target: '社交.关系',
      op: 'append-item',
      value: { 名称: 'X', 类型: 'INVALID', 好感度: 50 },
    });
    expect(r.status).toBe('error');
  });

  it('append-item 全合法 → ok', () => {
    const r = v.validateOne({
      target: '社交.关系',
      op: 'append-item',
      value: { 名称: 'X', 类型: '朋友', 好感度: 50 },
    });
    expect(r.status).toBe('ok');
  });

  it('replace-array 数组项校验 (内含错误) → error', () => {
    const r = v.validateOne({
      target: '社交.关系',
      op: 'replace-array',
      value: [
        { 名称: 'A', 类型: '朋友', 好感度: 50 },
        { 名称: 'B' }, // 缺 类型
      ],
    });
    expect(r.status).toBe('error');
  });
});

// ─── insert-item Shape + Schema ─────────────────────────

describe('PayloadValidator — insert-item shape', () => {
  const v = makeValidator();

  it('缺 value → error', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'start' },
    });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('value'))).toBe(true);
  });

  it('缺 position → error', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      value: { 名称: 'X', 类型: '朋友' },
    });
    expect(r.status).toBe('error');
    expect(r.issues.some((m) => m.includes('position'))).toBe(true);
  });

  it('position.at="middle" → error', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      // @ts-expect-error 故意传非法
      position: { at: 'middle' },
      value: { 名称: 'X', 类型: '朋友' },
    });
    expect(r.status).toBe('error');
  });

  it('position.before.by 缺失 → error', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      // @ts-expect-error
      position: { before: { value: 'x' } },
      value: { 名称: 'X', 类型: '朋友' },
    });
    expect(r.status).toBe('error');
  });

  it('同时有 at + before → error（只能一个）', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      // @ts-expect-error
      position: { at: 'end', before: { by: '名称', value: 'X' } },
      value: { 名称: 'X', 类型: '朋友' },
    });
    expect(r.status).toBe('error');
  });

  it('position.at=start 合法 + value 符合 schema → ok', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'start' },
      value: { 名称: 'Z', 类型: '朋友', 好感度: 50 },
    });
    expect(r.status).toBe('ok');
  });

  it('position.after={by:"名称",value:"王五"} 合法 → ok（假设王五在 state 中）', () => {
    const v2 = makeValidator({
      社交: { 关系: [{ 名称: '王五', 类型: '朋友', 好感度: 50 }] },
    });
    const r = v2.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { after: { by: '名称', value: '王五' } },
      value: { 名称: '苏墨', 类型: '朋友', 好感度: 60 },
    });
    expect(r.status).toBe('ok');
  });

  it('insert-item value 不符合 items schema → error', () => {
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'end' },
      value: { 名称: 'X' }, // 缺必填 类型
    });
    expect(r.status).toBe('error');
  });
});

describe('PayloadValidator — insert-item referential', () => {
  const state = { 社交: { 关系: [{ 名称: '王五', 类型: '朋友', 好感度: 50 }] } };

  it('before match 找不到 → warn（fallback 说明）', () => {
    const v = makeValidator(state);
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { before: { by: '名称', value: '不存在' } },
      value: { 名称: 'Y', 类型: '朋友', 好感度: 50 },
    });
    expect(r.status).toBe('warn');
    expect(r.issues.some((m) => m.includes('未找到'))).toBe(true);
    expect(r.issues.some((m) => m.includes('fallback'))).toBe(true);
  });

  it('after match 找到 + 非同名 → ok', () => {
    const v = makeValidator(state);
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { after: { by: '名称', value: '王五' } },
      value: { 名称: '苏墨', 类型: '朋友', 好感度: 60 },
    });
    expect(r.status).toBe('ok');
  });

  it('插入时 value 名称与既有项冲突 → warn', () => {
    const v = makeValidator(state);
    const r = v.validateOne({
      target: '社交.关系', op: 'insert-item',
      position: { at: 'start' },
      value: { 名称: '王五', 类型: '朋友', 好感度: 0 }, // 已存在
    });
    expect(r.status).toBe('warn');
    expect(r.issues.some((m) => m.includes('已存在'))).toBe(true);
  });
});

// ─── Referential 层 ───────────────────────────────────────

describe('PayloadValidator — Referential 层（仅 warn）', () => {
  const sm = {
    社交: { 关系: [{ 名称: '王五', 类型: '朋友', 好感度: 50 }] },
  };

  it('replace-item match 找不到 → warn', () => {
    const v = makeValidator(sm);
    const r = v.validateOne({
      target: '社交.关系',
      op: 'replace-item',
      match: { by: '名称', value: '不存在的人' },
      value: { 名称: '不存在的人', 类型: '朋友', 好感度: 0 },
    });
    expect(r.status).toBe('warn');
    expect(r.issues.some((m) => m.includes('未找到'))).toBe(true);
  });

  it('replace-item match 找到 → ok', () => {
    const v = makeValidator(sm);
    const r = v.validateOne({
      target: '社交.关系',
      op: 'replace-item',
      match: { by: '名称', value: '王五' },
      value: { 名称: '王五', 类型: '朋友', 好感度: 80 },
    });
    expect(r.status).toBe('ok');
  });

  it('append-item 同名冲突 → warn', () => {
    const v = makeValidator(sm);
    const r = v.validateOne({
      target: '社交.关系',
      op: 'append-item',
      value: { 名称: '王五', 类型: '朋友', 好感度: 50 }, // 已存在
    });
    expect(r.status).toBe('warn');
    expect(r.issues.some((m) => m.includes('已存在'))).toBe(true);
  });

  it('append-item 不冲突 → ok', () => {
    const v = makeValidator(sm);
    const r = v.validateOne({
      target: '社交.关系',
      op: 'append-item',
      value: { 名称: '苏墨', 类型: '朋友', 好感度: 70 },
    });
    expect(r.status).toBe('ok');
  });

  it('remove-item match 找不到 → warn', () => {
    const v = makeValidator(sm);
    const r = v.validateOne({
      target: '社交.关系',
      op: 'remove-item',
      match: { by: '名称', value: '不存在' },
    });
    expect(r.status).toBe('warn');
  });
});

// ─── validate(payload) 整体 ─────────────────────────────

describe('PayloadValidator.validate — 整体 payload', () => {
  it('每条 patch 都得到 status', () => {
    const v = makeValidator();
    const result = v.validate({
      summary: '',
      patches: [
        { target: '角色.基础信息.姓名', op: 'set-field', value: '李白' },
        { target: '元数据.foo', op: 'set-field', value: 'X' }, // blocked
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('ok');
    expect(result[1].status).toBe('error');
  });
});

// ─── 回归测试：GamePack.stateSchema 读取路径（2026-04-14 bug） ─

describe('PayloadValidator — GamePack.stateSchema 字段读取（回归）', () => {
  // 此前 bug：getStateSchema 错误读 `pack.schemas['state-schema']` 而非 `pack.stateSchema`
  // 结果：所有路径在 validator 里都被判 "不存在" + "未标 x-assistant-editable" → error
  it('从 pack.stateSchema 顶级字段读取（不是 pack.schemas[…]）', () => {
    const packCorrect = { stateSchema: SCHEMA } as unknown as GamePack;
    const packWrong = { schemas: { 'state-schema': SCHEMA } } as unknown as GamePack;

    const v1 = new PayloadValidator({ stateManager: makeMockSm({}), gamePack: packCorrect });
    const r1 = v1.validateOne({ target: '社交.关系', op: 'append-item', value: { 名称: 'A', 类型: '朋友' } });
    expect(r1.status).toBe('ok');

    const v2 = new PayloadValidator({ stateManager: makeMockSm({}), gamePack: packWrong });
    const r2 = v2.validateOne({ target: '社交.关系', op: 'append-item', value: { 名称: 'A', 类型: '朋友' } });
    expect(r2.status).toBe('error'); // schema 读不到 → 视为 "不存在"
    expect(r2.issues.some((m) => m.includes('不存在'))).toBe(true);
  });
});

// ─── validateValueAgainstSchema 工具函数 ─────────────────

describe('validateValueAgainstSchema 工具', () => {
  it('object required 字段缺失', () => {
    const issues = validateValueAgainstSchema(
      { a: 1 },
      { type: 'object', required: ['a', 'b'] },
      'root',
    );
    expect(issues.some((m) => m.includes('"b"'))).toBe(true);
  });

  it('null 与 nullable schema', () => {
    const issues = validateValueAgainstSchema(null, { type: 'string' }, '');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('array 内含错误项', () => {
    const issues = validateValueAgainstSchema(
      [1, 'wrong-type'],
      { type: 'array', items: { type: 'number' } },
      'arr',
    );
    expect(issues.some((m) => m.includes('[1]'))).toBe(true);
  });
});
