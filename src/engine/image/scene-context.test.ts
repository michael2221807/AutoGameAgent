import { describe, it, expect } from 'vitest';
import {
  parseLocationHierarchy,
  formatGameTimeForScene,
  buildSceneContext,
  parseSceneResponse,
  deriveFestivalName,
  deriveEnvironmentSummary,
} from '@/engine/image/scene-context';

describe('parseLocationHierarchy', () => {
  it('parses 3-part path correctly', () => {
    const result = parseLocationHierarchy('东荒大陆·青云城·客栈');
    expect(result.broad).toBe('东荒大陆');
    expect(result.mid).toBe('青云城');
    expect(result.specific).toBe('客栈');
    expect(result.fullPath).toBe('东荒大陆·青云城·客栈');
  });

  it('parses 2-part path (no broad)', () => {
    const result = parseLocationHierarchy('青云城·客栈');
    expect(result.broad).toBe('');
    expect(result.mid).toBe('青云城');
    expect(result.specific).toBe('客栈');
  });

  it('parses 1-part path (specific only)', () => {
    const result = parseLocationHierarchy('客栈');
    expect(result.broad).toBe('');
    expect(result.mid).toBe('');
    expect(result.specific).toBe('客栈');
  });

  it('takes innermost 3 layers for 5+ part paths', () => {
    const result = parseLocationHierarchy('大陆·国·城·街·店');
    expect(result.broad).toBe('城');
    expect(result.mid).toBe('街');
    expect(result.specific).toBe('店');
  });

  it('handles empty/null input gracefully', () => {
    expect(parseLocationHierarchy('')).toEqual({ broad: '', mid: '', specific: '', fullPath: '' });
    expect(parseLocationHierarchy('  ')).toEqual({ broad: '', mid: '', specific: '', fullPath: '' });
  });

  it('trims whitespace in path parts', () => {
    const result = parseLocationHierarchy(' 大陆 · 城 · 客栈 ');
    expect(result.broad).toBe('大陆');
    expect(result.mid).toBe('城');
    expect(result.specific).toBe('客栈');
  });
});

describe('formatGameTimeForScene', () => {
  it('returns time-of-day for morning', () => {
    expect(formatGameTimeForScene({ hour: 8 })).toContain('清晨');
  });

  it('returns time-of-day for night', () => {
    expect(formatGameTimeForScene({ hour: 21 })).toContain('夜晚');
  });

  it('includes season for month', () => {
    expect(formatGameTimeForScene({ month: 7, hour: 14 })).toContain('夏季');
    expect(formatGameTimeForScene({ month: 7, hour: 14 })).toContain('下午');
  });

  it('returns empty for null/undefined', () => {
    expect(formatGameTimeForScene(null)).toBe('');
    expect(formatGameTimeForScene(undefined)).toBe('');
  });
});

describe('buildSceneContext', () => {
  it('builds complete context from params', () => {
    const ctx = buildSceneContext({
      narrativeText: '夜色中，客栈的灯火闪烁...',
      locationPath: '东荒大陆·青云城·客栈',
      gameTime: { year: 1, month: 3, day: 15, hour: 21, minute: 30 },
      presentNpcs: ['林清霜', '萧无痕'],
      compositionMode: 'auto',
    });
    expect(ctx.location.specific).toBe('客栈');
    expect(ctx.location.broad).toBe('东荒大陆');
    expect(ctx.timeDescription).toContain('夜晚');
    expect(ctx.timeDescription).toContain('春季');
    expect(ctx.presentNpcs).toEqual(['林清霜', '萧无痕']);
    expect(ctx.narrativeText).toContain('灯火闪烁');
  });

  it('defaults to auto composition mode', () => {
    const ctx = buildSceneContext({ narrativeText: 'test', locationPath: '城' });
    expect(ctx.compositionMode).toBe('auto');
  });
});

describe('parseSceneResponse', () => {
  it('detects landscape from explicit judgment', () => {
    const raw = '<场景判定>不适合场景快照</场景判定><场景类型>风景场景</场景类型><判定说明>文本为对话</判定说明><提示词结构><基础>scenery tags</基础></提示词结构>';
    const result = parseSceneResponse(raw);
    expect(result.sceneType).toBe('landscape');
    expect(result.judgmentExplanation).toContain('对话');
    expect(result.promptContent).toContain('scenery tags');
  });

  it('detects snapshot from explicit judgment', () => {
    const raw = '<场景判定>适合场景快照</场景判定><场景类型>场景快照</场景类型><判定说明>有明确互动</判定说明><提示词结构><基础>scene</基础><角色>[1] Alice | 1girl</角色></提示词结构>';
    const result = parseSceneResponse(raw);
    expect(result.sceneType).toBe('snapshot');
    expect(result.promptContent).toContain('角色');
  });

  it('defaults to landscape when no judgment tags', () => {
    const raw = '<提示词结构><基础>mountain scenery</基础></提示词结构>';
    const result = parseSceneResponse(raw);
    expect(result.sceneType).toBe('landscape');
    expect(result.judgmentExplanation).toContain('风景');
  });

  it('extracts prompt content from structured block', () => {
    const raw = '<thinking>plan</thinking><提示词结构><基础>tags here</基础></提示词结构>';
    const result = parseSceneResponse(raw);
    expect(result.promptContent).toContain('tags here');
  });

  it('provides default explanation when none found', () => {
    const raw = '1girl, landscape, sunset';
    const result = parseSceneResponse(raw);
    expect(result.judgmentExplanation.length).toBeGreaterThan(0);
  });
});

// P3 env-tags port (2026-04-19) — scene context weather / festival / env passthrough
describe('deriveFestivalName', () => {
  it('returns empty for default 平日 with empty desc+effect', () => {
    expect(deriveFestivalName({ 名称: '平日', 描述: '', 效果: '' })).toBe('');
  });

  it('returns name for a named festival', () => {
    expect(deriveFestivalName({ 名称: '元宵节', 描述: '街景', 效果: '' })).toBe('元宵节');
  });

  it('returns 平日 when user customized description', () => {
    // Non-default desc on 平日 — surface so decoration tokens get added.
    expect(deriveFestivalName({ 名称: '平日', 描述: '悠闲日常', 效果: '' })).toBe('平日');
  });

  it('returns empty on null / non-object', () => {
    expect(deriveFestivalName(null)).toBe('');
    expect(deriveFestivalName(undefined)).toBe('');
    expect(deriveFestivalName('not-object')).toBe('');
  });

  it('returns empty on missing 名称', () => {
    expect(deriveFestivalName({ 描述: 'x', 效果: 'y' })).toBe('');
    expect(deriveFestivalName({ 名称: '', 描述: 'x', 效果: 'y' })).toBe('');
  });

  it('trims whitespace in 名称', () => {
    expect(deriveFestivalName({ 名称: '  中秋  ', 描述: '', 效果: '' })).toBe('中秋');
  });
});

describe('deriveEnvironmentSummary', () => {
  it('joins 名称 values with 、', () => {
    const tags = [
      { 名称: '暴雨', 描述: '', 效果: '' },
      { 名称: '泥泞', 描述: '', 效果: '' },
      { 名称: '昏暗', 描述: '', 效果: '' },
    ];
    expect(deriveEnvironmentSummary(tags)).toBe('暴雨、泥泞、昏暗');
  });

  it('returns empty string on empty array', () => {
    expect(deriveEnvironmentSummary([])).toBe('');
  });

  it('returns empty on non-array', () => {
    expect(deriveEnvironmentSummary(null)).toBe('');
    expect(deriveEnvironmentSummary({})).toBe('');
    expect(deriveEnvironmentSummary('not-array')).toBe('');
  });

  it('skips malformed entries silently', () => {
    const tags = [
      { 名称: 'A', 描述: '', 效果: '' },
      null,
      { 名称: '' }, // empty name → skipped
      { 描述: 'no name', 效果: 'x' }, // missing 名称 → skipped
      { 名称: 'B', 描述: '', 效果: '' },
    ];
    expect(deriveEnvironmentSummary(tags)).toBe('A、B');
  });

  it('trims whitespace', () => {
    const tags = [{ 名称: '  妖雾  ', 描述: '', 效果: '' }];
    expect(deriveEnvironmentSummary(tags)).toBe('妖雾');
  });
});

describe('buildSceneContext — P3 env-tags fields', () => {
  it('populates weather / festivalName / environmentSummary when all present', () => {
    const ctx = buildSceneContext({
      narrativeText: 'test',
      locationPath: '城·街·店',
      weather: '暴雨',
      festival: { 名称: '元宵节', 描述: '街上张灯', 效果: 'NPC 心情更佳' },
      environment: [
        { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
        { 名称: '昏暗', 描述: '能见度低', 效果: '-3感知' },
      ],
    });
    expect(ctx.weather).toBe('暴雨');
    expect(ctx.festivalName).toBe('元宵节');
    expect(ctx.environmentSummary).toBe('泥泞、昏暗');
  });

  it('defaults weather to 晴 when absent', () => {
    const ctx = buildSceneContext({ narrativeText: 'x', locationPath: '城' });
    expect(ctx.weather).toBe('晴');
  });

  it('defaults festivalName to empty string when default 平日', () => {
    const ctx = buildSceneContext({
      narrativeText: 'x',
      locationPath: '城',
      festival: { 名称: '平日', 描述: '', 效果: '' },
    });
    expect(ctx.festivalName).toBe('');
  });

  it('defaults environmentSummary to empty string when array empty', () => {
    const ctx = buildSceneContext({
      narrativeText: 'x',
      locationPath: '城',
      environment: [],
    });
    expect(ctx.environmentSummary).toBe('');
  });

  it('handles fully malformed env inputs defensively', () => {
    const ctx = buildSceneContext({
      narrativeText: 'x',
      locationPath: '城',
      weather: null as unknown as string,
      festival: 'not-object',
      environment: { not: 'an-array' },
    });
    expect(ctx.weather).toBe('晴');
    expect(ctx.festivalName).toBe('');
    expect(ctx.environmentSummary).toBe('');
  });
});
