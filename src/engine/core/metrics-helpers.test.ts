import { describe, it, expect } from 'vitest';
import { estimateTextTokens, estimateMessagesTokens } from './metrics-helpers';

describe('metrics-helpers', () => {
  describe('estimateTextTokens', () => {
    it('returns 0 for empty', () => {
      expect(estimateTextTokens('')).toBe(0);
    });

    it('counts CJK at 1 token/char', () => {
      expect(estimateTextTokens('你好世界')).toBe(4);
    });

    it('counts Latin at 4 chars/token rounded up', () => {
      expect(estimateTextTokens('abcd')).toBe(1);
      expect(estimateTextTokens('abcde')).toBe(2);
      expect(estimateTextTokens('ab')).toBe(1);
    });

    it('sums CJK + Latin parts', () => {
      // '你好' (2 CJK) + 'abcd' (4 Latin = 1 token) = 3
      expect(estimateTextTokens('你好abcd')).toBe(3);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('returns 0 for empty list', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it('adds 8 overhead per message', () => {
      // 2 messages, each with '你' (1 CJK token) = 2 * (8 + 1) = 18
      expect(
        estimateMessagesTokens([{ content: '你' }, { content: '你' }]),
      ).toBe(18);
    });

    it('handles missing content gracefully', () => {
      // @ts-expect-error — we intentionally pass malformed input
      expect(estimateMessagesTokens([{ content: undefined }])).toBe(8);
    });
  });
});
