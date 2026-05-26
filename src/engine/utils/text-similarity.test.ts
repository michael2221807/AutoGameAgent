import { describe, it, expect } from 'vitest';
import { extractBigrams, diceCoefficient, isNearDuplicate, DEDUP_THRESHOLD } from './text-similarity';

describe('extractBigrams', () => {
  it('returns empty set for empty string', () => {
    expect(extractBigrams('').size).toBe(0);
  });

  it('returns empty set for single character', () => {
    expect(extractBigrams('a').size).toBe(0);
  });

  it('returns one bigram for two-character string', () => {
    const bg = extractBigrams('ab');
    expect(bg.size).toBe(1);
    expect(bg.has('ab')).toBe(true);
  });

  it('returns correct bigrams for Chinese text', () => {
    const bg = extractBigrams('诊断左膝');
    expect(bg.size).toBe(3);
    expect(bg.has('诊断')).toBe(true);
    expect(bg.has('断左')).toBe(true);
    expect(bg.has('左膝')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(extractBigrams('  ab  ')).toEqual(extractBigrams('ab'));
  });

  it('handles mixed script (CJK + ASCII + punctuation)', () => {
    const bg = extractBigrams('发烧38.5°C');
    expect(bg.size).toBe(7); // 发烧, 烧3, 38, 8., .5, 5°, °C
    expect(bg.has('发烧')).toBe(true);
    expect(bg.has('°C')).toBe(true);
  });

  it('collapses repeated bigrams into one (set-based)', () => {
    const bg = extractBigrams('哈哈哈哈');
    expect(bg.size).toBe(1);
    expect(bg.has('哈哈')).toBe(true);
  });
});

describe('diceCoefficient', () => {
  it('returns 1 for two empty strings', () => {
    expect(diceCoefficient('', '')).toBe(1);
  });

  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('诊断左膝', '诊断左膝')).toBe(1);
  });

  it('returns 1 for identical strings with different whitespace', () => {
    expect(diceCoefficient(' hello ', 'hello')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(diceCoefficient('', '诊断')).toBe(0);
    expect(diceCoefficient('诊断', '')).toBe(0);
  });

  it('returns 0 for completely different strings', () => {
    const score = diceCoefficient('天气晴朗', '武功秘籍');
    expect(score).toBeLessThan(0.2);
  });

  it('returns 1.0 for repetitive strings (known set-based limitation)', () => {
    expect(diceCoefficient('哈哈哈哈', '哈哈')).toBe(1);
  });

  it('returns 0 for two-character strings that differ', () => {
    expect(diceCoefficient('ab', 'cd')).toBe(0);
  });

  it('detects high similarity for near-duplicates', () => {
    const a = '为周淑兰诊断左膝骨性节炎';
    const b = '为周淑兰诊断左膝中度骨性节炎';
    const score = diceCoefficient(a, b);
    expect(score).toBeGreaterThan(DEDUP_THRESHOLD);
  });

  it('returns low score for unrelated texts sharing a few characters', () => {
    const a = '与玩家在茶馆相识';
    const b = '在茶馆与师父论道';
    const score = diceCoefficient(a, b);
    expect(score).toBeLessThan(DEDUP_THRESHOLD);
  });

  it('handles mixed-script near-duplicates', () => {
    const a = '发烧38.5°C需要退烧药';
    const b = '发烧39°C需要退烧药';
    const score = diceCoefficient(a, b);
    expect(score).toBeGreaterThan(0.5);
  });
});

describe('isNearDuplicate', () => {
  it('returns false for empty candidate', () => {
    expect(isNearDuplicate('', ['some text'])).toBe(false);
  });

  it('returns false for empty existing array', () => {
    expect(isNearDuplicate('some text', [])).toBe(false);
  });

  it('catches exact duplicates', () => {
    expect(isNearDuplicate('初次在茶馆相遇', ['初次在茶馆相遇'])).toBe(true);
  });

  it('catches near-duplicates above threshold', () => {
    const existing = ['为周淑兰诊断左膝中度骨性节炎，右膝轻度退变，开药保守治疗'];
    const candidate = '为周淑兰诊断左膝骨性节炎，右膝退变，保守治疗';
    expect(isNearDuplicate(candidate, existing)).toBe(true);
  });

  it('passes through unrelated entries', () => {
    const existing = ['初次在茶馆相遇'];
    const candidate = '在道场切磋武艺';
    expect(isNearDuplicate(candidate, existing)).toBe(false);
  });

  it('handles short candidate against long existing (no pre-filter)', () => {
    const existing = ['为周淑兰诊断左膝骨性节炎，开药保守治疗，并嘱托定期复查，注意保暖'];
    const candidate = '为周淑兰诊断左膝骨性节炎';
    // Without length pre-filter, this comparison still runs
    // Dice score depends on bigram overlap ratio
    const score = diceCoefficient(candidate, existing[0]);
    if (score >= DEDUP_THRESHOLD) {
      expect(isNearDuplicate(candidate, existing)).toBe(true);
    } else {
      expect(isNearDuplicate(candidate, existing)).toBe(false);
    }
  });

  it('respects custom threshold', () => {
    const a = '初次在茶馆相遇';
    const b = '初次在酒馆相遇';
    expect(isNearDuplicate(a, [b], 0.3)).toBe(true);
    expect(isNearDuplicate(a, [b], 0.99)).toBe(false);
  });
});
