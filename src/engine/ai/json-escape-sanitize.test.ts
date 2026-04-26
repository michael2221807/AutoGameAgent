import { describe, it, expect } from 'vitest';
import { sanitizeJsonEscapes } from '@/engine/ai/json-escape-sanitize';

describe('sanitizeJsonEscapes', () => {
  describe('no-op on valid JSON', () => {
    it('leaves empty input untouched', () => {
      expect(sanitizeJsonEscapes('')).toBe('');
    });

    it('leaves JSON without strings untouched', () => {
      expect(sanitizeJsonEscapes('{"a":1,"b":true}')).toBe('{"a":1,"b":true}');
    });

    it('leaves all legal escapes untouched', () => {
      const src = '{"t":"line1\\nline2\\ttab\\"quote\\\\back\\/slash\\b\\f\\r"}';
      expect(sanitizeJsonEscapes(src)).toBe(src);
    });

    it('leaves valid \\uXXXX untouched', () => {
      const src = '{"t":"\\u0041\\u4f60"}';
      expect(sanitizeJsonEscapes(src)).toBe(src);
    });
  });

  describe('strips invalid \\X escapes in strings', () => {
    it('removes stray backslash before CJK char (the \\你 bug)', () => {
      // JSON source: {"t":"\你"} — invalid. After sanitize: {"t":"你"}
      const src = '{"t":"\\你"}';
      const sanitized = sanitizeJsonEscapes(src);
      expect(sanitized).toBe('{"t":"你"}');
      expect(JSON.parse(sanitized)).toEqual({ t: '你' });
    });

    it('preserves \\\\你 (valid double-backslash then CJK)', () => {
      // JSON source: {"t":"\\你"} — valid, decodes to literal backslash + 你
      const src = '{"t":"\\\\你"}';
      const sanitized = sanitizeJsonEscapes(src);
      expect(sanitized).toBe(src);
      expect(JSON.parse(sanitized)).toEqual({ t: '\\你' });
    });

    it('only strips backslash before invalid char, keeps the char', () => {
      const src = '{"t":"a\\xb"}';
      expect(sanitizeJsonEscapes(src)).toBe('{"t":"axb"}');
    });

    it('handles real-world stutter case from test data', () => {
      // Exact shape from the AGA main round response payload
      const src = '{"text":"是时候落下第一子了。\\n\\你站起身"}';
      const sanitized = sanitizeJsonEscapes(src);
      const parsed = JSON.parse(sanitized);
      expect(parsed.text).toBe('是时候落下第一子了。\n你站起身');
      expect(parsed.text).not.toContain('\\');
    });

    it('handles multiple stutters in one string', () => {
      const src = '{"t":"a\\bc\\de\\fg"}'; // \b, \f are valid; \d is not
      const sanitized = sanitizeJsonEscapes(src);
      expect(JSON.parse(sanitized)).toEqual({ t: 'a\bcde\fg' });
    });

    it('strips \\u when followed by non-hex', () => {
      const src = '{"t":"\\u你好"}'; // \u needs 4 hex, 你 is not hex
      const sanitized = sanitizeJsonEscapes(src);
      expect(JSON.parse(sanitized)).toEqual({ t: 'u你好' });
    });

    it('keeps \\u when followed by only 3 hex then space', () => {
      const src = '{"t":"\\u004 leftover"}';
      const sanitized = sanitizeJsonEscapes(src);
      // \u004 (only 3 hex) → invalid \uXXXX, strip backslash
      expect(JSON.parse(sanitized)).toEqual({ t: 'u004 leftover' });
    });
  });

  describe('string boundary handling', () => {
    it('does not touch backslashes outside strings', () => {
      // malformed input with a stray backslash outside quotes — leave it so
      // JSON.parse can still report the real error
      const src = '{\\"t":1}';
      expect(sanitizeJsonEscapes(src)).toBe('{\\"t":1}');
    });

    it('correctly re-enters strings after \\" inside a string', () => {
      const src = '{"t":"he said \\"hi\\" to \\他"}';
      // \" legal, \他 illegal
      const sanitized = sanitizeJsonEscapes(src);
      expect(JSON.parse(sanitized)).toEqual({ t: 'he said "hi" to 他' });
    });

    it('handles adjacent strings with bad escapes in each', () => {
      const src = '{"a":"\\啊","b":"\\哦"}';
      const sanitized = sanitizeJsonEscapes(src);
      expect(JSON.parse(sanitized)).toEqual({ a: '啊', b: '哦' });
    });
  });

  describe('edge cases', () => {
    it('handles trailing backslash at string end', () => {
      const src = '{"t":"incomplete\\';
      // trailing lone \ → drop it; string is still unterminated but at least
      // one symptom removed for the parser error to be more accurate
      const sanitized = sanitizeJsonEscapes(src);
      expect(sanitized).toBe('{"t":"incomplete');
    });

    it('handles empty string values', () => {
      expect(sanitizeJsonEscapes('{"t":""}')).toBe('{"t":""}');
    });

    it('passes undefined/null-ish inputs through', () => {
      expect(sanitizeJsonEscapes('')).toBe('');
      // @ts-expect-error testing runtime robustness
      expect(sanitizeJsonEscapes(null)).toBe(null);
      // @ts-expect-error
      expect(sanitizeJsonEscapes(undefined)).toBe(undefined);
    });
  });
});
