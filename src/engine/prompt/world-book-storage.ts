/**
 * World Book + Built-in Prompt persistence — IndexedDB storage
 *
 * Manages two stores:
 * - `worldbooks`: User-created world book collections with entries
 * - `builtin-prompts`: User overrides of built-in prompt slots
 *
 * Key design: world books are per-profile (keyed by profileId),
 * built-in prompt overrides are per-pack (keyed by packId:slotId).
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  WorldBook,
  WorldBookEntry,
  BuiltinPromptEntry,
  WorldBookPresetGroup,
  WorldBookExportData,
  BuiltinPromptExportData,
} from './world-book';

const DB_NAME = 'aga-worldbook';
const DB_VERSION = 1;

export class WorldBookStorage {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('worldbooks')) {
            db.createObjectStore('worldbooks');
          }
          if (!db.objectStoreNames.contains('builtin-prompts')) {
            db.createObjectStore('builtin-prompts');
          }
          if (!db.objectStoreNames.contains('preset-groups')) {
            db.createObjectStore('preset-groups');
          }
        },
      });
    }
    return this.dbPromise;
  }

  // ─── World Books ──────────────────────────────────────────

  async saveWorldBook(profileId: string, book: WorldBook): Promise<void> {
    const db = await this.getDB();
    await db.put('worldbooks', book, `${profileId}:${book.id}`);
  }

  async loadWorldBooks(profileId: string): Promise<WorldBook[]> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('worldbooks');
    const prefix = `${profileId}:`;
    const books: WorldBook[] = [];
    for (const key of keys) {
      if (String(key).startsWith(prefix)) {
        const book = await db.get('worldbooks', key);
        if (book) books.push(book as WorldBook);
      }
    }
    return books;
  }

  async deleteWorldBook(profileId: string, bookId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('worldbooks', `${profileId}:${bookId}`);
  }

  // ─── World Book Entries (convenience) ─────────────────────

  async addEntry(profileId: string, bookId: string, entry: WorldBookEntry): Promise<void> {
    const books = await this.loadWorldBooks(profileId);
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    book.entries.push(entry);
    book.updatedAt = Date.now();
    await this.saveWorldBook(profileId, book);
  }

  async updateEntry(profileId: string, bookId: string, entry: WorldBookEntry): Promise<void> {
    const books = await this.loadWorldBooks(profileId);
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const idx = book.entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      book.entries[idx] = { ...entry, updatedAt: Date.now() };
      book.updatedAt = Date.now();
      await this.saveWorldBook(profileId, book);
    }
  }

  async deleteEntry(profileId: string, bookId: string, entryId: string): Promise<void> {
    const books = await this.loadWorldBooks(profileId);
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    book.entries = book.entries.filter((e) => e.id !== entryId);
    book.updatedAt = Date.now();
    await this.saveWorldBook(profileId, book);
  }

  // ─── Built-in Prompt Overrides ────────────────────────────

  async saveBuiltinOverride(packId: string, entry: BuiltinPromptEntry): Promise<void> {
    const db = await this.getDB();
    await db.put('builtin-prompts', entry, `${packId}:${entry.slotId}`);
  }

  async loadBuiltinOverride(packId: string, slotId: string): Promise<BuiltinPromptEntry | undefined> {
    const db = await this.getDB();
    return db.get('builtin-prompts', `${packId}:${slotId}`) as Promise<BuiltinPromptEntry | undefined>;
  }

  async loadAllBuiltinOverrides(packId: string): Promise<BuiltinPromptEntry[]> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('builtin-prompts');
    const prefix = `${packId}:`;
    const entries: BuiltinPromptEntry[] = [];
    for (const key of keys) {
      if (String(key).startsWith(prefix)) {
        const entry = await db.get('builtin-prompts', key);
        if (entry) entries.push(entry as BuiltinPromptEntry);
      }
    }
    return entries;
  }

  async resetBuiltinOverride(packId: string, slotId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('builtin-prompts', `${packId}:${slotId}`);
  }

  async resetAllBuiltinOverrides(packId: string): Promise<void> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('builtin-prompts');
    const prefix = `${packId}:`;
    const tx = db.transaction('builtin-prompts', 'readwrite');
    for (const key of keys) {
      if (String(key).startsWith(prefix)) {
        await tx.store.delete(key);
      }
    }
    await tx.done;
  }

  // ─── Preset Groups ────────────────────────────────────────

  async savePresetGroup(profileId: string, group: WorldBookPresetGroup): Promise<void> {
    const db = await this.getDB();
    await db.put('preset-groups', group, `${profileId}:${group.id}`);
  }

  async loadPresetGroups(profileId: string): Promise<WorldBookPresetGroup[]> {
    const db = await this.getDB();
    const keys = await db.getAllKeys('preset-groups');
    const prefix = `${profileId}:`;
    const groups: WorldBookPresetGroup[] = [];
    for (const key of keys) {
      if (String(key).startsWith(prefix)) {
        const group = await db.get('preset-groups', key);
        if (group) groups.push(group as WorldBookPresetGroup);
      }
    }
    return groups;
  }

  async deletePresetGroup(profileId: string, groupId: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('preset-groups', `${profileId}:${groupId}`);
  }

  // ─── Export / Import ──────────────────────────────────────

  async exportWorldBooks(profileId: string): Promise<WorldBookExportData> {
    const books = await this.loadWorldBooks(profileId);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      books,
    };
  }

  async importWorldBooks(profileId: string, data: WorldBookExportData): Promise<number> {
    if (!data.books || !Array.isArray(data.books)) return 0;
    for (const book of data.books) {
      await this.saveWorldBook(profileId, {
        ...book,
        id: book.id || `wb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        updatedAt: Date.now(),
      });
    }
    return data.books.length;
  }

  async exportBuiltinOverrides(packId: string): Promise<BuiltinPromptExportData> {
    const entries = await this.loadAllBuiltinOverrides(packId);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    };
  }

  async importBuiltinOverrides(packId: string, data: BuiltinPromptExportData): Promise<number> {
    if (!data.entries || !Array.isArray(data.entries)) return 0;
    for (const entry of data.entries) {
      await this.saveBuiltinOverride(packId, entry);
    }
    return data.entries.length;
  }

  // ─── Clear All ────────────────────────────────────────────

  async clearAll(): Promise<void> {
    const db = await this.getDB();
    await db.clear('worldbooks');
    await db.clear('builtin-prompts');
    await db.clear('preset-groups');
  }
}
