import { describe, it, expect } from 'vitest';
import { buildEnvironmentBlock } from '@/engine/prompt/environment-block';

describe('buildEnvironmentBlock — default state', () => {
  it('returns the three-line default block when given no input', () => {
    const out = buildEnvironmentBlock({});
    expect(out).toBe('【当前环境】\n天气：晴\n节日：平日\n环境标签：（空）');
  });

  it('returns defaults when fields are undefined', () => {
    const out = buildEnvironmentBlock({
      weather: undefined,
      festival: undefined,
      environment: undefined,
    });
    expect(out).toContain('天气：晴');
    expect(out).toContain('节日：平日');
    expect(out).toContain('环境标签：（空）');
  });

  it('returns defaults when fields are null', () => {
    const out = buildEnvironmentBlock({
      weather: null,
      festival: null,
      environment: null,
    });
    expect(out).toContain('天气：晴');
    expect(out).toContain('节日：平日');
    expect(out).toContain('环境标签：（空）');
  });
});

describe('buildEnvironmentBlock — weather', () => {
  it('uses the weather string when valid', () => {
    expect(buildEnvironmentBlock({ weather: '暴雨' })).toContain('天气：暴雨');
  });

  it('trims whitespace', () => {
    expect(buildEnvironmentBlock({ weather: '  阴雨  ' })).toContain('天气：阴雨');
  });

  it('falls back to 晴 on empty string', () => {
    expect(buildEnvironmentBlock({ weather: '   ' })).toContain('天气：晴');
  });

  it('falls back on non-string (defensive)', () => {
    expect(buildEnvironmentBlock({ weather: 42 })).toContain('天气：晴');
  });
});

describe('buildEnvironmentBlock — festival', () => {
  it('shows default 平日 line when festival is the default object', () => {
    const out = buildEnvironmentBlock({
      festival: { 名称: '平日', 描述: '', 效果: '' },
    });
    expect(out).toContain('节日：平日');
    expect(out).not.toContain('（）');
    expect(out).not.toContain('效果：');
  });

  it('shows named festival with 描述 + 效果', () => {
    const out = buildEnvironmentBlock({
      festival: { 名称: '元宵节', 描述: '街上张灯结彩', 效果: 'NPC 心情更佳' },
    });
    expect(out).toContain('节日：元宵节（街上张灯结彩） — 效果：NPC 心情更佳');
  });

  it('omits 描述 parenthesis when empty', () => {
    const out = buildEnvironmentBlock({
      festival: { 名称: '中秋', 描述: '', 效果: '团圆氛围' },
    });
    expect(out).toContain('节日：中秋 — 效果：团圆氛围');
    expect(out).not.toContain('（）');
  });

  it('omits 效果 when empty', () => {
    const out = buildEnvironmentBlock({
      festival: { 名称: '除夕', 描述: '守岁', 效果: '' },
    });
    expect(out).toContain('节日：除夕（守岁）');
    expect(out).not.toMatch(/除夕.*—.*效果/);
  });

  it('falls back to 平日 on missing 名称', () => {
    expect(buildEnvironmentBlock({ festival: {} })).toContain('节日：平日');
  });

  it('falls back to 平日 on non-object', () => {
    expect(buildEnvironmentBlock({ festival: 'not-a-festival' })).toContain('节日：平日');
  });

  it('trims festival fields', () => {
    const out = buildEnvironmentBlock({
      festival: { 名称: '  节日  ', 描述: '  d  ', 效果: '  e  ' },
    });
    expect(out).toContain('节日：节日（d） — 效果：e');
  });
});

describe('buildEnvironmentBlock — environment array', () => {
  it('shows （空） when the array is empty', () => {
    expect(buildEnvironmentBlock({ environment: [] })).toContain('环境标签：（空）');
  });

  it('shows （空） on non-array', () => {
    expect(buildEnvironmentBlock({ environment: 'not-array' })).toContain('环境标签：（空）');
  });

  it('renders one tag as a bullet', () => {
    const out = buildEnvironmentBlock({
      environment: [{ 名称: '雾气弥漫', 描述: '能见度极低', 效果: '-3感知' }],
    });
    expect(out).toContain('环境标签：\n  - 雾气弥漫（能见度极低） — 效果：-3感知');
  });

  it('renders multiple tags on separate bullet lines', () => {
    const out = buildEnvironmentBlock({
      environment: [
        { 名称: '雾气弥漫', 描述: '能见度极低', 效果: '-3感知' },
        { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
      ],
    });
    expect(out).toContain('  - 雾气弥漫（能见度极低） — 效果：-3感知');
    expect(out).toContain('  - 泥泞（地面湿滑） — 效果：移动困难');
  });

  it('skips malformed tags silently', () => {
    const out = buildEnvironmentBlock({
      environment: [
        { 名称: 'A', 描述: 'd', 效果: 'e' },
        { 名称: '', 描述: 'bad', 效果: 'bad' },
        null,
        { 名称: 'B', 描述: 'd2', 效果: 'e2' },
      ],
    });
    expect(out).toContain('  - A');
    expect(out).toContain('  - B');
    expect(out.match(/^  - /gm) ?? []).toHaveLength(2);
  });

  it('renders tag with empty 描述 + 效果 as bare name', () => {
    const out = buildEnvironmentBlock({
      environment: [{ 名称: 'A', 描述: '', 效果: '' }],
    });
    expect(out).toMatch(/  - A$/m);
    // Assert no decorations follow the bare name on that line
    expect(out).not.toMatch(/- A[（ ]/);
  });
});

describe('buildEnvironmentBlock — full integration shape', () => {
  it('matches the reference example end-to-end', () => {
    const out = buildEnvironmentBlock({
      weather: '暴雨',
      festival: { 名称: '元宵节', 描述: '街上张灯结彩', 效果: 'NPC 心情更佳' },
      environment: [
        { 名称: '雾气弥漫', 描述: '能见度极低', 效果: '-3感知' },
        { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
      ],
    });
    expect(out).toBe(
      [
        '【当前环境】',
        '天气：暴雨',
        '节日：元宵节（街上张灯结彩） — 效果：NPC 心情更佳',
        '环境标签：',
        '  - 雾气弥漫（能见度极低） — 效果：-3感知',
        '  - 泥泞（地面湿滑） — 效果：移动困难',
      ].join('\n'),
    );
  });

  it('never throws on fully malformed input', () => {
    // All three fields already typed as `unknown` in `EnvironmentBlockInput` —
    // the object satisfies the type at compile time, no cast needed.
    expect(() =>
      buildEnvironmentBlock({
        weather: { not: 'a-string' },
        festival: [],
        environment: { not: 'an-array' },
      }),
    ).not.toThrow();
  });
});
