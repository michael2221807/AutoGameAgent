/**
 * backup-service 单元测试
 *
 * 覆盖范围：
 * - 纯函数：shape 校验、localStorage 收集/擦除、composite key 编解码
 * - 不覆盖：IDB 往返（需要 fake-indexeddb，留作后续独立 integration 测试）
 *
 * 2026-04-13：对应"全量备份恢复"重构后的新格式（含 activeProfile + bundleType）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _testExports } from './backup-service';
import { createMockLocalStorage } from '@/engine/__test-utils__/local-storage.mock';

const {
  isValidBundleShape,
  collectLocalStorageSettings,
  wipeLocalStorageSettings,
  compositeSlotKey,
  parseCompositeKey,
  hasVectorContent,
  BACKUP_FORMAT_VERSION,
} = _testExports;

// ─── isValidBundleShape ─────────────────────────────────────────

describe('isValidBundleShape', () => {
  const makeValid = () => ({
    version: 1,
    exportedAt: '2026-04-13T00:00:00Z',
    engineVersion: '0.1.0',
    profiles: {},
    saves: {},
    vectors: {},
    configs: {},
    prompts: {},
    engineSettings: {},
  });

  it('accepts a minimal valid v1 bundle (no optional fields)', () => {
    expect(isValidBundleShape(makeValid())).toBe(true);
  });

  it('accepts a v1.1 bundle with activeProfile + bundleType (new format)', () => {
    const bundle = {
      ...makeValid(),
      bundleType: 'full',
      activeProfile: { profileId: 'p1', slotId: 'auto' },
    };
    expect(isValidBundleShape(bundle)).toBe(true);
  });

  it('accepts a single-profile bundle with bundleType=profile + activeProfile=null', () => {
    const bundle = {
      ...makeValid(),
      bundleType: 'profile',
      activeProfile: null,
    };
    expect(isValidBundleShape(bundle)).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(isValidBundleShape(null)).toBe(false);
    expect(isValidBundleShape(undefined)).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isValidBundleShape('hello')).toBe(false);
    expect(isValidBundleShape(42)).toBe(false);
    expect(isValidBundleShape(true)).toBe(false);
  });

  it('rejects missing required fields', () => {
    const base = makeValid() as Record<string, unknown>;
    for (const key of [
      'version', 'exportedAt', 'engineVersion',
      'profiles', 'saves', 'vectors', 'configs', 'prompts', 'engineSettings',
    ]) {
      const clone = { ...base };
      delete clone[key];
      expect(isValidBundleShape(clone), `missing ${key} should fail`).toBe(false);
    }
  });

  it('rejects wrong types for nested containers', () => {
    expect(isValidBundleShape({ ...makeValid(), profiles: null })).toBe(false);
    expect(isValidBundleShape({ ...makeValid(), saves: 'not an object' })).toBe(false);
    expect(isValidBundleShape({ ...makeValid(), version: 'v1' })).toBe(false);
  });

  it('BACKUP_FORMAT_VERSION is still 1 (v1 bundles remain valid after 2026-04-13 changes)', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  // 2026-04-14 Phase 4：customPresets 字段是 optional，新旧 bundle 都能通过
  it('accepts bundle with customPresets field (2026-04-14 +)', () => {
    expect(
      isValidBundleShape({
        ...makeValid(),
        customPresets: {
          tianming: {
            worlds: [
              { id: 'user_a_b', source: 'user', createdAt: 1, generatedBy: 'manual', name: 'X' },
            ],
          },
        },
      }),
    ).toBe(true);
  });

  it('accepts bundle WITHOUT customPresets field (backward compat)', () => {
    expect(isValidBundleShape(makeValid())).toBe(true);
  });
});

// ─── collectLocalStorageSettings ────────────────────────────────

describe('collectLocalStorageSettings', () => {
  let mock: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mock = createMockLocalStorage();
    mock.install();
  });

  afterEach(() => {
    mock.restore();
  });

  it('collects only aga_* prefixed keys', () => {
    localStorage.setItem('aga_api_management', '{"foo":1}');
    localStorage.setItem('aga_user_settings', '{"theme":"dark"}');
    localStorage.setItem('unrelated_key', 'should not be collected');
    localStorage.setItem('app_other_setting', 'nope');

    const collected = collectLocalStorageSettings();
    expect(Object.keys(collected).sort()).toEqual([
      'aga_api_management',
      'aga_user_settings',
    ]);
    expect(collected['aga_api_management']).toBe('{"foo":1}');
  });

  it('collects both aga_ and aga- prefixed keys (legacy)', () => {
    localStorage.setItem('aga_new_style', 'A');
    localStorage.setItem('aga-legacy-style', 'B');
    localStorage.setItem('something-else', 'C');

    const collected = collectLocalStorageSettings();
    expect(Object.keys(collected).sort()).toEqual([
      'aga-legacy-style',
      'aga_new_style',
    ]);
  });

  it('collects dynamic prompt keys (aga_prompt_*)', () => {
    localStorage.setItem('aga_prompt_tianming_mainRound', 'custom content');
    localStorage.setItem('aga_prompt_enabled_tianming_mainRound', 'true');
    localStorage.setItem('aga_prompt_weight_tianming_mainRound', '8');

    const collected = collectLocalStorageSettings();
    expect(Object.keys(collected)).toHaveLength(3);
    expect(collected['aga_prompt_tianming_mainRound']).toBe('custom content');
  });

  it('returns empty object when no aga keys exist', () => {
    localStorage.setItem('foo', 'bar');
    expect(collectLocalStorageSettings()).toEqual({});
  });
});

// ─── wipeLocalStorageSettings ───────────────────────────────────

describe('wipeLocalStorageSettings', () => {
  let mock: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mock = createMockLocalStorage();
    mock.install();
  });

  afterEach(() => {
    mock.restore();
  });

  it('removes all aga_ and aga- prefixed keys', () => {
    localStorage.setItem('aga_api_management', 'X');
    localStorage.setItem('aga_user_settings', 'Y');
    localStorage.setItem('aga-legacy', 'Z');

    wipeLocalStorageSettings();

    expect(localStorage.getItem('aga_api_management')).toBeNull();
    expect(localStorage.getItem('aga_user_settings')).toBeNull();
    expect(localStorage.getItem('aga-legacy')).toBeNull();
  });

  it('preserves non-aga keys', () => {
    localStorage.setItem('aga_foo', 'wipe me');
    localStorage.setItem('other_key', 'keep me');
    localStorage.setItem('app_setting', 'keep me too');

    wipeLocalStorageSettings();

    expect(localStorage.getItem('aga_foo')).toBeNull();
    expect(localStorage.getItem('other_key')).toBe('keep me');
    expect(localStorage.getItem('app_setting')).toBe('keep me too');
  });

  it('handles many keys without index drift (collect-then-delete pattern)', () => {
    // 10 个 aga_ 键 + 10 个 other 键交错
    for (let i = 0; i < 10; i++) {
      localStorage.setItem(`aga_key_${i}`, String(i));
      localStorage.setItem(`other_${i}`, String(i));
    }

    wipeLocalStorageSettings();

    for (let i = 0; i < 10; i++) {
      expect(localStorage.getItem(`aga_key_${i}`)).toBeNull();
      expect(localStorage.getItem(`other_${i}`)).toBe(String(i));
    }
  });

  it('is idempotent (safe to call twice)', () => {
    localStorage.setItem('aga_foo', 'X');
    wipeLocalStorageSettings();
    wipeLocalStorageSettings(); // should not throw
    expect(localStorage.getItem('aga_foo')).toBeNull();
  });
});

// ─── compositeSlotKey / parseCompositeKey ───────────────────────

describe('compositeSlotKey', () => {
  it('combines profileId and slotId with "/"', () => {
    expect(compositeSlotKey('profile-123', 'slot-auto')).toBe('profile-123/slot-auto');
  });

  it('handles IDs containing underscores (IDB uses "_", composite uses "/")', () => {
    expect(compositeSlotKey('profile_with_underscore', 'slot_1')).toBe(
      'profile_with_underscore/slot_1',
    );
  });
});

describe('parseCompositeKey', () => {
  it('splits at the first "/"', () => {
    expect(parseCompositeKey('profile-123/slot-auto')).toEqual({
      profileId: 'profile-123',
      slotId: 'slot-auto',
    });
  });

  it('handles slotIds that themselves contain "/"', () => {
    // 当前实现使用 indexOf，第一个 / 前是 profileId，之后全是 slotId
    expect(parseCompositeKey('p1/slot/with/slashes')).toEqual({
      profileId: 'p1',
      slotId: 'slot/with/slashes',
    });
  });

  it('throws on malformed key without separator', () => {
    expect(() => parseCompositeKey('no_slash_here')).toThrow();
  });

  it('throws when key starts with "/"', () => {
    expect(() => parseCompositeKey('/slot-only')).toThrow();
  });

  it('throws when key ends with "/"', () => {
    expect(() => parseCompositeKey('profile-only/')).toThrow();
  });

  it('round-trip: compose then parse returns original parts', () => {
    const original = { profileId: 'p_abc', slotId: 's_123' };
    const composed = compositeSlotKey(original.profileId, original.slotId);
    expect(parseCompositeKey(composed)).toEqual(original);
  });
});

// ─── hasVectorContent ───────────────────────────────────────────

describe('hasVectorContent', () => {
  it('returns false for empty event + empty entity vectors', () => {
    expect(hasVectorContent({ eventVectors: {}, entityVectors: {} })).toBe(false);
  });

  it('returns true when eventVectors has content', () => {
    expect(
      hasVectorContent({
        eventVectors: { 'evt-1': [0.1, 0.2] },
        entityVectors: {},
      }),
    ).toBe(true);
  });

  it('returns true when entityVectors has content', () => {
    expect(
      hasVectorContent({
        eventVectors: {},
        entityVectors: { 'ent-1': [0.3, 0.4] },
      }),
    ).toBe(true);
  });

  it('returns true when both non-empty', () => {
    expect(
      hasVectorContent({
        eventVectors: { e: [1] },
        entityVectors: { n: [2] },
      }),
    ).toBe(true);
  });
});
