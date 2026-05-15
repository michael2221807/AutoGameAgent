import { describe, it, expect, beforeEach } from 'vitest';
import { compareVersions, MigrationRegistry } from './migration-registry';
import type { Migration } from './migration-registry';

describe('compareVersions', () => {
  it('equal versions return 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('a > b returns positive', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('a < b returns negative', () => {
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
  });

  it('compares major version first', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('compares minor version second', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
  });

  it('compares patch version third', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
  });

  it('handles different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  it('treats empty string as "0"', () => {
    expect(compareVersions('', '0')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
    expect(compareVersions('', '0.0.1')).toBeLessThan(0);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
    expect(compareVersions('1.abc.0', '1.0.0')).toBe(0);
  });
});

describe('MigrationRegistry', () => {
  let registry: MigrationRegistry;

  beforeEach(() => {
    registry = new MigrationRegistry();
  });

  const makeMigration = (
    from: string,
    to: string,
    fn?: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Migration => ({
    fromVersion: from,
    toVersion: to,
    description: `${from} → ${to}`,
    migrate: fn ?? ((data) => ({ ...data, [`migrated_${to}`]: true })),
  });

  describe('register', () => {
    it('increments size', () => {
      expect(registry.size()).toBe(0);
      registry.register(makeMigration('0.1.0', '0.2.0'));
      expect(registry.size()).toBe(1);
    });

    it('allows multiple registrations', () => {
      registry.register(makeMigration('0.1.0', '0.2.0'));
      registry.register(makeMigration('0.2.0', '0.3.0'));
      expect(registry.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('resets size to 0', () => {
      registry.register(makeMigration('0.1.0', '0.2.0'));
      registry.clear();
      expect(registry.size()).toBe(0);
    });
  });

  describe('apply', () => {
    it('returns original data when already at target version', () => {
      const data = { foo: 'bar' };
      const result = registry.apply(data, '1.0.0', '1.0.0');
      expect(result.data).toBe(data);
      expect(result.applied).toHaveLength(0);
      expect(result.finalVersion).toBe('1.0.0');
    });

    it('returns original data when past target version', () => {
      const data = { foo: 'bar' };
      const result = registry.apply(data, '2.0.0', '1.0.0');
      expect(result.data).toBe(data);
      expect(result.applied).toHaveLength(0);
    });

    it('returns original data when no migrations registered', () => {
      const data = { foo: 'bar' };
      const result = registry.apply(data, '0.1.0', '1.0.0');
      expect(result.data).toBe(data);
      expect(result.applied).toHaveLength(0);
      expect(result.finalVersion).toBe('0.1.0');
    });

    it('applies single migration', () => {
      registry.register(makeMigration('0.1.0', '0.2.0'));
      const result = registry.apply({ value: 1 }, '0.1.0', '0.2.0');
      expect(result.applied).toHaveLength(1);
      expect(result.finalVersion).toBe('0.2.0');
      expect(result.data).toHaveProperty('migrated_0.2.0', true);
    });

    it('chains multiple migrations in order', () => {
      const applied: string[] = [];
      registry.register(makeMigration('0.1.0', '0.2.0', (d) => {
        applied.push('0.1→0.2');
        return { ...d, v: '0.2' };
      }));
      registry.register(makeMigration('0.2.0', '0.3.0', (d) => {
        applied.push('0.2→0.3');
        return { ...d, v: '0.3' };
      }));
      const result = registry.apply({ v: '0.1' }, '0.1.0', '0.3.0');
      expect(result.finalVersion).toBe('0.3.0');
      expect(result.applied).toHaveLength(2);
      expect(applied).toEqual(['0.1→0.2', '0.2→0.3']);
      expect(result.data).toHaveProperty('v', '0.3');
    });

    it('stops when migration chain is broken (gap)', () => {
      registry.register(makeMigration('0.1.0', '0.2.0'));
      // Missing 0.2.0 → 0.3.0
      registry.register(makeMigration('0.3.0', '0.4.0'));
      const result = registry.apply({}, '0.1.0', '0.4.0');
      expect(result.finalVersion).toBe('0.2.0');
      expect(result.applied).toHaveLength(1);
    });

    it('halts on error and returns partial result', () => {
      registry.register(makeMigration('0.1.0', '0.2.0'));
      registry.register(makeMigration('0.2.0', '0.3.0', () => {
        throw new Error('migration failed');
      }));
      const result = registry.apply({}, '0.1.0', '0.3.0');
      expect(result.finalVersion).toBe('0.2.0');
      expect(result.applied).toHaveLength(1);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toBe('migration failed');
    });

    it('treats empty fromVersion as "0"', () => {
      registry.register(makeMigration('0', '0.1.0'));
      const result = registry.apply({}, '', '0.1.0');
      expect(result.applied).toHaveLength(1);
      expect(result.finalVersion).toBe('0.1.0');
    });

    it('handles non-Error throws', () => {
      registry.register(makeMigration('0.1.0', '0.2.0', () => {
        throw 'string error';
      }));
      const result = registry.apply({}, '0.1.0', '0.2.0');
      expect(result.error).toBeDefined();
      expect(result.error!.message).toBe('string error');
    });

    it('has safety limit to prevent infinite loops', () => {
      // Register a migration that loops back
      registry.register({
        fromVersion: '0.1.0',
        toVersion: '0.1.0',
        description: 'no-op',
        migrate: (d) => d,
      });
      const result = registry.apply({}, '0.1.0', '1.0.0');
      // Should terminate due to safety limit, not hang
      expect(result.applied.length).toBeLessThanOrEqual(100);
    });
  });
});
