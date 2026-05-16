import { describe, it, expect } from 'vitest';
import { clamp, generateReferenceId } from './utils';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max when value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('handles negative ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-15, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });

  it('handles zero-width range (min === max)', () => {
    expect(clamp(5, 3, 3)).toBe(3);
    expect(clamp(1, 3, 3)).toBe(3);
  });

  it('handles decimal values', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(-0.5, 0, 1)).toBe(0);
  });
});

describe('generateReferenceId', () => {
  it('returns a string starting with "ref_"', () => {
    const id = generateReferenceId();
    expect(id).toMatch(/^ref_/);
  });

  it('contains a timestamp component', () => {
    const before = Date.now();
    const id = generateReferenceId();
    const after = Date.now();

    const parts = id.split('_');
    const timestamp = Number(parts[1]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('contains a random suffix', () => {
    const id = generateReferenceId();
    const parts = id.split('_');
    expect(parts[2]).toBeDefined();
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateReferenceId()));
    expect(ids.size).toBe(100);
  });
});
