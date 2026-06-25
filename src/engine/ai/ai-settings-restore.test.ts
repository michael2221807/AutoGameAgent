/**
 * Regression: applyPersistedAISettings — shared cold-start / post-import restorer.
 *
 * Guards the API-management persistence fixes (2026-06-24):
 * - aga_ai_settings is co-owned by APIPanel (streaming/splitGen/maxRetries/
 *   privacyRepairRetries) and SettingsPanel (lowLoadMode/lowLoadMaxRequests).
 * - On cold start AND after a full-backup import, both maxRetries and the low-load
 *   rate limiter must be re-applied to the live AIService from localStorage.
 * - Importing a backup with low-load OFF must explicitly DISABLE a limiter that an
 *   earlier session enabled (unconditional configure, not "only when true").
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIService, applyPersistedAISettings, AI_SETTINGS_STORAGE_KEY } from './ai-service';
import { createMockLocalStorage } from '@/engine/__test-utils__/local-storage.mock';

let mock: ReturnType<typeof createMockLocalStorage>;

beforeEach(() => {
  mock = createMockLocalStorage();
  mock.install();
});

afterEach(() => {
  mock.restore();
});

function write(settings: Record<string, unknown>): void {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

describe('applyPersistedAISettings', () => {
  it('applies persisted maxRetries to the service', () => {
    write({ maxRetries: 4 });
    const svc = new AIService();
    applyPersistedAISettings(svc);
    expect(svc.maxRetries).toBe(4);
  });

  it('enables the rate limiter when lowLoadMode is true', () => {
    write({ lowLoadMode: true, lowLoadMaxRequests: 5 });
    const svc = new AIService();
    applyPersistedAISettings(svc);
    expect(svc.rateLimiterEnabled).toBe(true);
  });

  it('explicitly disables the limiter when lowLoadMode is false (import OFF must override a previously-enabled limiter)', () => {
    const svc = new AIService();
    svc.configureRateLimiter({ enabled: true, maxRequests: 3, windowMs: 60_000 });
    expect(svc.rateLimiterEnabled).toBe(true);
    write({ lowLoadMode: false });
    applyPersistedAISettings(svc);
    expect(svc.rateLimiterEnabled).toBe(false);
  });

  it('disables the limiter when lowLoadMode is absent', () => {
    const svc = new AIService();
    svc.configureRateLimiter({ enabled: true, maxRequests: 3, windowMs: 60_000 });
    write({ streaming: true });
    applyPersistedAISettings(svc);
    expect(svc.rateLimiterEnabled).toBe(false);
  });

  it('does not throw and leaves defaults on missing / malformed settings', () => {
    const svc = new AIService();
    const defaultRetries = svc.maxRetries;
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, '{not valid json');
    expect(() => applyPersistedAISettings(svc)).not.toThrow();
    expect(svc.maxRetries).toBe(defaultRetries);
    expect(svc.rateLimiterEnabled).toBe(false);
  });

  it('co-tenant merge contract: APIPanel-owned keys and lowLoad keys can coexist in one object', () => {
    // Mirrors the real read-merge fix: a single aga_ai_settings object carries BOTH
    // panels' fields; applying it restores both halves.
    write({
      streaming: false,
      splitGen: true,
      maxRetries: 2,
      privacyRepairRetries: 3,
      lowLoadMode: true,
      lowLoadMaxRequests: 7,
    });
    const svc = new AIService();
    applyPersistedAISettings(svc);
    expect(svc.maxRetries).toBe(2);
    expect(svc.rateLimiterEnabled).toBe(true);
  });
});
