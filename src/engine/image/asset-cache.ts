/**
 * Image Asset Cache — Sprint Image-4
 *
 * Stores generated images in IndexedDB for offline access and fast retrieval.
 * Per user directive (R-S2-1): IndexedDB for MVP, no scale considerations.
 *
 * Schema: single object store `image-assets`, keyed by asset ID.
 * Each entry stores: { id, blob, metadata }.
 */
import type { ImageAsset } from './types';

const DB_NAME = 'aga_image_cache';
const DB_VERSION = 1;
const STORE_NAME = 'image-assets';

export class ImageAssetCache {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async store(asset: ImageAsset, blob: Blob): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ id: asset.id, blob, metadata: asset });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async retrieve(assetId: string): Promise<{ blob: Blob; metadata: ImageAsset } | null> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(assetId);
      request.onsuccess = () => {
        const result = request.result as { id: string; blob: Blob; metadata: ImageAsset } | undefined;
        resolve(result ? { blob: result.blob, metadata: result.metadata } : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(assetId: string): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async listAll(): Promise<ImageAsset[]> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = request.result as Array<{ metadata: ImageAsset }>;
        resolve(entries.map((e) => e.metadata));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Export specific assets as base64-encoded entries for JSON backup.
   * Only exports assets whose IDs are in the provided set.
   */
  async exportByIds(assetIds: Set<string>): Promise<Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }>> {
    if (assetIds.size === 0) return [];
    await this.open();
    const results: Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }> = [];
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
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
