/**
 * LAN Save Sync — 内网存档中继客户端
 *
 * 与 vite.config.ts 中的 lanSaveRelay 插件配合使用。
 * 仅在开发模式下可用（Vite dev server 提供 /api/lan-save 端点）。
 * GitHub Pages 上此功能不可用（无 dev server），UI 会自动隐藏。
 */
// App doc: docs/user-guide/cloud-sync.md（方式三：内网中继）· docs/user-guide/pages/game-save.md §3.3

import type { BackupService } from '../persistence/backup-service';

const LS_ENABLED = 'aga_lan_sync_enabled';

export class LanSyncService {
  constructor(private backup: BackupService) {}

  isEnabled(): boolean {
    return localStorage.getItem(LS_ENABLED) !== 'false';
  }

  setEnabled(v: boolean): void {
    localStorage.setItem(LS_ENABLED, String(v));
  }

  /** Check if the LAN relay endpoint is available (dev server running) */
  async isAvailable(): Promise<boolean> {
    // The /api/lan-save relay only exists in the Vite dev server (see the
    // lanSaveRelay middleware in vite.config.ts). On a production build such as
    // GitHub Pages there is no such endpoint, so a relative OPTIONS probe just
    // resolves against the Pages origin and 405s — confusing noise that looks
    // like the cloud-save calling the wrong API. Skip the request entirely:
    // the feature is dev-only, so it is definitionally unavailable in prod.
    if (!import.meta.env.DEV) return false;
    try {
      const res = await fetch('/api/lan-save', { method: 'OPTIONS' });
      return res.status === 204 || res.ok;
    } catch {
      return false;
    }
  }

  /** Upload current save to the LAN relay */
  async upload(): Promise<{ size: number; updatedAt: string }> {
    const blob = await this.backup.exportAll();
    const res = await fetch('/api/lan-save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // Pass the Blob directly — fetch streams its bytes, so we avoid
      // materializing the entire (~100MB+) bundle as a JS string via .text().
      body: blob,
    });
    if (!res.ok) throw new Error(`LAN 上传失败: ${res.status}`);
    return res.json() as Promise<{ size: number; updatedAt: string }>;
  }

  /** Download save from the LAN relay and import */
  async download(): Promise<void> {
    const res = await fetch('/api/lan-save');
    if (res.status === 404) throw new Error('中继服务器上暂无存档');
    if (!res.ok) throw new Error(`LAN 下载失败: ${res.status}`);
    const blob = await res.blob();
    await this.backup.importAll(blob);
  }
}
