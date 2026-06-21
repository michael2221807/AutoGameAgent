/**
 * Deterministic offline save seeder (extracted from game-card-epic.spec.ts).
 *
 * Boots the app, disables the API (so nothing can spend tokens), injects the save
 * directly into IndexedDB (db `aga-saves`, store `data`), and reloads — landing in
 * a resumable game WITHOUT running the heavy Story-0 opening pipeline. From there a
 * spec clicks 继续游戏 (see navigation.enterSeededGame) to render the game.
 *
 * sessionType ('play' | 'worldBuilding') lives in the slot meta, NOT the state tree.
 */
import type { Page } from '@playwright/test';
import { disableApi } from './disable-api';
import { makeSeedTree, PROFILE_ID, SLOT_ID, PROTAGONIST, LOCATION_NAME, NPC_NAME } from './seed-tree';

export interface SeedOptions {
  /** Override the default minimal tree (use makeSeedTree(overrides) to build one). */
  tree?: Record<string, unknown>;
  /** Per-slot session mode. Default 'play'. */
  sessionType?: 'play' | 'worldBuilding';
}

/** The identifiers a spec needs after seeding. */
export interface SeedIds {
  profileId: string;
  slotId: string;
  protagonist: string;
  location: string;
  npc: string;
}

export async function seedSave(page: Page, opts: SeedOptions = {}): Promise<SeedIds> {
  const tree = opts.tree ?? makeSeedTree();
  const sessionType = opts.sessionType ?? 'play';

  await disableApi(page);          // init script — present before boot
  await page.goto('/');
  await page.evaluate(async ({ profileId, slotId, characterName, location, tree, sessionType }) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('aga-saves', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('data')) r.result.createObjectStore('data'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const req = db.transaction('data', 'readwrite').objectStore('data').clear();
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
    const put = (key: string, val: unknown) => new Promise<void>((res, rej) => {
      const t = db.transaction('data', 'readwrite');
      t.objectStore('data').put(val, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    const now = new Date().toISOString();
    const slotMeta = { slotId, slotName: '存档1', lastSavedAt: now, characterName, currentLocation: location, packId: 'tianming', packVersion: '1.0.0', sessionType };
    const profile = { profileId, createdAt: now, packId: 'tianming', characterName, slots: { [slotId]: slotMeta }, activeSlotId: slotId };
    await put('storage_root', { activeProfile: { profileId, slotId }, profiles: { [profileId]: profile } });
    await put(`save_${profileId}_${slotId}`, tree);
  }, { profileId: PROFILE_ID, slotId: SLOT_ID, characterName: PROTAGONIST, location: LOCATION_NAME, tree, sessionType });
  await page.reload();

  return { profileId: PROFILE_ID, slotId: SLOT_ID, protagonist: PROTAGONIST, location: LOCATION_NAME, npc: NPC_NAME };
}
