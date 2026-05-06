// App doc: docs/user-guide/pages/game-image.md §后台生成保护机制
/**
 * Image State Manager — MRJH npcImageStateWorkflow.ts + sceneImageArchiveWorkflow.ts
 *
 * Centralized state mutations for the image subsystem:
 * - NPC archive: history CRUD, avatar/portrait/background selection, auto-fallback
 * - Scene archive: wallpaper set/clear, persistent wallpaper
 * - Secret parts: per-body-part result storage
 * - Concurrent generation lock
 *
 * All mutations write to the state tree via StateManager and trigger auto-save.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ FRONTEND TODO (Phase 3-8: All Image UI tabs)                   │
 * │                                                                 │
 * │ These methods are consumed by every image UI feature:           │
 * │ - Gallery: set/clear avatar/portrait/background, delete image   │
 * │ - Scene: set/clear wallpaper, persistent wallpaper              │
 * │ - Manual: concurrent lock, task management                      │
 * │ - Presets: anchor save, preset CRUD                             │
 * │ MRJH ref: MRJH-USER-EXPERIENCE.md §B §E §F §G                 │
 * └─────────────────────────────────────────────────────────────────┘
 */
import type { StateManager } from '../core/state-manager';
import type { EnginePathConfig } from '../pipeline/types';
import type { SecretPartType } from './types';
import { eventBus } from '../core/event-bus';

/** Player pseudo-NPC identifier (MRJH: 主角角色锚点标识) */
export const PLAYER_PSEUDO_NPC_ID = '__player__';

/** State path for the player character's image archive */
const PLAYER_ARCHIVE_PATH = '角色.图片档案';

export class ImageStateManager {
  private static readonly LOCK_TIMEOUT_MS = 300_000;

  private generatingMap = new Map<string, number>();

  private isPlayer(name: string): boolean { return name === PLAYER_PSEUDO_NPC_ID; }

  constructor(
    private stateManager: StateManager,
    private paths: EnginePathConfig,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // §1 — Concurrent generation lock (MRJH NPC生图进行中集合)
  // ═══════════════════════════════════════════════════════════

  isGenerating(key: string): boolean {
    const lockedAt = this.generatingMap.get(key);
    if (lockedAt === undefined) return false;
    if (Date.now() - lockedAt > ImageStateManager.LOCK_TIMEOUT_MS) {
      this.generatingMap.delete(key);
      console.warn(`[ImageStateManager] Lock expired for "${key}" after ${ImageStateManager.LOCK_TIMEOUT_MS / 1000}s`);
      return false;
    }
    return true;
  }
  lockGeneration(key: string): void { this.generatingMap.set(key, Date.now()); }
  unlockGeneration(key: string): void { this.generatingMap.delete(key); }

  // ═══════════════════════════════════════════════════════════
  // §2 — NPC archive reads
  // ═══════════════════════════════════════════════════════════

  getNpcArchive(npcName: string): Record<string, unknown> | null {
    if (this.isPlayer(npcName)) {
      const raw = this.stateManager.get<Record<string, unknown>>(PLAYER_ARCHIVE_PATH);
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    }
    const npc = this.findNpc(npcName);
    if (!npc) return null;
    const archive = npc['图片档案'];
    return archive && typeof archive === 'object' && !Array.isArray(archive)
      ? archive as Record<string, unknown> : null;
  }

  getNpcImageHistory(npcName: string): Array<Record<string, unknown>> {
    const archive = this.getNpcArchive(npcName);
    return Array.isArray(archive?.['生图历史']) ? archive!['生图历史'] as Array<Record<string, unknown>> : [];
  }

  // ═══════════════════════════════════════════════════════════
  // §3 — NPC archive writes (MRJH npcImageStateWorkflow.ts)
  // ═══════════════════════════════════════════════════════════

  /**
   * Write an image record to NPC history with dedup + auto-selection.
   * MRJH 写入NPC图片历史记录 (npcImageStateWorkflow.ts:198-253)
   */
  writeNpcImageRecord(npcName: string, record: Record<string, unknown>): void {
    this.mutateNpc(npcName, (npc) => {
      const archive = this.ensureArchive(npc);
      const history = this.getHistoryArray(archive);

      const newRecord = {
        ...record,
        id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : this.generateRecordId(),
      };

      // Dedup by ID + sort by time descending
      const nextHistory = [newRecord, ...history.filter((item) => item.id !== newRecord.id)]
        .sort((a, b) => (Number((b as Record<string, unknown>)['生成时间'] ?? (b as Record<string, unknown>).createdAt ?? 0)) - (Number((a as Record<string, unknown>)['生成时间'] ?? (a as Record<string, unknown>).createdAt ?? 0)));

      // Auto-select avatar fallback if current selection was removed
      const currentAvatar = String(archive['已选头像图片ID'] ?? '').trim();
      const avatarStillExists = currentAvatar && nextHistory.some((item) => item.id === currentAvatar);
      const autoAvatar = !avatarStillExists
        ? (nextHistory.find((r) => (r as Record<string, unknown>).composition === 'portrait' && (r as Record<string, unknown>).status === 'complete')?.id as string
          ?? nextHistory.find((r) => (r as Record<string, unknown>).composition !== 'secret_part' && (r as Record<string, unknown>).status === 'complete')?.id as string
          ?? '')
        : currentAvatar;

      // Enforce per-NPC history limit (MRJH: 按NPC上限裁剪档案)
      const limit = this.stateManager.get<number>('系统.扩展.image.config.auto.historyLimit') ?? 100;
      if (nextHistory.length > limit) nextHistory.length = limit;

      npc['图片档案'] = {
        ...archive,
        '生图历史': nextHistory,
        '最近生图结果': newRecord.id,
        '已选头像图片ID': autoAvatar,
      };
      return npc;
    });
  }

  // ── Selection management ──

  setNpcAvatar(npcName: string, assetId: string): void {
    this.setArchiveField(npcName, '已选头像图片ID', assetId);
  }

  clearNpcAvatar(npcName: string): void {
    this.setArchiveField(npcName, '已选头像图片ID', '');
  }

  setNpcPortrait(npcName: string, assetId: string): void {
    this.setArchiveField(npcName, '已选立绘图片ID', assetId);
  }

  clearNpcPortrait(npcName: string): void {
    this.setArchiveField(npcName, '已选立绘图片ID', '');
  }

  setNpcBackground(npcName: string, assetId: string): void {
    this.setArchiveField(npcName, '已选背景图片ID', assetId);
  }

  clearNpcBackground(npcName: string): void {
    this.setArchiveField(npcName, '已选背景图片ID', '');
  }

  // ── Delete + clear ──

  deleteNpcImage(npcName: string, imageId: string): void {
    this.mutateNpc(npcName, (npc) => {
      const archive = this.ensureArchive(npc);
      const history = this.getHistoryArray(archive).filter((r) => r.id !== imageId);

      // Clear selections that pointed to deleted image
      const clearIfMatch = (field: string) => {
        if (String(archive[field] ?? '') === imageId) archive[field] = '';
      };
      clearIfMatch('已选头像图片ID');
      clearIfMatch('已选立绘图片ID');
      clearIfMatch('已选背景图片ID');
      if (String(archive['最近生图结果'] ?? '') === imageId) {
        archive['最近生图结果'] = history[0]?.id ?? '';
      }

      npc['图片档案'] = { ...archive, '生图历史': history };
      return npc;
    });
  }

  clearNpcHistory(npcName: string): void {
    this.mutateNpc(npcName, (npc) => {
      npc['图片档案'] = {
        '生图历史': [],
        '最近生图结果': '',
        '已选头像图片ID': '',
        '已选立绘图片ID': '',
        '已选背景图片ID': '',
      };
      return npc;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // §4 — Secret part results (MRJH npcImageStateWorkflow.ts:255+)
  // ═══════════════════════════════════════════════════════════

  setSecretPartResult(npcName: string, part: SecretPartType, result: Record<string, unknown>): void {
    this.mutateNpc(npcName, (npc) => {
      const archive = this.ensureArchive(npc);
      const secretArchive = (archive['香闺秘档'] ?? {}) as Record<string, unknown>;
      const partKey = part === 'breast' ? '胸部' : part === 'vagina' ? '小穴' : '屁穴';
      secretArchive[partKey] = result;
      npc['图片档案'] = { ...archive, '香闺秘档': secretArchive };
      return npc;
    });
  }

  getSecretPartResult(npcName: string, part: SecretPartType): Record<string, unknown> | null {
    const archive = this.getNpcArchive(npcName);
    if (!archive) return null;
    const secretArchive = archive['香闺秘档'] as Record<string, unknown> | undefined;
    if (!secretArchive) return null;
    const partKey = part === 'breast' ? '胸部' : part === 'vagina' ? '小穴' : '屁穴';
    const result = secretArchive[partKey];
    return result && typeof result === 'object' ? result as Record<string, unknown> : null;
  }

  // ═══════════════════════════════════════════════════════════
  // §5 — Scene wallpaper (MRJH sceneImageArchiveWorkflow.ts)
  // ═══════════════════════════════════════════════════════════

  setSceneWallpaper(imageId: string): void {
    this.mutateSceneArchive((archive) => {
      archive['当前壁纸图片ID'] = imageId;
      return archive;
    });
  }

  clearSceneWallpaper(): void {
    this.mutateSceneArchive((archive) => {
      archive['当前壁纸图片ID'] = '';
      return archive;
    });
  }

  setPersistentWallpaper(url: string): void {
    this.stateManager.set('系统.扩展.image.persistentWallpaper', url, 'system');
    eventBus.emit('engine:request-save');
  }

  clearPersistentWallpaper(): void {
    this.stateManager.set('系统.扩展.image.persistentWallpaper', '', 'system');
    eventBus.emit('engine:request-save');
  }

  getPersistentWallpaper(): string {
    return this.stateManager.get<string>('系统.扩展.image.persistentWallpaper') ?? '';
  }

  // ═══════════════════════════════════════════════════════════
  // §6 — Internal helpers
  // ═══════════════════════════════════════════════════════════

  private findNpc(npcName: string): Record<string, unknown> | null {
    if (this.isPlayer(npcName)) {
      const raw = this.stateManager.get<Record<string, unknown>>(PLAYER_ARCHIVE_PATH);
      return { '图片档案': raw && typeof raw === 'object' ? raw : undefined };
    }
    const list = this.stateManager.get<Array<Record<string, unknown>>>(this.paths.relationships);
    if (!Array.isArray(list)) return null;
    const nameKey = this.paths.npcFieldNames?.name ?? '名称';
    return list.find((n) => n[nameKey] === npcName) as Record<string, unknown> ?? null;
  }

  private findNpcIndex(npcName: string): number {
    const list = this.stateManager.get<Array<Record<string, unknown>>>(this.paths.relationships);
    if (!Array.isArray(list)) return -1;
    const nameKey = this.paths.npcFieldNames?.name ?? '名称';
    return list.findIndex((n) => n[nameKey] === npcName);
  }

  private mutateNpc(npcName: string, mutator: (npc: Record<string, unknown>) => Record<string, unknown>): void {
    // Player pseudo-NPC: read/write directly from 角色.图片档案
    if (this.isPlayer(npcName)) {
      const raw = this.stateManager.get<Record<string, unknown>>(PLAYER_ARCHIVE_PATH);
      const playerObj = { '图片档案': raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : undefined };
      const mutated = mutator({ ...playerObj });
      this.stateManager.set(PLAYER_ARCHIVE_PATH, mutated['图片档案'] ?? {}, 'system');
      eventBus.emit('engine:request-save');
      return;
    }

    const list = this.stateManager.get<Array<Record<string, unknown>>>(this.paths.relationships);
    if (!Array.isArray(list)) return;
    const idx = this.findNpcIndex(npcName);
    if (idx < 0) return;

    const updated = [...list];
    updated[idx] = mutator({ ...list[idx] });
    this.stateManager.set(this.paths.relationships, updated, 'system');
    eventBus.emit('engine:request-save');
  }

  private setArchiveField(npcName: string, field: string, value: string): void {
    this.mutateNpc(npcName, (npc) => {
      const archive = this.ensureArchive(npc);
      npc['图片档案'] = { ...archive, [field]: value };
      return npc;
    });
  }

  private ensureArchive(npc: Record<string, unknown>): Record<string, unknown> {
    const raw = npc['图片档案'];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };
    return { '生图历史': [], '已选头像图片ID': '', '已选立绘图片ID': '', '已选背景图片ID': '', '最近生图结果': '' };
  }

  private getHistoryArray(archive: Record<string, unknown>): Array<Record<string, unknown>> {
    const raw = archive['生图历史'];
    return Array.isArray(raw) ? raw.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object') : [];
  }

  private mutateSceneArchive(mutator: (archive: Record<string, unknown>) => Record<string, unknown>): void {
    const raw = this.stateManager.get<Record<string, unknown>>('系统.扩展.image.sceneArchive') ?? { '生图历史': [], '当前壁纸图片ID': '' };
    const archive = typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { '生图历史': [], '当前壁纸图片ID': '' };
    const updated = mutator(archive);
    this.stateManager.set('系统.扩展.image.sceneArchive', updated, 'system');
    eventBus.emit('engine:request-save');
  }

  private generateRecordId(): string {
    return `npc_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
