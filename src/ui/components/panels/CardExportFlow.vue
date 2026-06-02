<script setup lang="ts">
// App doc: docs/user-guide/pages/game-save.md §2.5
/**
 * CardExportFlow — Game Card export orchestrator (Story 5, P5).
 *
 * Single scrolling flow inside a Modal: coverage gate → protagonist → metadata →
 * checklist → preview → download. Reusable shape for Story 7: a `pre-classify` slot
 * sits between the gate and the options so Story 7 can inject its edge-classification
 * panel and feed the same `selectedEdgeIds`.
 */
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useGameState } from '@/ui/composables/useGameState';
import Modal from '@/ui/components/common/Modal.vue';
import ProtagonistModeSelector from '@/ui/components/panels/ProtagonistModeSelector.vue';
import CardExportChecklist from '@/ui/components/panels/CardExportChecklist.vue';
import { eventBus } from '@/engine/core/event-bus';
import { inject } from 'vue';
import type { GameStateTree } from '@/engine/types';
import type { SaveManager } from '@/engine/persistence/save-manager';
import type { ProfileManager } from '@/engine/persistence/profile-manager';
import type { EngramEditor, CoverageStats } from '@/engine/memory/engram/engram-editor';
import type { GameCardExportService } from '@/engine/export/game-card-export-service';
import {
  CARD_FORMAT_VERSION,
  type ProtagonistMode,
  type ExportFlags,
  type ExportOptions,
} from '@/engine/export/game-card-bundle.types';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const { t } = useI18n();
const router = useRouter();
const { activeProfileId, activeSlotId, activePackId, store } = useGameState();

const gameCardExportService = inject<GameCardExportService>('gameCardExportService');
const engramEditor = inject<EngramEditor>('engramEditor');
const saveManager = inject<SaveManager>('saveManager');
const profileManager = inject<ProfileManager>('profileManager');

// ─── Form state ───────────────────────────────────────────────
const mode = ref<ProtagonistMode>('fixed');
const editableFields = ref<string[]>([]);
const title = ref('');
const description = ref('');
const author = ref('');
const tags = ref<string[]>([]);
const tagDraft = ref('');
const cover = ref('');            // base64
const coverError = ref('');
const flags = ref<ExportFlags>(defaultFlags());
const coverage = ref<CoverageStats | null>(null);
const exporting = ref(false);

function defaultFlags(): ExportFlags {
  return {
    containsNsfw: false,
    includedGenerationHistory: false,
    includedReferenceGallery: false,
    includedSettings: false,
    includedApiTemplate: false,
    includedEngineConfig: false,
    includedWorldBooks: false,
    includedBuiltinOverrides: false,
    includedPromptSettings: false,
    includedHeroinePlan: false,
    includedPlotDirection: true, // OD1: plot direction default ON (reset, no spoiler)
  };
}

function resetForm(): void {
  mode.value = 'fixed';
  editableFields.value = [];
  title.value = '';
  description.value = '';
  author.value = '';
  tags.value = [];
  tagDraft.value = '';
  cover.value = '';
  coverError.value = '';
  flags.value = defaultFlags();
}

// ─── Coverage gate ────────────────────────────────────────────
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    resetForm();
    coverage.value = engramEditor ? engramEditor.getCoverageStats() : null;
  },
);

const gatePass = computed(
  () =>
    coverage.value !== null &&
    coverage.value.missingNpcNames.length === 0 &&
    coverage.value.missingLocationNames.length === 0,
);

const fixedNameMissing = computed(() => mode.value === 'fixed' && !String(store.characterName ?? '').trim());

const canExport = computed(
  () => gatePass.value && title.value.trim() !== '' && !fixedNameMissing.value && !exporting.value,
);

// ─── Preview counts (from the live snapshot) ──────────────────
const counts = computed(() => {
  const snap = asRecord(store.toSnapshot());
  return {
    npc: coverage.value?.totalNpcs ?? 0,
    loc: coverage.value?.totalLocations ?? 0,
    edge: edgeIdsFrom(snap).size,
    img: countSelectedImages(snap),
  };
});

// ─── Helpers ──────────────────────────────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function edgeIdsFrom(snap: Record<string, unknown>): Set<string> {
  const engram = rec(rec(rec(snap['系统'])?.['扩展'])?.['engramMemory']);
  const v2 = engram?.['v2Edges'];
  const ids = new Set<string>();
  if (Array.isArray(v2)) {
    for (const e of v2) {
      const id = rec(e)?.['id'];
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}
function countSelectedImages(snap: Record<string, unknown>): number {
  let n = 0;
  const sel = ['已选头像图片ID', '已选立绘图片ID', '已选背景图片ID'];
  const player = rec(rec(snap['角色'])?.['图片档案']);
  for (const f of sel) if (typeof player?.[f] === 'string' && player[f]) n++;
  const rels = rec(snap['社交'])?.['关系'];
  if (Array.isArray(rels)) {
    for (const npc of rels) {
      const arc = rec(rec(npc)?.['图片档案']);
      for (const f of sel) if (typeof arc?.[f] === 'string' && arc[f]) n++;
    }
  }
  const scene = rec(rec(rec(rec(snap['系统'])?.['扩展'])?.['image'])?.['sceneArchive']);
  if (typeof scene?.['当前壁纸图片ID'] === 'string' && scene['当前壁纸图片ID']) n++;
  return n;
}

// ─── Tags + cover ─────────────────────────────────────────────
function addTag(): void {
  const v = tagDraft.value.trim();
  if (v && !tags.value.includes(v)) tags.value = [...tags.value, v];
  tagDraft.value = '';
}
function removeTag(tag: string): void {
  tags.value = tags.value.filter((x) => x !== tag);
}
function onCover(e: Event): void {
  coverError.value = '';
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    coverError.value = t('save.export.meta.coverTooLarge');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result ?? '');
    // accept="image/*" is only a browser hint — enforce an image data-URL before embedding it in the card.
    if (!result.startsWith('data:image/')) {
      coverError.value = t('save.export.meta.coverInvalidType');
      return;
    }
    cover.value = result;
  };
  reader.onerror = () => { coverError.value = t('save.export.meta.coverInvalidType'); };
  reader.readAsDataURL(file);
}

// ─── Gate navigation ──────────────────────────────────────────
function goSolidify(): void {
  emit('update:modelValue', false);
  void router.push('/game/relationship-graph');
}

// ─── Export ───────────────────────────────────────────────────
function close(): void { emit('update:modelValue', false); }

async function doExport(): Promise<void> {
  if (!canExport.value || !gameCardExportService || !saveManager) return;
  const pid = activeProfileId.value;
  const slot = activeSlotId.value;
  const packId = activePackId.value ?? '';
  if (!pid || !slot) return;

  exporting.value = true;
  try {
    // Flush the live state so exportCard reads a consistent persisted snapshot.
    const snapshot = store.toSnapshot() as GameStateTree;
    const slotMeta = profileManager?.getProfile(pid)?.slots[slot];
    await saveManager.saveGame(pid, slot, snapshot, {
      slotId: slot,
      slotName: slotMeta?.slotName ?? slot,
      lastSavedAt: new Date().toISOString(),
      packId: slotMeta?.packId ?? packId,
      packVersion: slotMeta?.packVersion ?? '',
      characterName: store.characterName,
      currentLocation: store.currentLocation,
      gameTime: store.gameTime,
      saveType: 'manual',
    });

    // Story 5: include ALL edge ids (creative-card edges = world setup). Story 7 will inject a
    // filtered set via its classification panel (handover §8A reuse seam — service is source-agnostic).
    const selectedEdgeIds = edgeIdsFrom(asRecord(snapshot));

    const now = new Date().toISOString();
    const options: ExportOptions = {
      protagonist: {
        mode: mode.value,
        editableFields: mode.value === 'template' ? editableFields.value : undefined,
      },
      cardMeta: {
        formatVersion: CARD_FORMAT_VERSION,
        cardId: crypto.randomUUID(),
        title: title.value.trim(),
        description: description.value.trim(),
        author: author.value.trim(),
        tags: tags.value,
        coverImage: cover.value || undefined,
        createdAt: now,
        updatedAt: now,
        packId,
        packVersion: slotMeta?.packVersion, // Story 6 import uses this for cross-version drift warnings
      },
      selectedEdgeIds,
      checklist: flags.value,
    };

    const { blob } = await gameCardExportService.exportCard(pid, slot, options);
    downloadBlob(blob, fileName());
    eventBus.emit('ui:toast', { type: 'success', message: t('save.export.success'), duration: 2200 });
    close();
  } catch (err) {
    eventBus.emit('ui:toast', { type: 'error', message: t('save.export.failed') });
    console.warn('[CardExportFlow] export failed:', err);
  } finally {
    exporting.value = false;
  }
}

function fileName(): string {
  const safe = title.value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'card';
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `card-${safe}-${date}.aga-card`;
}
function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    :title="t('save.export.modalTitle')"
    width="640px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="cef">
      <!-- ① Coverage gate -->
      <div
        v-if="coverage"
        class="cef-gate"
        :class="gatePass ? 'cef-gate--pass' : 'cef-gate--fail'"
      >
        <template v-if="gatePass">
          <span class="cef-gate__icon">✓</span>
          <div>
            <p class="cef-gate__title">{{ t('save.export.gate.pass') }}</p>
            <p class="cef-gate__detail">{{ t('save.export.gate.passDetail', { npc: coverage.totalNpcs, loc: coverage.totalLocations }) }}</p>
          </div>
        </template>
        <template v-else>
          <span class="cef-gate__icon">!</span>
          <div class="cef-gate__body">
            <p class="cef-gate__title">{{ t('save.export.gate.fail') }}</p>
            <p v-if="coverage.missingNpcNames.length" class="cef-gate__detail">
              {{ t('save.export.gate.failNpc', { names: coverage.missingNpcNames.join('、') }) }}
            </p>
            <p v-if="coverage.missingLocationNames.length" class="cef-gate__detail">
              {{ t('save.export.gate.failLoc', { names: coverage.missingLocationNames.join('、') }) }}
            </p>
            <button type="button" class="cef-gate__btn" @click="goSolidify">{{ t('save.export.gate.goSolidify') }}</button>
          </div>
        </template>
      </div>

      <!-- Story 7 injects its edge-classification panel here -->
      <slot name="pre-classify" :selected-edge-ids="counts.edge" />

      <template v-if="gatePass">
        <!-- ② Protagonist -->
        <section class="cef-sec">
          <h3 class="cef-sec__title">{{ t('save.export.protagonist.sectionTitle') }}</h3>
          <ProtagonistModeSelector
            v-model:mode="mode"
            v-model:editable-fields="editableFields"
          />
          <p v-if="fixedNameMissing" class="cef-warn">{{ t('save.export.protagonist.fixedEmptyName') }}</p>
        </section>

        <!-- ③ Metadata -->
        <section class="cef-sec">
          <h3 class="cef-sec__title">{{ t('save.export.meta.sectionTitle') }}</h3>
          <label class="cef-field">
            <span class="cef-field__label">{{ t('save.export.meta.titleLabel') }} *</span>
            <input v-model="title" class="cef-input" type="text" :placeholder="t('save.export.meta.titlePlaceholder')" />
          </label>
          <label class="cef-field">
            <span class="cef-field__label">{{ t('save.export.meta.descLabel') }}</span>
            <textarea v-model="description" class="cef-input cef-input--area" rows="2" :placeholder="t('save.export.meta.descPlaceholder')" />
          </label>
          <label class="cef-field">
            <span class="cef-field__label">{{ t('save.export.meta.authorLabel') }}</span>
            <input v-model="author" class="cef-input" type="text" :placeholder="t('save.export.meta.authorPlaceholder')" />
          </label>
          <label class="cef-field">
            <span class="cef-field__label">{{ t('save.export.meta.tagsLabel') }}</span>
            <div class="cef-tags">
              <span v-for="tag in tags" :key="tag" class="cef-tag" @click="removeTag(tag)">{{ tag }} ✕</span>
              <input v-model="tagDraft" class="cef-input cef-input--tag" type="text" :placeholder="t('save.export.meta.tagsPlaceholder')" @keydown.enter.prevent="addTag" />
            </div>
          </label>
          <label class="cef-field">
            <span class="cef-field__label">{{ t('save.export.meta.coverLabel') }}</span>
            <div class="cef-cover">
              <img v-if="cover" :src="cover" class="cef-cover__thumb" alt="" />
              <input type="file" accept="image/*" class="cef-file" @change="onCover" />
              <button v-if="cover" type="button" class="cef-cover__clear" @click="cover = ''">{{ t('save.export.meta.coverClear') }}</button>
            </div>
            <p v-if="coverError" class="cef-warn">{{ coverError }}</p>
          </label>
        </section>

        <!-- ④ Checklist -->
        <section class="cef-sec">
          <h3 class="cef-sec__title">{{ t('save.export.content.sectionTitle') }}</h3>
          <CardExportChecklist v-model="flags" />
        </section>

        <!-- ⑤ Preview -->
        <section class="cef-sec">
          <h3 class="cef-sec__title">{{ t('save.export.preview.sectionTitle') }}</h3>
          <p class="cef-prev cef-prev--pack">{{ t('save.export.preview.willPack', { npc: counts.npc, loc: counts.loc, edge: counts.edge, img: counts.img }) }}</p>
          <p class="cef-prev cef-prev--strip">{{ t('save.export.preview.willStrip') }}</p>
          <div class="cef-never">
            <p class="cef-never__title">{{ t('save.export.neverExport.title') }}</p>
            <p class="cef-never__items">{{ t('save.export.neverExport.items') }}</p>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <button type="button" class="btn-modal btn-modal--secondary" @click="close">{{ t('save.export.cancel') }}</button>
      <button type="button" class="btn-modal btn-modal--primary" :disabled="!canExport" @click="doExport">
        {{ exporting ? t('save.export.exporting') : t('save.export.exportBtn') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.cef { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
/* Prevent any control from overflowing the modal body (no horizontal scrollbar). */
.cef :where(input, textarea, select) { box-sizing: border-box; max-width: 100%; }
.cef :where(p, h3) { overflow-wrap: anywhere; }
.cef-file { max-width: 100%; }

.cef-gate {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
}
.cef-gate--pass { background: color-mix(in oklch, var(--color-sage-400) 12%, transparent); }
.cef-gate--fail { background: color-mix(in oklch, var(--color-amber-400) 12%, transparent); }
.cef-gate__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-weight: 700;
  border-radius: var(--radius-full);
  color: var(--color-bg);
}
.cef-gate--pass .cef-gate__icon { background: var(--color-sage-400); }
.cef-gate--fail .cef-gate__icon { background: var(--color-amber-400); }
.cef-gate__title { margin: 0; font-size: 0.9rem; font-weight: 600; color: var(--color-text); }
.cef-gate__detail { margin: 4px 0 0; font-size: 0.8rem; color: var(--color-text-secondary); }
.cef-gate__btn {
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 0.82rem;
  color: var(--color-bg);
  background: var(--color-amber-400);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.cef-sec__title {
  margin: 0 0 10px;
  font-family: var(--font-serif-cjk);
  font-size: 0.98rem;
  font-weight: 500;
  color: var(--color-text);
}

.cef-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.cef-field__label { font-size: 0.82rem; color: var(--color-text-secondary); }
.cef-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 0.9rem;
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-bg) 55%, transparent);
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 10%, transparent);
  transition: box-shadow 0.16s var(--ease-out);
}
.cef-input::placeholder { color: color-mix(in oklch, var(--color-text-secondary) 70%, transparent); }
.cef-input:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1.5px color-mix(in oklch, var(--color-sage-400) 55%, transparent);
}
.cef-input--area { resize: vertical; min-height: 44px; font-family: inherit; }

.cef-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cef-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 0.78rem;
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-sage-400) 16%, transparent);
  border-radius: var(--radius-full);
  cursor: pointer;
}
.cef-input--tag { flex: 1; min-width: 120px; }

.cef-cover { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cef-cover__thumb { width: 56px; height: 56px; object-fit: cover; border-radius: var(--radius-sm); }
.cef-file { font-size: 0.82rem; color: var(--color-text-secondary); }
.cef-cover__clear {
  padding: 4px 10px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 14%, transparent);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.cef-warn { margin: 6px 0 0; font-size: 0.8rem; color: var(--color-amber-400); }

.cef-prev { margin: 0 0 6px; font-size: 0.84rem; line-height: 1.5; }
.cef-prev--pack { color: var(--color-text); }
.cef-prev--strip { color: var(--color-text-secondary); }
.cef-never {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-text) 5%, transparent);
  opacity: 0.85;
}
.cef-never__title { margin: 0 0 2px; font-size: 0.8rem; font-weight: 600; color: var(--color-text-secondary); }
.cef-never__items { margin: 0; font-size: 0.8rem; color: var(--color-text-secondary); }

.btn-modal {
  padding: 8px 18px;
  font-size: 0.88rem;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out);
}
.btn-modal--secondary {
  color: var(--color-text-secondary);
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 14%, transparent);
}
.btn-modal--primary { color: var(--color-bg); background: var(--color-sage-400); }
.btn-modal--primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
