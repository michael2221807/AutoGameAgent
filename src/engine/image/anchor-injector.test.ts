import { describe, it, expect } from 'vitest';
import { injectAnchorByComposition } from '@/engine/image/anchor-injector';
import type { AnchorStructuredFeatures } from '@/engine/image/types';

describe('injectAnchorByComposition', () => {
  // ── Null / empty anchor ──

  it('returns empty string for null anchor', () => {
    expect(injectAnchorByComposition(null, { composition: 'portrait' })).toBe('');
  });

  it('returns empty string for empty positive prompt', () => {
    expect(injectAnchorByComposition({ positive: '' }, { composition: 'portrait' })).toBe('');
  });

  // ── Portrait — structured features path ──

  it('portrait: picks face/hair/eye tags from structured features', () => {
    const features: AnchorStructuredFeatures = {
      appearance: ['oval face', 'sharp jawline'],
      hairstyle: ['long hair', 'straight hair'],
      hairColor: ['black hair'],
      eyes: ['blue eyes', 'narrow eyes'],
      skinTone: ['pale skin'],
      ageAppearance: ['young'],
      specialTraits: ['scar on cheek'],
      bust: ['large breasts'],
      baseOutfit: ['white dress'],
    };
    const result = injectAnchorByComposition(
      { positive: '', structuredFeatures: features },
      { composition: 'portrait' },
    );
    expect(result).toContain('oval face');
    expect(result).toContain('blue eyes');
    expect(result).toContain('black hair');
    expect(result).toContain('scar on cheek');
    // Should NOT include bust or outfit
    expect(result).not.toContain('large breasts');
    expect(result).not.toContain('white dress');
  });

  it('portrait: respects 20 token limit from features', () => {
    const features: AnchorStructuredFeatures = {
      appearance: Array.from({ length: 25 }, (_, i) => `face-tag-${i}`),
    };
    const result = injectAnchorByComposition(
      { positive: '', structuredFeatures: features },
      { composition: 'portrait' },
    );
    expect(result.split(', ').length).toBeLessThanOrEqual(20);
  });

  // ── Portrait — raw prompt fallback ──

  it('portrait: falls back to raw prompt when no structured features', () => {
    const result = injectAnchorByComposition(
      { positive: '1girl, blue eyes, long hair, pale skin, red dress, sword' },
      { composition: 'portrait' },
    );
    expect(result).toContain('1girl');
    expect(result).toContain('blue eyes');
    expect(result).toContain('long hair');
    expect(result).toContain('pale skin');
    // dress and sword should be denied
    expect(result).not.toContain('red dress');
    expect(result).not.toContain('sword');
  });

  it('portrait: removes camera words from raw prompt', () => {
    const result = injectAnchorByComposition(
      { positive: '1girl, blue eyes, upper body, portrait, long hair' },
      { composition: 'portrait' },
    );
    expect(result).toContain('1girl');
    expect(result).toContain('blue eyes');
    expect(result).toContain('long hair');
    expect(result).not.toContain('upper body');
    expect(result).not.toContain('portrait');
  });

  it('portrait: skips injection when positive contains NAI weight syntax', () => {
    const result = injectAnchorByComposition(
      { positive: '1.2::blue eyes, long hair::' },
      { composition: 'portrait' },
    );
    expect(result).toBe('');
  });

  // ── Secret part — breast ──

  it('secret_part breast: picks breast/skin/age from features', () => {
    const features: AnchorStructuredFeatures = {
      bust: ['large breasts', 'cleavage'],
      skinTone: ['pale skin'],
      ageAppearance: ['young'],
      appearance: ['blue eyes'],
      hairstyle: ['long hair'],
    };
    const result = injectAnchorByComposition(
      { positive: '', structuredFeatures: features },
      { composition: 'secret_part', secretPartType: 'breast' },
    );
    expect(result).toContain('large breasts');
    expect(result).toContain('cleavage');
    expect(result).toContain('pale skin');
    // face/hair features should NOT appear
    expect(result).not.toContain('blue eyes');
    expect(result).not.toContain('long hair');
  });

  it('secret_part breast: raw prompt fallback allows breast tags', () => {
    const result = injectAnchorByComposition(
      { positive: 'large breasts, pale skin, blue eyes, long hair, red dress' },
      { composition: 'secret_part', secretPartType: 'breast' },
    );
    expect(result).toContain('large breasts');
    expect(result).toContain('pale skin');
    expect(result).not.toContain('blue eyes');
    expect(result).not.toContain('long hair');
    expect(result).not.toContain('red dress');
  });

  // ── Secret part — vagina/anus (safe tags only) ──

  it('secret_part vagina: only skin/age tags from features', () => {
    const features: AnchorStructuredFeatures = {
      skinTone: ['pale skin', 'fair complexion'],
      ageAppearance: ['young adult'],
      bust: ['large breasts'],
      appearance: ['blue eyes'],
    };
    const result = injectAnchorByComposition(
      { positive: '', structuredFeatures: features },
      { composition: 'secret_part', secretPartType: 'vagina' },
    );
    expect(result).toContain('pale skin');
    expect(result).toContain('fair complexion');
    expect(result).not.toContain('large breasts');
    expect(result).not.toContain('blue eyes');
  });

  it('secret_part anus: raw prompt fallback only safe tags', () => {
    const result = injectAnchorByComposition(
      { positive: 'pale skin, tan complexion, young, blue eyes, long hair, red dress' },
      { composition: 'secret_part', secretPartType: 'anus' },
    );
    expect(result).toContain('pale skin');
    expect(result).toContain('tan');
    expect(result).toContain('young');
    expect(result).not.toContain('blue eyes');
    expect(result).not.toContain('long hair');
    expect(result).not.toContain('red dress');
  });

  // ── Half-body / Full-length / Scene / Custom — full anchor unchanged ──

  it('half-body: returns full anchor unchanged', () => {
    const positive = '1girl, blue eyes, long hair, pale skin, red dress, sword, standing';
    const result = injectAnchorByComposition(
      { positive },
      { composition: 'half-body' },
    );
    expect(result).toBe(positive);
  });

  it('full-length: returns full anchor unchanged', () => {
    const positive = '1girl, detailed outfit, full body, weapon';
    const result = injectAnchorByComposition(
      { positive },
      { composition: 'full-length' },
    );
    expect(result).toBe(positive);
  });

  it('scene: returns full anchor unchanged', () => {
    const positive = '1girl, landscape, sunset, mountains';
    const result = injectAnchorByComposition(
      { positive },
      { composition: 'scene' },
    );
    expect(result).toBe(positive);
  });

  it('custom: returns full anchor unchanged', () => {
    const positive = '1girl, custom pose, unique angle';
    const result = injectAnchorByComposition(
      { positive },
      { composition: 'custom' },
    );
    expect(result).toBe(positive);
  });

  // ── Dedup ──

  it('deduplicates tokens in portrait mode', () => {
    const result = injectAnchorByComposition(
      { positive: '1girl, blue eyes, Blue Eyes, long hair' },
      { composition: 'portrait' },
    );
    const tags = result.split(', ');
    const lowerTags = tags.map((t) => t.toLowerCase());
    expect(new Set(lowerTags).size).toBe(lowerTags.length);
  });
});
