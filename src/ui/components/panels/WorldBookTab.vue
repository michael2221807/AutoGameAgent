<script setup lang="ts">
// App doc: docs/user-guide/pages/game-prompts.md §4
import { ref, computed, inject, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { eventBus } from '@/engine/core/event-bus';
import { useEngineStateStore } from '@/engine/stores/engine-state';
import type { WorldBookStorage } from '@/engine/prompt/world-book-storage';
import type { WorldBook, WorldBookEntry, WorldBookEntryType, WorldBookScope, WorldBookEntryShape, WorldBookExportData } from '@/engine/prompt/world-book';
import { isSTLorebook, convertSTLorebook } from '@/engine/prompt/st-lorebook-converter';
import AgaButton from '@/ui/components/shared/AgaButton.vue';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import AgaSelect from '@/ui/components/shared/AgaSelect.vue';
import Tooltip from '@/ui/components/shared/Tooltip.vue';

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

// Type badge accents draw from the design-token palette (sage/amber/info/success)
// instead of legacy hardcoded hexes, so badges stay theme-consistent.
const TYPE_OPTIONS: Array<{ value: WorldBookEntryType; labelKey: string; color: string }> = [
  { value: 'world_lore', labelKey: 'prompt.type.worldLore', color: 'var(--color-info)' },
  { value: 'system_rule', labelKey: 'prompt.type.systemRule', color: 'var(--color-sage-400)' },
  { value: 'command_rule', labelKey: 'prompt.type.commandRule', color: 'var(--color-amber-400)' },
  { value: 'output_rule', labelKey: 'prompt.type.outputRule', color: 'var(--color-success)' },
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
  return TYPE_OPTIONS.find((o) => o.value === type)?.color ?? 'var(--color-text-muted)';
}

// ─── AgaSelect option arrays ───────────────────────────────
const shapeSelectOptions = computed(() =>
  SHAPE_OPTIONS.map((s) => ({ value: s.value, label: t(s.labelKey) })),
);
const typeSelectOptions = computed(() =>
  TYPE_OPTIONS.map((tp) => ({ value: tp.value, label: t(tp.labelKey) })),
);
const injectionModeOptions = computed(() => [
  { value: 'always', label: t('prompt.modal.injectionAlways') },
  { value: 'match_any', label: t('prompt.modal.injectionKeyword') },
]);
</script>

<template>
  <div class="wb-tab">
    <!-- Toolbar -->
    <div class="wb-toolbar">
      <AgaButton variant="primary" size="sm" @click="createBook">{{ $t('prompt.worldbook.createBook') }}</AgaButton>
      <AgaButton variant="ghost" size="sm" @click="importBooks">{{ $t('prompt.worldbook.import') }}</AgaButton>
      <AgaButton variant="ghost" size="sm" @click="exportBooks">{{ $t('prompt.worldbook.export') }}</AgaButton>
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
            <AgaToggle
              :modelValue="book.enabled !== false"
              @update:modelValue="() => toggleBookEnabled(book)"
              :label="$t('prompt.worldbook.toggleBookEnabled')"
              @click.stop
            />
            <Tooltip :text="$t('prompt.worldbook.deleteBook')" interactive>
              <button class="wb-delete-btn" @click.stop="deleteBook(book.id)">✕</button>
            </Tooltip>
          </div>
          <span class="wb-book-count">{{ book.entries.length }} {{ $t('prompt.worldbook.entries') }}</span>
        </div>

        <!-- Entries of selected book -->
        <template v-if="selectedBook">
          <div class="wb-entry-list-header">
            <AgaSelect
              class="wb-shape-select"
              :modelValue="newEntryShape"
              :options="shapeSelectOptions"
              @update:modelValue="v => newEntryShape = v as WorldBookEntryShape"
            />
            <AgaButton variant="ghost" size="sm" @click="createEntry">{{ $t('prompt.worldbook.createEntry') }}</AgaButton>
          </div>

          <div
            v-for="entry in selectedBook.entries"
            :key="entry.id"
            :class="['wb-entry-item', { 'wb-entry-item--selected': selectedEntryId === entry.id, 'wb-entry-item--disabled': entry.enabled === false }]"
            @click="selectedEntryId = entry.id"
          >
            <span class="wb-entry-title">{{ entry.title || $t('prompt.worldbook.untitled') }}</span>
            <span class="wb-type-badge" :style="{ background: `color-mix(in oklch, ${typeColor(entry.type)} 18%, transparent)`, color: typeColor(entry.type) }">
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
          <AgaToggle
            :modelValue="selectedEntry.enabled !== false"
            @update:modelValue="() => toggleEntryEnabled(selectedEntry!)"
            :label="$t('prompt.worldbook.toggleEntryEnabled')"
          />
          <AgaButton variant="danger" size="sm" @click="deleteEntry(selectedEntry!.id)">{{ $t('prompt.worldbook.deleteEntry') }}</AgaButton>
        </div>

        <!-- Meta fields -->
        <div class="wb-meta-grid">
          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.entryShape') }}</label>
            <AgaSelect
              :modelValue="selectedEntry.shape ?? 'normal'"
              :options="shapeSelectOptions"
              @update:modelValue="v => updateEntry(selectedEntry!, 'shape', v as WorldBookEntryShape)"
            />
          </div>

          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.entryType') }}</label>
            <AgaSelect
              :modelValue="selectedEntry.type"
              :options="typeSelectOptions"
              @update:modelValue="v => updateEntry(selectedEntry!, 'type', v as WorldBookEntryType)"
            />
          </div>

          <div class="wb-meta-field">
            <label class="wb-meta-label">{{ $t('prompt.worldbook.injectionMode') }}</label>
            <AgaSelect
              :modelValue="selectedEntry.injectionMode"
              :options="injectionModeOptions"
              @update:modelValue="v => updateEntry(selectedEntry!, 'injectionMode', v as 'always' | 'match_any')"
            />
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
  color: var(--color-text-muted);
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
  border-left: 3px solid var(--color-sage-400);
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-sage-400) 5%, transparent);
  cursor: pointer;
  transition: all 0.15s;
}
.wb-book-card:hover { background: color-mix(in oklch, var(--color-sage-400) 9%, transparent); }
.wb-book-card--selected {
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
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
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  outline: none;
  padding: 0;
  min-width: 0;
}
.wb-book-title-input:focus {
  border-bottom: 1px solid var(--color-sage-400);
}
.wb-book-count {
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

/* ─── Delete ─── */
.wb-delete-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px;
  flex-shrink: 0;
}
.wb-delete-btn:hover { color: var(--color-danger); }

/* ─── Entry list ─── */
.wb-entry-list-header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 0 4px;
  border-top: 1px solid var(--color-border-subtle);
  margin-top: 4px;
}
.wb-shape-select {
  flex: 1;
  min-width: 0;
}

.wb-entry-item {
  padding: 6px 8px;
  border-left: 3px solid var(--color-sage-400);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s;
}
.wb-entry-item:hover { background: rgba(255,255,255,0.04); }
.wb-entry-item--selected { background: color-mix(in oklch, var(--color-sage-400) 10%, transparent); }
.wb-entry-item--disabled { opacity: 0.4; }

.wb-entry-title {
  font-size: 0.78rem;
  color: var(--color-text);
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
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255,255,255,0.01);
}
.wb-editor::-webkit-scrollbar { width: 4px; }
.wb-editor::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

.wb-editor--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
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
  background: var(--color-surface-input);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  outline: none;
}
.wb-editor-title:focus { border-color: var(--color-sage-400); }

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
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.wb-meta-input {
  padding: 5px 8px;
  font-size: 0.78rem;
  background: var(--color-surface-input);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  outline: none;
}
.wb-meta-input:focus { border-color: var(--color-sage-400); }
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
  color: var(--color-text-secondary);
  cursor: pointer;
}
/* Native checkbox accent + focus ring themed globally by forms.css. */

/* ─── Content editor ─── */
.wb-content-area { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.wb-content-editor {
  width: 100%;
  min-height: 300px;
  padding: 10px;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text);
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  line-height: 1.6;
  box-sizing: border-box;
}
.wb-content-editor:focus { border-color: var(--color-sage-400); }

@media (max-width: 767px) {
  .wb-layout { grid-template-columns: 1fr; }
  .wb-sidebar { max-height: 200px; }
}
</style>
