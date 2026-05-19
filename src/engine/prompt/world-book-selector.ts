/**
 * World Book entry selector and injection text builder.
 *
 * Ported from MRJH utils/worldbook.ts (选择生效世界书条目 + 构建世界书注入文本),
 * adapted to AGA's English naming and EnginePathConfig-based field access.
 *
 * Engine-layer code: no hardcoded Chinese field names.
 */

import type {
  WorldBook,
  WorldBookEntry,
  WorldBookEntryType,
  WorldBookScope,
} from './world-book';

// ─── Corpus Building ─────────────────────────────────────────

export interface NpcFieldKeys {
  name?: string;
  identity?: string;
  relation?: string;
  location?: string;
}

export interface CorpusSources {
  environment?: { location?: string; weather?: unknown; time?: unknown };
  socialNpcs?: Array<Record<string, unknown>>;
  npcFieldKeys?: NpcFieldKeys;
  narrativeHistory?: Array<{ content: string }>;
  worldEvents?: unknown[];
  extraTexts?: string[];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractEnvironmentTexts(env?: CorpusSources['environment']): string[] {
  if (!env || typeof env !== 'object') return [];
  return [env.location, env.weather, env.time]
    .map((v) => textOf(v).trim())
    .filter(Boolean);
}

function extractNpcTexts(
  npcs: Array<Record<string, unknown>>,
  keys: NpcFieldKeys,
): string[] {
  return npcs.flatMap((npc) => {
    if (!npc || typeof npc !== 'object') return [];
    const fieldNames = [
      keys.name ?? 'name',
      keys.identity ?? 'identity',
      keys.relation ?? 'relation',
      keys.location ?? 'location',
    ];
    return fieldNames
      .map((k) => textOf(npc[k]).trim())
      .filter(Boolean);
  });
}

function extractHistoryTexts(
  history?: Array<{ content: string }>,
): string[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-12)
    .map((item) => textOf(item?.content).trim())
    .filter(Boolean);
}

function extractWorldEventTexts(events?: unknown[]): string[] {
  if (!Array.isArray(events)) return [];
  return events.flatMap((event: unknown) => {
    if (!event || typeof event !== 'object') return [];
    const e = event as Record<string, unknown>;
    return [e['title'], e['location'], e['type']]
      .map((v) => textOf(v).trim())
      .filter(Boolean);
  });
}

export function buildCorpus(sources: CorpusSources): string {
  const parts: string[] = [
    ...extractEnvironmentTexts(sources.environment),
    ...extractNpcTexts(
      Array.isArray(sources.socialNpcs) ? sources.socialNpcs : [],
      sources.npcFieldKeys ?? {},
    ),
    ...extractHistoryTexts(sources.narrativeHistory),
    ...extractWorldEventTexts(sources.worldEvents),
    ...(Array.isArray(sources.extraTexts)
      ? sources.extraTexts.map((t) => textOf(t).trim()).filter(Boolean)
      : []),
  ];
  return parts.join('\n').toLowerCase();
}

// ─── Timeline Matching ───────────────────────────────────────

/**
 * Convert a game time string (YYYY:MM:DD:HH:MM) to an ordinal number
 * for range comparison. Returns null for invalid/empty strings.
 */
export function timeToOrdinal(timeStr?: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,6}):(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  return ((((year * 12) + month) * 31 + day) * 24 + hour) * 60 + minute;
}

/**
 * Check if a world book entry's timeline range matches the current game time.
 *
 * - Entries with no start/end times always match.
 * - If current time cannot be parsed but entry has time constraints, entry does NOT match.
 * - If current time is parseable, checks [start, end] range inclusively.
 */
export function isTimelineMatch(
  entry: Pick<WorldBookEntry, 'timelineStart' | 'timelineEnd' | 'shape'>,
  currentGameTime: string,
): boolean {
  const hasStart = !!entry.timelineStart?.trim();
  const hasEnd = !!entry.timelineEnd?.trim();

  if (!hasStart && !hasEnd) return true;

  const current = timeToOrdinal(currentGameTime);
  if (current === null) return false;

  const start = timeToOrdinal(entry.timelineStart);
  const end = timeToOrdinal(entry.timelineEnd);

  if (start !== null && current < start) return false;
  if (end !== null && current > end) return false;
  return true;
}

// ─── Scope Matching ──────────────────────────────────────────

function isScopeMatch(
  entryScopes: WorldBookScope[],
  activeScopes: WorldBookScope[],
): boolean {
  if (entryScopes.includes('all')) return true;
  return activeScopes.some((s) => entryScopes.includes(s));
}

// ─── Budget Constants ────────────────────────────────────────

/** Per-scope character budget. 0 means no limit (all matched entries are injected). */
export const WORLD_BOOK_BUDGET: Record<WorldBookScope, number> = {
  main: 6000,
  opening: 7000,
  world_evolution: 4000,
  variable_calibration: 5000,
  story_plan: 5000,
  heroine_plan: 5000,
  recall: 0, // 0 = unlimited — recall scope injects all matched entries
  all: 7000,
};

// ─── Entry Selection ─────────────────────────────────────────

export interface WorldBookSelectionParams {
  books: WorldBook[];
  activeScopes: WorldBookScope[];
  corpus: string;
  currentGameTime?: string;
  maxChars?: number;
}

function flattenEntries(books: WorldBook[]): WorldBookEntry[] {
  return books
    .filter((b) => b.enabled !== false)
    .flatMap((b) => b.entries);
}

/**
 * Select world book entries that should be injected for the given context.
 *
 * Filter chain:
 * 1. Book enabled
 * 2. Entry enabled + non-empty content
 * 3. Scope match
 * 4. Timeline match (time_injection and timeline_outline shapes)
 * 5. Keyword match (match_any mode)
 * 6. Sort by priority descending (stable)
 * 7. Budget enforcement
 */
export function selectActiveEntries(
  params: WorldBookSelectionParams,
): WorldBookEntry[] {
  const {
    books,
    activeScopes,
    corpus: rawCorpus,
    currentGameTime = '',
    maxChars,
  } = params;

  const corpus = rawCorpus.toLowerCase();
  const effectiveScopes = activeScopes.length > 0 ? activeScopes : (['main'] as WorldBookScope[]);

  const budget = typeof maxChars === 'number' && Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars))
    : Math.max(0, ...effectiveScopes.map((s) => WORLD_BOOK_BUDGET[s]));

  const candidates = flattenEntries(books)
    .filter((e) => {
      if (e.enabled === false) return false;
      if (!(e.content ?? '').trim()) return false;
      if (!isScopeMatch(e.scope ?? ['main'], effectiveScopes)) return false;

      if (e.shape === 'time_injection' || e.shape === 'timeline_outline') {
        if (!isTimelineMatch(e, currentGameTime)) return false;
      }

      if (e.injectionMode === 'match_any') {
        const keywords = Array.isArray(e.keywords)
          ? e.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)
          : [];
        if (keywords.length === 0) return false;
        if (!keywords.some((kw) => corpus.includes(kw))) return false;
      }

      return true;
    });

  candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (budget <= 0) return candidates;

  // The first entry is always admitted regardless of budget (highest-priority entry guarantee).
  const selected: WorldBookEntry[] = [];
  let totalChars = 0;

  for (const entry of candidates) {
    const estimated = `${entry.title}\n${entry.content}`.length;
    if (selected.length > 0 && totalChars + estimated > budget) continue;
    selected.push(entry);
    totalChars += estimated;
  }

  return selected;
}

// ─── Injection Text Building ─────────────────────────────────

export interface WorldBookInjectionResult {
  selectedEntries: WorldBookEntry[];
  worldLoreText: string;
  systemRuleText: string;
  commandRuleText: string;
  outputRuleText: string;
}

const TYPE_LABELS: Record<WorldBookEntryType, string> = {
  world_lore: 'World Book Lore',
  system_rule: 'World Book System Rules',
  command_rule: 'World Book Command Rules',
  output_rule: 'World Book Output Rules',
};

function buildGroupText(label: string, entries: WorldBookEntry[]): string {
  const sections = entries
    .map((e) => {
      const title = (e.title ?? '').trim();
      const body = (e.content ?? '').trim();
      if (!body) return '';
      return title ? `### ${title}\n${body}` : body;
    })
    .filter(Boolean);
  if (sections.length === 0) return '';
  return `<${label.replace(/\s+/g, '_').toLowerCase()}>\n${sections.join('\n\n')}\n</${label.replace(/\s+/g, '_').toLowerCase()}>`;
}

/**
 * Build formatted injection text from selected entries, grouped by type.
 */
export function buildWorldBookInjectionText(
  selectedEntries: WorldBookEntry[],
): WorldBookInjectionResult {
  const grouped: Record<WorldBookEntryType, WorldBookEntry[]> = {
    world_lore: [],
    system_rule: [],
    command_rule: [],
    output_rule: [],
  };

  for (const entry of selectedEntries) {
    const type = entry.type ?? 'world_lore';
    if (type in grouped) {
      grouped[type].push(entry);
    }
  }

  return {
    selectedEntries,
    worldLoreText: buildGroupText(TYPE_LABELS.world_lore, grouped.world_lore),
    systemRuleText: buildGroupText(TYPE_LABELS.system_rule, grouped.system_rule),
    commandRuleText: buildGroupText(TYPE_LABELS.command_rule, grouped.command_rule),
    outputRuleText: buildGroupText(TYPE_LABELS.output_rule, grouped.output_rule),
  };
}
