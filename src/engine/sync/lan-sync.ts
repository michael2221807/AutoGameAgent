/**
 * LAN Save Sync — 内网存档中继客户端
 *
 * 与 vite.config.ts 中的 lanSaveRelay 插件配合使用。
 * 仅在开发模式下可用（Vite dev server 提供 /api/lan-save 端点）。
 * GitHub Pages 上此功能不可用（无 dev server），UI 会自动隐藏。
 */

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
      body: await blob.text(),
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
