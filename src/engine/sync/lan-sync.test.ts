import { describe, it, expect, vi, afterEach } from 'vitest';
import { LanSyncService } from './lan-sync';
import type { BackupService } from '../persistence/backup-service';

/**
 * Regression (2026-06-14): the LAN relay is dev-only (Vite middleware), but
 * `isAvailable()` used to probe `/api/lan-save` unconditionally. On the
 * production GitHub Pages build that relative OPTIONS resolved against the
 * Pages origin and 405'd — confusing noise that looked like the GitHub
 * cloud-save was calling the wrong endpoint. It must NOT fetch in prod.
 */

// isAvailable() never touches the backup service — a bare cast is sufficient.
const makeSvc = () => new LanSyncService({} as unknown as BackupService);

describe('LanSyncService.isAvailable', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns false WITHOUT probing /api/lan-save on a production build', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await makeSvc().isAvailable()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes the relay with an OPTIONS request in dev mode', async () => {
    vi.stubEnv('DEV', true);
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: false });
    vi.stubGlobal('fetch', fetchMock);

    expect(await makeSvc().isAvailable()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/lan-save', { method: 'OPTIONS' });
  });

  it('returns false in dev when the relay is not running (fetch rejects)', async () => {
    vi.stubEnv('DEV', true);
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await makeSvc().isAvailable()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
