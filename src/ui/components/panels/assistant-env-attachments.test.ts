import { describe, it, expect } from 'vitest';
import {
  buildSetWeatherAttachment,
  buildSetFestivalAttachment,
  buildReplaceEnvironmentAttachment,
  WEATHER_PRESETS,
} from '@/ui/components/panels/assistant-env-attachments';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

describe('buildSetWeatherAttachment', () => {
  it('accepts a valid weather string', () => {
    const result = buildSetWeatherAttachment('暴雨');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(DEFAULT_ENGINE_PATHS.weather);
      expect(result.value).toBe('暴雨');
    }
  });

  it('trims whitespace', () => {
    const result = buildSetWeatherAttachment('  阴雨  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('阴雨');
  });

  it('rejects empty string', () => {
    const result = buildSetWeatherAttachment('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('不能为空');
  });

  it('rejects whitespace-only string', () => {
    const result = buildSetWeatherAttachment('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects non-string (defensive)', () => {
    expect(buildSetWeatherAttachment(null).ok).toBe(false);
    expect(buildSetWeatherAttachment(undefined).ok).toBe(false);
    expect(buildSetWeatherAttachment(42).ok).toBe(false);
    expect(buildSetWeatherAttachment({}).ok).toBe(false);
  });
});

describe('buildSetFestivalAttachment', () => {
  it('accepts a full festival object', () => {
    const result = buildSetFestivalAttachment({
      名称: '元宵节',
      描述: '街上张灯',
      效果: 'NPC 心情更佳',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(DEFAULT_ENGINE_PATHS.festival);
      expect(result.value).toEqual({
        名称: '元宵节',
        描述: '街上张灯',
        效果: 'NPC 心情更佳',
      });
    }
  });

  it('accepts default 平日 reset', () => {
    const result = buildSetFestivalAttachment({ 名称: '平日', 描述: '', 效果: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.名称).toBe('平日');
  });

  it('fills missing 描述/效果 with empty strings', () => {
    const result = buildSetFestivalAttachment({ 名称: '中秋' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ 名称: '中秋', 描述: '', 效果: '' });
    }
  });

  it('rejects empty 名称', () => {
    const r = buildSetFestivalAttachment({ 名称: '', 描述: 'x', 效果: 'y' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('名称');
  });

  it('rejects null / non-object', () => {
    expect(buildSetFestivalAttachment(null).ok).toBe(false);
    expect(buildSetFestivalAttachment('not-object').ok).toBe(false);
    // Arrays pass the typeof-object check but fail on missing 名称 → rejected
    const r = buildSetFestivalAttachment([]);
    expect(r.ok).toBe(false);
  });

  it('trims all three fields', () => {
    const r = buildSetFestivalAttachment({ 名称: '  节  ', 描述: '  d  ', 效果: '  e  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ 名称: '节', 描述: 'd', 效果: 'e' });
  });
});

describe('buildReplaceEnvironmentAttachment', () => {
  it('accepts empty array (clears all tags)', () => {
    const r = buildReplaceEnvironmentAttachment([]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.path).toBe(DEFAULT_ENGINE_PATHS.environmentTags);
      expect(r.value).toEqual([]);
    }
  });

  it('accepts 1-3 valid tags', () => {
    const tags = [
      { 名称: '雷暴', 描述: '电闪雷鸣', 效果: '+感知' },
      { 名称: '泥泞', 描述: '地面湿滑', 效果: '移动困难' },
    ];
    const r = buildReplaceEnvironmentAttachment(tags);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it('rejects more than 3 tags', () => {
    const tags = Array.from({ length: 4 }, (_, i) => ({
      名称: `T${i}`,
      描述: '',
      效果: '',
    }));
    const r = buildReplaceEnvironmentAttachment(tags);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('3');
  });

  it('rejects a tag with empty 名称', () => {
    const r = buildReplaceEnvironmentAttachment([{ 名称: '', 描述: '', 效果: '' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('第 1 条');
  });

  it('rejects non-array', () => {
    expect(buildReplaceEnvironmentAttachment(null).ok).toBe(false);
    expect(buildReplaceEnvironmentAttachment('not-array').ok).toBe(false);
    expect(buildReplaceEnvironmentAttachment({ fake: 'obj' }).ok).toBe(false);
  });

  it('rejects non-object entries', () => {
    const r = buildReplaceEnvironmentAttachment(['not-an-object']);
    expect(r.ok).toBe(false);
  });

  it('trims and normalizes 描述/效果 fields', () => {
    const r = buildReplaceEnvironmentAttachment([
      { 名称: '雷暴', 描述: '  电闪  ', 效果: '  +感  ' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]).toEqual({ 名称: '雷暴', 描述: '电闪', 效果: '+感' });
  });

  it('fills non-string 描述/效果 with empty strings (lenient)', () => {
    const r = buildReplaceEnvironmentAttachment([{ 名称: '雷暴' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]).toEqual({ 名称: '雷暴', 描述: '', 效果: '' });
  });
});

describe('WEATHER_PRESETS', () => {
  it('includes common weather names', () => {
    expect(WEATHER_PRESETS).toContain('晴');
    expect(WEATHER_PRESETS).toContain('暴雨');
    expect(WEATHER_PRESETS).toContain('大雾');
  });

  it('has 晴 as the first preset', () => {
    expect(WEATHER_PRESETS[0]).toBe('晴');
  });
});
