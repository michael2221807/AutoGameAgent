import { describe, it, expect } from 'vitest';
import { isSTLorebook, convertSTLorebook } from './st-lorebook-converter';

// ─── Fixtures ─────────────────────────────────────────────

const MINIMAL_ST: Record<string, unknown> = {
  entries: {
    '0': {
      uid: 0,
      key: ['剑术', '武功'],
      keysecondary: [],
      comment: '剑术描写',
      content: '### 剑术要点\n...',
      constant: false,
      disable: false,
      order: 100,
      position: 4,
      selective: true,
      selectiveLogic: 0,
      probability: 100,
      depth: 4,
      role: 0,
      displayIndex: 0,
    },
  },
};

const MULTI_ENTRY_ST: Record<string, unknown> = {
  entries: {
    '0': {
      uid: 0,
      key: ['火术'],
      keysecondary: ['魔法'],
      comment: '火系魔法',
      content: '火焰魔法描述',
      constant: false,
      disable: false,
      order: 80,
      displayIndex: 0,
    },
    '1': {
      uid: 1,
      key: [],
      keysecondary: [],
      comment: '世界观设定',
      content: '这是一个剑与魔法的世界',
      constant: true,
      disable: false,
      order: 120,
      displayIndex: 1,
    },
    '2': {
      uid: 2,
      key: ['治愈'],
      keysecondary: [],
      comment: '治愈术',
      content: '治愈魔法',
      constant: false,
      disable: true,
      order: 90,
      displayIndex: 2,
    },
  },
};

const ARRAY_FORMAT_ST: Record<string, unknown> = {
  entries: [
    {
      uid: 0,
      key: ['NPC名'],
      comment: '角色设定',
      content: '角色描述',
      constant: false,
      disable: false,
      order: 50,
    },
  ],
};

// ─── isSTLorebook ─────────────────────────────────────────

describe('isSTLorebook', () => {
  it('recognizes valid ST object-keyed format', () => {
    expect(isSTLorebook(MINIMAL_ST)).toBe(true);
  });

  it('recognizes valid ST array format', () => {
    expect(isSTLorebook(ARRAY_FORMAT_ST)).toBe(true);
  });

  it('rejects AGA export format', () => {
    const agaFormat = {
      version: 1,
      exportedAt: '2026-05-19',
      books: [{ id: 'wb_1', title: 'test', entries: [] }],
    };
    expect(isSTLorebook(agaFormat)).toBe(false);
  });

  it('rejects null/undefined/primitives', () => {
    expect(isSTLorebook(null)).toBe(false);
    expect(isSTLorebook(undefined)).toBe(false);
    expect(isSTLorebook('string')).toBe(false);
    expect(isSTLorebook(42)).toBe(false);
  });

  it('rejects empty entries object', () => {
    expect(isSTLorebook({ entries: {} })).toBe(false);
  });

  it('rejects empty entries array', () => {
    expect(isSTLorebook({ entries: [] })).toBe(false);
  });

  it('rejects entries with non-ST shaped values', () => {
    expect(isSTLorebook({ entries: { '0': { foo: 'bar' } } })).toBe(false);
  });

  it('rejects ST settings/regex files (no entries key)', () => {
    expect(isSTLorebook({ id: 1, scriptName: 'test', findRegex: '.*' })).toBe(false);
  });
});

// ─── convertSTLorebook ───────────────────────────────────

describe('convertSTLorebook', () => {
  it('converts a minimal single-entry lorebook', () => {
    const book = convertSTLorebook(MINIMAL_ST);
    expect(book).not.toBeNull();
    expect(book!.entries).toHaveLength(1);
    expect(book!.enabled).toBe(true);

    const entry = book!.entries[0];
    expect(entry.title).toBe('剑术描写');
    expect(entry.content).toBe('### 剑术要点\n...');
    expect(entry.type).toBe('world_lore');
    expect(entry.shape).toBe('normal');
    expect(entry.scope).toEqual(['main']);
    expect(entry.injectionMode).toBe('match_any');
    expect(entry.keywords).toEqual(['剑术', '武功']);
    expect(entry.priority).toBe(100);
    expect(entry.enabled).toBe(true);
  });

  it('maps constant entries to always injection mode', () => {
    const book = convertSTLorebook(MULTI_ENTRY_ST);
    const constantEntry = book!.entries.find((e) => e.title === '世界观设定');
    expect(constantEntry).toBeDefined();
    expect(constantEntry!.injectionMode).toBe('always');
    expect(constantEntry!.keywords).toEqual([]);
    expect(constantEntry!.priority).toBe(120);
  });

  it('maps disabled entries', () => {
    const book = convertSTLorebook(MULTI_ENTRY_ST);
    const disabledEntry = book!.entries.find((e) => e.title === '治愈术');
    expect(disabledEntry!.enabled).toBe(false);
  });

  it('merges keysecondary into keywords', () => {
    const book = convertSTLorebook(MULTI_ENTRY_ST);
    const fireEntry = book!.entries.find((e) => e.title === '火系魔法');
    expect(fireEntry!.keywords).toEqual(['火术', '魔法']);
    expect(fireEntry!.injectionMode).toBe('match_any');
  });

  it('preserves entry order from object keys', () => {
    const book = convertSTLorebook(MULTI_ENTRY_ST);
    expect(book!.entries.map((e) => e.title)).toEqual([
      '火系魔法',
      '世界观设定',
      '治愈术',
    ]);
  });

  it('supports array-format entries', () => {
    const book = convertSTLorebook(ARRAY_FORMAT_ST);
    expect(book).not.toBeNull();
    expect(book!.entries).toHaveLength(1);
    expect(book!.entries[0].title).toBe('角色设定');
  });

  it('uses custom bookTitle when provided', () => {
    const book = convertSTLorebook(MINIMAL_ST, 'My Custom Book');
    expect(book!.title).toBe('My Custom Book');
  });

  it('defaults bookTitle to "Imported ST Lorebook"', () => {
    const book = convertSTLorebook(MINIMAL_ST);
    expect(book!.title).toBe('Imported ST Lorebook');
  });

  it('returns null for non-ST input', () => {
    expect(convertSTLorebook({ version: 1, books: [] })).toBeNull();
    expect(convertSTLorebook(null)).toBeNull();
    expect(convertSTLorebook('string')).toBeNull();
  });

  it('entries without keys get always injection mode', () => {
    const st = {
      entries: {
        '0': {
          uid: 0,
          key: [],
          keysecondary: [],
          comment: 'No Keywords',
          content: 'Some content',
          constant: false,
          disable: false,
          order: 50,
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries[0].injectionMode).toBe('always');
    expect(book!.entries[0].keywords).toEqual([]);
  });

  it('filters out empty/non-string keywords', () => {
    const st = {
      entries: {
        '0': {
          uid: 0,
          key: ['valid', '', 'also_valid'],
          keysecondary: ['sec'],
          comment: 'Mixed Keywords',
          content: 'Content',
          constant: false,
          disable: false,
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries[0].keywords).toEqual(['valid', 'also_valid', 'sec']);
  });

  it('defaults priority to 50 when order is missing', () => {
    const st = {
      entries: {
        '0': {
          uid: 0,
          key: ['test'],
          comment: 'No Order',
          content: 'Content',
          constant: false,
          disable: false,
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries[0].priority).toBe(50);
  });

  it('uses uid as fallback title when comment is empty', () => {
    const st = {
      entries: {
        '0': {
          uid: 42,
          key: ['test'],
          comment: '',
          content: 'Content',
          constant: false,
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries[0].title).toBe('Entry 42');
  });

  it('handles entries with missing comment and uid', () => {
    const st = {
      entries: {
        '0': {
          key: ['test'],
          content: 'Content',
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries[0].title).toBe('Entry 0');
  });

  it('handles key as non-array gracefully (older ST versions)', () => {
    const st = {
      entries: {
        '0': {
          uid: 0,
          key: 'comma,separated,string' as unknown,
          keysecondary: null as unknown,
          comment: 'Legacy Format',
          content: 'Content',
          constant: false,
          disable: false,
        },
      },
    };
    const book = convertSTLorebook(st);
    expect(book).not.toBeNull();
    expect(book!.entries[0].keywords).toEqual([]);
    expect(book!.entries[0].injectionMode).toBe('always');
  });

  it('sorts non-numeric object keys alphabetically', () => {
    const st = {
      entries: {
        'beta': { key: ['b'], comment: 'Beta', content: 'B' },
        'alpha': { key: ['a'], comment: 'Alpha', content: 'A' },
      },
    };
    const book = convertSTLorebook(st);
    expect(book!.entries.map((e) => e.title)).toEqual(['Alpha', 'Beta']);
  });

  it('returns null when all entries fail validation', () => {
    const st = {
      entries: {
        '0': { foo: 'bar' },
        '1': { baz: 123 },
      },
    };
    expect(convertSTLorebook(st)).toBeNull();
  });
});
