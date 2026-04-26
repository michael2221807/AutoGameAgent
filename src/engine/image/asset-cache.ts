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
