/**
 * Prompt 用户覆盖持久化 — IndexedDB 存储
 *
 * 存储用户对 prompt 模块的修改（内容修改 + 启用/禁用）。
 * key 格式: "{packId}:{promptId}"，不同 Game Pack 互不干扰。
 *
 * 支持操作：
 * - save/load/reset: 单个 prompt 的 CRUD
 * - resetAll: 按 packId 重置所有修改
 * - exportAll/importAll: 备份和恢复
 *
 * 对应 STEP-03B M2.6 prompt-storage.ts。
 * 参照 demo: promptStorage.ts（缓存 DB 连接的优化已保留）。
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'aga-prompts';

/** 存储在 IndexedDB 中的 prompt 覆盖数据 */
interface PromptOverlayData {
  content: string;
  enabled: boolean;
  modified: boolean;
  updatedAt: number;
}

export class PromptStorage {
  /** 缓存的 DB 连接 — 懒初始化，避免重复 openDB */
  private dbPromise: Promise<IDBPDatabase> | null = null;

  /** 获取（或首次打开）DB 连接 */
  private getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      const opening = openDB(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('prompts')) {
            db.createObjectStore('prompts');
          }
        },
        // 连接被浏览器异常关闭（存储驱逐 / 另一标签页 deleteDatabase）时丢弃
        // 缓存句柄，下一次 getDB() 自动重开，而非一直拿着死句柄报错。
        terminated: () => { if (this.dbPromise === opening) this.dbPromise = null; },
      });
      // open 自身失败时不要把 rejected promise 永久缓存。
      opening.catch(() => { if (this.dbPromise === opening) this.dbPromise = null; });
      this.dbPromise = opening;
    }
    return this.dbPromise;
  }

  /** 保存用户对某个 prompt 的修改 */
  async save(packId: string, promptId: string, content: string, enabled: boolean): Promise<void> {
    const db = await this.getDB();
    const data: PromptOverlayData = {
      content,
      enabled,
      modified: true,
      updatedAt: Date.now(),
    };
    await db.put('prompts', data, `${packId}:${promptId}`);
  }

  /** 加载用户对某个 prompt 的修改 */
  async load(
    packId: string,
    promptId: string,
  ): Promise<{ content: string; enabled: boolean } | undefined> {
    const db = await this.getDB();
    return db.get('prompts', `${packId}:${promptId}`) as Promise<{ content: string; enabled: boolean } | undefined>;
  }

  /** 重置某个 prompt 到默认（删除用户覆盖） */
  async reset(packId: string, promptId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('prompts', `${packId}:${promptId}`);
  }

  /** 重置指定 Game Pack 的所有 prompt 修改 */
  async resetAll(packId: string): Promise<void> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('prompts');
    const prefix = `${packId}:`;
    const tx = db.transaction('prompts', 'readwrite');
    for (const key of keys) {
      if (String(key).startsWith(prefix)) {
        await tx.store.delete(key);
      }
    }
    await tx.done;
  }

  /** 导出所有 prompt 覆盖（备份用） */
  async exportAll(): Promise<Array<{ key: string; value: unknown }>> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('prompts');
    const values = await db.getAll('prompts');
    return keys.map((k, i) => ({ key: String(k), value: values[i] }));
  }

  /** 导入 prompt 覆盖（恢复备份用） */
  async importAll(entries: Array<{ key: string; value: unknown }>): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction('prompts', 'readwrite');
    for (const entry of entries) {
      await tx.store.put(entry.value, entry.key);
    }
    await tx.done;
  }

  /**
   * Atomic clear-then-import in a SINGLE transaction (Story 6 import undo / failure-rollback) —
   * a put failure aborts the tx and rolls back to the pre-replace contents instead of leaving the
   * prompts store empty (unlike clear()+importAll() in two separate txs).
   */
  async replaceAll(entries: Array<{ key: string; value: unknown }>): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction('prompts', 'readwrite');
    await tx.store.clear();
    for (const entry of entries) {
      await tx.store.put(entry.value, entry.key);
    }
    await tx.done;
  }

  /**
   * 清空所有 prompt 覆盖（全量备份恢复前使用）
   *
   * 删除整个 prompts store 的所有条目，之后 importAll 可得到与备份一致的状态。
   */
  async clear(): Promise<void> {
    const db = await this.getDB();
    await db.clear('prompts');
  }
}
