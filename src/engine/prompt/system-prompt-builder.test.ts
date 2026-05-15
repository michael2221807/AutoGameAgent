import { describe, it, expect } from 'vitest';
import { estimateTokens } from './system-prompt-builder';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null/undefined input', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('estimates tokens as ceil(length / 3)', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('abcdef')).toBe(2);
    expect(estimateTokens('abcdefg')).toBe(3);
  });

  it('handles CJK text', () => {
    expect(estimateTokens('天命修仙')).toBe(2);
    expect(estimateTokens('你好世界')).toBe(2);
  });

  it('handles mixed CJK and English', () => {
    const text = 'Hello 天命';
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 3));
  });

  it('handles long strings', () => {
    const text = 'a'.repeat(3000);
    expect(estimateTokens(text)).toBe(1000);
  });
});
