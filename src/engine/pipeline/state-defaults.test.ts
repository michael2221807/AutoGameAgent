/**
 * buildSchemaDefaultTree 单元测试 — Story 6 P1 共享原语
 *
 * 该函数从 character-init 的 extractDefaultsFromSchema 逐字提取，创角与卡导入共用它
 * 构建默认底树。这里锁定其算法行为（嵌套默认填充 / 父默认优先 / 标量默认 / $ref 告警 /
 * 引用隔离），即"schema 默认与创角逐键一致"的回归基线。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSchemaDefaultTree } from './state-defaults';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSchemaDefaultTree — 嵌套对象默认（§4.1d 修复）', () => {
  it('对象字段 default:{} 但子属性有 default → 输出填充后的对象而非空壳', () => {
    // 复刻 tianming 的 角色.身份.先天六维 形态
    const schema = {
      properties: {
        先天六维: {
          type: 'object',
          default: {},
          properties: {
            体质: { type: 'number', default: 5 },
            直觉: { type: 'number', default: 5 },
            悟性: { type: 'number', default: 5 },
          },
        },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    // 旧 bug 会输出 { 先天六维: {} }；正确实现填充子默认
    expect(out).toEqual({ 先天六维: { 体质: 5, 直觉: 5, 悟性: 5 } });
  });

  it('多层嵌套对象递归填充', () => {
    const schema = {
      properties: {
        角色: {
          type: 'object',
          properties: {
            属性: {
              type: 'object',
              properties: {
                体力: { type: 'number', default: 100 },
                法力: { type: 'number', default: 50 },
              },
            },
          },
        },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect(out).toEqual({ 角色: { 属性: { 体力: 100, 法力: 50 } } });
  });
});

describe('buildSchemaDefaultTree — 父默认优先', () => {
  it('父对象 default 提供的键值，不被子属性 default 覆盖', () => {
    const schema = {
      properties: {
        六维: {
          type: 'object',
          default: { 体质: 9 }, // 父级显式给 9
          properties: {
            体质: { type: 'number', default: 5 }, // 子级 default 5 不应覆盖父级 9
            悟性: { type: 'number', default: 5 }, // 父级没给 → 用子级 5
          },
        },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect(out).toEqual({ 六维: { 体质: 9, 悟性: 5 } });
  });
});

describe('buildSchemaDefaultTree — 标量 / 数组 / 缺默认', () => {
  it('标量与数组 default 直接写入', () => {
    const schema = {
      properties: {
        金币: { type: 'number', default: 0 },
        称号: { type: 'string', default: '无名' },
        背包: { type: 'array', default: [] },
        启用: { type: 'boolean', default: false },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect(out).toEqual({ 金币: 0, 称号: '无名', 背包: [], 启用: false });
  });

  it('非对象且无 default 的字段被跳过（key 不出现）', () => {
    const schema = {
      properties: {
        有默认: { type: 'string', default: 'x' },
        无默认: { type: 'string' },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect(out).toEqual({ 有默认: 'x' });
    expect('无默认' in out).toBe(false);
  });

  it('根 schema 无 properties → 返回空对象', () => {
    expect(buildSchemaDefaultTree({})).toEqual({});
    expect(buildSchemaDefaultTree({ type: 'object' })).toEqual({});
  });

  it('对象字段无 default 且子属性全无 default → 不塞空壳', () => {
    const schema = {
      properties: {
        空容器: { type: 'object', properties: { a: { type: 'string' } } },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect('空容器' in out).toBe(false);
  });
});

describe('buildSchemaDefaultTree — $ref 告警', () => {
  it('遇到 $ref 字段时 console.warn 并跳过（不静默丢默认）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = {
      properties: {
        引用字段: { $ref: '#/definitions/Foo' },
        正常字段: { type: 'number', default: 1 },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('$ref');
    expect(out).toEqual({ 正常字段: 1 }); // $ref 字段不出现，正常字段照写
  });
});

describe('buildSchemaDefaultTree — 引用隔离（不可变默认）', () => {
  it('default 对象被深拷贝，改输出不影响 schema 内的 default', () => {
    const sharedDefault = { 体质: 5 };
    const schema = {
      properties: {
        六维: { type: 'object', default: sharedDefault, properties: {} },
      },
    };
    const out = buildSchemaDefaultTree(schema);
    (out.六维 as { 体质: number }).体质 = 999;
    expect(sharedDefault.体质).toBe(5); // schema 的 default 未被污染
  });

  it('两次调用产生互相独立的树', () => {
    const schema = { properties: { 背包: { type: 'array', default: [] } } };
    const a = buildSchemaDefaultTree(schema);
    const b = buildSchemaDefaultTree(schema);
    (a.背包 as unknown[]).push('x');
    expect(b.背包).toEqual([]);
  });
});
