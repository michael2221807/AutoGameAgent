import { describe, it, expect } from 'vitest';
import type { WorldBook, WorldBookEntry, WorldBookScope } from './world-book';
import {
  buildCorpus,
  timeToOrdinal,
  isTimelineMatch,
  selectActiveEntries,
  buildWorldBookInjectionText,
  WORLD_BOOK_BUDGET,
} from './world-book-selector';

// ─── Helpers ─────────────────────────────────────────────────

function makeEntry(overrides: Partial<WorldBookEntry> = {}): WorldBookEntry {
  return {
    id: overrides.id ?? 'e1',
    title: overrides.title ?? 'Test Entry',
    content: overrides.content ?? 'Test content for this entry.',
    type: overrides.type ?? 'world_lore',
    scope: overrides.scope ?? ['main'],
    injectionMode: overrides.injectionMode ?? 'always',
    enabled: overrides.enabled ?? true,
    shape: overrides.shape,
    keywords: overrides.keywords,
    priority: overrides.priority,
    timelineStart: overrides.timelineStart,
    timelineEnd: overrides.timelineEnd,
  };
}

function makeBook(entries: WorldBookEntry[], overrides: Partial<WorldBook> = {}): WorldBook {
  return {
    id: overrides.id ?? 'book1',
    title: overrides.title ?? 'Test Book',
    entries,
    enabled: overrides.enabled ?? true,
  };
}

// ─── buildCorpus ─────────────────────────────────────────────

describe('buildCorpus', () => {
  it('combines all data sources into lowercase string', () => {
    const corpus = buildCorpus({
      environment: { location: 'Mountain Peak', weather: 'Rainy', time: 'Dawn' },
      socialNpcs: [{ name: 'Alice', identity: 'Warrior' }],
      npcFieldKeys: { name: 'name', identity: 'identity' },
      narrativeHistory: [{ content: 'The hero entered the cave.' }],
      worldEvents: [{ title: 'War', location: 'East', type: 'conflict' }],
      extraTexts: ['Dragon Lair'],
    });
    expect(corpus).toContain('mountain peak');
    expect(corpus).toContain('alice');
    expect(corpus).toContain('warrior');
    expect(corpus).toContain('the hero entered the cave.');
    expect(corpus).toContain('war');
    expect(corpus).toContain('dragon lair');
  });

  it('handles partial data sources without error', () => {
    const corpus = buildCorpus({
      environment: { location: 'Town' },
    });
    expect(corpus).toContain('town');
  });

  it('returns empty string for empty/undefined sources', () => {
    expect(buildCorpus({})).toBe('');
    expect(buildCorpus({ environment: undefined })).toBe('');
  });

  it('handles non-object/null world events gracefully', () => {
    const corpus = buildCorpus({
      worldEvents: [null, undefined, 42, 'string', { title: 'War' }] as unknown[],
    });
    expect(corpus).toContain('war');
  });

  it('handles non-object/null NPC entries gracefully', () => {
    const corpus = buildCorpus({
      socialNpcs: [null, undefined, { name: 'Bob' }] as unknown as Array<Record<string, unknown>>,
      npcFieldKeys: { name: 'name' },
    });
    expect(corpus).toContain('bob');
  });

  it('handles non-array narrativeHistory', () => {
    const corpus = buildCorpus({
      narrativeHistory: undefined,
    });
    expect(corpus).toBe('');
  });

  it('uses default NPC field keys when npcFieldKeys not provided', () => {
    const corpus = buildCorpus({
      socialNpcs: [{ name: 'DefaultKey' }],
    });
    expect(corpus).toContain('defaultkey');
  });

  it('handles extraTexts with non-string values', () => {
    const corpus = buildCorpus({
      extraTexts: [null, 42, 'Valid Text', undefined] as unknown as string[],
    });
    expect(corpus).toContain('valid text');
  });

  it('handles environment with non-string weather and time', () => {
    const corpus = buildCorpus({
      environment: { location: 'Town', weather: { desc: 'rainy' }, time: 12345 },
    });
    expect(corpus).toContain('town');
  });

  it('extracts NPC fields using provided keys', () => {
    const corpus = buildCorpus({
      socialNpcs: [{ '名称': '李明', '身份': '剑客', '位置': '天山' }],
      npcFieldKeys: { name: '名称', identity: '身份', location: '位置' },
    });
    expect(corpus).toContain('李明');
    expect(corpus).toContain('剑客');
    expect(corpus).toContain('天山');
  });
});

// ─── timeToOrdinal ───────────────────────────────────────────

describe('timeToOrdinal', () => {
  it('returns null for whitespace-only string', () => {
    expect(timeToOrdinal('   ')).toBeNull();
  });

  it('parses valid time string to ordinal', () => {
    const ord = timeToOrdinal('0001:01:01:00:00');
    expect(ord).toBeTypeOf('number');
    expect(ord).toBeGreaterThan(0);
  });

  it('returns null for empty/undefined', () => {
    expect(timeToOrdinal()).toBeNull();
    expect(timeToOrdinal('')).toBeNull();
    expect(timeToOrdinal(undefined)).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(timeToOrdinal('abc')).toBeNull();
    expect(timeToOrdinal('2024-01-01')).toBeNull();
    expect(timeToOrdinal('1:2:3')).toBeNull();
  });

  it('later times produce larger ordinals', () => {
    const early = timeToOrdinal('0001:01:01:00:00')!;
    const late = timeToOrdinal('0001:06:15:12:30')!;
    expect(late).toBeGreaterThan(early);
  });
});

// ─── isTimelineMatch ─────────────────────────────────────────

describe('isTimelineMatch', () => {
  it('matches when no start/end are set', () => {
    expect(isTimelineMatch({ shape: 'time_injection' }, '0001:03:15:10:00')).toBe(true);
  });

  it('matches when current time is within range', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineStart: '0001:01:01:00:00', timelineEnd: '0001:12:31:23:59' },
      '0001:06:15:12:00',
    )).toBe(true);
  });

  it('does not match when current time is before start', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineStart: '0002:01:01:00:00' },
      '0001:06:15:12:00',
    )).toBe(false);
  });

  it('does not match when current time is after end', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineEnd: '0001:01:01:00:00' },
      '0001:06:15:12:00',
    )).toBe(false);
  });

  it('matches when only start is set and current >= start', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineStart: '0001:01:01:00:00' },
      '0002:01:01:00:00',
    )).toBe(true);
  });

  it('matches when only end is set and current <= end', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineEnd: '0010:01:01:00:00' },
      '0005:06:15:12:00',
    )).toBe(true);
  });

  it('does not match when current time is invalid and entry has constraints', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection', timelineStart: '0001:01:01:00:00' },
      'invalid-time',
    )).toBe(false);
  });

  it('matches when current time is invalid and entry has NO constraints', () => {
    expect(isTimelineMatch(
      { shape: 'time_injection' },
      'invalid-time',
    )).toBe(true);
  });
});

// ─── selectActiveEntries ─────────────────────────────────────

describe('selectActiveEntries', () => {
  const baseParams = { activeScopes: ['main'] as WorldBookScope[], corpus: '', currentGameTime: '' };

  it('selects always+scope-match entries', () => {
    const books = [makeBook([makeEntry({ scope: ['main'] })])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(1);
  });

  it('skips entries with non-matching scope', () => {
    const books = [makeBook([makeEntry({ scope: ['opening'] })])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(0);
  });

  it('scope "all" matches any active scope', () => {
    const books = [makeBook([makeEntry({ scope: ['all'] })])];
    const result = selectActiveEntries({ ...baseParams, books, activeScopes: ['world_evolution'] });
    expect(result).toHaveLength(1);
  });

  it('selects match_any entry when keyword is in corpus', () => {
    const books = [makeBook([makeEntry({
      injectionMode: 'match_any',
      keywords: ['dragon'],
    })])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: 'a dragon appeared' });
    expect(result).toHaveLength(1);
  });

  it('skips match_any entry when keyword is NOT in corpus', () => {
    const books = [makeBook([makeEntry({
      injectionMode: 'match_any',
      keywords: ['dragon'],
    })])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: 'a wolf appeared' });
    expect(result).toHaveLength(0);
  });

  it('skips match_any entry with empty keywords array', () => {
    const books = [makeBook([makeEntry({
      injectionMode: 'match_any',
      keywords: [],
    })])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: 'anything' });
    expect(result).toHaveLength(0);
  });

  it('match_any keyword matching is case-insensitive', () => {
    const books = [makeBook([makeEntry({
      injectionMode: 'match_any',
      keywords: ['Dragon'],
    })])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: 'a DRAGON appeared' });
    expect(result).toHaveLength(1);
  });

  it('match_any with empty corpus does not inject', () => {
    const books = [makeBook([makeEntry({
      injectionMode: 'match_any',
      keywords: ['dragon'],
    })])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: '' });
    expect(result).toHaveLength(0);
  });

  it('filters time_injection entries by timeline', () => {
    const books = [makeBook([makeEntry({
      shape: 'time_injection',
      timelineStart: '0001:01:01:00:00',
      timelineEnd: '0001:06:30:23:59',
    })])];
    const inRange = selectActiveEntries({ ...baseParams, books, currentGameTime: '0001:03:15:12:00' });
    expect(inRange).toHaveLength(1);

    const outRange = selectActiveEntries({ ...baseParams, books, currentGameTime: '0002:01:01:00:00' });
    expect(outRange).toHaveLength(0);
  });

  it('filters timeline_outline entries by timeline too', () => {
    const books = [makeBook([makeEntry({
      shape: 'timeline_outline',
      timelineStart: '0005:01:01:00:00',
    })])];
    const before = selectActiveEntries({ ...baseParams, books, currentGameTime: '0003:01:01:00:00' });
    expect(before).toHaveLength(0);

    const after = selectActiveEntries({ ...baseParams, books, currentGameTime: '0006:01:01:00:00' });
    expect(after).toHaveLength(1);
  });

  it('skips disabled entries', () => {
    const books = [makeBook([makeEntry({ enabled: false })])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(0);
  });

  it('skips all entries from disabled book', () => {
    const books = [makeBook([makeEntry()], { enabled: false })];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(0);
  });

  it('skips entries with empty content', () => {
    const books = [makeBook([makeEntry({ content: '' })])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(0);
  });

  it('sorts by priority descending', () => {
    const books = [makeBook([
      makeEntry({ id: 'low', priority: 10 }),
      makeEntry({ id: 'high', priority: 100 }),
      makeEntry({ id: 'mid', priority: 50 }),
    ])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result.map((e) => e.id)).toEqual(['high', 'mid', 'low']);
  });

  it('maintains insertion order for same priority (stable sort)', () => {
    const books = [makeBook([
      makeEntry({ id: 'a', priority: 50 }),
      makeEntry({ id: 'b', priority: 50 }),
      makeEntry({ id: 'c', priority: 50 }),
    ])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('enforces budget — skips entries exceeding char limit', () => {
    const longContent = 'x'.repeat(5000);
    const books = [makeBook([
      makeEntry({ id: 'first', content: longContent, priority: 100 }),
      makeEntry({ id: 'second', content: longContent, priority: 50 }),
    ])];
    const result = selectActiveEntries({ ...baseParams, books, maxChars: 6000 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('first');
  });

  it('uses max of active scopes for default budget', () => {
    const main = WORLD_BOOK_BUDGET.main;
    const opening = WORLD_BOOK_BUDGET.opening;
    expect(opening).toBeGreaterThan(main);

    const longContent = 'x'.repeat(main + 100);
    const books = [makeBook([
      makeEntry({ id: 'first', content: longContent, priority: 100, scope: ['all'] }),
      makeEntry({ id: 'second', content: 'short', priority: 50, scope: ['all'] }),
    ])];

    const resultMain = selectActiveEntries({ ...baseParams, books, activeScopes: ['main'] });
    expect(resultMain).toHaveLength(1);

    const resultBoth = selectActiveEntries({ ...baseParams, books, activeScopes: ['main', 'opening'] });
    expect(resultBoth).toHaveLength(2);
  });

  it('returns empty for empty books array', () => {
    const result = selectActiveEntries({ ...baseParams, books: [] });
    expect(result).toHaveLength(0);
  });

  it('recall scope with budget=0 returns all candidates (unlimited)', () => {
    const books = [makeBook([
      makeEntry({ id: 'a', content: 'x'.repeat(10000), scope: ['recall'] }),
      makeEntry({ id: 'b', content: 'y'.repeat(10000), scope: ['recall'] }),
    ])];
    const result = selectActiveEntries({ ...baseParams, books, activeScopes: ['recall'] });
    expect(result).toHaveLength(2);
  });

  it('empty activeScopes defaults to main', () => {
    const books = [makeBook([
      makeEntry({ scope: ['main'] }),
      makeEntry({ id: 'opening-only', scope: ['opening'] }),
    ])];
    const result = selectActiveEntries({ ...baseParams, books, activeScopes: [] });
    expect(result).toHaveLength(1);
    expect(result[0].scope).toContain('main');
  });

  it('handles entry with undefined content (fallback via ??)', () => {
    const entry = makeEntry();
    delete (entry as unknown as Record<string, unknown>).content;
    const books = [makeBook([entry])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(0);
  });

  it('handles entry with undefined scope (defaults to main)', () => {
    const entry = makeEntry();
    delete (entry as unknown as Record<string, unknown>).scope;
    const books = [makeBook([entry])];
    const result = selectActiveEntries({ ...baseParams, books });
    expect(result).toHaveLength(1);
  });

  it('handles match_any entry with undefined keywords (non-array)', () => {
    const entry = makeEntry({ injectionMode: 'match_any' });
    delete (entry as unknown as Record<string, unknown>).keywords;
    const books = [makeBook([entry])];
    const result = selectActiveEntries({ ...baseParams, books, corpus: 'anything' });
    expect(result).toHaveLength(0);
  });

  it('first entry always admitted even if it exceeds budget (highest-priority guarantee)', () => {
    const hugeContent = 'x'.repeat(50000);
    const books = [makeBook([makeEntry({ content: hugeContent })])];
    const result = selectActiveEntries({ ...baseParams, books, maxChars: 100 });
    expect(result).toHaveLength(1);
  });
});

// ─── buildWorldBookInjectionText ─────────────────────────────

describe('buildWorldBookInjectionText', () => {
  it('groups entries by type into separate text blocks', () => {
    const entries = [
      makeEntry({ type: 'world_lore', content: 'Lore content' }),
      makeEntry({ type: 'system_rule', content: 'Rule content' }),
      makeEntry({ type: 'command_rule', content: 'Command content' }),
      makeEntry({ type: 'output_rule', content: 'Output content' }),
    ];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toContain('Lore content');
    expect(result.systemRuleText).toContain('Rule content');
    expect(result.commandRuleText).toContain('Command content');
    expect(result.outputRuleText).toContain('Output content');
  });

  it('handles mixed types correctly', () => {
    const entries = [
      makeEntry({ id: 'l1', type: 'world_lore', content: 'Lore 1' }),
      makeEntry({ id: 'l2', type: 'world_lore', content: 'Lore 2' }),
      makeEntry({ id: 's1', type: 'system_rule', content: 'Rule 1' }),
    ];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toContain('Lore 1');
    expect(result.worldLoreText).toContain('Lore 2');
    expect(result.systemRuleText).toContain('Rule 1');
    expect(result.commandRuleText).toBe('');
    expect(result.outputRuleText).toBe('');
  });

  it('returns empty strings for no matching entries', () => {
    const result = buildWorldBookInjectionText([]);
    expect(result.worldLoreText).toBe('');
    expect(result.systemRuleText).toBe('');
    expect(result.commandRuleText).toBe('');
    expect(result.outputRuleText).toBe('');
    expect(result.selectedEntries).toHaveLength(0);
  });

  it('handles entry with empty title (no ### prefix)', () => {
    const entries = [makeEntry({ type: 'world_lore', title: '', content: 'Body only' })];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toContain('Body only');
    expect(result.worldLoreText).not.toContain('###');
  });

  it('skips entries with empty content in group text', () => {
    const entries = [makeEntry({ type: 'world_lore', content: '' })];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toBe('');
  });

  it('handles entry with unknown type gracefully', () => {
    const entries = [makeEntry({ type: 'unknown_type' as WorldBookEntry['type'], content: 'X' })];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toBe('');
    expect(result.systemRuleText).toBe('');
  });

  it('wraps each group in XML tags (engine-safe, no Chinese)', () => {
    const entries = [makeEntry({ type: 'world_lore', content: 'Some lore' })];
    const result = buildWorldBookInjectionText(entries);
    expect(result.worldLoreText).toMatch(/^<world_book_lore>/);
    expect(result.worldLoreText).toMatch(/<\/world_book_lore>$/);
  });

  it('entry with undefined type defaults to world_lore group', () => {
    const entry = makeEntry({ content: 'Default type' });
    delete (entry as unknown as Record<string, unknown>).type;
    const result = buildWorldBookInjectionText([entry]);
    expect(result.worldLoreText).toContain('Default type');
  });

  it('entry with undefined content in group text is skipped', () => {
    const entry = makeEntry({ type: 'world_lore' });
    delete (entry as unknown as Record<string, unknown>).content;
    const result = buildWorldBookInjectionText([entry]);
    expect(result.worldLoreText).toBe('');
  });

  it('entry with undefined title renders content without ### header', () => {
    const entry = makeEntry({ content: 'No title content' });
    delete (entry as unknown as Record<string, unknown>).title;
    const result = buildWorldBookInjectionText([entry]);
    expect(result.worldLoreText).toContain('No title content');
    expect(result.worldLoreText).not.toContain('###');
  });
});
