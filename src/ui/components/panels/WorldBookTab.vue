<script setup lang="ts">
// App doc: docs/user-guide/pages/game-prompts.md §4
import { ref, computed, inject, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { eventBus } from '@/engine/core/event-bus';
import { useEngineStateStore } from '@/engine/stores/engine-state';
import type { WorldBookStorage } from '@/engine/prompt/world-book-storage';
import type { WorldBook, WorldBookEntry, WorldBookEntryType, WorldBookScope, WorldBookEntryShape, WorldBookExportData } from '@/engine/prompt/world-book';
import { isSTLorebook, convertSTLorebook } from '@/engine/prompt/st-lorebook-converter';

const { t } = useI18n();
const engineState = useEngineStateStore();
const worldBookStorage = inject<WorldBookStorage>('worldBookStorage');

const SCOPE_OPTIONS: Array<{ value: WorldBookScope; labelKey: string }> = [
  { value: 'main', labelKey: 'prompt.scope.main' },
  { value: 'opening', labelKey: 'prompt.scope.opening' },
  { value: 'all', labelKey: 'prompt.scope.all' },
  { value: 'world_evolution', labelKey: 'prompt.scope.worldEvolution' },
  { value: 'variable_calibration', labelKey: 'prompt.scope.variableCalibration' },
  { value: 'story_plan', labelKey: 'prompt.scope.storyPlan' },
  { value: 'heroine_plan', labelKey: 'prompt.scope.heroinePlan' },
  { value: 'recall', labelKey: 'prompt.scope.recall' },
];

const TYPE_OPTIONS: Array<{ value: WorldBookEntryType; labelKey: string; color: string }> = [
  { value: 'world_lore', labelKey: 'prompt.type.worldLore', color: '#60a5fa' },
  { value: 'system_rule', labelKey: 'prompt.type.systemRule', color: '#a78bfa' },
  { value: 'command_rule', labelKey: 'prompt.type.commandRule', color: '#fb923c' },
  { value: 'output_rule', labelKey: 'prompt.type.outputRule', color: '#22d3ee' },
];

const SHAPE_OPTIONS: Array<{ value: WorldBookEntryShape; labelKey: string }> = [
  { value: 'normal', labelKey: 'prompt.worldbook.shapeNormal' },
  { value: 'timeline_outline', labelKey: 'prompt.worldbook.shapeTimeline' },
  { value: 'time_injection', labelKey: 'prompt.worldbook.shapeTimeInjection' },
];

// ─── State ─────────────────────────────────────────────────

const books = ref<WorldBook[]>([]);
const selectedBookId = ref<string>('');
const selectedEntryId = ref<string>('');
const newEntryShape = ref<WorldBookEntryShape>('normal');

const selectedBook = computed(() => books.value.find((b) => b.id === selectedBookId.value) ?? null);
const selectedEntry = computed(() => selectedBook.value?.entries.find((e) => e.id === selectedEntryId.value) ?? null);

// ─── Load ──────────────────────────────────────────────────

async function loadBooks() {
  if (!worldBookStorage) return;
  const pid = engineState.activeProfileId;
  if (!pid) return;
  books.value = await worldBookStorage.loadWorldBooks(pid);
  if (books.value.length > 0 && !selectedBookId.value) {
    selectedBookId.value = books.value[0].id;
    if (books.value[0].entries.length > 0) {
      selectedEntryId.value = books.value[0].entries[0].id;
    }
  }
}
void loadBooks();
watch(() => engineState.activeProfileId, () => {
  selectedBookId.value = '';
  selectedEntryId.value = '';
  void loadBooks();
});

// ─── Save (debounced) ──────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(book: WorldBook) {
  const existing = saveTimers.get(book.id);
  if (existing) clearTimeout(existing);
  saveTimers.set(book.id, setTimeout(() => {
    saveTimers.delete(book.id);
    void persistBook(book);
  }, 300));
}

async function persistBook(book: WorldBook) {
  if (!worldBookStorage) return;
  const pid = engineState.activeProfileId;
  if (!pid) return;
  book.updatedAt = Date.now();
  await worldBookStorage.saveWorldBook(pid, book);
  notifyEngine();
}

function notifyEngine() {
  eventBus.emit('worldbook:updated', books.value.filter((b) => b.enabled !== false));
}

onUnmounted(() => {
  for (const [bookId, timer] of saveTimers) {
    clearTimeout(timer);
    const book = books.value.find((b) => b.id === bookId);
    if (book) void persistBook(book);
  }
  saveTimers.clear();
});

// ─── Book CRUD ─────────────────────────────────────────────

function createBook() {
  const id = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const book: WorldBook = {
    id,
    title: t('prompt.worldbook.newBookTitle'),
    entries: [],
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  books.value = [book, ...books.value];
  selectedBookId.value = id;
  selectedEntryId.value = '';
  void persistBook(book);
}

async function deleteBook(bookId: string) {
  if (!window.confirm(t('prompt.worldbook.confirmDeleteBook'))) return;
  if (!worldBookStorage) return;
  const pid = engineState.activeProfileId;
  if (!pid) return;
  await worldBookStorage.deleteWorldBook(pid, bookId);
  books.value = books.value.filter((b) => b.id !== bookId);
  if (selectedBookId.value === bookId) {
    selectedBookId.value = books.value[0]?.id ?? '';
    selectedEntryId.value = books.value[0]?.entries[0]?.id ?? '';
  }
  notifyEngine();
}

function toggleBookEnabled(book: WorldBook) {
  book.enabled = !(book.enabled !== false);
  scheduleSave(book);
}

function updateBookTitle(book: WorldBook, title: string) {
  book.title = title;
  scheduleSave(book);
}

// ─── Entry CRUD ────────────────────────────────────────────

function createEntry() {
  const book = selectedBook.value;
  if (!book) return;
  const shape = newEntryShape.value;
  const id = `we_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const entry: WorldBookEntry = {
    id,
    title: t('prompt.worldbook.newEntryTitle'),
    content: '',
    type: 'world_lore',
    scope: shape === 'normal' ? ['main'] : ['all'],
    injectionMode: 'always',
    shape,
    enabled: true,
    priority: shape === 'timeline_outline' ? 120 : shape === 'time_injection' ? 90 : 50,
    keywords: [],
    timelineStart: '',
    timelineEnd: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  book.entries = [entry, ...book.entries];
  selectedEntryId.value = id;
  scheduleSave(book);
}

function deleteEntry(entryId: string) {
  if (!window.confirm(t('prompt.worldbook.confirmDeleteEntry'))) return;
  const book = selectedBook.value;
  if (!book) return;
  book.entries = book.entries.filter((e) => e.id !== entryId);
  if (selectedEntryId.value === entryId) {
    selectedEntryId.value = book.entries[0]?.id ?? '';
  }
  scheduleSave(book);
}

function toggleEntryEnabled(entry: WorldBookEntry) {
  entry.enabled = !(entry.enabled !== false);
  const book = selectedBook.value;
  if (book) scheduleSave(book);
}

function updateEntry<K extends keyof WorldBookEntry>(entry: WorldBookEntry, key: K, value: WorldBookEntry[K]) {
  entry[key] = value;
  entry.updatedAt = Date.now();
  const book = selectedBook.value;
  if (book) scheduleSave(book);
}

function toggleScope(entry: WorldBookEntry, scope: WorldBookScope) {
  const scopes = [...(entry.scope ?? ['main'])];
  const idx = scopes.indexOf(scope);
  if (idx >= 0) scopes.splice(idx, 1);
  else scopes.push(scope);
  updateEntry(entry, 'scope', scopes);
}

function setKeywordsFromText(entry: WorldBookEntry, text: string) {
  updateEntry(entry, 'keywords', text.split(',').map((s) => s.trim()).filter(Boolean));
}

// ─── Import / Export ───────────────────────────────────────

async function exportBooks() {
  if (!worldBookStorage) return;
  const pid = engineState.activeProfileId;
  if (!pid) return;
  const data = await worldBookStorage.exportWorldBooks(pid);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `worldbooks-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBooks() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || !worldBookStorage) return;
    const pid = engineState.activeProfileId;
    if (!pid) return;
    try {
      const raw = JSON.parse(await file.text()) as unknown;

      if (isSTLorebook(raw)) {
        const bookTitle = file.name.replace(/\.json$/i, '');
        const book = convertSTLorebook(raw, bookTitle);
        if (!book || book.entries.length === 0) {
          eventBus.emit('ui:toast', { type: 'error', i18nKey: 'prompt.worldbook.importInvalidFormat' });
          return;
        }
        if (book.entries.length > 200) {
          eventBus.emit('ui:toast', { type: 'error', i18nKey: 'prompt.worldbook.importTooMany' });
          return;
        }
        await worldBookStorage.saveWorldBook(pid, book);
        await loadBooks();
        selectedBookId.value = book.id;
        selectedEntryId.value = book.entries[0]?.id ?? '';
        eventBus.emit('ui:toast', {
          type: 'success',
          message: t('prompt.worldbook.importSTSuccess', { count: book.entries.length, title: book.title }),
        });
        notifyEngine();
        return;
      }

      const agaData = raw as Record<string, unknown>;
      if (!agaData.books || !Array.isArray(agaData.books)) {
        eventBus.emit('ui:toast', { type: 'error', i18nKey: 'prompt.worldbook.importInvalidFormat' });
        return;
      }
      const totalEntries = (agaData.books as WorldBook[]).reduce((sum: number, b) => sum + (b.entries?.length ?? 0), 0);
      if (totalEntries > 200) {
        eventBus.emit('ui:toast', { type: 'error', i18nKey: 'prompt.worldbook.importTooMany' });
        return;
      }
      const count = await worldBookStorage.importWorldBooks(pid, agaData as unknown as WorldBookExportData);
      await loadBooks();
      eventBus.emit('ui:toast', { type: 'success', message: t('prompt.worldbook.importSuccess', { count }) });
    } catch (e) {
      console.error('[WorldBook] import failed:', e);
      eventBus.emit('ui:toast', { type: 'error', i18nKey: 'prompt.worldbook.importError' });
    }
  };
  input.click();
}

// ─── Helpers ───────────────────────────────────────────────

function typeColor(type: WorldBookEntryType): string {
  return TYPE_OPTIONS.find((o) => o.value === type)?.color ?? '#888';
}
</script>

<template>
  <div class="wb-tab">
    <!-- Toolbar -->
    <div class="wb-toolbar">
      <button class="btn btn--primary btn--sm" @click="createBook">{{ $t('prompt.worldbook.createBook') }}</button>
      <button class="btn btn--ghost btn--sm" @click="importBooks">{{ $t('prompt.worldbook.import') }}</button>
      <button class="btn btn--ghost btn--sm" @click="exportBooks">{{ $t('prompt.worldbook.export') }}</button>
    </div>

    <div v-if="books.length === 0" class="wb-empty">
      {{ $t('prompt.worldbook.noBooks') }}
    </div>

    <div v-else class="wb-layout">
      <!-- Left: Book list + Entry list -->
      <div class="wb-sidebar">
        <!-- Book cards -->
        <div
          v-for="book in books"
          :key="book.id"
          :class="['wb-book-card', { 'wb-book-card--selected': selectedBookId === book.id, 'wb-book-card--disabled': book.enabled === false }]"
          @click="selectedBookId = book.id; selectedEntryId = book.entries[0]?.id ?? ''"
        >
          <div class="wb-book-header">
            <input
              class="wb-book-title-input"
              :value="book.title"
              @input="updateBookTitle(book, ($event.target as HTMLInputElement).value)"
              @click.stop
            />
            <button
              :class="['wb-toggle', { 'wb-toggle--on': book.enabled !== false }]"
              @click.stop="toggleBookEnabled(book)"
            >{{ book.enabled !== false ? 'ON' : 'OFF' }}</button>
            <button class="wb-delete-btn" @click.stop="deleteBook(book.id)" :title="$t('prompt.worldbook.deleteBook')">✕</button>
          </div>
          <span class="wb-book-count">{{ book.entries.length }} {{ $t('prompt.worldbook.entries') }}</span>
        </div>

        <!-- Entries of selected book -->
        <template v-if="selectedBook">
          <div class="wb-entry-list-header">
            <select v-model="newEntryShape" class="wb-shape-select">
              <option v-for="s in SHAPE_OPTIONS" :key="s.value" :value="s.value">{{ $t(s.labelKey) }}</option>
            </select>
            <button class="btn btn--ghost btn--sm" @click="createEntry">{{ $t('prompt.worldbook.createEntry') }}</button>
          </div>

          <div
            v-for="entry in selectedBook.entries"
            :key="entry.id"
            :class="['wb-entry-item', { 'wb-entry-item--selected': selectedEntryId === entry.id, 'wb-entry-item--disabled': entry.enabled === false }]"
            @click="selectedEntryId = entry.id"
          >
            <span class="wb-entry-title">{{ entry.title || $t('prompt.worldbook.untitled') }}</span>
            <span class="wb-type-badge" :style="{ background: typeColor(entry.type) + '20', color: typeColor(entry.type) }">
              {{ $t(TYPE_OPTIONS.find(o => o.value === entry.type)?.labelKey ?? 'prompt.type.worldLore') }}
            </span>
          </div>

          <div v-if="selectedBook.entries.length === 0" class="wb-empty-entries">
            {{ $t('prompt.worldbook.noEntries') }}
          </div>
        </template>
      </div>

      <!-- Right: Entry editor -->
      <div v-if="selectedEntry" class="wb-editor">
        <div class="wb-editor-header">
          <input
            class="wb-editor-title"
            :value="selectedEntry.title"
            @input="updateEntry(selectedEntry!, 'title', ($event.target as HTMLInputElement).value)"
            :placeholder="$t('prompt.worldbook.entryTitle')"
          />
          <button
            :class="['wb-toggle', { 'wb-toggle--on': selectedEntry.enabled !== false }]"
            @click="toggleEntryEnabled(selectedEntry!)"
          >{{ selectedEntry.enabled !== false ? 'ON' : 'OFF' }}</button>
          <button class="wb-delete-btn" @click="deleteEntry(selectedEntry!.id)">{{ $t('prompt.worldbook.deleteEntry') }}</button>
        </div>

        <!-- Meta fields -->
        <div class="wb-meta-grid">
          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.entryShape') }}</label>
            <select
              class="wb-meta-select"
              :value="selectedEntry.shape ?? 'normal'"
              @change="updateEntry(selectedEntry!, 'shape', ($event.target as HTMLSelectElement).value as WorldBookEntryShape)"
            >
              <option v-for="s in SHAPE_OPTIONS" :key="s.value" :value="s.value">{{ $t(s.labelKey) }}</option>
            </select>
          </div>

          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.entryType') }}</label>
            <select
              class="wb-meta-select"
              :value="selectedEntry.type"
              @change="updateEntry(selectedEntry!, 'type', ($event.target as HTMLSelectElement).value as WorldBookEntryType)"
            >
              <option v-for="tp in TYPE_OPTIONS" :key="tp.value" :value="tp.value">{{ $t(tp.labelKey) }}</option>
            </select>
          </div>

          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.injectionMode') }}</label>
            <select
              class="wb-meta-select"
              :value="selectedEntry.injectionMode"
              @change="updateEntry(selectedEntry!, 'injectionMode', ($event.target as HTMLSelectElement).value as 'always' | 'match_any')"
            >
              <option value="always">{{ $t('prompt.modal.injectionAlways') }}</option>
              <option value="match_any">{{ $t('prompt.modal.injectionKeyword') }}</option>
            </select>
          </div>

          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.priority') }}</label>
            <input
              type="number"
              class="wb-meta-input"
              min="0"
              max="999"
              :value="selectedEntry.priority ?? 50"
              @change="updateEntry(selectedEntry!, 'priority', Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>

        <!-- Scope checkboxes -->
        <div class="wb-meta-field">
          <label class="wb-meta-label">{{ $t('prompt.worldbook.scope') }}</label>
          <div class="wb-scope-group">
            <label v-for="s in SCOPE_OPTIONS" :key="s.value" class="wb-scope-check">
              <input type="checkbox" :checked="(selectedEntry.scope ?? []).includes(s.value)" @change="toggleScope(selectedEntry!, s.value)" />
              {{ $t(s.labelKey) }}
            </label>
          </div>
        </div>

        <!-- Keywords (only for match_any) -->
        <div v-if="selectedEntry.injectionMode === 'match_any'" class="wb-meta-field">
          <label class="wb-meta-label">{{ $t('prompt.worldbook.keywords') }}</label>
          <input
            class="wb-meta-input wb-meta-input--wide"
            :value="(selectedEntry.keywords ?? []).join(', ')"
            @input="setKeywordsFromText(selectedEntry!, ($event.target as HTMLInputElement).value)"
            :placeholder="$t('prompt.modal.keywordsPlaceholder')"
          />
        </div>

        <!-- Timeline fields (only for time_injection) -->
        <div v-if="selectedEntry.shape === 'time_injection'" class="wb-meta-grid">
          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.timeStart') }}</label>
            <input
              class="wb-meta-input"
              :value="selectedEntry.timelineStart ?? ''"
              @input="updateEntry(selectedEntry!, 'timelineStart', ($event.target as HTMLInputElement).value)"
              placeholder="YYYY:MM:DD:HH:MM"
            />
          </div>
          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.timeEnd') }}</label>
            <input
              class="wb-meta-input"
              :value="selectedEntry.timelineEnd ?? ''"
              @input="updateEntry(selectedEntry!, 'timelineEnd', ($event.target as HTMLInputElement).value)"
              placeholder="YYYY:MM:DD:HH:MM"
            />
          </div>
        </div>

        <!-- Content editor -->
        <div class="wb-content-area">
          <label class="wb-meta-label">{{ $t('prompt.worldbook.content') }}</label>
          <textarea
            class="wb-content-editor"
            :value="selectedEntry.content"
            @input="updateEntry(selectedEntry!, 'content', ($event.target as HTMLTextAreaElement).value)"
            rows="14"
            spellcheck="false"
          />
        </div>
      </div>

      <div v-else class="wb-editor wb-editor--empty">
        {{ $t('prompt.worldbook.selectEntry') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.wb-toolbar {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.wb-empty, .wb-empty-entries {
  font-size: 0.82rem;
  color: var(--color-text-muted, #55556a);
  text-align: center;
  padding: 24px 0;
}

.wb-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

/* ─── Sidebar ─── */
.wb-sidebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}
.wb-sidebar::-webkit-scrollbar { width: 4px; }
.wb-sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

/* ─── Book cards ─── */
.wb-book-card {
  padding: 8px 10px;
  border: 1px solid var(--color-border, #2a2a3a);
  border-left: 3px solid var(--color-primary, #6366f1);
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.04);
  cursor: pointer;
  transition: all 0.15s;
}
.wb-book-card:hover { background: rgba(99, 102, 241, 0.08); }
.wb-book-card--selected {
  border-color: var(--color-primary, #6366f1);
  background: rgba(99, 102, 241, 0.10);
}
.wb-book-card--disabled { opacity: 0.45; }

.wb-book-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wb-book-title-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--color-text, #e0e0e6);
  font-size: 0.82rem;
  font-weight: 600;
  outline: none;
  padding: 0;
  min-width: 0;
}
.wb-book-title-input:focus {
  border-bottom: 1px solid var(--color-primary, #6366f1);
}
.wb-book-count {
  font-size: 0.7rem;
  color: var(--color-text-muted, #55556a);
}

/* ─── Toggle + Delete ─── */
.wb-toggle {
  padding: 1px 8px;
  font-size: 0.65rem;
  font-weight: 700;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  flex-shrink: 0;
}
.wb-toggle--on {
  color: var(--color-success, #22c55e);
  border-color: rgba(34, 197, 94, 0.25);
  background: rgba(34, 197, 94, 0.08);
}
.wb-delete-btn {
  background: none;
  border: none;
  color: var(--color-text-muted, #55556a);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px;
  flex-shrink: 0;
}
.wb-delete-btn:hover { color: var(--color-danger, #ef4444); }

/* ─── Entry list ─── */
.wb-entry-list-header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 0 4px;
  border-top: 1px solid var(--color-border, #2a2a3a);
  margin-top: 4px;
}
.wb-shape-select {
  flex: 1;
  padding: 4px 6px;
  font-size: 0.72rem;
  background: var(--color-bg, #111118);
  color: var(--color-text, #e0e0e6);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
}

.wb-entry-item {
  padding: 6px 8px;
  border-left: 3px solid var(--color-primary, #6366f1);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s;
}
.wb-entry-item:hover { background: rgba(255,255,255,0.04); }
.wb-entry-item--selected { background: rgba(99, 102, 241, 0.08); }
.wb-entry-item--disabled { opacity: 0.4; }

.wb-entry-title {
  font-size: 0.78rem;
  color: var(--color-text, #e0e0e6);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-type-badge {
  font-size: 0.6rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

/* ─── Editor ─── */
.wb-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  background: rgba(255,255,255,0.01);
}
.wb-editor::-webkit-scrollbar { width: 4px; }
.wb-editor::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

.wb-editor--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted, #55556a);
  font-size: 0.82rem;
}

.wb-editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wb-editor-title {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.88rem;
  font-weight: 600;
  background: var(--color-bg, #111118);
  color: var(--color-text, #e0e0e6);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  outline: none;
}
.wb-editor-title:focus { border-color: var(--color-primary, #6366f1); }

/* ─── Meta grid ─── */
.wb-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.wb-meta-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wb-meta-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.wb-meta-select, .wb-meta-input {
  padding: 5px 8px;
  font-size: 0.78rem;
  background: var(--color-bg, #111118);
  color: var(--color-text, #e0e0e6);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  outline: none;
}
.wb-meta-select:focus, .wb-meta-input:focus { border-color: var(--color-primary, #6366f1); }
.wb-meta-input--wide { width: 100%; }

/* ─── Scope checkboxes ─── */
.wb-scope-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.wb-scope-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
}
.wb-scope-check input { accent-color: var(--color-primary, #6366f1); }

/* ─── Content editor ─── */
.wb-content-area { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.wb-content-editor {
  width: 100%;
  min-height: 300px;
  padding: 10px;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  line-height: 1.6;
  box-sizing: border-box;
}
.wb-content-editor:focus { border-color: var(--color-primary, #6366f1); }

/* ─── Shared btn classes (matching PromptPanel) ─── */
.btn {
  display: inline-flex; align-items: center; gap: 4px;
  border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.8rem; font-weight: 500; transition: all 0.15s ease;
}
.btn--sm { padding: 5px 10px; }
.btn--primary { color: var(--color-text-bone); background: var(--color-primary, #6366f1); }
.btn--primary:hover { background: var(--color-primary-hover, #4f46e5); }
.btn--ghost {
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--color-border, #2a2a3a);
}
.btn--ghost:hover { color: var(--color-text, #e0e0e6); }

@media (max-width: 767px) {
  .wb-layout { grid-template-columns: 1fr; }
  .wb-sidebar { max-height: 200px; }
}
</style>
