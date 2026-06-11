/**
 * deepMergeOverlay 单元测试 — Story 6 P1 共享原语
 *
 * 锚定稀疏 overlay 合并语义：深合并 / 数组替换 / 缺键保底 / 纯函数（不改入参）。
 */
import { describe, it, expect } from 'vitest';
import { deepMergeOverlay } from './state-merge';

describe('deepMergeOverlay — 深合并', () => {
  it('嵌套对象逐层合并，overlay 叶子胜出', () => {
    const base = { a: { x: 1, y: 2 }, b: 10 };
    const overlay = { a: { y: 99 } };
    const out = deepMergeOverlay(base, overlay);
    expect(out).toEqual({ a: { x: 1, y: 99 }, b: 10 });
  });

  it('overlay 中缺失的键保留 base 值（稀疏 overlay 的保底语义）', () => {
    const base = { 世界: { 天气: '晴', 节日: '无' }, 历史: ['a', 'b'] };
    const overlay = { 世界: { 天气: '雨' } }; // 节日、历史 都缺
    const out = deepMergeOverlay(base, overlay);
    expect(out).toEqual({ 世界: { 天气: '雨', 节日: '无' }, 历史: ['a', 'b'] });
  });

  it('overlay 引入 base 没有的新键', () => {
    const base = { a: 1 };
    const overlay = { b: 2, c: { d: 3 } };
    const out = deepMergeOverlay(base, overlay);
    expect(out).toEqual({ a: 1, b: 2, c: { d: 3 } });
  });
});

describe('deepMergeOverlay — 数组替换（关键语义）', () => {
  it('overlay 数组整体替换 base 数组，而非按索引合并', () => {
    const base = { list: [1, 2, 3, 4, 5] };
    const overlay = { list: [9, 8] };
    const out = deepMergeOverlay(base, overlay);
    // lodash 默认 merge 会得到 [9,8,3,4,5]；本原语必须得到 [9,8]
    expect(out.list).toEqual([9, 8]);
  });

  it('对象数组也整体替换（不 by-index 合并对象元素）', () => {
    const base = { npcs: [{ name: 'A', hp: 100 }, { name: 'B', hp: 50 }] };
    const overlay = { npcs: [{ name: 'C' }] };
    const out = deepMergeOverlay(base, overlay);
    expect(out.npcs).toEqual([{ name: 'C' }]);
  });

  it('overlay 用空数组替换非空 base 数组', () => {
    const base = { tags: ['x', 'y'] };
    const overlay = { tags: [] };
    const out = deepMergeOverlay(base, overlay);
    expect(out.tags).toEqual([]);
  });

  it('嵌套在对象里的数组同样整体替换', () => {
    const base = { world: { events: [1, 2, 3], name: 'w' } };
    const overlay = { world: { events: [7] } };
    const out = deepMergeOverlay(base, overlay);
    expect(out.world).toEqual({ events: [7], name: 'w' });
  });
});

describe('deepMergeOverlay — null / undefined', () => {
  it('overlay 的 null 覆盖 base 值', () => {
    const base = { a: { x: 1 } };
    const overlay = { a: null };
    const out = deepMergeOverlay(base, overlay);
    expect(out.a).toBeNull();
  });

  it('overlay 的 undefined 被跳过，base 值存活（lodash mergeWith 行为）', () => {
    const base = { a: 1, b: 2 };
    const overlay = { a: undefined };
    const out = deepMergeOverlay(base, overlay);
    expect(out.a).toBe(1);
    expect(out.b).toBe(2);
  });
});

describe('deepMergeOverlay — 纯函数（不可变）', () => {
  it('不修改 base 入参', () => {
    const base = { a: { x: 1 }, list: [1, 2] };
    const snapshot = structuredClone(base);
    deepMergeOverlay(base, { a: { x: 99 }, list: [3] });
    expect(base).toEqual(snapshot);
  });

  it('不修改 overlay 入参', () => {
    const overlay = { a: { x: 99 }, list: [3] };
    const snapshot = structuredClone(overlay);
    deepMergeOverlay({ a: { x: 1 } }, overlay);
    expect(overlay).toEqual(snapshot);
  });

  it('返回值与 base 无共享引用（改结果不影响 base）', () => {
    const base = { a: { x: 1 } };
    const out = deepMergeOverlay(base, {});
    (out.a as { x: number }).x = 999;
    expect(base.a.x).toBe(1);
  });

  it('返回值的替换数组与 overlay 无共享引用', () => {
    const overlay = { list: [1, 2] };
    const out = deepMergeOverlay({ list: [] }, overlay);
    (out.list as number[]).push(3);
    expect(overlay.list).toEqual([1, 2]);
  });

  it('空 overlay 等价返回 base 的深拷贝', () => {
    const base = { a: { x: 1 }, b: [1, 2] };
    const out = deepMergeOverlay(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
});
