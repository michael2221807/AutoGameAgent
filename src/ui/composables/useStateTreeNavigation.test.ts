/**
 * useStateTreeNavigation 单元测试 —— 锁定行为
 *
 * 目的：把 GameVariablePanel 的导航语义提取后，作为 StateTreeBrowser 复用基础。
 * 这些测试**同时**保护两个组件的行为一致性。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ref } from 'vue';
import {
  useStateTreeNavigation,
  getValueType,
  truncate,
  summarizeNode,
} from './useStateTreeNavigation';

const SAMPLE_TREE = {
  角色: {
    基础信息: { 姓名: '李白', 年龄: 30 },
    身份: { 出身: '贵族', 天赋档次: '上' },
  },
  社交: {
    关系: [
      { 名称: '王五', 类型: '朋友' },
      { 名称: '苏婉', 类型: '恋人' },
      { 名称: '张三', 类型: '中立' },
    ],
  },
  系统: { nsfwMode: false },
};

function makeNav() {
  const tree = ref<unknown>(SAMPLE_TREE);
  const get = <T = unknown>(path: string): T | undefined => {
    const segs = path.split('.').filter(Boolean);
    let cur: unknown = tree.value;
    for (const s of segs) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[s];
      else return undefined;
    }
    return cur as T;
  };
  return useStateTreeNavigation({ tree, get });
}

// ─── helpers ──────────────────────────────────────────

describe('getValueType', () => {
  it('null / undefined → "null"', () => {
    expect(getValueType(null)).toBe('null');
    expect(getValueType(undefined)).toBe('null');
  });
  it('array → "array"', () => {
    expect(getValueType([])).toBe('array');
  });
  it('其他类型 → typeof', () => {
    expect(getValueType('s')).toBe('string');
    expect(getValueType(1)).toBe('number');
    expect(getValueType(true)).toBe('boolean');
    expect(getValueType({})).toBe('object');
  });
});

describe('truncate', () => {
  it('短字符串原样返回', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });
  it('超长追加 …', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde…');
  });
});

describe('summarizeNode', () => {
  it('数组带首项名称', () => {
    expect(summarizeNode('x', [{ 名称: 'A' }, { 名称: 'B' }])).toContain('首项: A');
  });
  it('对象带名称字段', () => {
    expect(summarizeNode('x', { 名称: 'X', y: 1 })).toBe('X');
  });
  it('空对象', () => {
    expect(summarizeNode('x', {})).toBe('(空)');
  });
});

// ─── navigation 主流程 ───────────────────────────────

describe('useStateTreeNavigation — 导航', () => {
  let nav: ReturnType<typeof makeNav>;
  beforeEach(() => { nav = makeNav(); });

  it('初始 selectedPath = "" + breadcrumb = []', () => {
    expect(nav.selectedPath.value).toBe('');
    expect(nav.breadcrumb.value).toEqual([]);
  });

  it('currentChildren 在根时返回顶层 keys', () => {
    const keys = nav.currentChildren.value.map((c) => c.key);
    expect(keys.sort()).toEqual(['systemic_test_keys'.replace('systemic_test_keys', ''), '系统', '社交', '角色'].filter(Boolean).sort());
  });

  it('navigateTo 后 breadcrumb 反映层级', () => {
    nav.navigateTo('角色.基础信息');
    expect(nav.breadcrumb.value).toEqual(['角色', '基础信息']);
  });

  it('数组路径展开为下标节点', () => {
    nav.navigateTo('社交.关系');
    const children = nav.currentChildren.value;
    expect(children).toHaveLength(3);
    expect(children.every((c) => /^\d+$/.test(c.key))).toBe(true);
  });

  it('fieldEntries 标 isComplex 区分对象/标量', () => {
    nav.navigateTo('角色.基础信息');
    const entries = nav.fieldEntries.value;
    const name = entries.find((e) => e.key === '姓名');
    expect(name?.isComplex).toBe(false);
    expect(name?.value).toBe('李白');
  });

  it('navigateBreadcrumb(-1) 回到根', () => {
    nav.navigateTo('角色.基础信息');
    nav.navigateBreadcrumb(-1);
    expect(nav.selectedPath.value).toBe('');
  });

  it('goBack 返回上一层', () => {
    nav.navigateTo('角色.基础信息.姓名');
    nav.goBack();
    expect(nav.selectedPath.value).toBe('角色.基础信息');
    nav.goBack();
    expect(nav.selectedPath.value).toBe('角色');
  });
});

// ─── 搜索 ──────────────────────────────────────────────

describe('useStateTreeNavigation — 搜索', () => {
  let nav: ReturnType<typeof makeNav>;
  beforeEach(() => { nav = makeNav(); });

  it('空查询 → 无结果', () => {
    expect(nav.searchResults.value).toHaveLength(0);
    expect(nav.isSearching.value).toBe(false);
  });

  it('查询命中 path', () => {
    nav.searchQuery.value = '基础信息';
    const paths = nav.searchResults.value.map((r) => r.path);
    expect(paths.some((p) => p.includes('基础信息'))).toBe(true);
    expect(nav.isSearching.value).toBe(true);
  });

  it('navigateToSearchResult 跳到 path 父级 + 清搜索', () => {
    nav.searchQuery.value = '姓名';
    nav.navigateToSearchResult('角色.基础信息.姓名');
    expect(nav.selectedPath.value).toBe('角色.基础信息');
    expect(nav.searchQuery.value).toBe('');
  });
});
