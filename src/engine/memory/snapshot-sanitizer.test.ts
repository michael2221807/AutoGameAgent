/**
 * snapshot-sanitizer tests.
 *
 * Guards the strip-list contract: PROMPT_ALWAYS_STRIP_PATHS removes narrative
 * history / memory / engram / snapshot always; NSFW_STRIP_PATHS removes
 * 私密信息 / 身体 only when nsfwMode=false.
 *
 * 2026-04-19 env-tags port (P0): added explicit pass-through regression tests
 * for 世界.天气 / 世界.节日 / 世界.环境. If any of these ever gets added to a
 * strip list, the env tags won't reach the AI and the feature silently breaks.
 */
import { describe, it, expect } from 'vitest';
import { stringifySnapshotForPrompt } from '@/engine/memory/snapshot-sanitizer';

/**
 * Normalize `JSON.stringify` output by collapsing whitespace between tokens.
 * Lets assertions match the key-value pairs without depending on pretty-print
 * flags (`"天气":"暴雨"` vs `"天气": "暴雨"` both match after normalize).
 */
function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

function buildSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    元数据: {
      回合序号: 5,
      叙事历史: [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }],
      上次对话前快照: { should: 'be-stripped' },
    },
    记忆: {
      短期: ['s1', 's2'],
      中期: ['m1'],
      长期: ['l1'],
      隐式中期: ['im1'],
    },
    世界: {
      描述: '开阔大地',
      天气: '暴雨',
      节日: { 名称: '元宵节', 描述: '街上张灯结彩', 效果: 'NPC 心情更佳' },
      环境: [
        { 名称: '雾气弥漫', 描述: '能见度极低', 效果: '-3 感知' },
        { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
      ],
      时间: { 年: 1, 月: 1, 日: 1, 小时: 8, 分钟: 0 },
    },
    社交: {
      关系: [
        {
          名称: '林曦',
          性别: '女',
          私密信息: { secret: 'nsfw-stuff' },
        },
      ],
    },
    角色: {
      基础信息: { 姓名: '主角' },
      身体: { secret: 'nsfw-stuff' },
    },
    系统: { 扩展: { engramMemory: { tons: 'of-stuff' } } },
    ...overrides,
  };
}

describe('stringifySnapshotForPrompt — always-strip paths', () => {
  it('strips 元数据.叙事历史', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).not.toContain('叙事历史');
    expect(out).not.toContain('a1');
  });

  it('strips 记忆.短期/中期/长期/隐式中期', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).not.toContain('s1');
    expect(out).not.toContain('m1');
    expect(out).not.toContain('l1');
    expect(out).not.toContain('im1');
  });

  it('strips 系统.扩展.engramMemory', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).not.toContain('tons');
  });

  it('strips 元数据.上次对话前快照', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).not.toContain('be-stripped');
  });
});

describe('stringifySnapshotForPrompt — NSFW strip paths', () => {
  it('strips 私密信息 and 角色.身体 when nsfwMode=false', () => {
    // Use distinct sentinels so we can check each path independently.
    const snap = buildSnapshot({
      社交: { 关系: [{ 名称: '林曦', 性别: '女', 私密信息: { secret: 'NPC-PRIVATE' } }] },
      角色: { 基础信息: { 姓名: '主角' }, 身体: { secret: 'PLAYER-BODY' } },
    });
    const out = stringifySnapshotForPrompt(snap, false);
    expect(out).not.toContain('NPC-PRIVATE');
    expect(out).not.toContain('PLAYER-BODY');
  });

  it('keeps NPC 私密信息 when nsfwMode=true', () => {
    const snap = buildSnapshot({
      社交: { 关系: [{ 名称: '林曦', 性别: '女', 私密信息: { secret: 'NPC-PRIVATE' } }] },
      角色: { 基础信息: { 姓名: '主角' }, 身体: { secret: 'PLAYER-BODY' } },
    });
    const out = stringifySnapshotForPrompt(snap, true);
    expect(out).toContain('NPC-PRIVATE');
  });

  it('keeps 角色.身体 when nsfwMode=true', () => {
    const snap = buildSnapshot({
      社交: { 关系: [{ 名称: '林曦', 性别: '女', 私密信息: { secret: 'NPC-PRIVATE' } }] },
      角色: { 基础信息: { 姓名: '主角' }, 身体: { secret: 'PLAYER-BODY' } },
    });
    const out = stringifySnapshotForPrompt(snap, true);
    expect(out).toContain('PLAYER-BODY');
  });
});

describe('stringifySnapshotForPrompt — env tags pass-through (P0 env-tags port 2026-04-19)', () => {
  // These three must ALWAYS reach the AI. Any regression where one of these
  // paths gets added to a strip list means the env-tags feature silently
  // breaks (UI still shows tags but AI is blind to them).

  it('preserves 世界.天气 when nsfwMode=false', () => {
    const out = normalize(stringifySnapshotForPrompt(buildSnapshot(), false));
    expect(out).toContain('"天气":"暴雨"');
  });

  it('preserves 世界.天气 when nsfwMode=true', () => {
    const out = normalize(stringifySnapshotForPrompt(buildSnapshot(), true));
    expect(out).toContain('"天气":"暴雨"');
  });

  it('preserves 世界.节日 object intact when nsfwMode=false', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).toContain('元宵节');
    expect(out).toContain('街上张灯结彩');
    expect(out).toContain('NPC 心情更佳');
  });

  it('preserves 世界.节日 when nsfwMode=true', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), true);
    expect(out).toContain('元宵节');
  });

  it('preserves 世界.环境 array with all tags when nsfwMode=false', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), false);
    expect(out).toContain('雾气弥漫');
    expect(out).toContain('能见度极低');
    expect(out).toContain('-3 感知');
    expect(out).toContain('泥泞');
    expect(out).toContain('地面湿滑');
    expect(out).toContain('移动困难');
  });

  it('preserves 世界.环境 when nsfwMode=true', () => {
    const out = stringifySnapshotForPrompt(buildSnapshot(), true);
    expect(out).toContain('雾气弥漫');
    expect(out).toContain('泥泞');
  });

  it('preserves empty/default env state intact', () => {
    const snapshot = {
      世界: {
        天气: '晴',
        节日: { 名称: '平日', 描述: '', 效果: '' },
        环境: [],
      },
    };
    const out = normalize(stringifySnapshotForPrompt(snapshot, false));
    expect(out).toContain('"天气":"晴"');
    expect(out).toContain('"名称":"平日"');
    expect(out).toContain('"环境":[]');
  });
});
