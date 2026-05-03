import { describe, expect, it } from 'vitest';
import { buildPromptStyleInjection, joinPromptFragments } from './style-preset-injection';

describe('style preset injection', () => {
  it('builds positive and negative fragments from selected artist presets', () => {
    const result = buildPromptStyleInjection([
      {
        id: 'artist_a',
        artistString: 'by test artist',
        positive: 'soft lighting',
        negative: 'lowres',
      },
    ], ['artist_a']);

    expect(result.artistPrefix).toBe('by test artist, soft lighting');
    expect(result.extraNegative).toBe('lowres');
  });

  it('combines artist and PNG presets in selection order', () => {
    const result = buildPromptStyleInjection([
      { id: 'artist_a', artistString: 'by test artist', positive: 'watercolor', negative: 'bad hands' },
      { id: 'png_a', positive: 'warm rim light', negative: 'jpeg artifacts' },
    ], ['artist_a', 'png_a']);

    expect(result.artistPrefix).toBe('by test artist, watercolor, warm rim light');
    expect(result.extraNegative).toBe('bad hands, jpeg artifacts');
  });

  it('ignores blank, missing, and duplicate ids', () => {
    const result = buildPromptStyleInjection([
      { id: 'artist_a', artistString: 'ink wash' },
    ], ['', 'missing', 'artist_a', 'artist_a']);

    expect(result.artistPrefix).toBe('ink wash');
    expect(result.extraNegative).toBeUndefined();
  });

  it('joins only non-empty prompt fragments', () => {
    expect(joinPromptFragments([' masterpiece ', '', undefined, 'best quality'])).toBe('masterpiece, best quality');
  });
});
