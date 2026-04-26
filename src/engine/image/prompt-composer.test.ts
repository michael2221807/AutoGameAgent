import { describe, it, expect } from 'vitest';
import { ImagePromptComposer } from '@/engine/image/prompt-composer';

describe('ImagePromptComposer', () => {
  const composer = new ImagePromptComposer();

  it('composes from subject tokens only — default portrait size', () => {
    const result = composer.compose({
      subjectTokens: ['1girl', 'blue hair', 'school uniform'],
    });
    expect(result.positive).toBe('1girl, blue hair, school uniform');
    expect(result.negative).toContain('watermark');
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it('uses composition-specific default sizes', () => {
    expect(composer.compose({ subjectTokens: ['test'], composition: 'half-body' }).width).toBe(768);
    expect(composer.compose({ subjectTokens: ['test'], composition: 'half-body' }).height).toBe(1024);
    expect(composer.compose({ subjectTokens: ['test'], composition: 'full-length' }).width).toBe(832);
    expect(composer.compose({ subjectTokens: ['test'], composition: 'full-length' }).height).toBe(1216);
    expect(composer.compose({ subjectTokens: ['test'], composition: 'scene' }).width).toBe(1024);
    expect(composer.compose({ subjectTokens: ['test'], composition: 'scene' }).height).toBe(576);
  });

  it('portrait forces square even with explicit non-square dimensions', () => {
    const result = composer.compose({
      subjectTokens: ['test'],
      composition: 'portrait',
      width: 768,
      height: 1024,
    });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(1024);
  });

  it('includes artist prefix', () => {
    const result = composer.compose({
      subjectTokens: ['1girl', 'red dress'],
      artistPrefix: 'masterpiece, best quality',
    });
    expect(result.positive).toBe('masterpiece, best quality, 1girl, red dress');
  });

  it('merges negative from multiple sources with dedup', () => {
    const result = composer.compose({
      subjectTokens: ['test'],
      subjectNegative: ['bad anatomy', 'extra fingers'],
      extraNegative: 'bad anatomy, lowres',
    });
    const negTags = result.negative.split(', ');
    expect(negTags.filter((t) => t === 'bad anatomy')).toHaveLength(1);
    expect(negTags).toContain('extra fingers');
    expect(negTags).toContain('lowres');
    expect(negTags).toContain('watermark');
  });

  it('adds composition-specific negative for secret_part', () => {
    const result = composer.compose({
      subjectTokens: ['test'],
      composition: 'secret_part',
    });
    expect(result.negative).toContain('multiple views');
    expect(result.negative).toContain('split screen');
  });

  it('handles NAI character segments with | separator', () => {
    const result = composer.compose({
      subjectTokens: ['base scene tags | 1girl, character tags'],
      useNaiSegments: true,
      artistPrefix: 'masterpiece',
    });
    expect(result.positive).toContain('masterpiece');
    expect(result.positive).toContain('|');
  });

  it('handles empty inputs gracefully', () => {
    const result = composer.compose({ subjectTokens: [] });
    expect(result.positive).toBe('');
    expect(result.negative).toContain('watermark');
  });
});
