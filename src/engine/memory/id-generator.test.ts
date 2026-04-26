import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateMemoryId } from '@/engine/memory/id-generator';

describe('generateMemoryId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns string starting with prefix', () => {
    expect(generateMemoryId('lt')).toMatch(/^lt_/);
  });

  it('supports compound prefixes', () => {
    expect(generateMemoryId('lt_archive')).toMatch(/^lt_archive_/);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateMemoryId('test'));
    expect(ids.size).toBe(1000);
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid-1234' });
    expect(generateMemoryId('lt')).toBe('lt_fixed-uuid-1234');
  });

  it('falls back to Date.now + random when crypto unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
    const id = generateMemoryId('lt');
    expect(id).toMatch(/^lt_1700000000000_/);
    expect(id.length).toBeGreaterThan('lt_1700000000000_'.length);
  });

  it('handles empty prefix', () => {
    const id = generateMemoryId('');
    expect(id).toMatch(/^_/);
  });
});
