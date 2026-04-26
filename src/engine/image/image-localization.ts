/**
 * Image Localization — MRJH imageTasks.ts:3524-3572
 *
 * Persists a remote or data-URL image to local IndexedDB storage.
 * Three input cases:
 * 1. Already has local storage key → return as-is
 * 2. Data URL (data:image/...) → save directly to asset cache
 * 3. HTTP URL → fetch → blob → save to asset cache
 *
 * Used when user clicks "保存到本地" on a gallery image, or when
 * applying a remote image as persistent wallpaper.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ FRONTEND TODO (Phase 4: Gallery + Scene Tabs)                  │
 * │                                                                 │
 * │ "保存到本地" button on each gallery image card.                  │
 * │ "设为常驻壁纸" also triggers localization.                       │
 * │ MRJH ref: MRJH-USER-EXPERIENCE.md §B + §E                     │
 * └─────────────────────────────────────────────────────────────────┘
 */
import type { ImageAssetCache } from './asset-cache';

export interface LocalizationResult {
  storageKey: string;
  wasAlreadyLocal: boolean;
}

/**
 * Persist an image from URL to local IndexedDB storage.
 *
 * MRJH persistImageAssetLocally (imageTasks.ts:3524-3572)
 */
export async function persistImageLocally(
  imageUrl: string,
  assetId: string,
  cache: ImageAssetCache,
  backend: import('./types').ImageBackendType = 'openai',
): Promise<LocalizationResult> {
  const url = (imageUrl || '').trim();
  if (!url) throw new Error('No image URL to save');

  // Case 1: data URL → convert to blob and store
  if (/^data:image\//i.test(url)) {
    const blob = await dataUrlToBlob(url);
    await cache.store(
      { id: assetId, taskId: '', storageKey: assetId, mimeType: blob.type, width: 0, height: 0, sizeBytes: blob.size, backend, createdAt: Date.now() },
      blob,
    );
    return { storageKey: assetId, wasAlreadyLocal: false };
  }

  // Case 2: HTTP URL → fetch → blob → store
  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Failed to fetch image: ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Fetched image is empty');
    await cache.store(
      { id: assetId, taskId: '', storageKey: assetId, mimeType: blob.type || 'image/png', width: 0, height: 0, sizeBytes: blob.size, backend, createdAt: Date.now() },
      blob,
    );
    return { storageKey: assetId, wasAlreadyLocal: false };
  }

  // Case 3: looks like an existing storage key → already local
  return { storageKey: url, wasAlreadyLocal: true };
}

/** Convert a data URL to a Blob */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
