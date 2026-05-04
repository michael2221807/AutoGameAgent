// Design: docs/research/mrjh-migration/07-environment-tags-plan.md
/**
 * Environment-block prompt helper (env-tags P2, 2026-04-19).
 *
 * Formats the current 世界.天气 / 世界.节日 / 世界.环境 state into a compact
 * `【当前环境】` section that the main-round, world-heartbeat, body-polish,
 * and npcChat prompts can inject via `{{ENVIRONMENT_BLOCK}}`.
 *
 * The block is ALSO echoed inside `GAME_STATE_JSON` (the sanitizer passes
 * these paths through — guaranteed by the P0 snapshot-sanitizer tests), but
 * having an explicit section with plain-language formatting raises AI
 * attention dramatically compared to JSON walking. MRJH does the same —
 * see `systemPromptBuilder.ts:324-380` `构建环境状态文本`.
 *
 * All inputs are treated as `unknown` — the AI occasionally emits partial
 * data mid-round (especially during the first few rounds after enabling
 * a new pack). Every field is guarded; missing data → falls back to
 * defaults matching the schema (`"晴"` / `平日` / `[]`).
 */

/**
 * Runtime guard for a `{名称, 描述, 效果}` tag. Inlined here rather than
 * importing the UI-layer `environment-helpers.isValidTag` to preserve the
 * engine / UI separation — engine modules must not depend on `src/ui/*`.
 * The UI and engine have separate copies of this 5-line predicate; the
 * schema contract keeps them aligned.
 */
function isTagShape(obj: unknown): obj is { 名称: string; 描述: string; 效果: string } {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.名称 !== 'string' || o.名称.trim().length === 0) return false;
  if (typeof o.描述 !== 'string') return false;
  if (typeof o.效果 !== 'string') return false;
  return true;
}

/**
 * Shape of the input object — all three fields are optional and `unknown`
 * because this helper is called with raw state-tree reads (`stateManager.get`
 * returns `unknown`). The helper never throws; defensive guards drive all
 * fallback behavior.
 */
export interface EnvironmentBlockInput {
  weather?: unknown;
  festival?: unknown;
  environment?: unknown;
}

/**
 * Build the `【当前环境】` injection block.
 *
 * Output shape (example with all fields populated):
 *
 * ```
 * 【当前环境】
 * 天气：暴雨
 * 节日：元宵节（街上张灯结彩） — 效果：NPC 心情更佳
 * 环境标签：
 *   - 雾气弥漫（能见度极低） — 效果：-3感知
 *   - 泥泞（地面湿滑） — 效果：移动困难
 * ```
 *
 * Output when all three are default:
 *
 * ```
 * 【当前环境】
 * 天气：晴
 * 节日：平日
 * 环境标签：（空）
 * ```
 *
 * Always returns a non-empty block (header + 3 lines) so callers can safely
 * concatenate without empty-state branching.
 */
export function buildEnvironmentBlock(input: EnvironmentBlockInput): string {
  const lines: string[] = ['【当前环境】'];

  // ── 天气 ──
  const weatherName = normalizeStr(input.weather, '晴');
  lines.push(`天气：${weatherName}`);

  // ── 节日 ──
  lines.push(`节日：${formatFestival(input.festival)}`);

  // ── 环境标签 ──
  const tagLines = formatTagList(input.environment);
  if (tagLines.length === 0) {
    lines.push('环境标签：（空）');
  } else {
    lines.push('环境标签：');
    for (const t of tagLines) lines.push(`  - ${t}`);
  }

  return lines.join('\n');
}

/**
 * Safe string coercion for scalar fields. Empty / whitespace / non-string →
 * fallback. Trims whitespace to avoid trailing-space pollution from the AI.
 */
function normalizeStr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Render the 节日 line. The default `{名称:"平日", 描述:"", 效果:""}` prints
 * just `平日` (no description, no effect). Any customization surfaces via
 * parenthesized description + ` — 效果：...` suffix.
 */
function formatFestival(festival: unknown): string {
  if (!festival || typeof festival !== 'object') return '平日';
  const f = festival as Record<string, unknown>;
  const name = normalizeStr(f.名称, '平日');
  const desc = typeof f.描述 === 'string' ? f.描述.trim() : '';
  const effect = typeof f.效果 === 'string' ? f.效果.trim() : '';

  let out = name;
  if (desc) out += `（${desc}）`;
  if (effect) out += ` — 效果：${effect}`;
  return out;
}

/**
 * Render environment tag list as bullet strings. Filters malformed entries.
 * Each string is one tag's `名称（描述） — 效果：...` — the ` - ` bullet
 * prefix is added by the caller so the indentation is uniform.
 */
function formatTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const raw of tags) {
    if (!isTagShape(raw)) continue;
    const name = raw.名称.trim();
    const desc = raw.描述.trim();
    const effect = raw.效果.trim();

    let line = name;
    if (desc) line += `（${desc}）`;
    if (effect) line += ` — 效果：${effect}`;
    out.push(line);
  }
  return out;
}
