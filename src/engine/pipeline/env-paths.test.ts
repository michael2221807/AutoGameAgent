/**
 * Engine path constants smoke test (env-tags port P0, 2026-04-19).
 *
 * Guards the three new path constants that the environment-tags feature
 * depends on. If someone renames `DEFAULT_ENGINE_PATHS.weather` by mistake,
 * status-bar + sanitizer tests would still pass (they use hardcoded paths)
 * but runtime integration would silently misread the state tree. This test
 * anchors the string values.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

describe('DEFAULT_ENGINE_PATHS — environment-tags paths', () => {
  it('weather points to 世界.天气', () => {
    expect(DEFAULT_ENGINE_PATHS.weather).toBe('世界.天气');
  });

  it('festival points to 世界.节日', () => {
    expect(DEFAULT_ENGINE_PATHS.festival).toBe('世界.节日');
  });

  it('environmentTags points to 世界.环境', () => {
    expect(DEFAULT_ENGINE_PATHS.environmentTags).toBe('世界.环境');
  });

  it('none of the three collide with existing string-valued paths', () => {
    const newKeys = new Set(['weather', 'festival', 'environmentTags']);
    const newPaths = [...newKeys].map(
      (k) => DEFAULT_ENGINE_PATHS[k as keyof typeof DEFAULT_ENGINE_PATHS] as string,
    );
    // Filter to other string-valued entries only. `typeof v === 'string'`
    // naturally skips `npcFieldNames` (object) and any future sub-object
    // additions to EnginePathConfig — more robust than a manual exclusion list.
    const others = Object.entries(DEFAULT_ENGINE_PATHS)
      .filter(([k, v]) => !newKeys.has(k) && typeof v === 'string')
      .map(([, v]) => v as string);

    for (const path of newPaths) {
      expect(others).not.toContain(path);
    }
  });
});
