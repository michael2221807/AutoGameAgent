import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeLexiconTerms, buildHotwords } from '@/engine/stt/lexicon';
import {
  loadCustomLexicon, saveCustomLexicon, addCustomTerm, removeCustomTerm, CUSTOM_LEXICON_STORAGE_KEY,
} from '@/engine/stt/lexicon-store';
import { MAX_LEXICON_TERMS } from '@/engine/stt/types';
import { createMockLocalStorage } from '@/engine/__test-utils__/local-storage.mock';

describe('normalizeLexiconTerms', () => {
  it('keeps 2–10 Chinese-char terms, trims, dedupes (order-preserving)', () => {
    expect(normalizeLexiconTerms([' 韩素琴 ', '青云城', '韩素琴', '程俊生']))
      .toEqual(['韩素琴', '青云城', '程俊生']);
  });
  it('drops 1-char and >10-char terms', () => {
    expect(normalizeLexiconTerms(['琴', '青云城', '一二三四五六七八九十一'])).toEqual(['青云城']);
  });
  it('drops non-CJK / mixed terms', () => {
    expect(normalizeLexiconTerms(['abc', '青云city', '青云城', '123'])).toEqual(['青云城']);
  });
  it('caps at MAX_LEXICON_TERMS keeping the earliest (custom-first priority)', () => {
    const many = Array.from({ length: MAX_LEXICON_TERMS + 20 }, (_, i) => `甲乙${i}`.replace(/\d/g, ''))
      .map((_, i) => `名字${String.fromCharCode(0x4e00 + i)}`);
    const out = normalizeLexiconTerms(many);
    expect(out.length).toBe(MAX_LEXICON_TERMS);
    expect(out[0]).toBe(many[0]);
  });
});

describe('buildHotwords', () => {
  it('produces FunASR {word:weight} JSON string', () => {
    const json = buildHotwords(['韩素琴', '青云城'], 20);
    expect(JSON.parse(json)).toEqual({ 韩素琴: 20, 青云城: 20 });
  });
  it('empty / all-invalid → empty string (caller treats as OFF)', () => {
    expect(buildHotwords([], 20)).toBe('');
    expect(buildHotwords(['a', '琴'], 20)).toBe('');
  });
  it('applies the given weight uniformly', () => {
    expect(JSON.parse(buildHotwords(['雁回坞'], 40))).toEqual({ 雁回坞: 40 });
  });
});

describe('lexicon-store (per-save)', () => {
  let mock: ReturnType<typeof createMockLocalStorage>;
  beforeEach(() => { mock = createMockLocalStorage(); mock.install(); });
  afterEach(() => mock.restore());

  it('add/load/remove roundtrip scoped by saveKey', () => {
    addCustomTerm('p1::s1', '玄冥剑');
    addCustomTerm('p1::s1', '雁回坞');
    expect(loadCustomLexicon('p1::s1')).toEqual(['玄冥剑', '雁回坞']);
    removeCustomTerm('p1::s1', '玄冥剑');
    expect(loadCustomLexicon('p1::s1')).toEqual(['雁回坞']);
  });
  it('isolates different saves', () => {
    addCustomTerm('p1::s1', '玄冥剑');
    addCustomTerm('p1::s2', '天工阁');
    expect(loadCustomLexicon('p1::s1')).toEqual(['玄冥剑']);
    expect(loadCustomLexicon('p1::s2')).toEqual(['天工阁']);
  });
  it('empty saveKey is a no-op (no crash, empty list)', () => {
    addCustomTerm('', '玄冥剑');
    expect(loadCustomLexicon('')).toEqual([]);
  });
  it('rejects invalid terms via normalize (1-char dropped)', () => {
    addCustomTerm('p1::s1', '剑'); // 1-char → dropped
    expect(loadCustomLexicon('p1::s1')).toEqual([]);
  });
  it('dedupes on add', () => {
    saveCustomLexicon('p1::s1', ['玄冥剑', '玄冥剑', '雁回坞']);
    expect(loadCustomLexicon('p1::s1')).toEqual(['玄冥剑', '雁回坞']);
  });
  it('tolerates malformed storage → empty', () => {
    localStorage.setItem(CUSTOM_LEXICON_STORAGE_KEY, '{bad');
    expect(loadCustomLexicon('p1::s1')).toEqual([]);
  });
});
