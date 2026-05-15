import { describe, it, expect } from 'vitest';
import { tokenizeChinese, bm25Score, rrfMerge } from './search-utils';

describe('tokenizeChinese', () => {
  it('returns empty array for empty input', () => {
    expect(tokenizeChinese('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(tokenizeChinese('   ')).toEqual([]);
  });

  it('produces unigrams for single CJK characters', () => {
    const tokens = tokenizeChinese('天命');
    expect(tokens).toContain('天');
    expect(tokens).toContain('命');
  });

  it('produces bigrams for adjacent CJK characters', () => {
    const tokens = tokenizeChinese('天命修仙');
    expect(tokens).toContain('天命');
    expect(tokens).toContain('命修');
    expect(tokens).toContain('修仙');
  });

  it('extracts non-CJK words split by whitespace', () => {
    const tokens = tokenizeChinese('hello world');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('handles mixed CJK and non-CJK input', () => {
    const tokens = tokenizeChinese('hello 天命 world');
    expect(tokens).toContain('天');
    expect(tokens).toContain('命');
    expect(tokens).toContain('天命');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });

  it('lowercases all tokens', () => {
    const tokens = tokenizeChinese('Hello WORLD');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).not.toContain('Hello');
    expect(tokens).not.toContain('WORLD');
  });

  it('does not produce bigrams for non-adjacent CJK characters separated by non-CJK', () => {
    const tokens = tokenizeChinese('天a命');
    expect(tokens).toContain('天');
    expect(tokens).toContain('命');
    expect(tokens).not.toContain('天命');
  });

  it('handles single CJK character (no bigram possible)', () => {
    const tokens = tokenizeChinese('天');
    expect(tokens).toContain('天');
    expect(tokens).toHaveLength(1);
  });
});

describe('bm25Score', () => {
  it('returns 0 for empty query', () => {
    expect(bm25Score('', '天命修仙')).toBe(0);
  });

  it('returns 0 for empty text', () => {
    expect(bm25Score('天命', '')).toBe(0);
  });

  it('returns 0 when no query tokens match', () => {
    expect(bm25Score('天命', 'hello world')).toBe(0);
  });

  it('returns positive score for matching tokens', () => {
    const score = bm25Score('天命', '天命修仙');
    expect(score).toBeGreaterThan(0);
  });

  it('returns higher score for more matching tokens', () => {
    const scorePartial = bm25Score('天命修仙', '天命客栈');
    const scoreFull = bm25Score('天命修仙', '天命修仙录');
    expect(scoreFull).toBeGreaterThan(scorePartial);
  });

  it('returns score normalized to [0, 1]', () => {
    const score = bm25Score('天命', '天命修仙录');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('handles exact match — score should be high', () => {
    const score = bm25Score('天命', '天命');
    expect(score).toBeGreaterThan(0.3);
  });

  it('BM25 saturation: repeated tokens have diminishing returns', () => {
    const scoreOnce = bm25Score('天', '天');
    const scoreTwice = bm25Score('天', '天天');
    expect(scoreTwice).toBeGreaterThan(scoreOnce);
    const diff1 = scoreTwice - scoreOnce;
    const scoreThrice = bm25Score('天', '天天天');
    const diff2 = scoreThrice - scoreTwice;
    expect(diff2).toBeLessThan(diff1);
  });
});

describe('rrfMerge', () => {
  it('returns empty array for empty input', () => {
    expect(rrfMerge([])).toEqual([]);
  });

  it('returns empty array for empty lists', () => {
    expect(rrfMerge([[], []])).toEqual([]);
  });

  it('handles single list — preserves order', () => {
    const result = rrfMerge([['a', 'b', 'c']]);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
    expect(result[2].id).toBe('c');
  });

  it('merges two lists — items in both lists rank higher', () => {
    const result = rrfMerge([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
    ]);
    const ids = result.map((r) => r.id);
    // 'a' appears in both at rank 1 and 2, 'b' at rank 2 and 1 → tied
    // Both should rank above 'c' and 'd' which appear in only one list
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('d'));
  });

  it('uses k parameter — higher k reduces rank importance', () => {
    // Asymmetric lists: 'a' appears at rank 1 in both, 'b' only in list 1
    const resultK1 = rrfMerge([['a', 'b'], ['a', 'c']], 1);
    const resultK60 = rrfMerge([['a', 'b'], ['a', 'c']], 60);

    // With k=1: 'a' score = 1/2 + 1/2 = 1.0; 'b' = 1/3 ≈ 0.33 → gap ≈ 0.67
    // With k=60: 'a' = 2/61 ≈ 0.033; 'b' = 1/62 ≈ 0.016 → gap ≈ 0.017
    const gapK1 = resultK1[0].score - resultK1[resultK1.length - 1].score;
    const gapK60 = resultK60[0].score - resultK60[resultK60.length - 1].score;
    expect(gapK60).toBeLessThan(gapK1);
  });

  it('default k=1 (matching Graphiti)', () => {
    const result = rrfMerge([['a']]);
    // rank 1, k=1: score = 1/(1+1) = 0.5
    expect(result[0].score).toBeCloseTo(0.5);
  });

  it('computes correct RRF scores', () => {
    const result = rrfMerge([['a', 'b'], ['a', 'c']], 1);
    const scoreMap = new Map(result.map((r) => [r.id, r.score]));

    // 'a': rank 1 in list 1 + rank 1 in list 2 = 1/2 + 1/2 = 1.0
    expect(scoreMap.get('a')).toBeCloseTo(1.0);
    // 'b': rank 2 in list 1 only = 1/3 ≈ 0.333
    expect(scoreMap.get('b')).toBeCloseTo(1 / 3);
    // 'c': rank 2 in list 2 only = 1/3 ≈ 0.333
    expect(scoreMap.get('c')).toBeCloseTo(1 / 3);
  });

  it('results are sorted descending by score', () => {
    const result = rrfMerge([['a', 'b', 'c'], ['c', 'a', 'b']]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
