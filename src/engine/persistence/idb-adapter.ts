/**
 * IndexedDB 底层适配器 — 通用 KV 存储
 *
 * 所有持久化模块（SaveManager, ProfileManager）都通过此适配器
 * 与 IndexedDB 交互，避免各模块分别管理 DB 连接。
 *
 * 对应 STEP-03 M1.6。
 * 参照 demo: indexedDBManager.ts（但简化为纯 KV 接口）。
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'aga-saves';
const DB_VERSION = 1;
const STORE_NAME = 'data';

/** 缓存的 DB 连接 Promise — 懒初始化，全应用共享 */
let dbPromise: Promise<IDBPDatabase> | null = null;

/** 获取（或首次打开）IndexedDB 连接 */
function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 通用 KV 适配器
 * key 命名约定：
 * - "storage_root" — 角色档案根
 * - "save_{profileId}_{slotId}" — 存档数据
 */
let _lastQuotaCheck = 0;
const QUOTA_CHECK_INTERVAL = 60_000;

export const idbAdapter = {
  /** 按 key 读取 */
  async get<T>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return db.get(STORE_NAME, key);
  },

  /** 写入（structuredClone 避免 reactive proxy 问题） */
  async set(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    try {
      await db.put(STORE_NAME, structuredClone(value), key);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.error('[IDB] QuotaExceededError — storage full');
      }
      throw err;
    }

    const now = Date.now();
    if (navigator.storage?.estimate && now - _lastQuotaCheck > QUOTA_CHECK_INTERVAL) {
      _lastQuotaCheck = now;
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage && quota && usage > quota * 0.85) {
          console.warn(`[IDB] Storage ${Math.round(usage / 1024 / 1024)}MB / ${Math.round(quota / 1024 / 1024)}MB (>85%)`);
        }
      }).catch(() => { /* estimate() unavailable */ });
    }
  },

  /** 删除 */
  async delete(key: string): Promise<void> {
    const db = await getDB();
    await db.delete(STORE_NAME, key);
  },

  /** 列出所有 key */
  async keys(): Promise<string[]> {
    const db = await getDB();
    const allKeys = await db.getAllKeys(STORE_NAME);
    return allKeys.map(String);
  },

  /** 清空整个 store — 慎用，仅测试/重置时使用 */
  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear(STORE_NAME);
  },
};
