/**
 * assistant-blocklist 单元测试
 *
 * 覆盖：所有 5 个黑名单模式的边界条件 + normalizeStatePath。
 */
import { describe, it, expect } from 'vitest';
import { isBlockedPath, normalizeStatePath, ASSISTANT_BLOCKED_PATTERNS } from './assistant-blocklist';

describe('isBlockedPath — 元数据', () => {
  it('blocks 元数据 root', () => {
    expect(isBlockedPath('元数据')).toBe(true);
  });
  it('blocks 元数据.叙事历史', () => {
    expect(isBlockedPath('元数据.叙事历史')).toBe(true);
  });
  it('blocks $.元数据.游戏包名称', () => {
    expect(isBlockedPath('$.元数据.游戏包名称')).toBe(true);
  });
  it('does NOT block 元数据X (边界字符校验)', () => {
    expect(isBlockedPath('元数据X')).toBe(false);
    expect(isBlockedPath('元数据X.foo')).toBe(false);
  });
});

describe('isBlockedPath — 系统', () => {
  it('blocks 系统 root + nested API key', () => {
    expect(isBlockedPath('系统')).toBe(true);
    expect(isBlockedPath('系统.api.openai')).toBe(true);
    expect(isBlockedPath('系统.nsfwMode')).toBe(true);
  });
});

describe('isBlockedPath — 世界.时间', () => {
  it('blocks 世界.时间.* but NOT 世界 root or 世界.其他', () => {
    expect(isBlockedPath('世界.时间')).toBe(true);
    expect(isBlockedPath('世界.时间.年')).toBe(true);
    expect(isBlockedPath('世界')).toBe(false);
    expect(isBlockedPath('世界.描述')).toBe(false);
    expect(isBlockedPath('世界.地点信息')).toBe(false);
  });
});

describe('isBlockedPath — 世界.状态.心跳', () => {
  it('blocks 心跳 subtree only', () => {
    expect(isBlockedPath('世界.状态.心跳')).toBe(true);
    expect(isBlockedPath('世界.状态.心跳.配置')).toBe(true);
    expect(isBlockedPath('世界.状态')).toBe(false);
  });
});

describe('isBlockedPath — 角色.身份.先天六维', () => {
  it('blocks 先天六维 only, allows other 身份 fields', () => {
    expect(isBlockedPath('角色.身份.先天六维')).toBe(true);
    expect(isBlockedPath('角色.身份.先天六维.体质')).toBe(true);
    expect(isBlockedPath('角色.身份')).toBe(false);
    expect(isBlockedPath('角色.身份.出身')).toBe(false);
    expect(isBlockedPath('角色.身份.天赋')).toBe(false);
  });
});

describe('isBlockedPath — 防御性输入', () => {
  it('rejects empty string', () => {
    expect(isBlockedPath('')).toBe(true);
  });
  it('rejects non-string types', () => {
    // @ts-expect-error
    expect(isBlockedPath(null)).toBe(true);
    // @ts-expect-error
    expect(isBlockedPath(undefined)).toBe(true);
    // @ts-expect-error
    expect(isBlockedPath(123)).toBe(true);
  });
  it('does not block 社交 / 角色 / 世界.地点信息 等正常路径', () => {
    expect(isBlockedPath('社交.关系')).toBe(false);
    expect(isBlockedPath('角色.基础信息')).toBe(false);
    expect(isBlockedPath('世界.地点信息')).toBe(false);
  });
});

describe('normalizeStatePath', () => {
  it('strips $. prefix', () => {
    expect(normalizeStatePath('$.角色.基础信息')).toBe('角色.基础信息');
  });
  it('leaves prefix-less paths alone', () => {
    expect(normalizeStatePath('角色.基础信息')).toBe('角色.基础信息');
  });
  it('returns empty for non-string input', () => {
    // @ts-expect-error
    expect(normalizeStatePath(null)).toBe('');
  });
});

describe('ASSISTANT_BLOCKED_PATTERNS — 防御性常量', () => {
  it('is frozen to prevent runtime mutation', () => {
    expect(Object.isFrozen(ASSISTANT_BLOCKED_PATTERNS)).toBe(true);
  });
  it('contains exactly 5 patterns (lock count for safety)', () => {
    expect(ASSISTANT_BLOCKED_PATTERNS).toHaveLength(5);
  });
});
