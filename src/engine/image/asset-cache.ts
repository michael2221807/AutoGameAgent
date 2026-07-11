/**
 * Image Asset Cache — Sprint Image-4
 *
 * Stores generated images in IndexedDB for offline access and fast retrieval.
 * Per user directive (R-S2-1): IndexedDB for MVP, no scale considerations.
 *
 * Schema: single object store `image-assets`, keyed by asset ID.
 * Each entry stores: { id, blob, metadata }.
 *
 * 连接生命周期加固（2026-06-21）：注册 onclose/onversionchange 在连接被浏览器
 * 异常关闭（存储驱逐 / 另一标签页 deleteDatabase）时丢弃句柄；所有操作经
 * `withRetry` 包裹，遇「连接已关闭」类错误自动重开一次再试，而非永久报错到刷新为止。
 */
// App doc: docs/user-guide/pages/game-save.md §3.2 (数据持久化与浏览器驱逐) · docs/user-guide/pages/image.md
import type { ImageAsset } from './types';

const DB_NAME = 'aga_image_cache';
const DB_VERSION = 1;
const STORE_NAME = 'image-assets';

/** 连接被关闭后用于触发 withRetry 一次重连的可重试错误 */
function closedConnectionError(): DOMException {
  return new DOMException('Image cache connection is closed', 'InvalidStateError');
}

export class ImageAssetCache {
  private db: IDBDatabase | null = null;
  /** in-flight open() 去重 —— 避免并发/重试时重复 indexedDB.open() 泄漏连接句柄 */
  private openingPromise: Promise<void> | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    if (this.openingPromise) return this.openingPromise;

    this.openingPromise = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // 连接被浏览器异常关闭（存储驱逐 / 另一标签页 deleteDatabase）→ 丢弃句柄，下次重开。
        db.onclose = () => { if (this.db === db) this.db = null; };
        // 另一标签页要求升级/删库 → 主动关闭让出，并丢弃句柄，避免阻塞对方。
        db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; };
        this.db = db;
        resolve();
      };

      request.onerror = () => reject(request.error);
    }).finally(() => { this.openingPromise = null; });

    return this.openingPromise;
  }

  /** 遇「连接已关闭/被删」类错误时丢弃句柄并重开一次再试 */
  private async withRetry<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    await this.open();
    try {
      // this.db 可能在 open() 之后、fn() 之前被 onversionchange 置空 —— 显式读出校验，
      // null 时抛可重试错误，而不是把 null 传进 .transaction()。
      const db = this.db;
      if (!db) throw closedConnectionError();
      return await fn(db);
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'InvalidStateError' || err.name === 'NotFoundError')
      ) {
        this.db = null;
        await this.open();
        const db = this.db;
        if (!db) throw closedConnectionError();
        return fn(db);
      }
      throw err;
    }
  }

  async store(asset: ImageAsset, blob: Blob): Promise<void> {
    return this.withRetry((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ id: asset.id, blob, metadata: asset });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  async retrieve(assetId: string): Promise<{ blob: Blob; metadata: ImageAsset } | null> {
    return this.withRetry((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const result = request.result as { id: string; blob: Blob; metadata: ImageAsset } | undefined;
        resolve(result ? { blob: result.blob, metadata: result.metadata } : null);
      };
      request.onerror = () => reject(request.error);
    }));
  }

  async delete(assetId: string): Promise<void> {
    return this.withRetry((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  async listAll(): Promise<ImageAsset[]> {
    return this.withRetry((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = request.result as Array<{ metadata: ImageAsset }>;
        resolve(entries.map((e) => e.metadata));
      };
      request.onerror = () => reject(request.error);
    }));
  }

  async clear(): Promise<void> {
    return this.withRetry((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  /**
   * Export specific assets as base64-encoded entries for JSON backup.
   * Only exports assets whose IDs are in the provided set.
   */
  async exportByIds(assetIds: Set<string>): Promise<Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }>> {
    if (assetIds.size === 0) return [];
    return this.withRetry((db) => {
      // results 在 fn 内部声明 —— 重试时从空数组重新开始，避免重复累积。
      const results: Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }> = [];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.openCursor();
        const pending: Promise<void>[] = [];

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const entry = cursor.value as { id: string; blob: Blob; metadata: ImageAsset };
            if (assetIds.has(entry.id)) {
              pending.push(
                blobToBase64(entry.blob).then((base64) => {
                  results.push({ id: entry.id, metadata: entry.metadata, base64, mimeType: entry.blob.type || 'image/png' });
                }),
              );
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => { Promise.all(pending).then(() => resolve(results)).catch(reject); };
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  /**
   * Count how many of the given asset ids are actually present in the cache.
   *
   * Cheap keys-only existence check (no blob decode). Used by the export
   * integrity guard: if a save references N assets but only M<N are present,
   * the image cache was evicted/cleared and the export would silently drop
   * images — the sync layer must treat that as a degraded upload rather than
   * overwrite a healthy cloud backup. Distinguishes "cache is empty" from
   * "no images referenced", which {@link exportByIds} alone cannot.
   */
  async countPresent(assetIds: Set<string>): Promise<number> {
    if (assetIds.size === 0) return 0;
    return this.withRetry((db) => new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result as IDBValidKey[];
        let n = 0;
        for (const k of keys) if (typeof k === 'string' && assetIds.has(k)) n++;
        resolve(n);
      };
      request.onerror = () => reject(request.error);
    }));
  }

  /** Import base64-encoded assets back into the cache */
  async importEntries(entries: Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }>): Promise<void> {
    if (entries.length === 0) return;
    await this.open();
    for (const entry of entries) {
      try {
        const blob = base64ToBlob(entry.base64, entry.mimeType);
        await this.store(entry.metadata, blob);
      } catch {
        console.warn(`[ImageAssetCache] Failed to import asset "${entry.id}", skipping`);
      }
    }
  }
}

/** Delimiter between an import namespace and the original asset id. */
const ASSET_NAMESPACE_DELIM = '::';

/**
 * Namespace an asset id under an import namespace (the new profile id, or card id) so
 * an imported card's images cannot silently overwrite the player's existing assets.
 *
 * `ImageAssetCache.store` keys by `asset.id`, and `importEntries` re-keys via the
 * entry's `metadata.id` (it calls `store(entry.metadata, blob)`), so a card whose
 * asset id collides with a player's asset would clobber it on a global `put`. Importing
 * under a namespaced id avoids that.
 *
 * Pure, and idempotent FOR THE SAME namespace: re-namespacing an id already prefixed
 * with `<namespace>::` is a no-op. Calling with a DIFFERENT namespace NESTS a second
 * prefix (`ns2::ns1::id`) — so P4 `rewriteAssetRefs` must use one stable namespace per import.
 *
 * NOTE for callers (Story 6 P4 `rewriteAssetRefs`): when you namespace an imported asset
 * you MUST rewrite BOTH `entry.id` AND `entry.metadata.id` (the latter is the actual IDB
 * put key) AND every reference to the original id inside the merged state tree.
 *
 * @param namespace   Stable per-import namespace (new profile id or card id). Required.
 * @param originalId  The card's original asset id.
 * @returns `"<namespace>::<originalId>"`, or `originalId` unchanged if already namespaced.
 */
export function namespacedAssetId(namespace: string, originalId: string): string {
  const prefix = `${namespace}${ASSET_NAMESPACE_DELIM}`;
  if (originalId.startsWith(prefix)) return originalId;
  return `${prefix}${originalId}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}
