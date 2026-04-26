/**
 * Pure builders for env-tags quick-action attachments in AssistantPanel (P4, 2026-04-19).
 *
 * These are NOT AI-mediated attachments (`AttachmentSpec`). They represent
 * **deterministic state writes** the user composes in a modal, then fires
 * directly via `useGameState.setValue`. The AssistantPanel is just where
 * the entry points live — no AI round-trip is needed to change weather.
 *
 * The builders validate input + produce a `{path, value}` tuple aligned with
 * the P2 force-update convention (`set` on 世界.天气 / 世界.节日 / 世界.环境 —
 * never push/delete on the array). Keeping them in a sibling `.ts` file
 * lets tests exercise the validation without a Vue harness.
 */

import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

/** Shape of a festival / environment tag object. Matches the P0 schema. */
export interface EnvTag {
  名称: string;
  描述: string;
  效果: string;
}

/** Result of a builder — `ok: false` surfaces a reason to the UI. */
export type BuilderResult<T> =
  | { ok: true; path: string; value: T }
  | { ok: false; reason: string };

/**
 * Build a `{path, value}` for `set 世界.天气 = <name>`. Trims whitespace.
 * Rejects empty strings (AI might tolerate "" but the user picker should
 * force an explicit choice).
 */
export function buildSetWeatherAttachment(weather: unknown): BuilderResult<string> {
  if (typeof weather !== 'string') {
    return { ok: false, reason: '天气必须是字符串' };
  }
  const trimmed = weather.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: '天气不能为空' };
  }
  return {
    ok: true,
    path: DEFAULT_ENGINE_PATHS.weather,
    value: trimmed,
  };
}

/**
 * Build a `{path, value}` for `set 世界.节日 = {名称, 描述, 效果}`.
 *
 * Accepts `名称 = "平日"` with empty desc/effect — that's the valid "reset
 * to default" value. Rejects empty 名称 (must at least declare the festival
 * name; desc/effect can be empty).
 */
export function buildSetFestivalAttachment(festival: unknown): BuilderResult<EnvTag> {
  if (!festival || typeof festival !== 'object') {
    return { ok: false, reason: '节日必须是对象' };
  }
  const f = festival as Record<string, unknown>;
  const name = typeof f.名称 === 'string' ? f.名称.trim() : '';
  if (name.length === 0) {
    return { ok: false, reason: '节日名称不能为空（平日也要写"平日"）' };
  }
  return {
    ok: true,
    path: DEFAULT_ENGINE_PATHS.festival,
    value: {
      名称: name,
      描述: typeof f.描述 === 'string' ? f.描述.trim() : '',
      效果: typeof f.效果 === 'string' ? f.效果.trim() : '',
    },
  };
}

/**
 * Build a `{path, value}` for `set 世界.环境 = [...]`.
 *
 * Accepts an empty array (clears all env tags). Rejects when:
 * - not an array
 * - any entry has empty 名称 (partial entries produce garbage in status-bar)
 * - more than 3 tags (enforces the core.md §四.5 cap; UI prevents adding,
 *   but this guards against programmatic abuse)
 *
 * Silently drops 描述 / 效果 fields that are non-string, defaulting them
 * to empty string (lenient on optional fields).
 */
export function buildReplaceEnvironmentAttachment(tags: unknown): BuilderResult<EnvTag[]> {
  if (!Array.isArray(tags)) {
    return { ok: false, reason: '环境标签必须是数组' };
  }
  if (tags.length > 3) {
    return { ok: false, reason: '最多只能同时有 3 条环境标签' };
  }
  const normalized: EnvTag[] = [];
  for (let i = 0; i < tags.length; i++) {
    const raw = tags[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: `第 ${i + 1} 条环境标签不是对象` };
    }
    const o = raw as Record<string, unknown>;
    const name = typeof o.名称 === 'string' ? o.名称.trim() : '';
    if (name.length === 0) {
      return { ok: false, reason: `第 ${i + 1} 条环境标签缺少名称` };
    }
    normalized.push({
      名称: name,
      描述: typeof o.描述 === 'string' ? o.描述.trim() : '',
      效果: typeof o.效果 === 'string' ? o.效果.trim() : '',
    });
  }
  return {
    ok: true,
    path: DEFAULT_ENGINE_PATHS.environmentTags,
    value: normalized,
  };
}

/** Common weather presets for the picker modal. Order matches MRJH convention. */
export const WEATHER_PRESETS: readonly string[] = [
  '晴',
  '阴',
  '小雨',
  '暴雨',
  '大雾',
  '雪',
  '沙尘',
];
