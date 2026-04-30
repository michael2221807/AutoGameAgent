<script setup lang="ts">
/**
 * ImagePanel — image generation workspace.
 *
 * This is a simplified first-pass that provides actual usable controls.
 * Full ImageManagerModal (7-tab system) will be built on top of this foundation.
 */
import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ImageService } from '@/engine/image/image-service';
import type { ImageBackendType, ImageTask } from '@/engine/image/types';
import type { GameTime } from '@/engine/image/scene-context';
import ImageDisplay from '@/ui/components/image/ImageDisplay.vue';
import ImageViewer from '@/ui/components/image/ImageViewer.vue';
import RegenerateSameModal from '@/ui/components/image/RegenerateSameModal.vue';
import AgaButton from '@/ui/components/shared/AgaButton.vue';
import AgaSelect, { type SelectOption } from '@/ui/components/shared/AgaSelect.vue';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import AgaTabBar, { type TabItem } from '@/ui/components/shared/AgaTabBar.vue';
import AgaProgressBar from '@/ui/components/shared/AgaProgressBar.vue';
import AgaConfirmModal from '@/ui/components/shared/AgaConfirmModal.vue';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';
import { extractAnchorViaAI } from '@/engine/image/anchor-extractor';
import type { AIService } from '@/engine/ai/ai-service';
import { getDefaultPresets, getDefaultModelBundles } from '@/engine/image/transformer-presets';
import { SCENE_PORTRAIT_SIZE_OPTIONS, SCENE_LANDSCAPE_SIZE_OPTIONS, sizeOptionsToSelectOptions } from '@/engine/image/image-size-options';
import type { TransformerPromptPreset, ModelTransformerBundle } from '@/engine/image/transformer-presets';

const imageService = inject<ImageService>('imageService');
const aiService = inject<AIService | undefined>('aiService', undefined);
const { isLoaded, get, setValue, useValue } = useGameState();
const relationships = useValue<Array<Record<string, unknown>>>(DEFAULT_ENGINE_PATHS.relationships);

// Reactive trigger: incremented on every image event to force computed re-evaluation.
// Necessary because task queue is an in-memory Map — Vue cannot track its mutations.
const imageUpdateTick = ref(0);
const unsubImageUpdate = eventBus.on('image:task-update', () => { imageUpdateTick.value++; });
onUnmounted(() => { unsubImageUpdate(); });

const enabled = computed(() => get('系统.扩展.image.enabled') === true);

// ── Persistence: debounced auto-save for all image config changes ──
// ImagePanel writes to 40+ state paths under 系统.扩展.image.*.
// Each setValue() updates the reactive state tree but does NOT persist to IndexedDB.
// This watcher listens for any change and debounces a single save request.
const imageConfigRoot = useValue<Record<string, unknown>>('系统.扩展.image');
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(imageConfigRoot, () => {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    eventBus.emit('engine:request-save');
    saveDebounceTimer = null;
  }, 800);
}, { deep: true });
onUnmounted(() => { if (saveDebounceTimer) clearTimeout(saveDebounceTimer); });

// Tab state
const tabs: TabItem[] = [
  { key: 'manual', label: '手动生成' },
  { key: 'gallery', label: '图库' },
  { key: 'scene', label: '场景壁纸' },
  { key: 'queue', label: '队列' },
  { key: 'history', label: '历史' },
  { key: 'presets', label: '预设' },
  { key: 'rules', label: '规则' },
  { key: 'settings', label: '设置' },
];
const activeTab = ref('manual');

// Manual generation state
const selectedNpc = ref('');
const composition = ref<'portrait' | 'half-body' | 'full-length' | 'custom'>('portrait');
const customComposition = ref('');
const artStyle = ref<'none' | 'generic' | 'anime' | 'realistic' | 'chinese'>('none');
const backend = ref<ImageBackendType>('novelai');
const extraPrompt = ref('');
const selectedArtistPreset = ref('');
const selectedPngPreset = ref('');
const sizePreset = ref<'none' | '1:1' | '3:4' | '9:16' | '16:9' | 'custom'>('none');
const sizeScale = ref<'1x' | '2x'>('2x');
const manualWidth = ref('1024');
const manualHeight = ref('1024');
const backgroundMode = ref(true);
const isGenerating = ref(false);
const lastTask = ref<ImageTask | null>(null);
const manualFlowStage = ref<'idle' | 'confirm' | 'submitting'>('idle');
const manualStatusText = ref('');

// Secret part state (independent from manual form)
const secretStyle = ref<'none' | 'generic' | 'anime' | 'realistic' | 'chinese'>('none');
const secretSizePreset = ref<'none' | '1:1' | '3:4' | '9:16' | '16:9' | 'custom'>('1:1');
const secretArtistPreset = ref('');
const secretPngPreset = ref('');
const secretExtraPrompt = ref('');
const secretStatusText = ref('');
const secretBusy = ref('');
const errorMsg = ref('');

// Viewer state
const viewerOpen = ref(false);
const viewerSrc = ref('');

function closeViewer() {
  viewerOpen.value = false;
  if (viewerSrc.value) {
    URL.revokeObjectURL(viewerSrc.value);
    viewerSrc.value = '';
  }
}

// Confirm dialog state
const showDeleteConfirm = ref(false);
const pendingDeleteId = ref('');

function requestDelete(assetId: string) {
  pendingDeleteId.value = assetId;
  showDeleteConfirm.value = true;
}

function confirmDelete() {
  deleteImage(pendingDeleteId.value);
  showDeleteConfirm.value = false;
  pendingDeleteId.value = '';
}

// NPC options for AgaSelect
const npcOptions = computed<SelectOption[]>(() => {
  const list = relationships.value;
  if (!Array.isArray(list)) return [];
  return list.map((npc) => ({
    label: `${npc['名称'] ?? '?'}${npc['是否主要角色'] ? ' ★' : ''}`,
    value: String(npc['名称'] ?? ''),
  }));
});

const compositionOptions = [
  { label: '头像', subtitle: '1:1 特写', value: 'portrait' as const },
  { label: '半身像', subtitle: '3:4 半身', value: 'half-body' as const },
  { label: '立绘', subtitle: '全身立绘', value: 'full-length' as const },
  { label: '自定义', subtitle: '构图描述', value: 'custom' as const },
];
const isCustomComposition = computed(() => composition.value === 'custom');

const SIZE_BASES: Record<'1:1' | '3:4' | '9:16' | '16:9', { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '3:4': { w: 768, h: 1024 },
  '9:16': { w: 576, h: 1024 },
  '16:9': { w: 1024, h: 576 },
};

const sizePresetOptions = [
  { label: '无要求', value: 'none' as const },
  { label: '1:1', value: '1:1' as const },
  { label: '3:4', value: '3:4' as const },
  { label: '9:16', value: '9:16' as const },
  { label: '16:9', value: '16:9' as const },
  { label: '自定义', value: 'custom' as const },
];

// Auto-update width/height when preset or scale changes
const presetSize = computed(() => {
  const p = sizePreset.value;
  if (p === 'none' || p === 'custom') return null;
  const base = SIZE_BASES[p];
  const factor = sizeScale.value === '2x' ? 2 : 1;
  return { w: base.w * factor, h: base.h * factor };
});

// Watch preset/scale changes → sync to width/height
watch([sizePreset, sizeScale], () => {
  const ps = presetSize.value;
  if (ps) {
    manualWidth.value = String(ps.w);
    manualHeight.value = String(ps.h);
  }
});

// Reset size preset when switching away from custom composition
watch(composition, (newVal) => {
  if (newVal !== 'custom' && sizePreset.value !== 'none') {
    sizePreset.value = 'none';
  }
});

const currentSizeDisplay = computed(() => {
  if (!isCustomComposition.value) return '无要求';
  if (sizePreset.value === 'none') return '无要求';
  const w = manualWidth.value.trim();
  const h = manualHeight.value.trim();
  if (!w || !h || !/^\d+$/.test(w) || !/^\d+$/.test(h)) return '未填写';
  return `${w}x${h}`;
});

const styleOptions = [
  { label: '无要求', value: 'none' as const },
  { label: '通用', value: 'generic' as const },
  { label: '二次元', value: 'anime' as const },
  { label: '写实', value: 'realistic' as const },
  { label: '国风', value: 'chinese' as const },
];

const backendOptions: SelectOption[] = [
  { label: 'NovelAI', value: 'novelai' },
  { label: 'OpenAI DALL-E', value: 'openai' },
  { label: 'SD-WebUI', value: 'sd_webui' },
  { label: 'ComfyUI', value: 'comfyui' },
  { label: 'Civitai', value: 'civitai' },
];

const civitaiSchedulerOptions: SelectOption[] = [
  { label: 'Euler A', value: 'EulerA' },
  { label: 'Euler', value: 'Euler' },
  { label: 'DPM++ 2M', value: 'DPM2M' },
  { label: 'DPM++ 2S A', value: 'DPM2SA' },
  { label: 'DPM++ SDE', value: 'DPMSDE' },
  { label: 'DDIM', value: 'DDIM' },
  { label: 'UniPC', value: 'UniPC' },
  { label: 'LCM', value: 'LCM' },
  { label: 'Heun', value: 'Heun' },
  { label: 'DPM++ 2M Karras', value: 'DPM2MKarras' },
  { label: 'DPM++ SDE Karras', value: 'DPMSDEKarras' },
  { label: 'DEIS', value: 'DEIS' },
];

const civitaiOutputFormatOptions: SelectOption[] = [
  { label: 'PNG', value: 'png' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'WebP', value: 'webp' },
];

/** Human-readable label for an image backend. Reuses backendOptions as the
 *  source so any label change propagates without duplicating strings. */
function backendLabel(value: string): string {
  return backendOptions.find((b) => b.value === value)?.label ?? value;
}

/**
 * Render the "使用模型" cell.
 *
 * Some backends ship with the model baked into their config (NovelAI / DALL-E /
 * SD-WebUI), so `img.model` is the active ckpt name. Others route the model
 * through the workflow graph itself (ComfyUI with a user-supplied workflow)
 * and the APIConfig's `.model` is legitimately empty — in that case we fall
 * back to the backend label so the cell still carries signal.
 */
function modelCellText(img: { model?: string; backend?: string }): string {
  const model = (img.model ?? '').trim();
  const backend = img.backend ? backendLabel(img.backend) : '';
  if (model && backend) return `${backend} · ${model}`;
  if (model) return model;
  if (backend) return backend;
  return '未记录';
}

// Selected NPC data
const selectedNpcData = computed(() => {
  if (!selectedNpc.value || !Array.isArray(relationships.value)) return null;
  return relationships.value.find((n) => n['名称'] === selectedNpc.value) ?? null;
});

// PNG preset options for manual tab
const pngPresetOptions = computed<SelectOption[]>(() => [
  { label: '不启用', value: '' },
  ...artistPresets.value
    .filter((p) => p.scope === 'npc' && p.id.startsWith('png_'))
    .map((p) => ({ label: p.name, value: p.id })),
]);

// Anchor status for selected NPC
const selectedNpcAnchor = computed(() => {
  if (!selectedNpc.value) return null;
  const anchors = get('系统.扩展.image.characterAnchors');
  if (!Array.isArray(anchors)) return null;
  return (anchors as CharacterAnchor[]).find((a) => a.npcName === selectedNpc.value) ?? null;
});

// Per-NPC task status (MRJH: 最近状态 card + active task display)
const selectedNpcActiveTask = computed(() => {
  void imageUpdateTick.value; // reactive dependency
  if (!selectedNpc.value || !imageService) return null;
  const allTasks = imageService.getTaskQueue().getAll();
  return Array.from(allTasks.values())
    .filter((t) => t.targetCharacter === selectedNpc.value && (t.status === 'pending' || t.status === 'tokenizing' || t.status === 'generating'))
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
});

const selectedNpcLastResult = computed(() => {
  void imageUpdateTick.value;
  if (!selectedNpc.value || !imageService) return null;
  const allTasks = imageService.getTaskQueue().getAll();
  return Array.from(allTasks.values())
    .filter((t) => t.targetCharacter === selectedNpc.value && (t.status === 'complete' || t.status === 'failed'))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
});

const taskStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    pending: '排队中', tokenizing: '词组转换中', generating: '生成图片中', complete: '已完成', failed: '失败',
  };
  return labels[status] ?? status;
};

const taskStatusVariant = (status: string) => {
  const variants: Record<string, string> = {
    pending: 'info', tokenizing: 'info', generating: 'warning', complete: 'success', failed: 'danger',
  };
  return variants[status] ?? 'default';
};

/** Click handler for generate button — validates, then either direct submit (bg) or open confirm (fg) */
function handleGenerate() {
  if (!selectedNpc.value) {
    errorMsg.value = '请先选择需要手动生图的角色。';
    return;
  }
  if (isCustomComposition.value && !customComposition.value.trim()) {
    errorMsg.value = '请先填写自定义构图描述。';
    return;
  }
  errorMsg.value = '';
  manualStatusText.value = '';

  if (backgroundMode.value) {
    void submitGenerate();
  } else {
    manualFlowStage.value = 'confirm';
  }
}

function cancelConfirm() {
  if (manualFlowStage.value === 'submitting') return;
  manualFlowStage.value = 'idle';
}

function cancelSubmitting() {
  if (manualFlowStage.value !== 'submitting') return;
  manualFlowStage.value = 'idle';
  manualStatusText.value = '已取消当前提交弹层等待；后台任务仍可能继续执行，可在队列中查看状态。';
}

async function submitGenerate() {
  if (!imageService || isGenerating.value || !selectedNpc.value) return;
  isGenerating.value = true;
  errorMsg.value = '';
  lastTask.value = null;

  // Background mode: NO overlay — just inline status text (MRJH behavior)
  // Foreground mode: show overlay with progress tracking
  if (backgroundMode.value) {
    manualFlowStage.value = 'idle';
    manualStatusText.value = '任务正在转入后台处理，可直接返回主界面。';
  } else {
    manualFlowStage.value = 'submitting';
    manualStatusText.value = '正在提交任务并写入真实队列状态...';
  }

  try {
    const npc = selectedNpcData.value;
    const artStyleMap: Record<string, string> = { none: '无要求', generic: '通用', anime: '二次元', realistic: '写实', chinese: '国风' };
    const anchor = selectedNpcAnchor.value;

    // Extract rich NPC data as JSON (matching MRJH's 提取NPC生图基础数据)
    const npcBaseData: Record<string, unknown> = {};
    if (npc) {
      const tryField = (keys: string[]): string => {
        for (const k of keys) {
          const v = npc[k];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
      };
      const setIfPresent = (key: string, val: unknown) => {
        if (val !== undefined && val !== null && val !== '') npcBaseData[key] = val;
      };
      setIfPresent('姓名', npc['名称'] ?? npc['姓名']);
      setIfPresent('性别', npc['性别']);
      setIfPresent('年龄', typeof npc['年龄'] === 'number' ? npc['年龄'] : undefined);
      setIfPresent('身份', tryField(['身份', '职业']));
      setIfPresent('境界', tryField(['境界']));
      setIfPresent('简介', tryField(['简介', '描述']));
      setIfPresent('核心性格特征', tryField(['核心性格特征', '性格', '性格特征']));
      setIfPresent('性格', tryField(['性格', '核心性格特征']));
      setIfPresent('关系状态', tryField(['关系状态']));
      // Schema key is `外貌描述` (appearance); accept 外貌描写 / 外貌 as legacy fallbacks.
      setIfPresent('外貌描述', tryField(['外貌描述', '外貌描写', '外貌', '外貌要点']));
      setIfPresent('身材描写', tryField(['身材描写', '身材', '身材要点']));
      setIfPresent('衣着风格', tryField(['衣着风格', '衣着', '衣着要点']));
      // MRJH key aliases — direct-prompt-builder order expects these names when
      // the transformer is disabled. Mirror the AGA values into them.
      setIfPresent('外貌', tryField(['外貌描述', '外貌描写', '外貌', '外貌要点']));
      setIfPresent('身材', tryField(['身材描写', '身材', '身材要点']));
      setIfPresent('衣着', tryField(['衣着风格', '衣着', '衣着要点']));
    }

    const appearanceText = String(npc?.['外貌描述'] ?? npc?.['外貌描写'] ?? npc?.['描述'] ?? '');
    const bodyText = String(npc?.['身材描写'] ?? npc?.['身材'] ?? '');
    const outfitText = String(npc?.['衣着风格'] ?? npc?.['衣着'] ?? '');

    const task = await imageService.generateCharacterImage({
      characterName: selectedNpc.value,
      description: String(npc?.['描述'] ?? ''),
      appearance: appearanceText,
      bodyDescription: bodyText,
      outfitStyle: outfitText,
      backend: backend.value,
      composition: composition.value,
      customComposition: customComposition.value || undefined,
      artStyle: artStyleMap[artStyle.value] ?? '通用',
      extraPrompt: extraPrompt.value || undefined,
      anchorPositive: anchor?.positive || undefined,
      anchorNegative: anchor?.negative || undefined,
      npcDataJson: JSON.stringify(npcBaseData, null, 2),
      useTransformer: get('系统.扩展.image.config.useTransformer') !== false,
    });
    lastTask.value = task;
    if (task.status === 'failed') {
      errorMsg.value = task.error ?? '生成失败';
      if (!backgroundMode.value) manualFlowStage.value = 'confirm';
    } else if (backgroundMode.value) {
      // Background: update inline status, no overlay
      manualStatusText.value = '后台任务已提交，可关闭当前页面。';
    } else {
      // Foreground: auto-close overlay after 450ms (MRJH behavior)
      manualStatusText.value = '任务已提交。';
      setTimeout(() => {
        manualFlowStage.value = 'idle';
        manualStatusText.value = '任务已完成，已自动关闭提交层。';
      }, 450);
    }
  } catch (err) {
    errorMsg.value = (err as Error).message ?? String(err);
    manualFlowStage.value = 'confirm';
    manualStatusText.value = '';
  } finally {
    isGenerating.value = false;
  }
}

function removeTask(taskId: string) {
  imageService?.getTaskQueue().remove(taskId);
}

// MRJH: 4 clear buttons — NPC completed/all + scene completed/all
function clearNpcQueueCompleted() {
  const queue = imageService?.getTaskQueue();
  if (!queue) return;
  for (const t of queue.getAll().filter((t) => t.subjectType !== 'scene' && (t.status === 'complete' || t.status === 'failed'))) {
    queue.remove(t.id);
  }
  eventBus.emit('ui:toast', { type: 'info', message: '已清空已完成 NPC 任务', duration: 1500 });
}

function clearNpcQueueAll() {
  const queue = imageService?.getTaskQueue();
  if (!queue) return;
  for (const t of queue.getAll().filter((t) => t.subjectType !== 'scene')) {
    queue.remove(t.id);
  }
  eventBus.emit('ui:toast', { type: 'info', message: '已清空全部 NPC 任务', duration: 1500 });
}

function openManualGenerateForRetry(characterName: string) {
  selectedNpc.value = characterName;
  activeTab.value = 'manual';
}

async function retryTask(task: ImageTask) {
  if (!imageService) return;
  removeTask(task.id);
  try {
    if (task.subjectType === 'scene') {
      // P3 env-tags (2026-04-19): retry path must forward the current env
      // state too — otherwise a retried scene image silently loses weather
      // / festival / environment context that the original had.
      await imageService.generateSceneImage({
        sceneDescription: task.positivePrompt ?? '',
        location: '',
        gameTime: get(DEFAULT_ENGINE_PATHS.gameTime) as GameTime | null | undefined,
        weather: get(DEFAULT_ENGINE_PATHS.weather) as string | undefined,
        festival: get(DEFAULT_ENGINE_PATHS.festival),
        environment: get(DEFAULT_ENGINE_PATHS.environmentTags),
        backend: task.backend ?? 'novelai',
      });
    } else {
      await imageService.generateCharacterImage({
        characterName: task.targetCharacter ?? '',
        description: task.positivePrompt ?? '',
        backend: task.backend ?? 'novelai',
      });
    }
    eventBus.emit('ui:toast', { type: 'info', message: '任务已重新提交', duration: 1500 });
  } catch (err) {
    eventBus.emit('ui:toast', { type: 'error', message: `重试失败：${(err as Error).message}`, duration: 2000 });
  }
}

async function saveToLocal(assetId: string) {
  try {
    const { ImageAssetCache } = await import('@/engine/image/asset-cache');
    const cache = new ImageAssetCache();
    const result = await cache.retrieve(assetId);
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aga-image-${assetId}.png`;
    a.click();
    URL.revokeObjectURL(url);
    eventBus.emit('ui:toast', { type: 'success', message: '已保存到本地', duration: 1500 });
  } catch {
    eventBus.emit('ui:toast', { type: 'error', message: '保存失败', duration: 2000 });
  }
}

// Secret-part UI rows. Keys are engine-native `SecretPartType` values; the
// service auto-resolves `特征描述` from the NPC's `私密信息.身体部位` array by
// `部位名称` (breast→胸部, vagina→小穴, anus→屁穴).
const secretParts = [
  { key: 'breast', label: '胸部' },
  { key: 'vagina', label: '小穴' },
  { key: 'anus',   label: '屁穴' },
] as const;

async function generateSecretPart(partKey: 'breast' | 'vagina' | 'anus') {
  if (!imageService || !selectedNpc.value) return;
  const part = secretParts.find((p) => p.key === partKey);
  if (!part) return;
  secretBusy.value = partKey;
  secretStatusText.value = `${part.label}特写已提交，正在加入图片队列。`;
  try {
    const task = await imageService.generateSecretPartImage({
      characterName: selectedNpc.value,
      part: partKey,
      backend: backend.value,
    });
    // Mirror the regular generate flow — push result into lastTask so the NPC
    // preview panel picks up the latest image instead of staying blank.
    lastTask.value = task;
    if (task.status === 'failed') {
      secretStatusText.value = `${part.label}特写生成失败：${task.error ?? '未知错误'}`;
    } else {
      secretStatusText.value = `${part.label}特写已完成，可在图库/历史查看。`;
    }
  } catch (err) {
    secretStatusText.value = `${part.label}特写提交后出现失败：${(err as Error).message}`;
  } finally {
    secretBusy.value = '';
  }
}

async function generateAllSecretParts() {
  if (!imageService || !selectedNpc.value) return;
  secretBusy.value = 'all';
  secretStatusText.value = '三处特写已提交，正在加入图片队列。';
  try {
    let lastCompleted: ImageTask | null = null;
    for (const part of secretParts) {
      const task = await imageService.generateSecretPartImage({
        characterName: selectedNpc.value,
        part: part.key,
        backend: backend.value,
      });
      if (task.status === 'complete') lastCompleted = task;
    }
    if (lastCompleted) lastTask.value = lastCompleted;
    secretStatusText.value = '三处特写已完成，可在图库/历史查看。';
  } catch {
    secretStatusText.value = '部分特写提交失败，请查看队列。';
  } finally {
    secretBusy.value = '';
  }
}

/**
 * Resolve the stored secret-part result's asset ID for the currently-selected
 * NPC, per body part. Drives the inline preview inside each secret card so the
 * latest generation shows up without leaving the manual tab.
 */
function getSecretPartAssetId(partKey: 'breast' | 'vagina' | 'anus'): string | null {
  void imageUpdateTick.value;
  const archive = selectedNpcData.value?.['图片档案'] as Record<string, unknown> | undefined;
  const secretArchive = archive?.['香闺秘档'] as Record<string, unknown> | undefined;
  if (!secretArchive) return null;
  const cnKey = partKey === 'breast' ? '胸部' : partKey === 'vagina' ? '小穴' : '屁穴';
  const entry = secretArchive[cnKey] as Record<string, unknown> | undefined;
  const id = entry?.id;
  return typeof id === 'string' && id ? id : null;
}

// ── Regenerate-Same modal (shared by queue / gallery / scene history) ──
// Captures a snapshot of the source record so the modal can display prompts
// and dispatch `ImageService.regenerateFromPrompts` with the correct subject.
interface RegenPayload {
  subjectType: 'scene' | 'character' | 'secret_part';
  subjectLabel: string;
  subtitle?: string;
  targetCharacter?: string;
  composition?: 'portrait' | 'half-body' | 'full-length' | 'scene' | 'custom';
  part?: 'breast' | 'vagina' | 'anus';
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  initialBackend: ImageBackendType;
  artStyle?: string;
}
const regenPayload = ref<RegenPayload | null>(null);
const regenBusy = ref(false);

function openRegenerateModal(payload: RegenPayload) {
  if (!payload.positivePrompt || !payload.positivePrompt.trim()) {
    eventBus.emit('ui:toast', { type: 'error', message: '该记录未保存提示词，无法同款生成', duration: 2000 });
    return;
  }
  regenPayload.value = payload;
}

function cancelRegenerate() {
  if (regenBusy.value) return;
  regenPayload.value = null;
}

async function confirmRegenerate(opts: { backend: ImageBackendType }) {
  if (!imageService || !regenPayload.value || regenBusy.value) return;
  const p = regenPayload.value;
  regenBusy.value = true;
  try {
    const task = await imageService.regenerateFromPrompts({
      subjectType: p.subjectType,
      targetCharacter: p.targetCharacter,
      composition: p.composition,
      part: p.part,
      positivePrompt: p.positivePrompt,
      negativePrompt: p.negativePrompt,
      width: p.width,
      height: p.height,
      backend: opts.backend,
      artStyle: p.artStyle,
    });
    if (task.status === 'failed') {
      eventBus.emit('ui:toast', { type: 'error', message: `同款生成失败：${task.error ?? '未知错误'}`, duration: 2500 });
    } else {
      eventBus.emit('ui:toast', { type: 'success', message: '同款任务已提交，可在队列/历史查看', duration: 2000 });
      regenPayload.value = null;
    }
  } catch (err) {
    eventBus.emit('ui:toast', { type: 'error', message: `同款生成失败：${(err as Error).message}`, duration: 2500 });
  } finally {
    regenBusy.value = false;
  }
}

/** Derive a human-readable secondary line (composition · size · backend) */
function buildRegenSubtitle(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join(' · ');
}

function compositionLabel(comp?: string): string {
  if (!comp) return '';
  const map: Record<string, string> = { portrait: '头像', 'half-body': '半身', 'full-length': '立绘', scene: '场景', secret_part: '私密特写', custom: '自定义' };
  return map[comp] ?? comp;
}

function partLabel(part?: string): string {
  if (!part) return '';
  const map: Record<string, string> = { breast: '胸部', vagina: '小穴', anus: '屁穴' };
  return map[part] ?? part;
}

function openRegenerateFromTask(task: ImageTask) {
  const isSecret = task.subjectType === 'secret_part';
  const subjectLabel = task.subjectType === 'scene'
    ? '场景'
    : (task.targetCharacter ?? '角色');
  const subtitle = buildRegenSubtitle([
    task.subjectType === 'character' ? '角色任务' : task.subjectType === 'scene' ? '场景任务' : '私密特写',
    `${task.width} × ${task.height}`,
    task.backend,
  ]);
  openRegenerateModal({
    subjectType: task.subjectType,
    subjectLabel,
    subtitle,
    targetCharacter: task.targetCharacter,
    // Queue tasks don't record composition/part explicitly on the ImageTask;
    // for character queue tasks we default to 'portrait' so the regen record
    // gets a sensible composition badge — user can still re-trigger manually
    // if they want a different composition. Scene/secret-part don't need it.
    composition: task.subjectType === 'character' ? 'portrait' : undefined,
    part: isSecret ? (task as ImageTask & { part?: 'breast' | 'vagina' | 'anus' }).part : undefined,
    positivePrompt: task.positivePrompt ?? '',
    negativePrompt: task.negativePrompt ?? '',
    width: task.width,
    height: task.height,
    initialBackend: task.backend,
  });
}

function openRegenerateFromGalleryImage(npcName: string, img: GalleryImage) {
  const comp = String(img.composition ?? '');
  const isSecret = comp === 'secret_part';
  const part = img.part;
  const width = Number(img.width) || 832;
  const height = Number(img.height) || 1216;
  const bk = img.backend ?? backend.value;
  openRegenerateModal({
    subjectType: isSecret ? 'secret_part' : 'character',
    subjectLabel: npcName,
    subtitle: buildRegenSubtitle([
      isSecret ? `私密特写 · ${partLabel(part)}` : compositionLabel(comp),
      `${width} × ${height}`,
      bk,
    ]),
    targetCharacter: npcName,
    composition: isSecret
      ? undefined
      : ((comp || 'portrait') as 'portrait' | 'half-body' | 'full-length' | 'scene' | 'custom'),
    part: isSecret ? part : undefined,
    positivePrompt: String(img.positivePrompt ?? ''),
    negativePrompt: String(img.negativePrompt ?? ''),
    width,
    height,
    initialBackend: bk,
    artStyle: img.artStyle || undefined,
  });
}

function openRegenerateFromHistoryEntry(entry: { type: 'scene' | 'character'; name: string; composition?: string; positivePrompt?: string; negativePrompt?: string; width?: number; height?: number; backend?: ImageBackendType; part?: 'breast' | 'vagina' | 'anus'; artStyle?: string }) {
  const isScene = entry.type === 'scene';
  const isSecret = entry.composition === 'secret_part';
  const width = entry.width ?? (isScene ? 1024 : 832);
  const height = entry.height ?? (isScene ? 576 : 1216);
  const bk = entry.backend ?? backend.value;
  openRegenerateModal({
    subjectType: isScene ? 'scene' : (isSecret ? 'secret_part' : 'character'),
    subjectLabel: isScene ? '场景' : entry.name,
    subtitle: buildRegenSubtitle([
      isScene ? '场景壁纸' : (isSecret ? `私密特写 · ${partLabel(entry.part)}` : compositionLabel(entry.composition)),
      `${width} × ${height}`,
      bk,
    ]),
    targetCharacter: isScene ? undefined : entry.name,
    composition: isScene || isSecret
      ? undefined
      : ((entry.composition || 'portrait') as 'portrait' | 'half-body' | 'full-length' | 'scene' | 'custom'),
    part: isSecret ? entry.part : undefined,
    positivePrompt: entry.positivePrompt ?? '',
    negativePrompt: entry.negativePrompt ?? '',
    width,
    height,
    initialBackend: bk,
    artStyle: entry.artStyle,
  });
}

function openRegenerateFromSceneRecord(record: Record<string, unknown>) {
  const width = Number(record.width) || 1024;
  const height = Number(record.height) || 576;
  const rawBackend = String(record.backend ?? '');
  const bk = (rawBackend as ImageBackendType) || backend.value;
  openRegenerateModal({
    subjectType: 'scene',
    subjectLabel: '场景',
    subtitle: buildRegenSubtitle([
      '场景壁纸',
      `${width} × ${height}`,
      bk,
    ]),
    positivePrompt: String(record.positivePrompt ?? record['最终正向提示词'] ?? ''),
    negativePrompt: String(record.negativePrompt ?? record['最终负向提示词'] ?? ''),
    width,
    height,
    initialBackend: bk,
  });
}

const recentTasks = computed(() => {
  void imageUpdateTick.value; // reactive dependency — re-evaluate when image events fire
  return imageService?.getTaskQueue().getAll().slice(0, 20) ?? [];
});

// Stats
const totalImages = computed(() => {
  if (!Array.isArray(relationships.value)) return 0;
  return relationships.value.reduce((sum, npc) => {
    const archive = npc['图片档案'] as Record<string, unknown> | undefined;
    const history = archive?.['生图历史'];
    return sum + (Array.isArray(history) ? history.length : 0);
  }, 0);
});
const successCount = computed(() => recentTasks.value.filter((t) => t.status === 'complete').length);
const failedCount = computed(() => recentTasks.value.filter((t) => t.status === 'failed').length);
const pendingCount = computed(() => recentTasks.value.filter((t) => t.status === 'pending' || t.status === 'generating' || t.status === 'tokenizing').length);

const route = useRoute();

async function openViewer(assetId?: string | null) {
  if (!assetId) return;
  try {
    const { ImageAssetCache } = await import('@/engine/image/asset-cache');
    const cache = new ImageAssetCache();
    const result = await cache.retrieve(assetId);
    if (result) {
      viewerSrc.value = URL.createObjectURL(result.blob);
      viewerOpen.value = true;
    }
  } catch { /* silent */ }
}

// Wallpaper state
const currentWallpaperId = computed(() => {
  const v = get('世界.状态.壁纸.资源');
  return typeof v === 'string' && v ? v : null;
});


// Scene generation state
const selectedScenePreset = ref('');
const selectedScenePngPreset = ref('');
const sceneScopedPresets = computed(() =>
  artistPresets.value.filter((p) => p.scope === 'scene' && !p.id.startsWith('png_'))
);
const scenePngPresets = computed(() =>
  artistPresets.value.filter((p) => p.scope === 'scene' && p.id.startsWith('png_'))
);

const sceneResolution = ref('1024x576');
const sceneResolutionOptions = computed(() =>
  sizeOptionsToSelectOptions(sceneOrientation.value === 'landscape' ? SCENE_LANDSCAPE_SIZE_OPTIONS : SCENE_PORTRAIT_SIZE_OPTIONS)
);
const sceneComposition = ref<'snapshot' | 'landscape'>('snapshot');
const sceneOrientation = ref<'landscape' | 'portrait'>('landscape');
const sceneExtraPrompt = ref('');
const sceneGenerating = ref(false);
const sceneError = ref('');
const sceneStatusText = ref('');

// Scene archive from state tree (MRJH sceneImageArchiveWorkflow)
const sceneArchiveRaw = useValue<Record<string, unknown>>('系统.扩展.image.sceneArchive');
const sceneArchive = computed(() => {
  const raw = sceneArchiveRaw.value;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { '生图历史': [] };
});

const sceneArchiveHistory = computed<Array<Record<string, unknown>>>(() => {
  const history = sceneArchive.value['生图历史'];
  return Array.isArray(history) ? history as Array<Record<string, unknown>> : [];
});

const currentSceneWallpaperId = computed(() => {
  const id = sceneArchive.value['当前壁纸图片ID'];
  return typeof id === 'string' && id ? id : null;
});

// Scene queue (from task queue, scene-type only)
const sceneQueueTasks = computed(() => {
  void imageUpdateTick.value;
  return imageService?.getTaskQueue().getAll().filter((t) => t.subjectType === 'scene') ?? [];
});

// Scene stats (MRJH: 6 stat cards)
const sceneStats = computed(() => {
  const history = sceneArchiveHistory.value;
  const queue = sceneQueueTasks.value;
  return {
    total: history.length,
    success: history.filter((r) => r.status === 'complete' || r.status === 'success').length,
    failed: history.filter((r) => r.status === 'failed').length,
    pending: history.filter((r) => r.status === 'pending' || r.status === 'generating' || r.status === 'tokenizing').length,
    queueTotal: queue.length,
    queueRunning: queue.filter((t) => t.status === 'generating' || t.status === 'tokenizing').length,
  };
});

// Scene history limit
const sceneArchiveLimit = computed(() => {
  const v = get('系统.扩展.image.config.sceneHistoryLimit');
  return typeof v === 'number' && v > 0 ? v : 10;
});
const sceneArchiveLimitDraft = ref(String(sceneArchiveLimit.value));
watch(sceneArchiveLimit, (v) => { sceneArchiveLimitDraft.value = String(v); });

function saveSceneArchiveLimit() {
  const n = parseInt(sceneArchiveLimitDraft.value, 10);
  if (!isNaN(n) && n >= 1 && n <= 100) {
    setValue('系统.扩展.image.config.sceneHistoryLimit', n);
    eventBus.emit('ui:toast', { type: 'success', message: `场景历史上限已设为 ${n}`, duration: 1500 });
  }
}

// Scene wallpaper management
function applySceneWallpaper(imageId: string) {
  if (!imageService) return;
  imageService.state.setSceneWallpaper(imageId);
  eventBus.emit('ui:toast', { type: 'success', message: '已设为场景壁纸', duration: 1500 });
}

function clearSceneWallpaper() {
  if (!imageService) return;
  imageService.state.clearSceneWallpaper();
  eventBus.emit('ui:toast', { type: 'info', message: '场景壁纸已清除', duration: 1500 });
}

function isCurrentSceneWallpaper(imageId: string): boolean {
  return currentSceneWallpaperId.value === imageId;
}

// Clear scene operations
function clearSceneHistory() {
  const queue = imageService?.getTaskQueue();
  if (queue) {
    for (const t of queue.getAll().filter((t) => t.subjectType === 'scene')) {
      queue.remove(t.id);
    }
  }
  // Also clear scene archive history
  if (imageService) {
    setValue('系统.扩展.image.sceneArchive', { '生图历史': [], '当前壁纸图片ID': '' });
  }
  eventBus.emit('ui:toast', { type: 'info', message: '场景历史已清空', duration: 1500 });
}

function clearSceneQueueCompleted() {
  const queue = imageService?.getTaskQueue();
  if (!queue) return;
  for (const t of queue.getAll().filter((t) => t.subjectType === 'scene' && (t.status === 'complete' || t.status === 'failed'))) {
    queue.remove(t.id);
  }
  eventBus.emit('ui:toast', { type: 'info', message: '已清空已完成场景任务', duration: 1500 });
}

function clearSceneQueueAll() {
  const queue = imageService?.getTaskQueue();
  if (!queue) return;
  for (const t of queue.getAll().filter((t) => t.subjectType === 'scene')) {
    queue.remove(t.id);
  }
  eventBus.emit('ui:toast', { type: 'info', message: '已清空全部场景任务', duration: 1500 });
}

function deleteSceneImage(imageId: string) {
  if (!imageService) return;
  const archive = sceneArchive.value;
  const history = Array.isArray(archive['生图历史'])
    ? (archive['生图历史'] as Array<Record<string, unknown>>).filter((r) => r.id !== imageId)
    : [];
  const cleared = String(archive['当前壁纸图片ID'] ?? '') === imageId ? '' : archive['当前壁纸图片ID'];
  setValue('系统.扩展.image.sceneArchive', { ...archive, '生图历史': history, '当前壁纸图片ID': cleared });
  eventBus.emit('ui:toast', { type: 'info', message: '场景图片已删除', duration: 1500 });
}

async function generateScene() {
  if (!imageService || sceneGenerating.value) return;
  sceneGenerating.value = true;
  sceneError.value = '';
  sceneStatusText.value = backgroundMode.value ? '任务正在转入后台处理…' : '正在生成场景图…';
  try {
    // Parse resolution string to width/height
    const resParts = sceneResolution.value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    const sceneW = resParts ? Number(resParts[1]) : (sceneOrientation.value === 'landscape' ? 1024 : 576);
    const sceneH = resParts ? Number(resParts[2]) : (sceneOrientation.value === 'landscape' ? 576 : 1024);

    // P3 env-tags port (2026-04-19): pipe the four env-related state reads
    // into scene generation so image output reflects current weather,
    // festival decoration, and atmospheric tags.
    const gameTime = get(DEFAULT_ENGINE_PATHS.gameTime) as GameTime | null | undefined;
    const task = await imageService.generateSceneImage({
      sceneDescription: sceneExtraPrompt.value || '当前场景',
      location: get('角色.基础信息.当前位置') as string ?? '',
      gameTime,
      weather: get(DEFAULT_ENGINE_PATHS.weather) as string | undefined,
      festival: get(DEFAULT_ENGINE_PATHS.festival),
      environment: get(DEFAULT_ENGINE_PATHS.environmentTags),
      backend: backend.value,
      compositionMode: sceneComposition.value === 'snapshot' ? 'story_snapshot' : 'pure_landscape',
      extraRequirements: sceneExtraPrompt.value || undefined,
      preset: { id: 'scene_custom', name: '场景自定义', positivePrefix: '', positiveSuffix: '', negative: '', source: 'manual', width: sceneW, height: sceneH },
    });
    if (task.status === 'failed') {
      sceneError.value = task.error ?? '场景生成失败';
      sceneStatusText.value = '';
    } else {
      sceneStatusText.value = backgroundMode.value ? '后台任务已提交。' : '场景图已生成。';
    }
  } catch (err) {
    sceneError.value = (err as Error).message ?? String(err);
    sceneStatusText.value = '';
  } finally {
    sceneGenerating.value = false;
  }
}

// Settings tab state
const settingsBackend = computed(() => String(get('系统.扩展.image.config.defaultBackend') ?? 'novelai'));
const isNovelAIBackend = computed(() => settingsBackend.value === 'novelai');
const settingsSceneIndependent = computed(() => get('系统.扩展.image.config.sceneIndependentBackend') === true);
const settingsTransformerIndependent = computed(() => get('系统.扩展.image.config.transformerIndependentModel') === true);

const civitaiNetworksJsonError = ref('');
const civitaiControlNetsJsonError = ref('');
function validateCivitaiJson(field: 'additionalNetworksJson' | 'controlNetsJson', errorRef: 'civitaiNetworksJsonError' | 'civitaiControlNetsJsonError') {
  const raw = String(get(`系统.扩展.image.config.civitai.${field}`) ?? '').trim();
  if (!raw) { (errorRef === 'civitaiNetworksJsonError' ? civitaiNetworksJsonError : civitaiControlNetsJsonError).value = ''; return; }
  try { JSON.parse(raw); (errorRef === 'civitaiNetworksJsonError' ? civitaiNetworksJsonError : civitaiControlNetsJsonError).value = ''; }
  catch (e) { (errorRef === 'civitaiNetworksJsonError' ? civitaiNetworksJsonError : civitaiControlNetsJsonError).value = `JSON 格式错误: ${(e as Error).message}`; }
}

const civitaiWhatifLoading = ref(false);
const civitaiWhatifResult = ref('');
async function runCivitaiWhatif() {
  civitaiWhatifLoading.value = true;
  civitaiWhatifResult.value = '';
  try {
    const apiConfig = aiService?.getConfigForUsage('imageGeneration');
    if (!apiConfig) { civitaiWhatifResult.value = '未配置图像生成 API'; return; }
    const base = apiConfig.url.replace(/\/+$/, '');
    const body: Record<string, unknown> = { prompt: 'cost estimate', width: 1024, height: 1024, quantity: 1, batchSize: 1 };
    if (apiConfig.model) body.model = apiConfig.model;
    const steps = get('系统.扩展.image.config.civitai.steps');
    if (steps != null) body.steps = steps;
    const res = await fetch(`${base}/v2/consumer/recipes/textToImage?whatif=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { civitaiWhatifResult.value = `查询失败: HTTP ${res.status}`; return; }
    const data = await res.json();
    const cost = data?.cost ?? data?.totalCost ?? data?.jobs?.[0]?.cost;
    civitaiWhatifResult.value = cost != null ? `预计消耗 ${cost} Buzz` : `查询完成 — ${JSON.stringify(data).slice(0, 120)}`;
  } catch (e) {
    civitaiWhatifResult.value = `查询失败: ${(e as Error).message}`;
  } finally {
    civitaiWhatifLoading.value = false;
  }
}

// History state
const historyFilter = ref('all');
const historyFilterOptions: SelectOption[] = [
  { label: '全部', value: 'all' },
  { label: '角色', value: 'character' },
  { label: '场景', value: 'scene' },
  { label: '成功', value: 'complete' },
  { label: '失败', value: 'failed' },
];
// Preset management state
const presetScope = ref<'npc' | 'scene'>('npc');
const selectedPresetId = ref('');
const newPresetName = ref('');
const newPresetPositive = ref('');
const newPresetNegative = ref('');
const newPresetArtist = ref('');

interface ArtistPreset {
  id: string;
  name: string;
  scope: 'npc' | 'scene';
  artistString: string;
  positive: string;
  negative: string;
  /** PNG import metadata (only present for PNG-imported presets) */
  pngMeta?: {
    source?: string;
    originalPrompt?: string;
    rawText?: string;
    parsedParams?: Record<string, unknown>;
    replicateParams?: boolean;
    coverDataUrl?: string;
  };
}

const artistPresets = computed<ArtistPreset[]>(() => {
  const raw = get('系统.扩展.image.artistPresets');
  return Array.isArray(raw) ? raw as ArtistPreset[] : [];
});


// Split presets: PNG presets vs artist-only presets
const pngPresets = computed(() =>
  artistPresets.value.filter((p) => p.id.startsWith('png_'))
);
const artistOnlyPresets = computed(() =>
  artistPresets.value.filter((p) => p.scope === presetScope.value && !p.id.startsWith('png_'))
);

// Always NPC-scoped presets (for Manual + Secret sections, independent of Presets tab scope)
const npcArtistPresets = computed(() =>
  artistPresets.value.filter((p) => p.scope === 'npc' && !p.id.startsWith('png_'))
);

const selectedPreset = computed(() =>
  artistPresets.value.find((p) => p.id === selectedPresetId.value) ?? null
);

function createPreset() {
  const name = newPresetName.value.trim() || `预设 ${Date.now()}`;
  const preset: ArtistPreset = {
    id: `preset_${Date.now()}`,
    name,
    scope: presetScope.value,
    artistString: '',
    positive: '',
    negative: '',
  };
  const list = [...artistPresets.value, preset];
  setValue('系统.扩展.image.artistPresets', list);
  selectedPresetId.value = preset.id;
  newPresetName.value = '';
}

function savePreset() {
  if (!selectedPreset.value) return;
  const list = artistPresets.value.map((p) =>
    p.id === selectedPresetId.value
      ? { ...p, positive: newPresetPositive.value, negative: newPresetNegative.value, artistString: newPresetArtist.value }
      : p
  );
  setValue('系统.扩展.image.artistPresets', list);
}

function deletePreset() {
  const list = artistPresets.value.filter((p) => p.id !== selectedPresetId.value);
  setValue('系统.扩展.image.artistPresets', list);
  selectedPresetId.value = '';
}

// Artist preset import/export (§2.7-A)
function exportArtistPresets() {
  const data = artistPresets.value.filter((p) => p.scope === presetScope.value);
  if (data.length === 0) {
    eventBus.emit('ui:toast', { type: 'info', message: '当前范围没有预设可导出', duration: 1500 });
    return;
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `artist-presets-${presetScope.value}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  eventBus.emit('ui:toast', { type: 'success', message: `已导出 ${data.length} 个预设`, duration: 1500 });
}

function importArtistPresets(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result as string);
      const items: ArtistPreset[] = (Array.isArray(parsed) ? parsed : [parsed])
        .filter((p: unknown): p is ArtistPreset =>
          typeof p === 'object' && p !== null && 'name' in p
        )
        .map((p: ArtistPreset) => ({
          ...p,
          id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          scope: p.scope === 'scene' ? 'scene' : 'npc',
        }));
      if (items.length === 0) {
        eventBus.emit('ui:toast', { type: 'error', message: '未找到有效预设数据', duration: 2000 });
        return;
      }
      const list = [...artistPresets.value, ...items];
      setValue('系统.扩展.image.artistPresets', list);
      eventBus.emit('ui:toast', { type: 'success', message: `已导入 ${items.length} 个预设`, duration: 1500 });
    } catch {
      eventBus.emit('ui:toast', { type: 'error', message: '导入失败：无效的 JSON 文件', duration: 2000 });
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// Load selected preset content into editor
// PNG import
const pngImporting = ref(false);
const pngImportStatus = ref('');

async function importPng(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  pngImporting.value = true;
  pngImportStatus.value = `正在解析：${file.name}`;

  try {
    const { extractPngMetadata } = await import('@/engine/image/png-metadata');
    const metadata = await extractPngMetadata(file);

    if (!metadata.positive && !metadata.rawText) {
      pngImportStatus.value = '未找到有效的 PNG 元数据';
      pngImporting.value = false;
      return;
    }

    // Generate small cover thumbnail (80x56)
    let coverDataUrl: string | undefined;
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('load'));
        img.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 56;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, 80, 56);
        coverDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      }
      URL.revokeObjectURL(objectUrl);
    } catch { /* cover is optional */ }

    const parsedParams: Record<string, unknown> = {};
    if (metadata.params?.sampler) parsedParams.sampler = metadata.params.sampler;
    if (metadata.params?.steps) parsedParams.steps = metadata.params.steps;
    if (metadata.params?.cfgScale) parsedParams.cfgScale = metadata.params.cfgScale;
    if (metadata.params?.seed) parsedParams.seed = metadata.params.seed;
    if (metadata.params?.model) parsedParams.model = metadata.params.model;
    if (metadata.params?.width) parsedParams.width = metadata.params.width;
    if (metadata.params?.height) parsedParams.height = metadata.params.height;

    const preset: ArtistPreset = {
      id: `png_${Date.now()}`,
      name: file.name.replace(/\.png$/i, ''),
      scope: presetScope.value,
      artistString: '',
      positive: metadata.positive ?? '',
      negative: metadata.negative ?? '',
      pngMeta: {
        source: metadata.source,
        originalPrompt: metadata.positive ?? '',
        rawText: metadata.rawText ?? '',
        parsedParams: Object.keys(parsedParams).length > 0 ? parsedParams : undefined,
        replicateParams: false,
        coverDataUrl,
      },
    };

    const list = [...artistPresets.value, preset];
    setValue('系统.扩展.image.artistPresets', list);
    selectedPresetId.value = preset.id;
    loadPresetIntoEditor();
    pngImportStatus.value = `已导入：${preset.name}`;
  } catch (err) {
    pngImportStatus.value = `解析失败：${(err as Error).message}`;
  } finally {
    pngImporting.value = false;
    input.value = '';
  }
}

function loadPresetIntoEditor() {
  if (selectedPreset.value) {
    newPresetPositive.value = selectedPreset.value.positive;
    newPresetNegative.value = selectedPreset.value.negative;
    newPresetArtist.value = selectedPreset.value.artistString;
  }
}

function toggleReplicateParams(value: boolean) {
  if (!selectedPreset.value?.pngMeta) return;
  const list = artistPresets.value.map((p) =>
    p.id === selectedPresetId.value
      ? { ...p, pngMeta: { ...p.pngMeta!, replicateParams: value } }
      : p
  );
  setValue('系统.扩展.image.artistPresets', list);
}

// Character anchor management (MRJH §J Sec 2)
interface CharacterAnchor {
  id: string;
  name: string;
  npcName: string;
  enabled: boolean;
  defaultAppend: boolean;
  sceneLink: boolean;
  positive: string;
  negative: string;
  structuredFeatures?: import('@/engine/image/types').AnchorStructuredFeatures;
  source?: string;
  model?: string;
}

const selectedAnchorId = ref('');
const anchorExtractRequirements = ref('');
const anchorExtracting = ref(false);
const anchorExtractMessage = ref('');
const anchorExtractStage = ref<'idle' | 'extracting' | 'done' | 'error'>('idle');

const characterAnchors = computed<CharacterAnchor[]>(() => {
  const raw = get('系统.扩展.image.characterAnchors');
  return Array.isArray(raw) ? raw as CharacterAnchor[] : [];
});

const selectedAnchor = computed(() =>
  characterAnchors.value.find((a) => a.id === selectedAnchorId.value) ?? null
);

// Editor state for anchor
const editAnchorName = ref('');
const editAnchorNpc = ref('');
const editAnchorPositive = ref('');
const editAnchorNegative = ref('');

function selectAnchor(id: string) {
  selectedAnchorId.value = id;
  const a = characterAnchors.value.find((x) => x.id === id);
  if (a) {
    editAnchorName.value = a.name;
    editAnchorNpc.value = a.npcName;
    editAnchorPositive.value = a.positive;
    editAnchorNegative.value = a.negative;
  }
}

async function extractAnchor() {
  if (!editAnchorNpc.value || !aiService) {
    anchorExtractStage.value = 'error';
    anchorExtractMessage.value = !aiService ? 'AI 服务未就绪' : '请先选择 NPC';
    return;
  }
  anchorExtracting.value = true;
  anchorExtractStage.value = 'extracting';
  anchorExtractMessage.value = `正在为 ${editAnchorNpc.value} 提取锚点…`;
  try {
    const npc = (relationships.value as Array<Record<string, unknown>>)?.find(
      (n) => n['名称'] === editAnchorNpc.value
    );
    if (!npc) throw new Error('NPC not found');

    const npcData: Record<string, unknown> = { 姓名: editAnchorNpc.value };
    const pick = (key: string) => { const v = npc[key]; return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
    if (pick('性别')) npcData['性别'] = pick('性别');
    if (npc['年龄']) npcData['年龄'] = npc['年龄'];
    if (pick('描述')) npcData['描述'] = pick('描述');
    if (pick('外貌描述')) npcData['外貌描述'] = pick('外貌描述');
    if (pick('身材描写')) npcData['身材描写'] = pick('身材描写');
    if (pick('衣着风格')) npcData['衣着风格'] = pick('衣着风格');
    if (Array.isArray(npc['性格特征'])) npcData['性格特征'] = npc['性格特征'];

    const result = await extractAnchorViaAI(
      aiService,
      JSON.stringify(npcData, null, 2),
      {
        displayName: editAnchorNpc.value,
        extraRequirements: anchorExtractRequirements.value.trim() || undefined,
      },
    );

    const anchor: CharacterAnchor = {
      id: `anchor_${Date.now()}`,
      name: `${editAnchorNpc.value} 锚点`,
      npcName: editAnchorNpc.value,
      enabled: true,
      defaultAppend: true,
      sceneLink: false,
      positive: result.positivePrompt,
      negative: result.negativePrompt,
      structuredFeatures: result.structuredFeatures,
      source: 'AI提取',
    };
    const list = [...characterAnchors.value.filter((a) => a.npcName !== editAnchorNpc.value), anchor];
    setValue('系统.扩展.image.characterAnchors', list);
    selectAnchor(anchor.id);
    anchorExtractStage.value = 'done';
    anchorExtractMessage.value = `锚点已提取：${anchor.name}`;
  } catch (err) {
    anchorExtractStage.value = 'error';
    anchorExtractMessage.value = `提取失败：${(err as Error).message}`;
  } finally {
    anchorExtracting.value = false;
  }
}

function saveAnchor() {
  if (!selectedAnchor.value) return;
  const list = characterAnchors.value.map((a) =>
    a.id === selectedAnchorId.value
      ? { ...a, name: editAnchorName.value, positive: editAnchorPositive.value, negative: editAnchorNegative.value }
      : a
  );
  setValue('系统.扩展.image.characterAnchors', list);
  eventBus.emit('ui:toast', { type: 'success', message: '锚点已保存', duration: 1500 });
}

function deleteAnchor() {
  const list = characterAnchors.value.filter((a) => a.id !== selectedAnchorId.value);
  setValue('系统.扩展.image.characterAnchors', list);
  selectedAnchorId.value = '';
}

function toggleAnchorProp(prop: 'enabled' | 'defaultAppend' | 'sceneLink', value: boolean) {
  const list = characterAnchors.value.map((a) =>
    a.id === selectedAnchorId.value ? { ...a, [prop]: value } : a
  );
  setValue('系统.扩展.image.characterAnchors', list);
}

// Transformer preset CRUD state (§2.7-C)
interface TransformerPreset {
  id: string;
  name: string;
  scope: 'npc' | 'scene' | 'secret';
  prompt: string;
}

const transformerScope = ref<'npc' | 'scene' | 'secret'>('npc');
const selectedTransformerId = ref('');
const newTransformerName = ref('');
const editTransformerPrompt = ref('');

const transformerPresets = computed<TransformerPreset[]>(() => {
  const raw = get('系统.扩展.image.transformerPresets');
  return Array.isArray(raw) ? raw as TransformerPreset[] : [];
});

const scopedTransformers = computed(() =>
  transformerPresets.value.filter((p) => p.scope === transformerScope.value)
);

const selectedTransformer = computed(() =>
  transformerPresets.value.find((p) => p.id === selectedTransformerId.value) ?? null
);

function loadTransformerIntoEditor() {
  if (selectedTransformer.value) {
    editTransformerPrompt.value = selectedTransformer.value.prompt;
  }
}

function createTransformerPreset() {
  const name = newTransformerName.value.trim() || `转化器 ${Date.now()}`;
  const preset: TransformerPreset = {
    id: `tf_${Date.now()}`,
    name,
    scope: transformerScope.value,
    prompt: '',
  };
  const list = [...transformerPresets.value, preset];
  setValue('系统.扩展.image.transformerPresets', list);
  selectedTransformerId.value = preset.id;
  newTransformerName.value = '';
  editTransformerPrompt.value = '';
}

function saveTransformerPreset() {
  if (!selectedTransformer.value) return;
  const list = transformerPresets.value.map((p) =>
    p.id === selectedTransformerId.value
      ? { ...p, prompt: editTransformerPrompt.value }
      : p
  );
  setValue('系统.扩展.image.transformerPresets', list);
  eventBus.emit('ui:toast', { type: 'success', message: '转化器预设已保存', duration: 1500 });
}

function deleteTransformerPreset() {
  const list = transformerPresets.value.filter((p) => p.id !== selectedTransformerId.value);
  setValue('系统.扩展.image.transformerPresets', list);
  selectedTransformerId.value = '';
  editTransformerPrompt.value = '';
}

// Model rulesets — MRJH §J-2 Sub-section 1
interface ModelRuleset {
  id: string;
  name: string;
  enabled: boolean;
  compatMode: boolean;
  baseModelRule: string;
  anchorModeModelRule: string;
  serializationStrategy: string;
  npcTemplateId: string;
  sceneTemplateId: string;
  judgeTemplateId: string;
}

const modelRulesetExpanded = ref(false);
const editingModelRulesetId = ref('');
const editModelRulesetName = ref('');
const editModelRulesetBase = ref('');
const editModelRulesetAnchor = ref('');

const modelRulesets = computed<ModelRuleset[]>(() => {
  const raw = get('系统.扩展.image.modelRulesets');
  return Array.isArray(raw) ? raw as ModelRuleset[] : [];
});

const editingModelRuleset = computed(() =>
  modelRulesets.value.find((r) => r.id === editingModelRulesetId.value) ?? null
);

const activeModelRuleset = computed(() =>
  modelRulesets.value.find((r) => r.enabled) ?? null
);

const modelRulesetOptions = computed<SelectOption[]>(() =>
  modelRulesets.value.map((r) => ({ label: `${r.name}${r.enabled ? ' (启用中)' : ''}`, value: r.id }))
);

// Auto-select the enabled model ruleset when rulesets are seeded
watch(modelRulesets, (list) => {
  if (editingModelRulesetId.value) return;
  const enabled = list.find((r) => r.enabled);
  if (enabled) selectModelRuleset(enabled.id);
}, { immediate: true });

function selectModelRuleset(id: string) {
  editingModelRulesetId.value = id;
  const r = modelRulesets.value.find((x) => x.id === id);
  if (r) {
    editModelRulesetName.value = r.name;
    editModelRulesetBase.value = r.baseModelRule;
    editModelRulesetAnchor.value = r.anchorModeModelRule;
  }
}

function createModelRuleset() {
  const ruleset: ModelRuleset = {
    id: `mrs_${Date.now()}`,
    name: `规则集 ${modelRulesets.value.length + 1}`,
    enabled: false,
    compatMode: false,
    baseModelRule: '',
    anchorModeModelRule: '',
    serializationStrategy: 'nai_character_segments',
    npcTemplateId: '',
    sceneTemplateId: '',
    judgeTemplateId: '',
  };
  const list = [...modelRulesets.value, ruleset];
  setValue('系统.扩展.image.modelRulesets', list);
  selectModelRuleset(ruleset.id);
}

function saveModelRuleset() {
  if (!editingModelRuleset.value) return;
  const list = modelRulesets.value.map((r) =>
    r.id === editingModelRulesetId.value
      ? { ...r, name: editModelRulesetName.value, baseModelRule: editModelRulesetBase.value, anchorModeModelRule: editModelRulesetAnchor.value }
      : r
  );
  setValue('系统.扩展.image.modelRulesets', list);
  eventBus.emit('ui:toast', { type: 'success', message: '模型规则集已保存', duration: 1500 });
}

function deleteModelRuleset() {
  const list = modelRulesets.value.filter((r) => r.id !== editingModelRulesetId.value);
  setValue('系统.扩展.image.modelRulesets', list);
  editingModelRulesetId.value = '';
}

function toggleModelRulesetEnabled(value: boolean) {
  // Only one ruleset can be enabled — disable others first
  const list = modelRulesets.value.map((r) => ({
    ...r,
    enabled: r.id === editingModelRulesetId.value ? value : (value ? false : r.enabled),
  }));
  setValue('系统.扩展.image.modelRulesets', list);
}

function toggleModelRulesetCompat(value: boolean) {
  const list = modelRulesets.value.map((r) =>
    r.id === editingModelRulesetId.value ? { ...r, compatMode: value } : r
  );
  setValue('系统.扩展.image.modelRulesets', list);
}

function exportModelRulesets() {
  const data = modelRulesets.value;
  if (data.length === 0) {
    eventBus.emit('ui:toast', { type: 'info', message: '暂无模型规则集可导出', duration: 1500 });
    return;
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `model-rulesets-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  eventBus.emit('ui:toast', { type: 'success', message: `已导出 ${data.length} 个模型规则集`, duration: 1500 });
}

function importModelRulesets(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result as string);
      const items = (Array.isArray(parsed) ? parsed : [parsed]).filter(
        (r: unknown): r is ModelRuleset => typeof r === 'object' && r !== null && 'name' in r
      ).map((r) => ({
        ...r,
        id: `mrs_import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        enabled: false,
      }));
      if (items.length === 0) {
        eventBus.emit('ui:toast', { type: 'error', message: '未找到有效规则集数据', duration: 2000 });
        return;
      }
      setValue('系统.扩展.image.modelRulesets', [...modelRulesets.value, ...items]);
      eventBus.emit('ui:toast', { type: 'success', message: `已导入 ${items.length} 个模型规则集`, duration: 1500 });
    } catch {
      eventBus.emit('ui:toast', { type: 'error', message: '导入失败：无效的 JSON 文件', duration: 2000 });
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// Rules state — full CRUD per MRJH §J-2
interface RuleTemplate {
  id: string;
  name: string;
  scope: 'npc' | 'scene' | 'judge';
  baseRule: string;
  anchorRule: string;
  noAnchorFallback: string;
  outputFormat: string;
  transformerPresetId: string;
}

const ruleScope = ref<'npc' | 'scene' | 'judge'>('npc');

const ruleTemplates = computed<RuleTemplate[]>(() => {
  const raw = get('系统.扩展.image.ruleTemplates');
  return Array.isArray(raw) ? raw as RuleTemplate[] : [];
});

const scopedRuleTemplates = computed(() =>
  ruleTemplates.value.filter((r) => r.scope === ruleScope.value)
);

// "当前生效" — which rule is active per scope
const activeNpcRuleId = ref(String(get('系统.扩展.image.rules.activeNpcRule') ?? ''));
const activeSceneRuleId = ref(String(get('系统.扩展.image.rules.activeSceneRule') ?? ''));
const activeJudgeRuleId = ref(String(get('系统.扩展.image.rules.activeJudgeRule') ?? ''));

const currentActiveRuleId = computed({
  get: () => ruleScope.value === 'npc' ? activeNpcRuleId.value : ruleScope.value === 'scene' ? activeSceneRuleId.value : activeJudgeRuleId.value,
  set: (v: string) => {
    if (ruleScope.value === 'npc') activeNpcRuleId.value = v;
    else if (ruleScope.value === 'scene') activeSceneRuleId.value = v;
    else activeJudgeRuleId.value = v;
  },
});

// "当前编辑" — which rule is being edited
const editingRuleId = ref('');

const editingRule = computed(() =>
  ruleTemplates.value.find((r) => r.id === editingRuleId.value) ?? null
);

// Editor fields
const editRuleName = ref('');
const editBaseRule = ref('');
const editAnchorRule = ref('');
const editNoAnchorFallback = ref('');
const editOutputFormat = ref('');
const editRuleTransformerId = ref('');

const activeRuleOptions = computed<SelectOption[]>(() => [
  { label: '不使用', value: '' },
  ...scopedRuleTemplates.value.map((r) => ({ label: r.name, value: r.id })),
]);

const editRuleOptions = computed<SelectOption[]>(() =>
  scopedRuleTemplates.value.map((r) => ({ label: r.name, value: r.id }))
);

const npcTransformerOptions = computed<SelectOption[]>(() => [
  { label: '不使用', value: '' },
  ...transformerPresets.value.filter((p) => p.scope === 'npc').map((p) => ({ label: p.name, value: p.id })),
]);
const sceneTransformerOptions = computed<SelectOption[]>(() => [
  { label: '不使用', value: '' },
  ...transformerPresets.value.filter((p) => p.scope === 'scene').map((p) => ({ label: p.name, value: p.id })),
]);

const currentTransformerOptions = computed(() =>
  ruleScope.value === 'npc' ? npcTransformerOptions.value : sceneTransformerOptions.value
);

function loadRuleIntoEditor() {
  if (editingRule.value) {
    editRuleName.value = editingRule.value.name;
    editBaseRule.value = editingRule.value.baseRule;
    editAnchorRule.value = editingRule.value.anchorRule;
    editNoAnchorFallback.value = editingRule.value.noAnchorFallback;
    editOutputFormat.value = editingRule.value.outputFormat;
    editRuleTransformerId.value = editingRule.value.transformerPresetId;
  }
}

function selectEditRule(id: string) {
  editingRuleId.value = id;
  loadRuleIntoEditor();
}

// Auto-select first rule template when scope changes and nothing is selected
watch([scopedRuleTemplates, ruleScope], ([templates]) => {
  if (editingRuleId.value && templates.some((t: RuleTemplate) => t.id === editingRuleId.value)) return;
  if (templates.length > 0) {
    selectEditRule(templates[0].id);
  }
}, { immediate: true });

function createRuleTemplate() {
  const rule: RuleTemplate = {
    id: `rule_${Date.now()}`,
    name: `${ruleScope.value === 'npc' ? 'NPC' : ruleScope.value === 'scene' ? '场景' : '判定'}规则 ${scopedRuleTemplates.value.length + 1}`,
    scope: ruleScope.value,
    baseRule: '', anchorRule: '', noAnchorFallback: '', outputFormat: '',
    transformerPresetId: '',
  };
  const list = [...ruleTemplates.value, rule];
  setValue('系统.扩展.image.ruleTemplates', list);
  editingRuleId.value = rule.id;
  loadRuleIntoEditor();
}

function saveRuleTemplate() {
  if (!editingRule.value) return;
  const list = ruleTemplates.value.map((r) =>
    r.id === editingRuleId.value
      ? { ...r, name: editRuleName.value, baseRule: editBaseRule.value, anchorRule: editAnchorRule.value, noAnchorFallback: editNoAnchorFallback.value, outputFormat: editOutputFormat.value, transformerPresetId: editRuleTransformerId.value }
      : r
  );
  setValue('系统.扩展.image.ruleTemplates', list);
  eventBus.emit('ui:toast', { type: 'success', message: '规则已保存', duration: 1500 });
}

function deleteRuleTemplate() {
  const list = ruleTemplates.value.filter((r) => r.id !== editingRuleId.value);
  setValue('系统.扩展.image.ruleTemplates', list);
  // Clear active if deleted
  if (currentActiveRuleId.value === editingRuleId.value) {
    currentActiveRuleId.value = '';
  }
  editingRuleId.value = '';
}

function saveActiveRules() {
  const existing = (get('系统.扩展.image.rules') as Record<string, unknown>) ?? {};
  setValue('系统.扩展.image.rules', {
    ...existing,
    activeNpcRule: activeNpcRuleId.value,
    activeSceneRule: activeSceneRuleId.value,
    activeJudgeRule: activeJudgeRuleId.value,
  });
  eventBus.emit('ui:toast', { type: 'success', message: '生效规则已更新', duration: 1500 });
}

// Rules import/export
function exportRules() {
  const data = {
    ruleTemplates: ruleTemplates.value,
    modelRulesets: modelRulesets.value,
    rules: get('系统.扩展.image.rules'),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `image-rules-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  eventBus.emit('ui:toast', { type: 'success', message: '规则已导出', duration: 1500 });
}

function importRules(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      if (Array.isArray(data.ruleTemplates)) {
        setValue('系统.扩展.image.ruleTemplates', data.ruleTemplates);
      }
      if (Array.isArray(data.modelRulesets)) {
        setValue('系统.扩展.image.modelRulesets', data.modelRulesets);
      }
      if (data.rules && typeof data.rules === 'object') {
        setValue('系统.扩展.image.rules', data.rules);
      }
      eventBus.emit('ui:toast', { type: 'success', message: '规则已导入', duration: 1500 });
    } catch {
      eventBus.emit('ui:toast', { type: 'error', message: '导入失败：无效的 JSON 文件', duration: 2000 });
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// Combined history: NPC archives + scene archives + task queue, sorted by time (MRJH: combinedHistoryRecords)
interface CombinedHistoryEntry {
  key: string;
  type: 'character' | 'scene';
  timestamp: number;
  id: string;
  name: string;
  status: string;
  positivePrompt?: string;
  negativePrompt?: string;
  composition?: string;
  model?: string;
  artStyle?: string;
  error?: string;
  assetId?: string;
  taskId?: string;
  /** Captured output dimensions + backend — used by "生成同款" to replay. */
  width?: number;
  height?: number;
  backend?: ImageBackendType;
  part?: 'breast' | 'vagina' | 'anus';
}

const combinedHistory = computed<CombinedHistoryEntry[]>(() => {
  void imageUpdateTick.value;
  const entries: CombinedHistoryEntry[] = [];

  // NPC archives
  if (Array.isArray(relationships.value)) {
    for (const npc of relationships.value) {
      const name = String(npc['名称'] ?? '');
      const archive = npc['图片档案'] as Record<string, unknown> | undefined;
      if (!archive) continue;
      const history = archive['生图历史'];
      if (!Array.isArray(history)) continue;
      for (const record of history as Array<Record<string, unknown>>) {
        entries.push({
          key: `npc_${name}_${record.id ?? record.createdAt}`,
          type: 'character',
          timestamp: Number(record.createdAt ?? record['生成时间'] ?? 0),
          id: String(record.id ?? ''),
          name,
          status: String(record.status ?? 'complete'),
          positivePrompt: String(record.positivePrompt ?? record['最终正向提示词'] ?? ''),
          negativePrompt: String(record.negativePrompt ?? record['最终负向提示词'] ?? ''),
          composition: String(record.composition ?? ''),
          model: String(record.model ?? record['使用模型'] ?? ''),
          artStyle: String(record.artStyle ?? record['画风'] ?? ''),
          assetId: String(record.id ?? ''),
          width: Number(record.width) || undefined,
          height: Number(record.height) || undefined,
          backend: (record.backend as ImageBackendType | undefined) ?? undefined,
          part: record.part as 'breast' | 'vagina' | 'anus' | undefined,
        });
      }
    }
  }

  // Player archive
  for (const record of getPlayerArchiveHistory()) {
    entries.push({
      key: `player_${record.id ?? record.createdAt}`,
      type: 'character',
      timestamp: Number(record.createdAt ?? 0),
      id: String(record.id ?? ''),
      name: playerName.value ?? '主角',
      status: String(record.status ?? 'complete'),
      positivePrompt: String(record.positivePrompt ?? ''),
      negativePrompt: String(record.negativePrompt ?? ''),
      composition: String(record.composition ?? ''),
      assetId: String(record.id ?? ''),
      width: Number(record.width) || undefined,
      height: Number(record.height) || undefined,
      backend: record.backend ?? undefined,
      part: record.part ?? undefined,
    });
  }

  // Scene archives
  for (const record of sceneArchiveHistory.value) {
    entries.push({
      key: `scene_${record.id ?? record.createdAt}`,
      type: 'scene',
      timestamp: Number(record.createdAt ?? record['生成时间'] ?? 0),
      id: String(record.id ?? ''),
      name: '场景',
      status: String(record.status ?? 'complete'),
      positivePrompt: String(record.positivePrompt ?? record['最终正向提示词'] ?? ''),
      negativePrompt: String(record.negativePrompt ?? record['最终负向提示词'] ?? ''),
      model: String(record.model ?? record['使用模型'] ?? ''),
      assetId: String(record.id ?? ''),
      taskId: String(record.taskId ?? ''),
      width: Number(record.width) || undefined,
      height: Number(record.height) || undefined,
      backend: (record.backend as ImageBackendType | undefined) ?? undefined,
    });
  }

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
});

const filteredHistory = computed(() => {
  let entries = combinedHistory.value;
  const f = historyFilter.value;
  if (f === 'character') entries = entries.filter((e) => e.type === 'character');
  else if (f === 'scene') entries = entries.filter((e) => e.type === 'scene');
  else if (f === 'complete') entries = entries.filter((e) => e.status === 'complete');
  else if (f === 'failed') entries = entries.filter((e) => e.status === 'failed');
  return entries;
});

function clearAllNpcHistory() {
  if (!imageService || !Array.isArray(relationships.value)) return;
  for (const npc of relationships.value) {
    const name = String(npc['名称'] ?? '');
    if (name) imageService.clearNpcHistory(name);
  }
  eventBus.emit('ui:toast', { type: 'info', message: '已清空全部 NPC 历史', duration: 1500 });
}

function clearAllSceneHistory() {
  clearSceneHistory();
}
// Convert engine TransformerPromptPreset → UI RuleTemplate
function enginePresetToRuleTemplate(p: TransformerPromptPreset): RuleTemplate {
  const scopeMap: Record<string, 'npc' | 'scene' | 'judge'> = { npc: 'npc', scene: 'scene', scene_judge: 'judge' };
  return {
    id: p.id,
    name: p.name,
    scope: scopeMap[p.scope] ?? 'npc',
    baseRule: p.prompt,
    anchorRule: p.scope === 'scene' ? (p.sceneAnchorModePrompt ?? p.anchorModePrompt ?? '') : (p.anchorModePrompt ?? ''),
    noAnchorFallback: p.noAnchorFallbackPrompt ?? '',
    outputFormat: p.outputFormatPrompt ?? '',
    transformerPresetId: '',
  };
}

// Convert engine ModelTransformerBundle → UI ModelRuleset
function engineBundleToModelRuleset(b: ModelTransformerBundle): ModelRuleset {
  return {
    id: b.id,
    name: b.name,
    enabled: b.enabled,
    compatMode: false,
    baseModelRule: b.modelPrompt,
    anchorModeModelRule: b.anchorModeModelPrompt,
    serializationStrategy: b.serializationStrategy,
    npcTemplateId: b.npcPresetId,
    sceneTemplateId: b.scenePresetId,
    judgeTemplateId: b.sceneJudgePresetId,
  };
}

onMounted(() => {
  const npcQuery = route.query.npc;
  if (typeof npcQuery === 'string' && npcQuery) {
    selectedNpc.value = npcQuery;
  }

  // Seed default model rulesets + rule templates from engine defaults if state tree is empty
  const existingRulesets = get('系统.扩展.image.modelRulesets');
  if (!Array.isArray(existingRulesets) || existingRulesets.length === 0) {
    const defaults = getDefaultModelBundles().map(engineBundleToModelRuleset);
    setValue('系统.扩展.image.modelRulesets', defaults);
  }

  const existingTemplates = get('系统.扩展.image.ruleTemplates');
  if (!Array.isArray(existingTemplates) || existingTemplates.length === 0) {
    const defaults = getDefaultPresets().map(enginePresetToRuleTemplate);
    setValue('系统.扩展.image.ruleTemplates', defaults);
  }
});

// Gallery state
const galleryNpc = ref('');

interface GalleryImage {
  id: string;
  createdAt: number | string;
  composition?: string;
  artStyle?: string;
  model?: string;
  status?: 'complete' | 'failed' | 'generating' | 'pending' | 'tokenizing';
  positivePrompt?: string;
  negativePrompt?: string;
  /** Populated for secret-part records so regen targets the right archive. */
  part?: 'breast' | 'vagina' | 'anus';
  /** Captured output dimensions — used to replay the same size on regen. */
  width?: number;
  height?: number;
  /** Backend that produced the record; initial value when opening the regen modal. */
  backend?: ImageBackendType;
}

// Player archive for Gallery/History integration (MRJH: __player__ pseudo-NPC)
const PLAYER_ID = '__player__';
const playerArchiveRaw = useValue<Record<string, unknown>>('角色.图片档案');
const playerName = useValue<string>(DEFAULT_ENGINE_PATHS.playerName);

function getArchiveHistory(npc: Record<string, unknown>): GalleryImage[] {
  const archive = npc['图片档案'] as Record<string, unknown> | undefined;
  if (!archive) return [];
  const history = archive['生图历史'];
  return Array.isArray(history) ? history as GalleryImage[] : [];
}

function getPlayerArchiveHistory(): GalleryImage[] {
  const raw = playerArchiveRaw.value;
  if (!raw || typeof raw !== 'object') return [];
  const history = raw['生图历史'];
  return Array.isArray(history) ? history as GalleryImage[] : [];
}

const npcsWithImages = computed(() => {
  void imageUpdateTick.value;
  const list = relationships.value;
  const result: Array<Record<string, unknown>> = [];

  // Include player as virtual NPC if they have images
  if (getPlayerArchiveHistory().length > 0) {
    result.push({ '名称': PLAYER_ID, '性别': '', '是否主要角色': true, '图片档案': playerArchiveRaw.value });
  }

  if (Array.isArray(list)) {
    result.push(...list.filter((npc) => getArchiveHistory(npc).length > 0));
  }
  return result;
});

const galleryImages = computed(() => {
  void imageUpdateTick.value;
  if (!galleryNpc.value) return [];
  if (galleryNpc.value === PLAYER_ID) {
    return [...getPlayerArchiveHistory()].reverse();
  }
  if (!Array.isArray(relationships.value)) return [];
  const npc = relationships.value.find((n) => n['名称'] === galleryNpc.value);
  if (!npc) return [];
  return [...getArchiveHistory(npc)].reverse();
});

const galleryNpcData = computed(() => {
  if (!galleryNpc.value) return null;
  if (galleryNpc.value === PLAYER_ID) {
    return { '名称': playerName.value ?? '主角', '性别': '', '是否主要角色': true, '图片档案': playerArchiveRaw.value } as Record<string, unknown>;
  }
  if (!Array.isArray(relationships.value)) return null;
  return relationships.value.find((n) => n['名称'] === galleryNpc.value) ?? null;
});

function getCurrentArchive(): Record<string, unknown> | undefined {
  if (!galleryNpc.value) return undefined;
  if (galleryNpc.value === PLAYER_ID) {
    const raw = playerArchiveRaw.value;
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
  }
  if (!Array.isArray(relationships.value)) return undefined;
  const npc = relationships.value.find((n) => n['名称'] === galleryNpc.value);
  return npc?.['图片档案'] as Record<string, unknown> | undefined;
}

function isCurrentAvatar(assetId: string): boolean {
  return getCurrentArchive()?.['已选头像图片ID'] === assetId;
}

function isCurrentPortrait(assetId: string): boolean {
  return getCurrentArchive()?.['已选立绘图片ID'] === assetId;
}

function isCurrentBackground(assetId: string): boolean {
  return getCurrentArchive()?.['已选背景图片ID'] === assetId;
}

function setAsAvatar(assetId: string) {
  if (!imageService || !galleryNpc.value) return;
  imageService.setNpcAvatar(galleryNpc.value, assetId);
}

function setAsPortrait(assetId: string) {
  if (!imageService || !galleryNpc.value) return;
  imageService.setNpcPortrait(galleryNpc.value, assetId);
}

function clearAvatar() {
  if (!imageService || !galleryNpc.value) return;
  imageService.clearNpcAvatar(galleryNpc.value);
}

function clearPortrait() {
  if (!imageService || !galleryNpc.value) return;
  imageService.clearNpcPortrait(galleryNpc.value);
}

function setAsBackground(assetId: string) {
  if (!imageService || !galleryNpc.value) return;
  imageService.setNpcBackground(galleryNpc.value, assetId);
}

function clearBackground() {
  if (!imageService || !galleryNpc.value) return;
  imageService.clearNpcBackground(galleryNpc.value);
}

function setPersistentWallpaper(assetId: string) {
  if (!imageService) return;
  imageService.state.setPersistentWallpaper(assetId);
  eventBus.emit('ui:toast', { type: 'success', message: '已设为常驻壁纸', duration: 1500 });
}

function clearPersistentWallpaper() {
  if (!imageService) return;
  imageService.state.clearPersistentWallpaper();
  eventBus.emit('ui:toast', { type: 'info', message: '常驻壁纸已清除', duration: 1500 });
}

const persistentWallpaperRaw = useValue<string>('系统.扩展.image.persistentWallpaper');
const persistentWallpaper = computed(() => persistentWallpaperRaw.value ?? '');

function isPersistentWallpaper(assetId: string): boolean {
  const pw = persistentWallpaper.value;
  return Boolean(pw && pw === assetId);
}

// Selection button eligibility.
//
// Previously gated on composition (portrait → avatar only; half-body/full-length
// → portrait only). That blocked the "generate 同款 then swap avatar" flow:
// when the regen uses a different composition (or composition wasn't recorded
// on the original), the new image had no button, and the currently-set card's
// cancel button also disappeared because its composition didn't match the new
// gate. We now accept any complete non-secret image — secret-part images are
// still excluded because they're close-ups and make poor avatars.
//
// The composition field stays on the record for display/badging; it just no
// longer blocks the selection actions.
function canSelectAvatar(img: GalleryImage): boolean {
  return img.status === 'complete' && img.composition !== 'secret_part';
}

function canSelectPortrait(img: GalleryImage): boolean {
  return img.status === 'complete' && img.composition !== 'secret_part';
}

function canSelectBackground(img: GalleryImage): boolean {
  return img.status === 'complete';
}

function deleteImage(assetId: string) {
  if (!galleryNpc.value || !imageService) return;
  imageService.deleteNpcImage(galleryNpc.value, assetId);
}

function deleteNpcHistoryEntry(npcName: string, imageId: string) {
  if (!imageService) return;
  imageService.deleteNpcImage(npcName, imageId);
}

function clearNpcImages() {
  if (!galleryNpc.value || !imageService) return;
  imageService.clearNpcHistory(galleryNpc.value);
  eventBus.emit('ui:toast', { type: 'info', message: `${galleryNpc.value} 的图片记录已清空`, duration: 1500 });
}
</script>

<template>
  <div class="image-panel">
    <header class="panel-header">
      <h2 class="panel-title">图像工作台</h2>
    </header>

    <div v-if="!enabled" class="panel-notice">
      <p>图像生成功能未启用。请在<strong>设置</strong>面板底部开启「图像生成」。</p>
      <p style="margin-top:8px;font-size:var(--font-size-xs);color:var(--color-text-muted)">
        开启后请在 <strong>API</strong> 面板添加一个「图像生成」类别的 API 配置。
      </p>
    </div>

    <template v-else-if="isLoaded">
      <AgaTabBar :tabs="tabs" v-model="activeTab" />

      <!-- Stats bar -->
      <div class="stats-bar">
        <div class="stat-card"><span class="stat-value">{{ totalImages }}</span><span class="stat-label">影像总数</span></div>
        <div class="stat-card stat-card--success"><span class="stat-value">{{ successCount }}</span><span class="stat-label">成功</span></div>
        <div class="stat-card stat-card--danger"><span class="stat-value">{{ failedCount }}</span><span class="stat-label">失败</span></div>
        <div class="stat-card stat-card--info"><span class="stat-value">{{ pendingCount }}</span><span class="stat-label">进行中</span></div>
        <div v-if="successCount + failedCount > 0" class="stat-card stat-card--bar">
          <AgaProgressBar
            :value="successCount"
            :max="successCount + failedCount"
            label="成功率"
            :show-value="true"
            variant="success"
          />
        </div>
      </div>

      <!-- ═══ Manual Generation Tab ═══ -->
      <div v-if="activeTab === 'manual'" class="tab-content">
        <div class="gen-layout">
          <!-- Left: NPC info + form -->
          <div class="gen-form-col">
            <div class="form-section">
              <label class="form-label">选择角色</label>
              <AgaSelect :options="npcOptions" v-model="selectedNpc" placeholder="选择一个 NPC…" />
            </div>

            <!-- NPC summary card -->
            <div v-if="selectedNpcData" class="npc-summary-card">
              <div class="npc-summary-name">{{ selectedNpcData['名称'] }}</div>
              <div class="npc-summary-meta">
                <span v-if="selectedNpcData['性别']">{{ selectedNpcData['性别'] }}</span>
                <span v-if="selectedNpcData['年龄']">{{ selectedNpcData['年龄'] }}岁</span>
                <span v-if="selectedNpcData['是否主要角色']" class="badge-major">主要角色</span>
              </div>
              <p v-if="selectedNpcData['描述']" class="npc-summary-desc">{{ String(selectedNpcData['描述']).slice(0, 120) }}</p>
            </div>

            <!-- Anchor status banner -->
            <div v-if="selectedNpc" :class="[
              'anchor-banner',
              selectedNpcAnchor?.enabled ? 'anchor-banner--active' :
              selectedNpcAnchor ? 'anchor-banner--inactive' : 'anchor-banner--none'
            ]">
              <template v-if="selectedNpcAnchor?.enabled">该角色锚点已启用，手动生图会自动附加：{{ selectedNpcAnchor.name }}</template>
              <template v-else-if="selectedNpcAnchor">该角色锚点已停用</template>
              <template v-else>该角色未绑定角色锚点，手动生图将只使用常规提示词。</template>
            </div>

            <div class="form-section">
              <label class="form-label">构图预设</label>
              <div class="btn-grid btn-grid--4">
                <button
                  v-for="opt in compositionOptions"
                  :key="opt.value"
                  type="button"
                  :class="['grid-btn', { 'grid-btn--active': composition === opt.value }]"
                  @click="composition = opt.value"
                >
                  <div class="grid-btn__label">{{ opt.label }}</div>
                  <div class="grid-btn__sub">{{ opt.subtitle }}</div>
                </button>
              </div>
              <div v-if="isCustomComposition" class="form-section" style="margin-top: 8px;">
                <div class="form-hint">自定义构图说明</div>
                <input
                  v-model="customComposition"
                  type="text"
                  class="form-input"
                  placeholder="例如：45度侧脸半身、古风战斗姿势、低机位仰拍"
                />
              </div>
            </div>

            <div class="form-section">
              <label class="form-label">画风选择</label>
              <div class="btn-grid btn-grid--5">
                <button
                  v-for="opt in styleOptions"
                  :key="opt.value"
                  type="button"
                  :class="['grid-btn grid-btn--compact', { 'grid-btn--active': artStyle === opt.value }]"
                  @click="artStyle = opt.value"
                >
                  <div class="grid-btn__label">{{ opt.label }}</div>
                </button>
              </div>
            </div>

            <div class="form-section">
              <label class="form-label">后端</label>
              <AgaSelect :options="backendOptions" v-model="backend" />
            </div>

            <div class="form-section">
              <label class="form-label">分辨率 / 比例</label>
              <div class="btn-grid btn-grid--6">
                <button
                  v-for="opt in sizePresetOptions"
                  :key="opt.value"
                  type="button"
                  :class="['grid-btn grid-btn--compact', { 'grid-btn--active': sizePreset === opt.value }, { 'grid-btn--disabled': !isCustomComposition }]"
                  :disabled="!isCustomComposition"
                  @click="sizePreset = opt.value"
                >
                  <div class="grid-btn__label">{{ opt.label }}</div>
                </button>
              </div>

              <!-- 1x/2x 倍率 toggle (only for preset ratios, not 'none' or 'custom') -->
              <div v-if="isCustomComposition && sizePreset !== 'custom' && sizePreset !== 'none'" class="scale-toggle">
                <span class="form-hint">倍率</span>
                <button
                  v-for="s in (['1x', '2x'] as const)"
                  :key="s"
                  type="button"
                  :class="['scale-btn', { 'scale-btn--active': sizeScale === s }]"
                  @click="sizeScale = s"
                >{{ s.toUpperCase() }}</button>
              </div>

              <!-- Width / Height inputs -->
              <div class="size-inputs">
                <div class="size-input-group">
                  <div class="form-hint">宽 (px)</div>
                  <input
                    v-model="manualWidth"
                    type="text"
                    class="form-input"
                    :disabled="!isCustomComposition || sizePreset !== 'custom'"
                    :placeholder="presetSize ? String(presetSize.w) : '1024'"
                    @input="sizePreset = 'custom'"
                  />
                </div>
                <div class="size-input-group">
                  <div class="form-hint">高 (px)</div>
                  <input
                    v-model="manualHeight"
                    type="text"
                    class="form-input"
                    :disabled="!isCustomComposition || sizePreset !== 'custom'"
                    :placeholder="presetSize ? String(presetSize.h) : '1024'"
                    @input="sizePreset = 'custom'"
                  />
                </div>
              </div>

              <div class="form-hint">当前尺寸：{{ currentSizeDisplay }}</div>
              <div v-if="!isCustomComposition" class="form-hint">内置构图已包含推荐尺寸，选择自定义构图后可启用。</div>
            </div>

            <div class="form-section">
              <label class="form-label">画师串预设</label>
              <AgaSelect
                :options="[{ label: '未配置预设', value: '' }, ...npcArtistPresets.map(p => ({ label: p.name, value: p.id }))]"
                v-model="selectedArtistPreset"
              />
              <div v-if="selectedArtistPreset && artistPresets.find(p => p.id === selectedArtistPreset)" class="preset-preview">
                <span class="form-hint">{{ artistPresets.find(p => p.id === selectedArtistPreset)?.artistString?.slice(0, 80) || '(空)' }}</span>
              </div>
            </div>

            <div class="form-section">
              <label class="form-label">PNG 画风预设</label>
              <AgaSelect
                :options="pngPresetOptions"
                v-model="selectedPngPreset"
              />
              <div v-if="selectedPngPreset && artistPresets.find(p => p.id === selectedPngPreset)" class="preset-preview">
                <span class="form-hint">{{ artistPresets.find(p => p.id === selectedPngPreset)?.positive?.slice(0, 80) || '(空)' }}</span>
              </div>
            </div>

            <div class="form-section">
              <label class="form-label">额外要求</label>
              <textarea v-model="extraPrompt" class="form-textarea" rows="2" placeholder="如：白衣飘飘、御剑横空、月下独立…" />
            </div>

            <div class="form-section form-section--inline">
              <label class="form-label">后台处理</label>
              <AgaToggle v-model="backgroundMode" />
            </div>

            <div class="form-actions">
              <AgaButton
                variant="primary"
                size="lg"
                :loading="isGenerating"
                :disabled="!selectedNpc || manualFlowStage === 'submitting'"
                @click="handleGenerate"
              >
                {{ isGenerating ? '生成中…' : backgroundMode ? '加入队列' : `立即生成${compositionOptions.find(o => o.value === composition)?.label ?? ''}` }}
              </AgaButton>
              <div v-if="manualStatusText && manualFlowStage === 'idle'" class="status-text">{{ manualStatusText }}</div>
            </div>

            <!-- Per-NPC task status (MRJH §A: 最近状态 + active task display) -->
            <div v-if="selectedNpcActiveTask" class="npc-task-status npc-task-status--active">
              <div class="task-status-header">
                <span :class="['task-status-badge', `task-status-badge--${taskStatusVariant(selectedNpcActiveTask.status)}`]">
                  {{ taskStatusLabel(selectedNpcActiveTask.status) }}
                </span>
                <span class="task-status-time">{{ new Date(selectedNpcActiveTask.updatedAt).toLocaleTimeString() }}</span>
              </div>
              <div class="task-status-progress">任务正在处理中…</div>
            </div>
            <div v-else-if="selectedNpcLastResult" :class="['npc-task-status', `npc-task-status--${selectedNpcLastResult.status}`]">
              <div class="task-status-header">
                <span :class="['task-status-badge', `task-status-badge--${taskStatusVariant(selectedNpcLastResult.status)}`]">
                  {{ taskStatusLabel(selectedNpcLastResult.status) }}
                </span>
                <span class="task-status-time">{{ new Date(selectedNpcLastResult.updatedAt).toLocaleTimeString() }}</span>
              </div>
              <div v-if="selectedNpcLastResult.error" class="task-status-error">{{ selectedNpcLastResult.error }}</div>
            </div>

            <div class="gen-nav-buttons">
              <AgaButton variant="ghost" size="sm" @click="activeTab = 'queue'">查看队列</AgaButton>
              <AgaButton variant="ghost" size="sm" @click="activeTab = 'gallery'">查看图库</AgaButton>
            </div>

            <div v-if="errorMsg" class="gen-error">{{ errorMsg }}</div>

            <!-- Secret part generation (NSFW gated, non-male NPC) -->
            <div
              v-if="selectedNpcData && !(selectedNpcData['性别'] && String(selectedNpcData['性别']).includes('男')) && get('系统.nsfwMode') === true"
              class="secret-section"
            >
              <div class="secret-header-row">
                <div>
                  <h4 class="secret-title">私密部位特写</h4>
                  <p class="secret-desc">为当前角色生成私密部位特写图片。</p>
                </div>
                <button
                  type="button"
                  class="secret-all-btn"
                  :disabled="!!secretBusy"
                  @click="generateAllSecretParts"
                >{{ secretBusy === 'all' ? '生成中...' : '全部生成' }}</button>
              </div>

              <!-- Independent config: style + resolution -->
              <div class="secret-config-grid">
                <div class="form-section">
                  <label class="form-label">画风选择</label>
                  <div class="btn-grid btn-grid--5">
                    <button v-for="opt in styleOptions" :key="opt.value" type="button"
                      :class="['grid-btn grid-btn--compact grid-btn--fuchsia', { 'grid-btn--fuchsia-active': secretStyle === opt.value }]"
                      @click="secretStyle = opt.value"
                    ><div class="grid-btn__label">{{ opt.label }}</div></button>
                  </div>
                </div>
                <div class="form-section">
                  <label class="form-label">分辨率 / 比例</label>
                  <div class="btn-grid btn-grid--6">
                    <button v-for="opt in sizePresetOptions" :key="opt.value" type="button"
                      :class="['grid-btn grid-btn--compact grid-btn--fuchsia', { 'grid-btn--fuchsia-active': secretSizePreset === opt.value }]"
                      @click="secretSizePreset = opt.value"
                    ><div class="grid-btn__label">{{ opt.label }}</div></button>
                  </div>
                </div>
              </div>

              <!-- Presets + extra -->
              <div class="secret-config-grid">
                <div class="form-section">
                  <label class="form-label">画师串预设</label>
                  <AgaSelect :options="[{ label: '未配置预设', value: '' }, ...npcArtistPresets.map(p => ({ label: p.name, value: p.id }))]" v-model="secretArtistPreset" />
                </div>
                <div class="form-section">
                  <label class="form-label">PNG 画风预设</label>
                  <AgaSelect :options="pngPresetOptions" v-model="secretPngPreset" />
                </div>
                <div class="form-section">
                  <label class="form-label">额外要求</label>
                  <textarea v-model="secretExtraPrompt" class="form-textarea form-textarea--fuchsia" rows="2" placeholder="如：近景柔光、细节清晰、细腻写实..." />
                </div>
              </div>

              <div v-if="secretStatusText" class="secret-status">{{ secretStatusText }}</div>

              <!-- 3 body part cards — each card shows the latest secret-part
                   image for that body part from the NPC archive (香闺秘档). -->
              <div class="secret-cards">
                <div v-for="part in secretParts" :key="part.key" class="secret-card">
                  <div class="secret-card-header">
                    <span class="secret-card-label">{{ part.label }}</span>
                    <button type="button" class="secret-card-btn" :disabled="!!secretBusy" @click="generateSecretPart(part.key)">
                      {{ secretBusy === part.key ? '生成中...' : '生成' }}
                    </button>
                  </div>
                  <div
                    class="secret-card-image"
                    :class="{ 'secret-card-image--has-img': getSecretPartAssetId(part.key) }"
                    @click="getSecretPartAssetId(part.key) && openViewer(getSecretPartAssetId(part.key)!)"
                  >
                    <template v-if="getSecretPartAssetId(part.key)">
                      <ImageDisplay
                        :asset-id="getSecretPartAssetId(part.key)!"
                        :fallback-letter="part.label.charAt(0)"
                        size="lg"
                        class="secret-card-img"
                      />
                    </template>
                    <div v-else class="secret-card-placeholder">暂无图片</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Legacy preview column removed — preview lives in NPC 预览面板 below -->
        </div>

        <!-- NPC 预览面板（全宽，图片+角色资料） -->
        <div v-if="selectedNpcData" class="npc-preview-panel">
          <div class="npc-preview-image-col">
            <div class="npc-preview-header">
              <span class="npc-preview-title">图片预览</span>
              <button v-if="lastTask?.resultAssetId" type="button" class="npc-preview-link" @click="activeTab = 'gallery'">查看图库</button>
            </div>
            <div class="npc-preview-image-area">
              <div v-if="lastTask?.resultAssetId" class="npc-preview-image-wrap" @click="openViewer(lastTask.resultAssetId!)">
                <!-- `fill` variant expands to the container — previously `lg`
                     forced an 80×80 square that looked tiny in the panel. -->
                <ImageDisplay :asset-id="lastTask.resultAssetId" fallback-letter="?" size="fill" />
              </div>
              <div v-else class="npc-preview-empty">
                <div class="npc-preview-empty-icon">☯</div>
                <div>暂无可预览图片</div>
              </div>
            </div>
          </div>
          <div class="npc-preview-data-col">
            <div class="npc-preview-header">
              <span class="npc-preview-title">角色资料</span>
            </div>
            <div class="npc-preview-data">
              <!--
                角色资料 grid — 增量接口说明：
                后续对标 MRJH SocialModal 时，此区域应扩展显示：
                - 境界/身份（如 pack schema 支持）
                - 外貌特征 grid（外貌/身材/衣着/生日/称呼）
                - 共同记忆时间线
                - 关系驱动面板（核心性格、突破条件、女性关系网）
                当前保持基础信息 + 全文描述，预留结构。
              -->
              <div class="npc-preview-grid">
                <div><div class="npc-meta-label">姓名</div><div class="npc-meta-value">{{ selectedNpcData['名称'] ?? '未知' }}</div></div>
                <div><div class="npc-meta-label">性别</div><div class="npc-meta-value">{{ selectedNpcData['性别'] ?? '未知' }}</div></div>
                <div v-if="selectedNpcData['年龄']"><div class="npc-meta-label">年龄</div><div class="npc-meta-value">{{ selectedNpcData['年龄'] }}岁</div></div>
                <div v-if="selectedNpcData['与玩家关系']"><div class="npc-meta-label">与玩家关系</div><div class="npc-meta-value">{{ selectedNpcData['与玩家关系'] }}</div></div>
                <div v-if="selectedNpcData['位置']"><div class="npc-meta-label">当前位置</div><div class="npc-meta-value">{{ selectedNpcData['位置'] }}</div></div>
                <div v-if="selectedNpcData['类型']"><div class="npc-meta-label">角色类型</div><div class="npc-meta-value">{{ selectedNpcData['类型'] }}</div></div>
              </div>
              <div class="npc-preview-desc-section">
                <div class="npc-meta-label">角色设定</div>
                <div class="npc-preview-desc">{{ selectedNpcData['描述'] || selectedNpcData['外貌描述'] || '未找到角色资料' }}</div>
              </div>
              <div v-if="selectedNpcData['外貌描述'] && selectedNpcData['描述']" class="npc-preview-desc-section">
                <div class="npc-meta-label">外貌描述</div>
                <div class="npc-preview-desc">{{ selectedNpcData['外貌描述'] }}</div>
              </div>
              <div v-if="selectedNpcData['身材描写']" class="npc-preview-desc-section">
                <div class="npc-meta-label">身材描写</div>
                <div class="npc-preview-desc">{{ selectedNpcData['身材描写'] }}</div>
              </div>
              <div v-if="selectedNpcData['衣着风格']" class="npc-preview-desc-section">
                <div class="npc-meta-label">衣着风格</div>
                <div class="npc-preview-desc">{{ selectedNpcData['衣着风格'] }}</div>
              </div>
              <div v-if="Array.isArray(selectedNpcData['性格特征']) && (selectedNpcData['性格特征'] as string[]).length" class="npc-preview-desc-section">
                <div class="npc-meta-label">性格特征</div>
                <div class="npc-preview-traits">
                  <span v-for="trait in (selectedNpcData['性格特征'] as string[])" :key="trait" class="npc-preview-trait">{{ trait }}</span>
                </div>
              </div>
              <div v-if="selectedNpcData['背景']" class="npc-preview-desc-section">
                <div class="npc-meta-label">背景</div>
                <div class="npc-preview-desc">{{ selectedNpcData['背景'] }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Gallery Tab ═══ -->
      <div v-if="activeTab === 'gallery'" class="tab-content">
        <div class="gallery-layout">
          <!-- Left: NPC list -->
          <div class="gallery-npc-list">
            <button
              v-for="npc in npcsWithImages"
              :key="String(npc['名称'])"
              :class="['gallery-npc-btn', { 'gallery-npc-btn--active': galleryNpc === String(npc['名称']) }]"
              @click="galleryNpc = String(npc['名称'])"
            >
              <span class="gallery-npc-name">{{ String(npc['名称']) === '__player__' ? (playerName ?? '主角') : npc['名称'] }}</span>
              <span class="gallery-npc-count">{{ getArchiveHistory(npc).length }}</span>
            </button>
            <div v-if="npcsWithImages.length === 0" class="gallery-empty-list">
              <p>还没有生成过图片</p>
              <AgaButton variant="secondary" size="sm" @click="activeTab = 'manual'">去生成</AgaButton>
            </div>
          </div>

          <!-- Right: Image grid -->
          <div class="gallery-grid-area">
            <div v-if="galleryNpc" class="gallery-header">
              <div class="gallery-header-left">
                <h3>{{ galleryNpc }}</h3>
                <div class="gallery-header-badges">
                  <span class="gallery-info-badge">{{ galleryNpcData?.['性别'] || '未知性别' }}</span>
                  <span class="gallery-info-badge">{{ galleryNpcData?.['是否主要角色'] ? '主要角色' : '普通角色' }}</span>
                  <span class="gallery-info-badge gallery-info-badge--count">共 {{ galleryImages.length }} 张图片</span>
                </div>
              </div>
              <div class="gallery-header-actions">
                <AgaButton variant="ghost" size="sm" @click="selectedNpc = galleryNpc; activeTab = 'manual'">去生成图片</AgaButton>
                <AgaButton v-if="galleryImages.length > 0" variant="danger" size="sm" @click="clearNpcImages()">清空记录</AgaButton>
              </div>
            </div>

            <div v-if="galleryImages.length > 0" class="gallery-grid">
              <div v-for="img in galleryImages" :key="img.id" class="gallery-card">
                <div class="gallery-card-image" @click="openViewer(img.id)" style="cursor:pointer" title="点击查看大图">
                  <ImageDisplay :asset-id="img.id" :fallback-letter="galleryNpc?.charAt(0) ?? '?'" size="lg" />
                  <!-- Overlay badges: status + usage (stacked, top-left) -->
                  <div class="gallery-overlay-badges">
                    <span :class="['gallery-status-badge', `gallery-status-badge--${img.status ?? 'complete'}`]">
                      {{ img.status === 'failed' ? '失败' : img.status === 'generating' || img.status === 'tokenizing' ? '生成中' : img.status === 'pending' ? '排队中' : '成功' }}
                    </span>
                    <span v-if="isCurrentAvatar(img.id)" class="gallery-usage-badge">已设头像</span>
                    <span v-if="isCurrentPortrait(img.id)" class="gallery-usage-badge">已设立绘</span>
                    <span v-if="isCurrentBackground(img.id)" class="gallery-usage-badge">已设背景</span>
                    <span v-if="currentWallpaperId === img.id" class="gallery-usage-badge">常驻壁纸</span>
                  </div>
                </div>
                <div class="gallery-card-meta">
                  <div class="gallery-meta-top">
                    <span class="gallery-meta-comp">{{ img.composition || '角色' }}</span>
                    <span class="gallery-meta-time">{{ new Date(img.createdAt).toLocaleString() }}</span>
                  </div>
                  <div class="gallery-meta-grid">
                    <div class="gallery-meta-cell" :title="modelCellText(img)">
                      <div class="gallery-meta-label">使用模型</div>
                      <div class="gallery-meta-value">{{ modelCellText(img) }}</div>
                    </div>
                    <div class="gallery-meta-cell" :title="img.artStyle || '未记录'">
                      <div class="gallery-meta-label">画风</div>
                      <div class="gallery-meta-value">{{ img.artStyle || '未记录' }}</div>
                    </div>
                  </div>
                  <div v-if="img.positivePrompt || img.negativePrompt" class="gallery-card-prompts">
                    <details v-if="img.positivePrompt" class="prompt-details">
                      <summary>最终正向提示词</summary>
                      <pre class="prompt-text">{{ img.positivePrompt }}</pre>
                    </details>
                    <details v-if="img.negativePrompt" class="prompt-details">
                      <summary>最终负面提示词</summary>
                      <pre class="prompt-text">{{ img.negativePrompt }}</pre>
                    </details>
                  </div>
                </div>
                <div class="gallery-card-actions">
                  <!-- Row 1: selection actions.
                       Cancel buttons are gated only on "is current selection"
                       so the user can always un-bind the current avatar/立绘/
                       background regardless of its composition. Set buttons
                       defer to canSelect*() but are now composition-lax so a
                       同款 regen with any composition can be bound directly. -->
                  <div class="gallery-actions-row">
                    <AgaButton
                      v-if="canSelectAvatar(img) && !isCurrentAvatar(img.id)"
                      variant="secondary" size="sm"
                      @click="setAsAvatar(img.id)"
                    >设为头像</AgaButton>
                    <AgaButton
                      v-if="isCurrentAvatar(img.id)"
                      variant="ghost" size="sm"
                      @click="clearAvatar()"
                    >取消设置头像</AgaButton>
                    <AgaButton
                      v-if="canSelectPortrait(img) && !isCurrentPortrait(img.id)"
                      variant="secondary" size="sm"
                      @click="setAsPortrait(img.id)"
                    >设为立绘</AgaButton>
                    <AgaButton
                      v-if="isCurrentPortrait(img.id)"
                      variant="ghost" size="sm"
                      @click="clearPortrait()"
                    >取消设置立绘</AgaButton>
                    <AgaButton
                      v-if="canSelectBackground(img) && !isCurrentBackground(img.id)"
                      variant="secondary" size="sm"
                      @click="setAsBackground(img.id)"
                    >设为背景</AgaButton>
                    <AgaButton
                      v-if="isCurrentBackground(img.id)"
                      variant="ghost" size="sm"
                      @click="clearBackground()"
                    >取消背景</AgaButton>
                  </div>
                  <!-- Row 2: utility actions -->
                  <div class="gallery-actions-row">
                    <AgaButton
                      v-if="img.positivePrompt"
                      variant="secondary" size="sm"
                      @click="openRegenerateFromGalleryImage(galleryNpc, img)"
                    >生成同款</AgaButton>
                    <AgaButton
                      v-if="img.status === 'complete' && !isPersistentWallpaper(img.id)"
                      variant="ghost" size="sm"
                      @click="setPersistentWallpaper(img.id)"
                    >设为常驻壁纸</AgaButton>
                    <AgaButton
                      v-if="img.status === 'complete' && isPersistentWallpaper(img.id)"
                      variant="ghost" size="sm"
                      @click="clearPersistentWallpaper()"
                    >取消常驻壁纸</AgaButton>
                    <AgaButton variant="ghost" size="sm" @click="saveToLocal(img.id)">保存到本地</AgaButton>
                    <AgaButton variant="danger" size="sm" @click="requestDelete(img.id)">删除图片</AgaButton>
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="galleryNpc" class="tab-placeholder">
              <p>{{ galleryNpc }} 还没有图片</p>
              <AgaButton variant="secondary" size="sm" @click="selectedNpc = galleryNpc; activeTab = 'manual'">去生成</AgaButton>
            </div>

            <div v-else class="tab-placeholder">
              <p>← 选择一个角色查看图库</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Scene Tab ═══ -->
      <div v-if="activeTab === 'scene'" class="tab-content">
        <div class="scene-layout-v2">
          <!-- Left column: wallpaper + stats + controls -->
          <div class="scene-left-col">
            <!-- Current wallpaper -->
            <div class="scene-section">
              <h3 class="section-label">当前场景壁纸</h3>
              <div v-if="currentSceneWallpaperId" class="wallpaper-card" @click="openViewer(currentSceneWallpaperId)" title="点击查看大图">
                <ImageDisplay :asset-id="currentSceneWallpaperId" fallback-letter="S" size="lg" />
                <span class="wallpaper-badge">当前使用中</span>
              </div>
              <div v-else class="wallpaper-placeholder">
                <p>暂无场景壁纸</p>
                <p class="form-hint">当前尚未指定任何场景壁纸</p>
              </div>
            </div>

            <!-- Scene stats (MRJH: 6 stat cards) -->
            <div class="scene-section">
              <h3 class="section-label">场景生成统计</h3>
              <div class="scene-stats-grid">
                <div class="stat-card"><span class="stat-value">{{ sceneStats.total }}</span><span class="stat-label">图片总数</span></div>
                <div class="stat-card stat-card--success"><span class="stat-value">{{ sceneStats.success }}</span><span class="stat-label">成功</span></div>
                <div class="stat-card stat-card--danger"><span class="stat-value">{{ sceneStats.failed }}</span><span class="stat-label">失败</span></div>
                <div class="stat-card stat-card--warning"><span class="stat-value">{{ sceneStats.pending }}</span><span class="stat-label">生成中</span></div>
                <div class="stat-card stat-card--info"><span class="stat-value">{{ sceneStats.queueTotal }}</span><span class="stat-label">队列总数</span></div>
                <div class="stat-card stat-card--info"><span class="stat-value">{{ sceneStats.queueRunning }}</span><span class="stat-label">运行中</span></div>
              </div>
            </div>

            <!-- Scene history limit -->
            <div class="scene-section">
              <h3 class="section-label">场景历史数量限制</h3>
              <p class="form-hint">当前 {{ sceneStats.total }} / {{ sceneArchiveLimit }}，超限时自动删除最旧场景图。</p>
              <div class="scene-limit-row">
                <input v-model="sceneArchiveLimitDraft" type="number" min="1" max="100" class="form-input scene-limit-input" />
                <AgaButton variant="secondary" size="sm" @click="saveSceneArchiveLimit">应用上限</AgaButton>
              </div>
            </div>

            <!-- Scene composition requirement -->
            <div class="scene-section">
              <label class="form-label">场景构图要求</label>
              <div class="btn-grid btn-grid--2">
                <button
                  v-for="mode in (['snapshot', 'landscape'] as const)"
                  :key="mode"
                  type="button"
                  :class="['grid-btn grid-btn--compact', { 'grid-btn--active': sceneComposition === mode }]"
                  @click="sceneComposition = mode"
                >
                  <div class="grid-btn__label">{{ mode === 'snapshot' ? '故事快照' : '纯场景' }}</div>
                </button>
              </div>
              <p class="form-hint">选择场景画面是纯景观还是带人物互动的故事快照。</p>
            </div>

            <!-- Orientation -->
            <div class="scene-section">
              <label class="form-label">画面方向</label>
              <div class="btn-grid btn-grid--2">
                <button
                  v-for="ori in (['landscape', 'portrait'] as const)"
                  :key="ori"
                  type="button"
                  :class="['grid-btn grid-btn--compact', { 'grid-btn--active': sceneOrientation === ori }]"
                  @click="sceneOrientation = ori"
                >
                  <div class="grid-btn__label">{{ ori === 'landscape' ? '横屏' : '竖屏' }}</div>
                </button>
              </div>
            </div>

            <!-- Resolution -->
            <div class="scene-section">
              <label class="form-label">分辨率 / 比例</label>
              <AgaSelect
                :options="sceneResolutionOptions"
                v-model="sceneResolution"
              />
              <input v-model="sceneResolution" type="text" class="form-input" style="margin-top:var(--space-2xs)" placeholder="自定义分辨率，如 1280x720" />
              <p class="form-hint">当前分辨率：{{ sceneResolution || '未选择' }}</p>
            </div>

            <!-- Extra requirements -->
            <div class="scene-section">
              <label class="form-label">额外要求</label>
              <textarea v-model="sceneExtraPrompt" class="form-textarea" rows="3" placeholder="如：夜雨江湖、远景俯瞰、人物剪影..." />
            </div>

            <!-- Artist preset -->
            <div class="scene-section">
              <label class="form-label">场景画师串预设</label>
              <AgaSelect
                :options="[{ label: sceneScopedPresets.length > 0 ? '不使用' : '未配置预设', value: '' }, ...sceneScopedPresets.map(p => ({ label: p.name, value: p.id }))]"
                v-model="selectedScenePreset"
              />
            </div>

            <!-- PNG preset -->
            <div class="scene-section">
              <label class="form-label">场景PNG画风预设</label>
              <AgaSelect
                :options="[{ label: '不启用', value: '' }, ...scenePngPresets.map(p => ({ label: p.name, value: p.id }))]"
                v-model="selectedScenePngPreset"
              />
            </div>

            <!-- Background mode toggle -->
            <div class="scene-section form-section--inline">
              <label class="form-label">后台处理</label>
              <AgaToggle v-model="backgroundMode" />
              <p class="form-hint">开启后，场景生成会直接进入后台队列。</p>
            </div>

            <!-- Status text -->
            <div v-if="sceneStatusText" class="scene-status-text">{{ sceneStatusText }}</div>

            <!-- Generate + clear buttons -->
            <div class="scene-form-actions">
              <AgaButton variant="primary" :loading="sceneGenerating" @click="generateScene">
                {{ sceneGenerating ? '生成中…' : '按当前正文生成' }}
              </AgaButton>
              <AgaButton variant="danger" size="sm" @click="clearSceneHistory">清空历史</AgaButton>
            </div>

            <div v-if="sceneError" class="gen-error">{{ sceneError }}</div>
          </div>

          <!-- Right column: queue + history -->
          <div class="scene-right-col">
            <!-- Scene queue (max 30%) -->
            <div v-if="sceneQueueTasks.length > 0" class="scene-queue-section">
              <div class="scene-queue-header">
                <h3 class="section-label">场景队列</h3>
                <div class="scene-queue-actions">
                  <AgaButton variant="ghost" size="sm" @click="clearSceneQueueCompleted">清空已完成</AgaButton>
                  <AgaButton variant="danger" size="sm" @click="clearSceneQueueAll">清空全部</AgaButton>
                </div>
              </div>
              <div class="scene-queue-list">
                <div v-for="task in sceneQueueTasks" :key="task.id" class="scene-queue-card">
                  <div class="scene-queue-card-top">
                    <span class="scene-queue-summary">{{ task.positivePrompt?.slice(0, 40) || '场景生成' }}</span>
                    <span :class="['task-badge', `task-badge--${task.status}`]">{{ taskStatusLabel(task.status) }}</span>
                  </div>
                  <div class="scene-queue-card-meta">{{ new Date(task.createdAt).toLocaleString() }}</div>
                </div>
              </div>
            </div>

            <!-- Scene history -->
            <div class="scene-history-section">
              <div class="scene-history-header">
                <h3 class="section-label">场景历史</h3>
                <span class="scene-history-count">{{ sceneArchiveHistory.length }} 条记录</span>
              </div>
              <div v-if="sceneArchiveHistory.length > 0" class="scene-history-grid">
                <div
                  v-for="record in sceneArchiveHistory"
                  :key="String(record.id ?? record.createdAt)"
                  class="scene-history-card"
                >
                  <div class="scene-history-card-image" @click="openViewer(String(record.id ?? ''))" style="cursor:pointer" title="点击查看大图">
                    <ImageDisplay :asset-id="String(record.id ?? '')" fallback-letter="S" size="lg" />
                    <div class="gallery-overlay-badges">
                      <span :class="['gallery-status-badge', `gallery-status-badge--${record.status ?? 'complete'}`]">
                        {{ record.status === 'failed' ? '失败' : '成功' }}
                      </span>
                      <span v-if="isCurrentSceneWallpaper(String(record.id ?? ''))" class="gallery-usage-badge">当前壁纸</span>
                    </div>
                  </div>
                  <div class="scene-history-card-body">
                    <div class="scene-history-card-top">
                      <span class="scene-history-card-time">{{ new Date(Number(record.createdAt) || 0).toLocaleString() }}</span>
                    </div>
                    <!-- Expandable prompts -->
                    <details v-if="record.positivePrompt" class="prompt-details">
                      <summary>最终正向提示词</summary>
                      <pre class="prompt-text">{{ record.positivePrompt }}</pre>
                    </details>
                    <details v-if="record.negativePrompt" class="prompt-details">
                      <summary>最终负面提示词</summary>
                      <pre class="prompt-text">{{ record.negativePrompt }}</pre>
                    </details>
                    <!-- Action buttons -->
                    <div class="scene-history-card-actions">
                      <AgaButton
                        v-if="record.positivePrompt"
                        variant="secondary" size="sm"
                        @click="openRegenerateFromSceneRecord(record as Record<string, unknown>)"
                      >生成同款</AgaButton>
                      <AgaButton
                        v-if="!isCurrentSceneWallpaper(String(record.id ?? ''))"
                        variant="secondary" size="sm"
                        @click="applySceneWallpaper(String(record.id ?? ''))"
                      >设为壁纸</AgaButton>
                      <AgaButton
                        v-if="isCurrentSceneWallpaper(String(record.id ?? ''))"
                        variant="ghost" size="sm"
                        @click="clearSceneWallpaper()"
                      >取消设置壁纸</AgaButton>
                      <AgaButton
                        v-if="!isPersistentWallpaper(String(record.id ?? ''))"
                        variant="ghost" size="sm"
                        @click="setPersistentWallpaper(String(record.id ?? ''))"
                      >设为常驻壁纸</AgaButton>
                      <AgaButton
                        v-if="isPersistentWallpaper(String(record.id ?? ''))"
                        variant="ghost" size="sm"
                        @click="clearPersistentWallpaper()"
                      >取消常驻壁纸</AgaButton>
                      <AgaButton variant="ghost" size="sm" @click="saveToLocal(String(record.id ?? ''))">保存到本地</AgaButton>
                      <AgaButton variant="danger" size="sm" @click="deleteSceneImage(String(record.id ?? ''))">删除图片</AgaButton>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="tab-placeholder">
                <p>暂无场景历史记录</p>
                <p class="form-hint">请先生成场景图片。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Queue Tab ═══ -->
      <div v-if="activeTab === 'queue'" class="tab-content">
        <div class="queue-header-v2">
          <div>
            <h3 class="section-label">统一生成队列</h3>
            <p class="form-hint">所有角色和场景的生成任务都会显示在这里。</p>
          </div>
          <div class="queue-clear-buttons">
            <AgaButton variant="ghost" size="sm" @click="clearNpcQueueCompleted">清空已完成 NPC 任务</AgaButton>
            <AgaButton variant="danger" size="sm" @click="clearNpcQueueAll">清空全部 NPC 任务</AgaButton>
            <AgaButton variant="ghost" size="sm" @click="clearSceneQueueCompleted">清空已完成场景任务</AgaButton>
            <AgaButton variant="danger" size="sm" @click="clearSceneQueueAll">清空全部场景任务</AgaButton>
          </div>
        </div>

        <div v-if="recentTasks.length === 0" class="tab-placeholder">
          <p>当前没有生成任务</p>
          <p class="form-hint">新的角色或场景生成任务会显示在这里。</p>
        </div>
        <div v-else class="task-list-v2">
          <div v-for="task in recentTasks" :key="task.id" class="queue-card-v2">
            <!-- Type badge (top-right corner) -->
            <span class="queue-type-corner">{{ task.subjectType === 'scene' ? '场景任务' : '角色任务' }}</span>

            <!-- Header: name + status -->
            <div class="queue-card-header">
              <div class="queue-card-title">
                <div class="queue-card-name">{{ task.subjectType === 'scene' ? (task.positivePrompt?.slice(0, 30) || '场景生成') : (task.targetCharacter ?? '角色') }}</div>
                <div class="queue-card-sub">
                  <span v-if="task.subjectType !== 'scene'">{{ task.subjectType === 'character' ? '角色' : task.subjectType }}</span>
                  <span>{{ new Date(task.createdAt).toLocaleString() }}</span>
                </div>
              </div>
              <div class="queue-card-status-area">
                <span :class="['task-badge', `task-badge--${task.status}`]">{{ taskStatusLabel(task.status) }}</span>
                <AgaButton variant="ghost" size="sm" @click="removeTask(task.id)">删除</AgaButton>
              </div>
            </div>

            <!-- 4-card metadata grid -->
            <div class="queue-meta-grid">
              <div class="queue-meta-cell">
                <div class="queue-meta-label">创建时间</div>
                <div class="queue-meta-value">{{ new Date(task.createdAt).toLocaleString() }}</div>
              </div>
              <div class="queue-meta-cell">
                <div class="queue-meta-label">最后更新</div>
                <div class="queue-meta-value">{{ new Date(task.updatedAt).toLocaleString() }}</div>
              </div>
              <div class="queue-meta-cell">
                <div class="queue-meta-label">后端</div>
                <div class="queue-meta-value">{{ task.backend || '未定' }}</div>
              </div>
              <div class="queue-meta-cell queue-meta-cell--progress">
                <div class="queue-meta-label">任务进度 ({{ taskStatusLabel(task.status) }})</div>
                <div class="queue-meta-value">{{ task.error || taskStatusLabel(task.status) }}</div>
              </div>
            </div>

            <!-- Captured prompts (collapsible). Available as soon as the task
                 reaches `generating`; lets the user inspect what was actually
                 sent to the backend and kick off a same-prompt regeneration. -->
            <div v-if="task.positivePrompt || task.negativePrompt" class="queue-card-prompts">
              <details v-if="task.positivePrompt" class="prompt-details">
                <summary>最终正向提示词</summary>
                <pre class="prompt-text">{{ task.positivePrompt }}</pre>
              </details>
              <details v-if="task.negativePrompt" class="prompt-details">
                <summary>最终负面提示词</summary>
                <pre class="prompt-text">{{ task.negativePrompt }}</pre>
              </details>
            </div>

            <!-- Actions row: regenerate-same (only when prompts exist) + retry on failure -->
            <div class="queue-card-actions-row">
              <AgaButton
                v-if="task.positivePrompt"
                variant="secondary" size="sm"
                @click="openRegenerateFromTask(task)"
              >同提示词重新生成</AgaButton>
              <AgaButton
                v-if="task.status === 'failed' && task.subjectType !== 'scene' && task.targetCharacter"
                variant="ghost" size="sm"
                @click="openManualGenerateForRetry(task.targetCharacter!)"
              >手动重试</AgaButton>
              <AgaButton
                v-if="task.status === 'failed'"
                variant="ghost" size="sm"
                @click="retryTask(task)"
              >重试任务</AgaButton>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ History Tab ═══ -->
      <div v-if="activeTab === 'history'" class="tab-content">
        <div class="history-header-v2">
          <div>
            <h3 class="section-label">全部生成历史</h3>
          </div>
          <div class="history-header-actions">
            <AgaSelect :options="historyFilterOptions" v-model="historyFilter" placeholder="筛选" />
            <AgaButton variant="danger" size="sm" @click="clearAllNpcHistory">清空 NPC 历史</AgaButton>
            <AgaButton variant="danger" size="sm" @click="clearAllSceneHistory">清空场景历史</AgaButton>
          </div>
        </div>

        <div v-if="filteredHistory.length > 0" class="history-list-v2">
          <div v-for="entry in filteredHistory" :key="entry.key" class="history-card-v2">
            <!-- Left: image (1/3) -->
            <div
              class="history-card-image-v2"
              :class="entry.type === 'scene' ? 'history-card-image-v2--landscape' : ''"
              @click="openViewer(entry.assetId)"
              style="cursor:pointer"
              title="点击查看大图"
            >
              <ImageDisplay
                :asset-id="entry.assetId"
                :fallback-letter="entry.type === 'scene' ? 'S' : (entry.name?.charAt(0) ?? '?')"
                size="lg"
              />
              <div class="gallery-overlay-badges">
                <span :class="['gallery-status-badge', `gallery-status-badge--${entry.status}`]">
                  {{ entry.status === 'complete' ? '成功' : entry.status === 'failed' ? '失败' : '处理中' }}
                </span>
                <span class="history-type-badge-v2">{{ entry.type === 'scene' ? '场景' : '角色' }}</span>
              </div>
            </div>

            <!-- Right: metadata (2/3) -->
            <div class="history-card-body-v2">
              <div class="history-card-title-row">
                <div>
                  <div class="history-card-name-v2">{{ entry.type === 'scene' ? '场景' : entry.name }}</div>
                  <div class="history-card-sub-v2">
                    <span v-if="entry.composition" class="history-comp-badge">{{ entry.composition }}</span>
                    <span>{{ new Date(entry.timestamp).toLocaleString() }}</span>
                  </div>
                </div>
                <AgaButton v-if="entry.type === 'character'" variant="danger" size="sm" @click="deleteNpcHistoryEntry(entry.name, entry.id)">删除图片</AgaButton>
                <AgaButton v-else variant="danger" size="sm" @click="deleteSceneImage(entry.id)">删除图片</AgaButton>
              </div>

              <!-- Metadata grid -->
              <div class="history-meta-grid-v2">
                <div class="history-meta-cell-v2">
                  <div class="history-meta-label-v2">使用模型</div>
                  <div class="history-meta-value-v2">{{ modelCellText(entry) }}</div>
                </div>
                <div class="history-meta-cell-v2">
                  <div class="history-meta-label-v2">画风偏好</div>
                  <div class="history-meta-value-v2">{{ entry.artStyle || '无' }}</div>
                </div>
                <div v-if="entry.error" class="history-meta-cell-v2 history-meta-cell-v2--error" style="grid-column: span 2">
                  <div class="history-meta-value-v2">{{ entry.error }}</div>
                </div>
              </div>

              <!-- Expandable prompt details -->
              <div class="history-details-v2">
                <details v-if="entry.positivePrompt" class="prompt-details">
                  <summary>最终正向提示词</summary>
                  <pre class="prompt-text">{{ entry.positivePrompt }}</pre>
                </details>
                <details v-if="entry.negativePrompt" class="prompt-details">
                  <summary>最终负面提示词</summary>
                  <pre class="prompt-text">{{ entry.negativePrompt }}</pre>
                </details>
              </div>

              <!-- Action buttons -->
              <div class="history-actions-v2">
                <AgaButton v-if="entry.assetId" variant="ghost" size="sm" @click="openViewer(entry.assetId)">查看大图</AgaButton>
                <AgaButton
                  v-if="entry.positivePrompt"
                  variant="secondary" size="sm"
                  @click="openRegenerateFromHistoryEntry(entry)"
                >生成同款</AgaButton>
                <template v-if="entry.status === 'complete' && entry.assetId">
                  <AgaButton
                    v-if="entry.type === 'scene' && !isCurrentSceneWallpaper(entry.assetId)"
                    variant="ghost" size="sm"
                    @click="applySceneWallpaper(entry.assetId)"
                  >设为壁纸</AgaButton>
                  <AgaButton
                    v-if="entry.type === 'scene' && isCurrentSceneWallpaper(entry.assetId)"
                    variant="ghost" size="sm"
                    @click="clearSceneWallpaper()"
                  >取消设置壁纸</AgaButton>
                  <AgaButton
                    v-if="!isPersistentWallpaper(entry.assetId)"
                    variant="ghost" size="sm"
                    @click="setPersistentWallpaper(entry.assetId)"
                  >设为常驻壁纸</AgaButton>
                  <AgaButton
                    v-if="isPersistentWallpaper(entry.assetId)"
                    variant="ghost" size="sm"
                    @click="clearPersistentWallpaper()"
                  >取消常驻壁纸</AgaButton>
                  <AgaButton variant="ghost" size="sm" @click="saveToLocal(entry.assetId)">保存本地</AgaButton>
                </template>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="tab-placeholder">
          <p>暂无历史记录</p>
          <p class="form-hint">成功、失败与处理中记录都会在这里留档。</p>
        </div>
      </div>

      <!-- ═══ Presets Tab ═══ -->
      <div v-if="activeTab === 'presets'" class="tab-content">
        <!-- Auto preset bindings (MRJH §J Section 1 — 4 dropdowns in 2x2) -->
        <div class="preset-card">
          <span class="preset-card-badge">自动预设</span>
          <h3 class="section-label">自动画师串预设</h3>
          <p class="form-hint">自动生图时默认附加的画师串和 PNG 预设</p>
          <div class="bindings-grid">
            <div class="form-section">
              <label class="form-label">NPC 画师串</label>
              <AgaSelect
                :options="[{ label: '不使用', value: '' }, ...artistPresets.filter(p => p.scope === 'npc').map(p => ({ label: p.name, value: p.id }))]"
                :model-value="String(get('系统.扩展.image.config.defaultNpcArtistPreset') ?? '')"
                @update:model-value="setValue('系统.扩展.image.config.defaultNpcArtistPreset', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">NPC PNG 预设</label>
              <AgaSelect
                :options="[{ label: '不使用', value: '' }, ...artistPresets.filter(p => p.scope === 'npc' && p.id.startsWith('png_')).map(p => ({ label: p.name, value: p.id }))]"
                :model-value="String(get('系统.扩展.image.config.defaultNpcPngPreset') ?? '')"
                @update:model-value="setValue('系统.扩展.image.config.defaultNpcPngPreset', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">场景画师串</label>
              <AgaSelect
                :options="[{ label: '不使用', value: '' }, ...artistPresets.filter(p => p.scope === 'scene').map(p => ({ label: p.name, value: p.id }))]"
                :model-value="String(get('系统.扩展.image.config.defaultSceneArtistPreset') ?? '')"
                @update:model-value="setValue('系统.扩展.image.config.defaultSceneArtistPreset', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">场景 PNG 预设</label>
              <AgaSelect
                :options="[{ label: '不使用', value: '' }, ...artistPresets.filter(p => p.scope === 'scene' && p.id.startsWith('png_')).map(p => ({ label: p.name, value: p.id }))]"
                :model-value="String(get('系统.扩展.image.config.defaultScenePngPreset') ?? '')"
                @update:model-value="setValue('系统.扩展.image.config.defaultScenePngPreset', $event)"
              />
            </div>
          </div>
        </div>

        <!-- Section: Character Anchor Management (MRJH §J Sec 2) -->
        <div class="preset-card">
          <span class="preset-card-badge">角色锚点</span>
          <h3 class="section-label">角色锚定管理</h3>
          <p class="form-hint">角色锚点严格跟随 NPC，每个角色只保留一个锚点。后续生图会直接附加锚点，词组转化器只生成镜头、动作、构图与环境。</p>

          <div class="anchor-layout">
            <div class="anchor-list-col">
              <h4 class="form-label">锚点列表</h4>
              <div class="anchor-list">
                <button
                  v-for="a in characterAnchors"
                  :key="a.id"
                  :class="['preset-item', { 'preset-item--active': selectedAnchorId === a.id }]"
                  @click="selectAnchor(a.id)"
                >
                  <span class="preset-item-name">{{ a.name }}</span>
                  <span class="form-hint">{{ a.npcName }}</span>
                  <span class="anchor-badges">
                    <span :class="a.enabled ? 'anchor-badge--on' : 'anchor-badge--off'">{{ a.enabled ? '启用' : '停用' }}</span>
                    <span v-if="a.sceneLink" class="anchor-badge--link">场景联动</span>
                  </span>
                  <span v-if="a.positive" class="preset-item-preview">{{ a.positive.slice(0, 60) }}</span>
                </button>
              </div>
              <div v-if="characterAnchors.length === 0" class="transformer-empty">
                <span class="form-hint">请选择一个 NPC，再直接 AI 提取该角色的唯一锚点。</span>
              </div>
            </div>

            <div class="anchor-editor-col">
              <div class="form-section">
                <label class="form-label">绑定 NPC</label>
                <AgaSelect
                  :options="npcOptions"
                  :model-value="editAnchorNpc"
                  @update:model-value="editAnchorNpc = $event"
                />
              </div>
              <div class="form-section">
                <label class="form-label">提取附加要求</label>
                <input v-model="anchorExtractRequirements" class="form-input" placeholder="例如：更重视脸部、发色、胸型和常驻衣着" />
              </div>

              <div class="anchor-actions-row">
                <AgaButton variant="secondary" size="sm" :loading="anchorExtracting" @click="extractAnchor">{{ anchorExtracting ? '提取中…' : 'AI 提取锚点' }}</AgaButton>
                <AgaButton v-if="selectedAnchor" variant="primary" size="sm" @click="saveAnchor">保存锚点</AgaButton>
                <AgaButton v-if="selectedAnchor" variant="danger" size="sm" @click="deleteAnchor">删除锚点</AgaButton>
              </div>

              <!-- Extract status message (MRJH: 3-state colored box) -->
              <div
                v-if="anchorExtractMessage"
                :class="['anchor-extract-msg',
                  anchorExtractStage === 'error' ? 'anchor-extract-msg--error' :
                  anchorExtractStage === 'done' ? 'anchor-extract-msg--done' :
                  'anchor-extract-msg--info'
                ]"
              >{{ anchorExtractMessage }}</div>

              <template v-if="selectedAnchor">
                <div class="form-section">
                  <label class="form-label">锚点名称</label>
                  <input v-model="editAnchorName" class="form-input" />
                </div>

                <div class="anchor-toggles">
                  <div class="form-section form-section--inline">
                    <label class="form-label">启用锚点</label>
                    <AgaToggle :model-value="selectedAnchor.enabled" @update:model-value="toggleAnchorProp('enabled', $event)" />
                  </div>
                  <span class="form-hint">关闭后不参与生图</span>

                  <div class="form-section form-section--inline">
                    <label class="form-label">默认附加</label>
                    <AgaToggle :model-value="selectedAnchor.defaultAppend" @update:model-value="toggleAnchorProp('defaultAppend', $event)" />
                  </div>
                  <span class="form-hint">NPC 单图自动带入</span>

                  <div class="form-section form-section--inline">
                    <label class="form-label">场景联动</label>
                    <AgaToggle :model-value="selectedAnchor.sceneLink" @update:model-value="toggleAnchorProp('sceneLink', $event)" />
                  </div>
                  <span class="form-hint">场景图自动注入</span>
                </div>

                <div class="form-section">
                  <label class="form-label">正面提示词</label>
                  <textarea v-model="editAnchorPositive" class="form-textarea" rows="4" placeholder="角色外貌、服饰、特征的正面描述标签…" />
                </div>
                <div class="form-section">
                  <label class="form-label">负面提示词</label>
                  <textarea v-model="editAnchorNegative" class="form-textarea" rows="2" placeholder="需要避免的特征…" />
                </div>

                <div v-if="selectedAnchor.structuredFeatures && Object.keys(selectedAnchor.structuredFeatures).length > 0" class="form-section">
                  <label class="form-label">结构化特征</label>
                  <div class="anchor-features">
                    <div v-for="(val, key) in selectedAnchor.structuredFeatures" :key="key" class="anchor-feature-row">
                      <span class="form-label">{{ key }}</span>
                      <span class="form-hint">{{ val }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="selectedAnchor.source || selectedAnchor.model" class="anchor-status-card">
                  <span v-if="selectedAnchor.source" class="form-hint">来源: {{ selectedAnchor.source }}</span>
                  <span v-if="selectedAnchor.model" class="form-hint">模型: {{ selectedAnchor.model }}</span>
                  <span class="form-hint">绑定角色: {{ selectedAnchor.npcName }}</span>
                </div>
              </template>

              <div v-else-if="characterAnchors.length > 0" class="tab-placeholder" style="padding:var(--space-lg)">
                <p>← 选择一个锚点来编辑</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Section: PNG 画风预设 (MRJH: separate section with thumbnail list) -->
        <div class="preset-card">
          <span class="preset-card-badge">PNG画风预设</span>
          <div class="preset-card-header">
            <div>
              <h3 class="section-label">PNG 解析与画风复用</h3>
              <p class="form-hint">导入 PNG 后自动解析并提炼画风，可保存为预设。</p>
            </div>
            <div class="preset-card-actions">
              <AgaButton variant="ghost" size="sm" @click="exportArtistPresets">导出预设</AgaButton>
              <label class="png-import-btn">
                导入预设
                <input type="file" accept="application/json,.json" style="display:none" @change="importArtistPresets" />
              </label>
              <label class="png-import-btn">
                导入 PNG
                <input type="file" accept="image/png" style="display:none" @change="importPng" />
              </label>
            </div>
          </div>

          <div class="presets-layout">
            <!-- PNG preset list with thumbnails (220px) -->
            <div class="png-preset-list-col">
              <h4 class="form-label">预设列表</h4>
              <div class="png-preset-list">
                <div v-if="pngPresets.length === 0" class="transformer-empty">
                  <span class="form-hint">暂无 PNG 画风预设</span>
                </div>
                <button
                  v-for="p in pngPresets"
                  :key="p.id"
                  :class="['preset-item preset-item--png', { 'preset-item--active': selectedPresetId === p.id }]"
                  @click="selectedPresetId = p.id; loadPresetIntoEditor()"
                >
                  <div class="png-preset-item-inner">
                    <div class="png-preset-thumb">
                      <img v-if="p.pngMeta?.coverDataUrl" :src="p.pngMeta.coverDataUrl" alt="cover" />
                      <span v-else class="form-hint">无封面</span>
                    </div>
                    <div class="png-preset-info">
                      <span class="preset-item-name">{{ p.name }}</span>
                      <span class="preset-item-preview">{{ p.positive?.slice(0, 40) || '未提炼画风' }}</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <!-- PNG preset editor -->
            <div class="presets-editor">
              <template v-if="selectedPreset?.pngMeta">
                <!-- Cover + name + source -->
                <div class="png-editor-header">
                  <div class="png-cover-area">
                    <img v-if="selectedPreset.pngMeta.coverDataUrl" :src="selectedPreset.pngMeta.coverDataUrl" class="png-cover-thumb" alt="cover" />
                    <span v-else class="png-no-cover">未设置封面</span>
                  </div>
                  <div class="png-source-info">
                    <div class="form-section">
                      <label class="form-label">预设名称</label>
                      <input v-model="newPresetArtist" class="form-input" :placeholder="selectedPreset.name" />
                    </div>
                    <div class="png-source-meta">
                      <span class="form-hint">来源: {{ selectedPreset.pngMeta.source ?? '未知' }}</span>
                      <span v-if="selectedPreset.pngMeta.parsedParams?.model" class="form-hint">模型: {{ selectedPreset.pngMeta.parsedParams.model }}</span>
                    </div>
                  </div>
                </div>

                <div class="form-section">
                  <label class="form-label">画师串</label>
                  <textarea v-model="newPresetArtist" class="form-textarea" rows="3" />
                </div>
                <div class="form-section">
                  <label class="form-label">正面提示词</label>
                  <textarea v-model="newPresetPositive" class="form-textarea" rows="5" />
                </div>
                <div class="form-section">
                  <label class="form-label">负面提示词</label>
                  <textarea v-model="newPresetNegative" class="form-textarea" rows="3" />
                </div>

                <!-- Replicate params toggle -->
                <div class="form-section form-section--inline">
                  <label class="form-label">优先复刻原参数</label>
                  <AgaToggle
                    :model-value="selectedPreset.pngMeta.replicateParams === true"
                    @update:model-value="toggleReplicateParams($event)"
                  />
                </div>
                <span class="form-hint">开启后，解析出的步数、采样器、CFG 等参数一并下发到生图后端（分辨率与 Seed 自动剔除）。</span>

                <!-- Expandable metadata -->
                <details class="prompt-details">
                  <summary>解析参数与元数据</summary>
                  <div class="png-metadata-content">
                    <div v-if="selectedPreset.pngMeta.originalPrompt" class="png-meta-block">
                      <span class="form-label">原始正面提示词</span>
                      <pre class="prompt-text">{{ selectedPreset.pngMeta.originalPrompt }}</pre>
                    </div>
                    <div v-if="selectedPreset.pngMeta.parsedParams && Object.keys(selectedPreset.pngMeta.parsedParams).length > 0" class="png-meta-block">
                      <span class="form-label">解析参数</span>
                      <pre class="prompt-text">{{ JSON.stringify(selectedPreset.pngMeta.parsedParams, null, 2) }}</pre>
                    </div>
                    <div v-if="selectedPreset.pngMeta.rawText" class="png-meta-block">
                      <span class="form-label">原始元数据</span>
                      <pre class="prompt-text">{{ selectedPreset.pngMeta.rawText }}</pre>
                    </div>
                  </div>
                </details>

                <div class="presets-editor-actions">
                  <AgaButton variant="primary" size="sm" @click="savePreset">保存修改</AgaButton>
                  <AgaButton variant="danger" size="sm" @click="deletePreset">删除预设</AgaButton>
                </div>
              </template>

              <div v-else-if="selectedPreset && !selectedPreset.pngMeta" class="tab-placeholder">
                <p>选中的预设不是 PNG 类型，请在画师串管理中编辑。</p>
              </div>
              <div v-else class="tab-placeholder">
                <p>尚未选择 PNG 画风预设。请导入 PNG 或从列表选择预设。</p>
              </div>
            </div>
          </div>

          <!-- PNG import inputs at bottom -->
          <div class="png-import-footer">
            <div class="png-import-status">
              <span v-if="pngImporting" class="png-status png-status--loading">{{ pngImportStatus || '正在解析 PNG…' }}</span>
              <span v-else-if="pngImportStatus" class="png-status">{{ pngImportStatus }}</span>
            </div>
          </div>
        </div>

        <!-- Section: 画师串预设管理 (MRJH: separate section) -->
        <div class="preset-card">
          <span class="preset-card-badge">画师串管理</span>
          <div class="preset-card-header">
            <h3 class="section-label">画师串预设管理</h3>
            <div class="preset-card-actions">
              <AgaButton variant="secondary" size="sm" @click="createPreset">新增预设</AgaButton>
              <AgaButton variant="ghost" size="sm" @click="exportArtistPresets">导出预设</AgaButton>
              <label class="png-import-btn">
                导入预设
                <input type="file" accept="application/json,.json" style="display:none" @change="importArtistPresets" />
              </label>
            </div>
          </div>

          <div class="artist-preset-controls">
            <div class="form-section">
              <label class="form-label">适用范围</label>
              <div class="presets-scope-toggle">
                <AgaButton :variant="presetScope === 'npc' ? 'primary' : 'secondary'" size="sm" @click="presetScope = 'npc'">NPC</AgaButton>
                <AgaButton :variant="presetScope === 'scene' ? 'primary' : 'secondary'" size="sm" @click="presetScope = 'scene'">场景</AgaButton>
              </div>
            </div>
            <div class="form-section">
              <label class="form-label">当前编辑</label>
              <AgaSelect
                :options="[{ label: '未选择预设', value: '' }, ...artistOnlyPresets.map(p => ({ label: p.name, value: p.id }))]"
                :model-value="selectedPresetId"
                @update:model-value="selectedPresetId = $event; loadPresetIntoEditor()"
              />
            </div>
          </div>

          <template v-if="selectedPreset && !selectedPreset.pngMeta">
            <div class="artist-preset-editor">
              <div class="form-section">
                <label class="form-label">预设名称</label>
                <input v-model="newPresetName" class="form-input" />
              </div>
              <div class="form-section">
                <label class="form-label">画师串</label>
                <textarea v-model="newPresetArtist" class="form-textarea" rows="3" placeholder="画师名、风格标签" />
              </div>
              <div class="form-section">
                <label class="form-label">正面提示词</label>
                <textarea v-model="newPresetPositive" class="form-textarea" rows="5" placeholder="质量标签、风格描述" />
              </div>
              <div class="form-section">
                <label class="form-label">负面提示词</label>
                <textarea v-model="newPresetNegative" class="form-textarea" rows="3" placeholder="需要排除的内容" />
              </div>
              <div class="presets-editor-actions">
                <AgaButton variant="primary" size="sm" @click="savePreset">保存修改</AgaButton>
                <AgaButton variant="danger" size="sm" @click="deletePreset">删除预设</AgaButton>
              </div>
            </div>
          </template>
          <div v-else class="tab-placeholder">
            <p>请先选择或新增预设。</p>
          </div>
        </div>
        <!-- Section C: 词组转化器预设 CRUD -->
        <div class="preset-card">
          <span class="preset-card-badge">词组转化器</span>
          <h3 class="section-label">词组转化器预设</h3>
          <p class="form-hint">管理 tokenizer AI 的系统提示词，影响如何将中文描述转化为英文图像标签</p>

          <div class="transformer-crud-layout">
            <div class="transformer-sidebar">
              <div class="transformer-scope-toggle">
                <AgaButton :variant="transformerScope === 'npc' ? 'primary' : 'secondary'" size="sm" @click="transformerScope = 'npc'">NPC</AgaButton>
                <AgaButton :variant="transformerScope === 'scene' ? 'primary' : 'secondary'" size="sm" @click="transformerScope = 'scene'">场景</AgaButton>
                <AgaButton :variant="transformerScope === 'secret' ? 'primary' : 'secondary'" size="sm" @click="transformerScope = 'secret'">秘密</AgaButton>
              </div>

              <div class="transformer-list">
                <button
                  v-for="t in scopedTransformers"
                  :key="t.id"
                  :class="['preset-item', { 'preset-item--active': selectedTransformerId === t.id }]"
                  @click="selectedTransformerId = t.id; loadTransformerIntoEditor()"
                >
                  <span class="preset-item-name">{{ t.name }}</span>
                  <span v-if="t.prompt" class="preset-item-preview">{{ t.prompt.slice(0, 40) }}</span>
                </button>
                <div v-if="scopedTransformers.length === 0" class="transformer-empty">
                  <span class="form-hint">暂无{{ transformerScope === 'npc' ? 'NPC' : transformerScope === 'scene' ? '场景' : '秘密' }}转化器预设</span>
                </div>
              </div>

              <div class="presets-actions">
                <input v-model="newTransformerName" class="form-input" placeholder="新预设名称" style="font-size:12px" />
                <AgaButton variant="secondary" size="sm" @click="createTransformerPreset">+ 新增</AgaButton>
              </div>
            </div>

            <div class="transformer-editor">
              <template v-if="selectedTransformer">
                <h4 class="section-label">{{ selectedTransformer.name }}</h4>

                <div class="form-section">
                  <label class="form-label">转化器提示词</label>
                  <span class="form-hint">定义 AI 如何将{{ transformerScope === 'npc' ? '角色描述' : transformerScope === 'scene' ? '场景描述' : '秘密部位描述' }}转化为图像标签</span>
                  <textarea
                    v-model="editTransformerPrompt"
                    class="form-textarea"
                    rows="8"
                    :placeholder="transformerScope === 'npc'
                      ? '如：将以下角色信息转化为 NovelAI 格式标签，注重外貌、服饰、表情…'
                      : transformerScope === 'scene'
                        ? '如：将场景描述转化为背景/中景/前景分层标签…'
                        : '如：将秘密部位描述转化为特写构图标签…'"
                  />
                </div>

                <div class="presets-editor-actions">
                  <AgaButton variant="primary" size="sm" @click="saveTransformerPreset">保存修改</AgaButton>
                  <AgaButton variant="danger" size="sm" @click="deleteTransformerPreset">删除预设</AgaButton>
                </div>
              </template>

              <div v-else class="tab-placeholder" style="padding:var(--space-xl)">
                <p>← 选择或新增一个转化器预设来编辑</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Rules Tab — full CRUD per MRJH §J-2 ═══ -->
      <div v-if="activeTab === 'rules'" class="tab-content">
        <div class="rules-layout">
          <div class="rules-header">
            <div>
              <h3 class="section-label">提示词规则中心</h3>
            </div>
            <div class="rules-header-actions">
              <AgaButton variant="ghost" size="sm" @click="exportRules">导出全部</AgaButton>
              <label class="png-import-btn">
                导入全部
                <input type="file" accept="application/json,.json" style="display:none" @change="importRules" />
              </label>
              <AgaButton variant="primary" size="sm" @click="saveActiveRules">保存生效配置</AgaButton>
            </div>
          </div>

          <!-- Sub-section 1: Model Rulesets (collapsible) -->
          <div class="model-ruleset-section" :class="{ 'model-ruleset-section--expanded': modelRulesetExpanded }">
            <button class="model-ruleset-toggle" @click="modelRulesetExpanded = !modelRulesetExpanded">
              <span class="section-label">模型规则集</span>
              <span class="form-hint" style="flex:1">选择当前启用的模型规则，并编辑基础模式与锚定模式规则。</span>
              <span v-if="activeModelRuleset" class="model-ruleset-active-name">{{ activeModelRuleset.name }}</span>
              <span class="model-ruleset-expand-text">{{ modelRulesetExpanded ? '收起' : '展开' }}</span>
            </button>

            <div v-if="modelRulesetExpanded" class="model-ruleset-body">
              <div class="model-ruleset-actions">
                <AgaButton variant="secondary" size="sm" @click="createModelRuleset">新增规则集</AgaButton>
                <AgaButton v-if="editingModelRuleset" variant="danger" size="sm" @click="deleteModelRuleset">删除当前</AgaButton>
                <AgaButton variant="ghost" size="sm" @click="exportModelRulesets">导出</AgaButton>
                <label class="png-import-btn">
                  导入
                  <input type="file" accept="application/json,.json" style="display:none" @change="importModelRulesets" />
                </label>
              </div>

              <div class="model-ruleset-two-col">
                <div class="model-ruleset-left">
                  <div class="form-section">
                    <label class="form-label">当前编辑</label>
                    <AgaSelect
                      v-if="modelRulesetOptions.length > 0"
                      :options="modelRulesetOptions"
                      :model-value="editingModelRulesetId"
                      @update:model-value="selectModelRuleset($event)"
                    />
                    <span v-else class="form-hint">暂无规则集，请新增</span>
                  </div>

                  <template v-if="editingModelRuleset">
                    <div class="form-section form-section--inline">
                      <label class="form-label">启用当前规则集</label>
                      <AgaToggle
                        :model-value="editingModelRuleset.enabled"
                        @update:model-value="toggleModelRulesetEnabled($event)"
                      />
                    </div>
                    <span class="form-hint">锚定模式开启后，会直接改用锚定模式模型规则。</span>

                    <div class="form-section form-section--inline">
                      <label class="form-label">兼容模式</label>
                      <AgaToggle
                        :model-value="editingModelRuleset.compatMode"
                        @update:model-value="toggleModelRulesetCompat($event)"
                      />
                    </div>
                    <span class="form-hint">开启后，画师串与 PNG 画风正面词会先发给 AI 提炼，再写入最终提示词。</span>
                  </template>
                </div>

                <div class="model-ruleset-right">
                  <template v-if="editingModelRuleset">
                    <div class="form-section">
                      <label class="form-label">规则集名称</label>
                      <input v-model="editModelRulesetName" class="form-input" placeholder="如：NovelAI V4 专用" />
                    </div>
                    <div class="form-section">
                      <label class="form-label">基础模型规则</label>
                      <textarea v-model="editModelRulesetBase" class="form-textarea" rows="5" placeholder="模型基础规则（如：Output must be in NovelAI tag format, comma-separated…）" />
                    </div>
                    <div class="form-section">
                      <label class="form-label">锚定模式模型规则</label>
                      <textarea v-model="editModelRulesetAnchor" class="form-textarea" rows="5" placeholder="锚定模式规则（如：The character anchor is provided. Only generate pose, lighting, and composition…）" />
                    </div>
                    <AgaButton variant="primary" size="sm" @click="saveModelRuleset">保存规则集</AgaButton>
                  </template>
                  <div v-else class="tab-placeholder" style="padding:var(--space-lg)">
                    <p>← 选择或新增一个模型规则集来编辑</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub-section 2: Rule Templates -->
          <div class="rules-template-section">
            <div class="rules-template-header">
              <div>
                <h4 class="section-label">规则模板</h4>
                <p class="form-hint">按模块切换编辑 NPC、场景和场景判定规则。</p>
              </div>
              <div class="rules-scope-tabs">
                <AgaButton :variant="ruleScope === 'npc' ? 'primary' : 'ghost'" size="sm" @click="ruleScope = 'npc'; editingRuleId = ''">NPC 转化规则</AgaButton>
                <AgaButton :variant="ruleScope === 'scene' ? 'primary' : 'ghost'" size="sm" @click="ruleScope = 'scene'; editingRuleId = ''">场景转化规则</AgaButton>
                <AgaButton :variant="ruleScope === 'judge' ? 'primary' : 'ghost'" size="sm" @click="ruleScope = 'judge'; editingRuleId = ''">场景判定规则</AgaButton>
              </div>
            </div>

            <!-- Scope description (MRJH: per-tab hint) -->
            <p class="form-hint" style="margin-bottom:var(--space-sm)">
              {{ ruleScope === 'npc' ? '角色图使用基础规则；锚定开启后改用专属锚定规则。' :
                 ruleScope === 'scene' ? '场景图使用空间与构图规则；角色锚定存在时改用场景锚定规则。' :
                 '用于判断当前文本应生成风景场景还是场景快照。' }}
            </p>

          <!-- Enable toggle -->
          <div class="form-section form-section--inline">
            <label class="form-label">启用{{ ruleScope === 'npc' ? 'NPC' : ruleScope === 'scene' ? '场景' : '判定' }}转化规则</label>
            <AgaToggle
              :model-value="get(`系统.扩展.image.rules.${ruleScope}Enabled`) !== false"
              @update:model-value="setValue(`系统.扩展.image.rules.${ruleScope}Enabled`, $event)"
            />
          </div>

          <!-- Two-column: 当前生效/当前编辑 (left) + editor (right) -->
          <div class="rules-two-col">
            <div class="rules-left-col">
              <div class="form-section">
                <label class="form-label">当前生效</label>
                <span v-if="activeModelRuleset" class="form-hint" style="color:var(--color-warning)">已被模型规则集「{{ activeModelRuleset.name }}」覆盖</span>
                <span v-else class="form-hint">选择该范围下生效的规则模板</span>
                <AgaSelect
                  :options="activeRuleOptions"
                  :model-value="currentActiveRuleId"
                  :disabled="!!activeModelRuleset"
                  @update:model-value="currentActiveRuleId = $event"
                />
              </div>

              <div class="form-section">
                <label class="form-label">当前编辑</label>
                <AgaSelect
                  v-if="editRuleOptions.length > 0"
                  :options="editRuleOptions"
                  :model-value="editingRuleId"
                  @update:model-value="selectEditRule($event)"
                />
                <span v-else class="form-hint">暂无规则，请先新增</span>
              </div>

              <div class="rules-crud-buttons">
                <AgaButton variant="secondary" size="sm" @click="createRuleTemplate">新增规则</AgaButton>
                <AgaButton v-if="editingRule" variant="danger" size="sm" @click="deleteRuleTemplate">删除当前</AgaButton>
              </div>
            </div>

            <div class="rules-right-col">
              <template v-if="editingRule">
                <div class="form-section">
                  <label class="form-label">规则名称</label>
                  <input v-model="editRuleName" class="form-input" placeholder="规则模板名称" />
                </div>

                <div class="form-section">
                  <label class="form-label">关联转化器预设</label>
                  <AgaSelect
                    :options="currentTransformerOptions"
                    :model-value="editRuleTransformerId"
                    @update:model-value="editRuleTransformerId = $event"
                  />
                </div>

                <!-- NPC/Scene: 4 textareas -->
                <template v-if="ruleScope !== 'judge'">
                  <div class="form-section">
                    <label class="form-label">基础转化规则</label>
                    <span class="form-hint">{{ ruleScope === 'npc' ? '定义如何将 NPC 描述转化为图像 prompt' : '定义如何将场景描述转化为图像 prompt' }}</span>
                    <textarea v-model="editBaseRule" class="form-textarea" rows="8" :placeholder="ruleScope === 'npc' ? 'NPC 基础转化规则模板…' : '场景基础转化规则模板…'" />
                  </div>
                  <div class="form-section">
                    <label class="form-label">{{ ruleScope === 'npc' ? '锚定模式专属规则' : '场景锚定专属规则' }}</label>
                    <span class="form-hint">当{{ ruleScope === 'npc' ? '角色' : '场景' }}锚点已启用时使用此规则</span>
                    <textarea v-model="editAnchorRule" class="form-textarea" rows="6" placeholder="锚定模式转化规则…" />
                  </div>
                  <div class="form-section">
                    <label class="form-label">无锚点回退规则</label>
                    <span class="form-hint">当无锚点时的转化规则</span>
                    <textarea v-model="editNoAnchorFallback" class="form-textarea" rows="4" placeholder="无锚点回退规则…" />
                  </div>
                  <div class="form-section">
                    <label class="form-label">输出格式规则</label>
                    <span class="form-hint">约束 AI 的输出格式（标签格式、分隔符等）</span>
                    <textarea v-model="editOutputFormat" class="form-textarea" rows="4" placeholder="输出格式规则…" />
                  </div>
                </template>

                <!-- Judge: 1 textarea -->
                <template v-else>
                  <div class="form-section">
                    <label class="form-label">判定规则</label>
                    <span class="form-hint">定义如何判断当前场景应生成"故事快照"（含人物）还是"纯风景"</span>
                    <textarea v-model="editBaseRule" class="form-textarea" rows="10" placeholder="场景判定规则…" />
                  </div>
                </template>

                <div class="presets-editor-actions">
                  <AgaButton variant="primary" size="sm" @click="saveRuleTemplate">保存规则</AgaButton>
                </div>
              </template>

              <div v-else class="tab-placeholder" style="padding:var(--space-xl)">
                <p>← 选择或新增一条规则来编辑</p>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      <!-- ═══ Settings Tab (8th tab — MRJH ImageGenerationSettings) ═══ -->
      <div v-if="activeTab === 'settings'" class="tab-content settings-tab">

        <!-- §7.1 Basic -->
        <div class="preset-card">
          <span class="preset-card-badge">基础</span>
          <div class="settings-row">
            <div><span class="form-label">文生图总开关</span></div>
            <AgaToggle
              :model-value="enabled"
              @update:model-value="setValue('系统.扩展.image.enabled', $event)"
            />
          </div>
          <div class="settings-row">
            <div>
              <span class="form-label">后端类型</span>
              <span class="form-hint">新建生图任务时的默认图像 API 后端</span>
            </div>
            <AgaSelect
              :options="backendOptions"
              :model-value="settingsBackend"
              @update:model-value="setValue('系统.扩展.image.config.defaultBackend', $event)"
            />
          </div>
          <div class="settings-row">
            <div>
              <span class="form-label">NPC 生图使用词组转化器</span>
              <span class="form-hint">将中文角色描述通过 AI 转化为英文图像标签。NovelAI 后端要求必须开启。</span>
            </div>
            <AgaToggle
              :model-value="isNovelAIBackend || get('系统.扩展.image.config.useTransformer') !== false"
              :disabled="isNovelAIBackend"
              @update:model-value="setValue('系统.扩展.image.config.useTransformer', $event)"
            />
          </div>
        </div>

        <!-- §7.2 Backend settings (conditional per backend) -->
        <div v-if="isNovelAIBackend" class="preset-card">
          <span class="preset-card-badge">NovelAI 设置</span>
          <div class="settings-row">
            <div><span class="form-label">NovelAI 自定义参数</span></div>
            <AgaToggle
              :model-value="get('系统.扩展.image.config.novelai.customParams') === true"
              @update:model-value="setValue('系统.扩展.image.config.novelai.customParams', $event)"
            />
          </div>
          <div class="settings-grid-3">
            <div class="form-section">
              <label class="form-label">采样方法</label>
              <AgaSelect
                :options="[
                  { label: 'Euler Ancestral', value: 'k_euler_ancestral' },
                  { label: 'Euler', value: 'k_euler' },
                  { label: 'DPM++ 2M', value: 'k_dpmpp_2m' },
                  { label: 'DPM++ 2S Ancestral', value: 'k_dpmpp_2s_ancestral' },
                  { label: 'DPM++ SDE', value: 'k_dpmpp_sde' },
                  { label: 'DPM++ 2M SDE', value: 'k_dpmpp_2m_sde' },
                ]"
                :model-value="String(get('系统.扩展.image.config.novelai.sampler') ?? 'k_euler_ancestral')"
                @update:model-value="setValue('系统.扩展.image.config.novelai.sampler', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">噪点表</label>
              <AgaSelect
                :options="[
                  { label: 'Karras', value: 'karras' },
                  { label: 'Native', value: 'native' },
                  { label: 'Exponential', value: 'exponential' },
                  { label: 'Polyexponential', value: 'polyexponential' },
                ]"
                :model-value="String(get('系统.扩展.image.config.novelai.noiseSchedule') ?? 'karras')"
                @update:model-value="setValue('系统.扩展.image.config.novelai.noiseSchedule', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">步数</label>
              <input
                type="number" min="1" max="50" class="form-input"
                :value="get('系统.扩展.image.config.novelai.steps') ?? 28"
                @change="setValue('系统.扩展.image.config.novelai.steps', Math.max(1, Math.min(50, Number(($event.target as HTMLInputElement).value) || 28)))"
              />
            </div>
          </div>
          <div class="settings-grid-3">
            <div class="form-section">
              <label class="form-label">CFG Scale</label>
              <input
                type="number" min="1" max="30" step="0.5" class="form-input"
                :value="get('系统.扩展.image.config.novelai.cfgScale') ?? 5"
                @change="setValue('系统.扩展.image.config.novelai.cfgScale', Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <div class="form-section settings-row-inline">
              <label class="form-label">启用 SMEA</label>
              <AgaToggle
                :model-value="get('系统.扩展.image.config.novelai.smea') === true"
                @update:model-value="setValue('系统.扩展.image.config.novelai.smea', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">固定 Seed</label>
              <input
                type="number" min="0" class="form-input"
                :value="get('系统.扩展.image.config.novelai.seed') ?? 0"
                @change="setValue('系统.扩展.image.config.novelai.seed', Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>
          <div class="form-section">
            <label class="form-label">默认负面提示词</label>
            <textarea
              class="form-textarea" rows="4"
              placeholder="例如：lowres, bad anatomy, text, watermark"
              :value="get('系统.扩展.image.config.novelai.negativeDefault') ?? ''"
              @input="setValue('系统.扩展.image.config.novelai.negativeDefault', ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </div>

        <div v-if="settingsBackend === 'comfyui'" class="preset-card">
          <span class="preset-card-badge">ComfyUI 设置</span>
          <div class="form-section">
            <label class="form-label">ComfyUI Workflow JSON</label>
            <textarea
              class="form-textarea" rows="12"
              placeholder="粘贴从 ComfyUI 导出的 API workflow JSON。可用占位符：__PROMPT__、__NEGATIVE_PROMPT__、__WIDTH__、__HEIGHT__"
              :value="get('系统.扩展.image.config.comfyui.workflowJson') ?? ''"
              @input="setValue('系统.扩展.image.config.comfyui.workflowJson', ($event.target as HTMLTextAreaElement).value)"
            />
            <p class="form-hint">支持占位符：__PROMPT__、{<!-- -->{prompt}}、__NEGATIVE_PROMPT__、{<!-- -->{negative_prompt}}、__WIDTH__、__HEIGHT__、__STEPS__、__CFG__、__SEED__</p>
          </div>
        </div>

        <!-- Civitai settings (tiered: basic + advanced) -->
        <div v-if="settingsBackend === 'civitai'" class="preset-card">
          <span class="preset-card-badge">Civitai 设置</span>
          <div class="settings-row">
            <div>
              <span class="form-label">允许 Civitai Mature 内容</span>
              <p class="form-hint">
                向 Civitai 发送 allowMatureContent=true。需要账号已开启成人内容并有 Buzz 余额。
                此选项独立于 AGA 故事系统的 NSFW 模式。如需无限制本地生成，请使用 ComfyUI 或 SD-WebUI。
              </p>
            </div>
            <AgaToggle
              :model-value="get('系统.扩展.image.config.civitai.allowMatureContent') === true"
              @update:model-value="setValue('系统.扩展.image.config.civitai.allowMatureContent', $event)"
            />
          </div>
          <div class="settings-grid-3">
            <div class="form-section">
              <label class="form-label">采样器</label>
              <AgaSelect
                :options="civitaiSchedulerOptions"
                :model-value="String(get('系统.扩展.image.config.civitai.scheduler') ?? 'EulerA')"
                @update:model-value="setValue('系统.扩展.image.config.civitai.scheduler', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">步数</label>
              <input
                type="number" min="1" max="100" class="form-input"
                :value="get('系统.扩展.image.config.civitai.steps') ?? 25"
                @change="setValue('系统.扩展.image.config.civitai.steps', Math.max(1, Math.min(100, Number(($event.target as HTMLInputElement).value) || 25)))"
              />
            </div>
            <div class="form-section">
              <label class="form-label">CFG Scale</label>
              <input
                type="number" min="1" max="30" step="0.5" class="form-input"
                :value="get('系统.扩展.image.config.civitai.cfgScale') ?? 7"
                @change="setValue('系统.扩展.image.config.civitai.cfgScale', Number(($event.target as HTMLInputElement).value) || 7)"
              />
            </div>
          </div>
          <div class="settings-grid-3">
            <div class="form-section">
              <label class="form-label">Seed (-1 = 随机)</label>
              <input
                type="number" min="-1" max="4294967295" class="form-input"
                :value="get('系统.扩展.image.config.civitai.seed') ?? -1"
                @change="setValue('系统.扩展.image.config.civitai.seed', Number(($event.target as HTMLInputElement).value) ?? -1)"
              />
            </div>
          </div>

          <details class="form-advanced">
            <summary>高级参数</summary>
            <div class="settings-grid-3">
              <div class="form-section">
                <label class="form-label">Clip Skip</label>
                <input
                  type="number" min="1" max="12" class="form-input"
                  :value="get('系统.扩展.image.config.civitai.clipSkip') ?? 2"
                  @change="setValue('系统.扩展.image.config.civitai.clipSkip', Math.max(1, Math.min(12, Number(($event.target as HTMLInputElement).value) || 2)))"
                />
              </div>
              <div class="form-section">
                <label class="form-label">输出格式</label>
                <AgaSelect
                  :options="civitaiOutputFormatOptions"
                  :model-value="String(get('系统.扩展.image.config.civitai.outputFormat') ?? 'png')"
                  @update:model-value="setValue('系统.扩展.image.config.civitai.outputFormat', $event)"
                />
              </div>
            </div>
            <div class="form-section">
              <label class="form-label">附加网络 (LoRA JSON)</label>
              <textarea
                class="form-textarea" rows="3"
                :class="{ 'form-textarea--error': civitaiNetworksJsonError }"
                placeholder='{"urn:air:sdxl:lora:civitai:82098@87153": {"type": "Lora", "strength": 0.8}}'
                :value="String(get('系统.扩展.image.config.civitai.additionalNetworksJson') ?? '')"
                @input="setValue('系统.扩展.image.config.civitai.additionalNetworksJson', ($event.target as HTMLTextAreaElement).value)"
                @blur="validateCivitaiJson('additionalNetworksJson', 'civitaiNetworksJsonError')"
              />
              <span v-if="civitaiNetworksJsonError" class="form-hint" style="color: var(--color-error, #f87171);">{{ civitaiNetworksJsonError }}</span>
            </div>
            <div class="form-section">
              <label class="form-label">ControlNet (JSON)</label>
              <textarea
                class="form-textarea" rows="3"
                :class="{ 'form-textarea--error': civitaiControlNetsJsonError }"
                placeholder='[{"preprocessor": "Canny", "weight": 1.0, "imageUrl": "..."}]'
                :value="String(get('系统.扩展.image.config.civitai.controlNetsJson') ?? '')"
                @input="setValue('系统.扩展.image.config.civitai.controlNetsJson', ($event.target as HTMLTextAreaElement).value)"
                @blur="validateCivitaiJson('controlNetsJson', 'civitaiControlNetsJsonError')"
              />
              <span v-if="civitaiControlNetsJsonError" class="form-hint" style="color: var(--color-error, #f87171);">{{ civitaiControlNetsJsonError }}</span>
            </div>
          </details>

          <div class="settings-row" style="margin-top: 8px;">
            <div>
              <span class="form-label">预估 Buzz 消耗</span>
              <span class="form-hint">以当前参数向 Civitai 查询费用，不实际生成图片</span>
            </div>
            <button class="btn-secondary btn-sm" :disabled="civitaiWhatifLoading" @click="runCivitaiWhatif">
              {{ civitaiWhatifLoading ? '查询中…' : '预估费用' }}
            </button>
          </div>
          <p v-if="civitaiWhatifResult" class="form-hint" style="margin-top: 4px;">{{ civitaiWhatifResult }}</p>
        </div>

        <!-- §7.3 Transformer section -->
        <div class="preset-card">
          <span class="preset-card-badge">转化器</span>
          <div class="settings-row">
            <div>
              <span class="form-label">独立转化器模型</span>
              <span class="form-hint">为词组转化器使用独立的 API 接口和模型</span>
            </div>
            <AgaToggle
              :model-value="settingsTransformerIndependent"
              @update:model-value="setValue('系统.扩展.image.config.transformerIndependentModel', $event)"
            />
          </div>
          <template v-if="settingsTransformerIndependent">
            <div class="settings-grid-2">
              <div class="form-section">
                <label class="form-label">转化器接口地址</label>
                <input
                  type="text" class="form-input" placeholder="留空则沿用主剧情接口"
                  :value="get('系统.扩展.image.config.transformer.endpoint') ?? ''"
                  @input="setValue('系统.扩展.image.config.transformer.endpoint', ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="form-section">
                <label class="form-label">转化器 API Key</label>
                <input
                  type="password" class="form-input" placeholder="留空则沿用主剧情 API Key"
                  :value="get('系统.扩展.image.config.transformer.apiKey') ?? ''"
                  @input="setValue('系统.扩展.image.config.transformer.apiKey', ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
            <div class="form-section">
              <label class="form-label">转化器模型名称</label>
              <input
                type="text" class="form-input" placeholder="例如：gpt-4o-mini / gemini-2.5-flash"
                :value="get('系统.扩展.image.config.transformer.model') ?? ''"
                @input="setValue('系统.扩展.image.config.transformer.model', ($event.target as HTMLInputElement).value)"
              />
            </div>
          </template>
          <div class="settings-row">
            <div>
              <span class="form-label">香闺秘档特写强制裸体语义</span>
              <span class="form-hint">关闭后不再额外强塞 nude/naked/unclothed，仅按原始描述和转化器生成。</span>
            </div>
            <AgaToggle
              :model-value="get('系统.扩展.image.config.forceNudeSemantics') !== false"
              @update:model-value="setValue('系统.扩展.image.config.forceNudeSemantics', $event)"
            />
          </div>
        </div>

        <!-- §7.4 Automation section -->
        <div class="preset-card">
          <span class="preset-card-badge">自动任务</span>

          <!-- Scene generation mode -->
          <div class="settings-row">
            <div><span class="form-label">场景生图模式</span></div>
            <AgaToggle
              :model-value="get('系统.扩展.image.config.autoSceneOnRound') === true"
              @update:model-value="setValue('系统.扩展.image.config.autoSceneOnRound', $event)"
            />
          </div>

          <!-- Scene independent backend -->
          <div class="settings-row">
            <div>
              <span class="form-label">场景独立生图接口</span>
              <span class="form-hint">场景图使用独立的后端和 API 配置</span>
            </div>
            <AgaToggle
              :model-value="settingsSceneIndependent"
              @update:model-value="setValue('系统.扩展.image.config.sceneIndependentBackend', $event)"
            />
          </div>
          <template v-if="settingsSceneIndependent">
            <div class="form-section">
              <label class="form-label">场景后端类型</label>
              <AgaSelect
                :options="backendOptions"
                :model-value="String(get('系统.扩展.image.config.scene.backend') ?? 'novelai')"
                @update:model-value="setValue('系统.扩展.image.config.scene.backend', $event)"
              />
            </div>
            <div class="settings-grid-2">
              <div class="form-section">
                <label class="form-label">场景 API 地址</label>
                <input
                  type="text" class="form-input"
                  :value="get('系统.扩展.image.config.scene.endpoint') ?? ''"
                  @input="setValue('系统.扩展.image.config.scene.endpoint', ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="form-section">
                <label class="form-label">场景 API Key</label>
                <input
                  type="password" class="form-input"
                  :value="get('系统.扩展.image.config.scene.apiKey') ?? ''"
                  @input="setValue('系统.扩展.image.config.scene.apiKey', ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
            <div class="form-section">
              <label class="form-label">场景模型名称</label>
              <input
                type="text" class="form-input" placeholder="例如：nai-diffusion-4-5-full"
                :value="get('系统.扩展.image.config.scene.model') ?? ''"
                @input="setValue('系统.扩展.image.config.scene.model', ($event.target as HTMLInputElement).value)"
              />
            </div>
          </template>

          <!-- Scene defaults -->
          <div class="settings-grid-2">
            <div class="form-section">
              <label class="form-label">自动场景构图要求</label>
              <AgaSelect
                :options="[{ label: '纯场景', value: 'landscape' }, { label: '故事快照', value: 'snapshot' }]"
                :model-value="String(get('系统.扩展.image.config.auto.sceneComposition') ?? 'landscape')"
                @update:model-value="setValue('系统.扩展.image.config.auto.sceneComposition', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">自动场景画面方向</label>
              <AgaSelect
                :options="[{ label: '横屏', value: 'landscape' }, { label: '竖屏', value: 'portrait' }]"
                :model-value="String(get('系统.扩展.image.config.auto.sceneOrientation') ?? 'landscape')"
                @update:model-value="setValue('系统.扩展.image.config.auto.sceneOrientation', $event)"
              />
            </div>
          </div>
          <div class="form-section">
            <label class="form-label">自动场景分辨率</label>
            <AgaSelect
              :options="sizeOptionsToSelectOptions((get('系统.扩展.image.config.auto.sceneOrientation') ?? 'landscape') === 'landscape' ? SCENE_LANDSCAPE_SIZE_OPTIONS : SCENE_PORTRAIT_SIZE_OPTIONS)"
              :model-value="String(get('系统.扩展.image.config.auto.sceneResolution') ?? '1024x576')"
              @update:model-value="setValue('系统.扩展.image.config.auto.sceneResolution', $event)"
            />
          </div>

          <!-- NPC auto generation -->
          <div class="settings-row" style="margin-top:var(--space-md)">
            <div><span class="form-label">NPC 自动生图</span></div>
            <AgaToggle
              :model-value="get('系统.扩展.image.config.autoPortraitForMajorNpcs') === true"
              @update:model-value="setValue('系统.扩展.image.config.autoPortraitForMajorNpcs', $event)"
            />
          </div>
          <div class="settings-grid-3">
            <div class="form-section">
              <label class="form-label">性别筛选</label>
              <AgaSelect
                :options="[{ label: '全部', value: 'all' }, { label: '男', value: 'male' }, { label: '女', value: 'female' }]"
                :model-value="String(get('系统.扩展.image.config.auto.genderFilter') ?? 'all')"
                @update:model-value="setValue('系统.扩展.image.config.auto.genderFilter', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">重要性筛选</label>
              <AgaSelect
                :options="[{ label: '全部 NPC', value: 'all' }, { label: '只生成重要 NPC', value: 'major' }]"
                :model-value="String(get('系统.扩展.image.config.auto.importanceFilter') ?? 'all')"
                @update:model-value="setValue('系统.扩展.image.config.auto.importanceFilter', $event)"
              />
            </div>
            <div class="form-section">
              <label class="form-label">NPC 默认画风</label>
              <AgaSelect
                :options="[{ label: '通用', value: 'generic' }, { label: '二次元', value: 'anime' }, { label: '写实', value: 'realistic' }, { label: '国风', value: 'chinese' }]"
                :model-value="String(get('系统.扩展.image.config.auto.npcStyle') ?? 'generic')"
                @update:model-value="setValue('系统.扩展.image.config.auto.npcStyle', $event)"
              />
            </div>
          </div>
        </div>
      </div>

    </template>

    <!-- ─── 前台提交确认 overlay ─── -->
    <Transition name="fade">
      <div v-if="manualFlowStage !== 'idle'" class="confirm-overlay" @click.self="cancelConfirm">
        <!--
          MRJH-style confirm modal — shows a portrait thumbnail, character vitals,
          visual archive preview, and every active generation parameter so the
          user can double-check before paying for an API call.
        -->
        <div class="confirm-card confirm-card--wide">
          <header class="confirm-header">
            <div>
              <div class="confirm-title">
                {{ manualFlowStage === 'submitting'
                  ? (backgroundMode ? '任务已提交（后台处理）' : '正在提交任务')
                  : '确认生成图片' }}
              </div>
              <div class="confirm-subtitle">
                {{ manualFlowStage === 'submitting'
                  ? (backgroundMode ? '任务已进入后台队列，可直接关闭当前提示。' : '系统正在提交任务，请稍候...')
                  : '请确认角色与生成参数无误后提交。' }}
              </div>
            </div>
            <button
              v-if="manualFlowStage !== 'submitting'"
              class="confirm-close"
              aria-label="关闭"
              @click="cancelConfirm"
            >×</button>
          </header>

          <div class="confirm-body">
            <!-- ═══ Left: character preview ═══ -->
            <aside class="confirm-character" v-if="selectedNpcData">
              <div class="confirm-character-avatar">
                <ImageDisplay
                  :asset-id="(selectedNpcData['图片档案'] as Record<string, unknown> | undefined)?.['已选头像图片ID'] as string | undefined"
                  :fallback-letter="String(selectedNpcData['名称'] ?? '?').charAt(0)"
                  :alt="String(selectedNpcData['名称'] ?? '')"
                  size="lg"
                  class="confirm-character-avatar__img"
                />
              </div>
              <div class="confirm-character-name">{{ selectedNpcData['名称'] ?? '未知' }}</div>
              <div class="confirm-character-meta">
                <span v-if="selectedNpcData['性别']">{{ selectedNpcData['性别'] }}</span>
                <span v-if="selectedNpcData['年龄']">· {{ selectedNpcData['年龄'] }}岁</span>
                <span v-if="selectedNpcData['类型']">· {{ selectedNpcData['类型'] }}</span>
              </div>
              <div v-if="selectedNpcAnchor" class="confirm-character-anchor">
                <span
                  :class="['confirm-anchor-dot', selectedNpcAnchor.enabled ? 'confirm-anchor-dot--on' : 'confirm-anchor-dot--off']"
                />
                锚点{{ selectedNpcAnchor.enabled ? '已启用' : '已停用' }}
                <span v-if="selectedNpcAnchor.name" class="confirm-anchor-name">: {{ selectedNpcAnchor.name }}</span>
              </div>
              <p v-if="selectedNpcData['描述']" class="confirm-character-desc">
                {{ String(selectedNpcData['描述']).slice(0, 160) }}
              </p>
            </aside>

            <!-- ═══ Right: generation parameters ═══ -->
            <div class="confirm-params-panel">
              <section class="confirm-section">
                <h4 class="confirm-section-title">生成参数</h4>
                <dl class="confirm-dl">
                  <div class="confirm-dl-row">
                    <dt>构图</dt>
                    <dd>{{ compositionOptions.find(o => o.value === composition)?.label ?? composition }}</dd>
                  </div>
                  <div class="confirm-dl-row">
                    <dt>画风</dt>
                    <dd>{{ styleOptions.find(o => o.value === artStyle)?.label ?? artStyle }}</dd>
                  </div>
                  <div class="confirm-dl-row">
                    <dt>后端</dt>
                    <dd>{{ backendLabel(backend) }}</dd>
                  </div>
                  <div class="confirm-dl-row">
                    <dt>尺寸</dt>
                    <dd>{{ currentSizeDisplay }}</dd>
                  </div>
                </dl>
              </section>

              <section
                v-if="extraPrompt?.trim() || selectedNpcData?.['外貌描述'] || selectedNpcData?.['身材描写'] || selectedNpcData?.['衣着风格']"
                class="confirm-section"
              >
                <h4 class="confirm-section-title">视觉资料注入</h4>
                <div
                  v-if="selectedNpcData?.['外貌描述']"
                  class="confirm-kv"
                >
                  <div class="confirm-kv-key">外貌描述</div>
                  <div class="confirm-kv-value">{{ String(selectedNpcData['外貌描述']).slice(0, 180) }}</div>
                </div>
                <div
                  v-if="selectedNpcData?.['身材描写']"
                  class="confirm-kv"
                >
                  <div class="confirm-kv-key">身材描写</div>
                  <div class="confirm-kv-value">{{ String(selectedNpcData['身材描写']).slice(0, 120) }}</div>
                </div>
                <div
                  v-if="selectedNpcData?.['衣着风格']"
                  class="confirm-kv"
                >
                  <div class="confirm-kv-key">衣着风格</div>
                  <div class="confirm-kv-value">{{ String(selectedNpcData['衣着风格']).slice(0, 120) }}</div>
                </div>
                <div
                  v-if="extraPrompt?.trim()"
                  class="confirm-kv"
                >
                  <div class="confirm-kv-key">额外要求</div>
                  <div class="confirm-kv-value">{{ extraPrompt }}</div>
                </div>
              </section>

              <!-- submitting 状态：real-time progress (MRJH: tracks task phases) -->
              <div v-if="manualFlowStage === 'submitting'" class="confirm-progress">
                <div class="confirm-spinner" />
                <div class="confirm-progress-text">
                  <span v-if="selectedNpcActiveTask" :class="['task-status-badge', `task-status-badge--${taskStatusVariant(selectedNpcActiveTask.status)}`]">
                    {{ taskStatusLabel(selectedNpcActiveTask.status) }}
                  </span>
                  <span>{{ manualStatusText || '正在提交任务或等待状态更新...' }}</span>
                </div>
              </div>
            </div>
          </div>

          <footer class="confirm-footer">
            <!-- confirm 状态：操作按钮 -->
            <template v-if="manualFlowStage !== 'submitting'">
              <button class="btn-secondary" @click="cancelConfirm">返回修改</button>
              <button class="btn-primary" :disabled="isGenerating" @click="submitGenerate">确认生成</button>
            </template>
            <!-- submitting 状态：取消按钮 -->
            <template v-else>
              <button class="btn-secondary" @click="cancelSubmitting">
                {{ backgroundMode ? '关闭提示' : '取消等待' }}
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Fullscreen viewer -->
    <ImageViewer v-if="viewerOpen" :src="viewerSrc" @close="closeViewer" />

    <!-- Delete confirmation -->
    <AgaConfirmModal
      v-if="showDeleteConfirm"
      title="确认删除"
      message="确定要删除这张图片吗？此操作不可撤销。"
      variant="danger"
      confirm-label="删除"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- Regenerate-Same modal (shared across queue / gallery / scene) -->
    <RegenerateSameModal
      v-if="regenPayload"
      :subject-label="regenPayload.subjectLabel"
      :subtitle="regenPayload.subtitle"
      :positive-prompt="regenPayload.positivePrompt"
      :negative-prompt="regenPayload.negativePrompt"
      :width="regenPayload.width"
      :height="regenPayload.height"
      :initial-backend="regenPayload.initialBackend"
      :busy="regenBusy"
      @confirm="confirmRegenerate"
      @cancel="cancelRegenerate"
    />
  </div>
</template>

<style scoped>
.image-panel { padding: var(--space-lg) var(--sidebar-right-reserve, 40px) var(--space-lg) var(--sidebar-left-reserve, 40px); transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet); height: 100%; display: flex; flex-direction: column; overflow: hidden; }

/* Slim scrollbar for all scrollable areas within image panel */
.image-panel ::-webkit-scrollbar { width: 6px; height: 6px; }
.image-panel ::-webkit-scrollbar-track { background: transparent; }
.image-panel ::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--color-text-umber) 35%, transparent);
  border-radius: 3px;
}
.image-panel ::-webkit-scrollbar-thumb:hover { background: color-mix(in oklch, var(--color-text-umber) 55%, transparent); }
.image-panel { scrollbar-width: thin; scrollbar-color: color-mix(in oklch, var(--color-text-umber) 35%, transparent) transparent; }
.image-panel * { scrollbar-width: thin; scrollbar-color: color-mix(in oklch, var(--color-text-umber) 35%, transparent) transparent; }
.panel-header { margin-bottom: var(--space-md); }
.panel-title { font-size: var(--font-size-xl); color: var(--color-text); }
.panel-notice { padding: var(--space-xl); text-align: center; color: var(--color-text-secondary); }
.panel-notice strong { color: var(--color-primary); }

.tab-content { flex: 1; overflow-y: auto; padding-top: var(--space-md); }

.gen-layout { display: flex; gap: var(--space-xl); }
.gen-form-col { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
/* gen-preview-col removed — preview is now in npc-preview-panel */

.form-section { display: flex; flex-direction: column; gap: var(--space-2xs); }
.form-section--inline { flex-direction: row; align-items: center; justify-content: space-between; }
.form-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.form-textarea {
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--font-size-sm);
  resize: vertical;
}
.form-textarea:focus { outline: none; border-color: var(--color-primary); }
.form-input {
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.form-input:focus { outline: none; border-color: var(--color-primary); }
.form-hint { font-size: 0.68rem; color: var(--color-text-secondary); }
.form-actions { padding-top: var(--space-sm); }

/* ── Button Grid (composition / style / resolution selectors) ── */
.btn-grid { display: grid; gap: 8px; }
.btn-grid--4 { grid-template-columns: repeat(4, 1fr); }
.btn-grid--5 { grid-template-columns: repeat(5, 1fr); }
.btn-grid--6 { grid-template-columns: repeat(6, 1fr); }
.grid-btn {
  padding: 10px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: center;
  transition: all 0.25s ease;
}
.grid-btn:hover {
  border-color: var(--color-primary);
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  color: var(--color-text);
}
.grid-btn--active {
  border-color: var(--color-primary);
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  color: var(--color-primary);
  box-shadow: 0 0 12px color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}
.grid-btn--active .grid-btn__sub { color: var(--color-primary); opacity: 0.75; }
.grid-btn--compact { padding: 8px 4px; }
.grid-btn--disabled { opacity: 0.4; cursor: not-allowed; }
.grid-btn--disabled:hover { border-color: var(--color-border); background: rgba(255, 255, 255, 0.03); color: var(--color-text-secondary); }

/* Scale toggle (1X / 2X) */
.scale-toggle { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.scale-btn {
  padding: 3px 10px; font-size: 0.68rem; font-weight: 600;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.03); color: var(--color-text-secondary);
  cursor: pointer; transition: all 0.2s;
}
.scale-btn:hover { border-color: var(--color-primary); }
.scale-btn--active { border-color: var(--color-primary); background: color-mix(in oklch, var(--color-sage-400) 15%, transparent); color: var(--color-primary); }

/* Width / Height inputs */
.size-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
.size-input-group { display: flex; flex-direction: column; gap: 3px; }

/* Status text */
.status-text { font-size: 0.75rem; color: var(--color-primary); margin-top: 6px; }

/* ── NPC Preview Panel (full width, below form) ── */
.npc-preview-panel {
  /* 55/45 split gives the image enough canvas for portrait aspect ratios
     while keeping character data readable. Was 50/50 with a tiny image. */
  display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 0;
  margin-top: var(--space-md);
  border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  background: var(--color-surface); overflow: hidden;
}
.npc-preview-image-col { border-right: 1px solid var(--color-border); display: flex; flex-direction: column; min-height: 520px; }
.npc-preview-data-col { display: flex; flex-direction: column; min-height: 520px; }
.npc-preview-header {
  padding: 10px 14px; border-bottom: 1px solid var(--color-border);
  background: rgba(255,255,255,0.02); display: flex; align-items: center; justify-content: space-between;
}
.npc-preview-title { font-size: 0.92rem; font-weight: 700; color: var(--color-text); }
.npc-preview-link {
  font-size: 0.72rem; color: var(--color-primary); background: none; border: none;
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}
.npc-preview-image-area {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 20px; min-height: 460px;
  background: radial-gradient(circle at center, color-mix(in oklch, var(--color-sage-400) 5%, transparent), transparent 70%);
}
.npc-preview-image-wrap {
  cursor: pointer;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.npc-preview-image-wrap:hover { transform: scale(1.015); }
.npc-preview-image-wrap img,
.npc-preview-image-wrap :deep(.image-display),
.npc-preview-image-wrap :deep(img) {
  /* Max dimensions pinned to viewport so tall portraits stretch to fill the
     canvas while wide scenes still fit. Was hard-capped at 280px which looked
     like a thumbnail inside a giant panel. */
  max-height: min(72vh, 720px);
  max-width: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
.npc-preview-empty { text-align: center; color: var(--color-text-secondary); font-size: 0.82rem; }
.npc-preview-empty-icon { font-size: 2.5rem; margin-bottom: 8px; opacity: 0.4; }
.npc-preview-data { flex: 1; padding: 16px; overflow-y: auto; }
.npc-preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.npc-meta-label { font-size: 0.68rem; color: var(--color-text-secondary); margin-bottom: 2px; }
.npc-meta-value { font-size: 0.82rem; color: var(--color-text); }
.npc-preview-desc-section { border-top: 1px solid var(--color-border); padding-top: 12px; margin-top: 12px; }
.npc-preview-desc-section:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.npc-preview-desc {
  font-size: 0.78rem; color: var(--color-text-secondary); line-height: 1.6;
  white-space: pre-wrap; margin-top: 4px;
}
.npc-preview-traits {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;
}
.npc-preview-trait {
  font-size: 0.72rem;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  color: var(--color-primary);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* ── Foreground confirm overlay ── */
.confirm-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.confirm-card {
  width: 100%; max-width: 480px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); padding: 24px;
  display: flex; flex-direction: column; gap: 14px;
}
.confirm-card--wide {
  max-width: 720px;
  padding: 0;
  gap: 0;
  overflow: hidden;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
.confirm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px;
  padding: 22px 26px 18px;
  border-bottom: 1px solid var(--color-border);
  background: radial-gradient(circle at top right, color-mix(in oklch, var(--color-sage-400) 8%, transparent), transparent 70%);
}
.confirm-close {
  width: 28px; height: 28px;
  padding: 0;
  border: none; border-radius: 6px;
  background: transparent; color: var(--color-text-secondary);
  font-size: 1.2rem; line-height: 1;
  cursor: pointer; transition: all 0.15s;
}
.confirm-close:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-text); }
.confirm-title { font-size: 1.1rem; font-weight: 700; color: var(--color-text); }
.confirm-subtitle { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 4px; }

.confirm-body {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  max-height: 68vh;
  overflow-y: auto;
}
/* Character preview rail — fixed width, sticky visual anchor for the user. */
.confirm-character {
  display: flex; flex-direction: column; align-items: center;
  padding: 20px;
  border-right: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
  text-align: center;
}
.confirm-character-avatar {
  width: 120px; height: 120px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--color-border);
  background: rgba(0, 0, 0, 0.2);
  margin-bottom: 12px;
}
.confirm-character-avatar__img,
.confirm-character-avatar :deep(.image-display),
.confirm-character-avatar :deep(img) {
  width: 100%; height: 100%; object-fit: cover;
}
.confirm-character-name { font-size: 1rem; font-weight: 700; color: var(--color-text); }
.confirm-character-meta { font-size: 0.72rem; color: var(--color-text-secondary); margin-top: 4px; }
.confirm-character-anchor {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 10px;
  font-size: 0.7rem; color: var(--color-text-secondary);
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
}
.confirm-anchor-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.confirm-anchor-dot--on { background: var(--color-success); box-shadow: 0 0 6px color-mix(in oklch, var(--color-success) 60%, transparent); }
.confirm-anchor-dot--off { background: var(--color-text-muted); }
.confirm-anchor-name { color: var(--color-text); font-weight: 500; }
.confirm-character-desc {
  margin-top: 10px;
  font-size: 0.72rem; line-height: 1.5;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}

.confirm-params-panel {
  padding: 20px 24px;
  display: flex; flex-direction: column; gap: 18px;
}
.confirm-section { display: flex; flex-direction: column; gap: 8px; }
.confirm-section-title {
  font-size: 0.72rem; font-weight: 700;
  color: var(--color-text-secondary);
  text-transform: uppercase; letter-spacing: 0.08em;
  margin: 0; padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
}
.confirm-dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin: 0;
}
.confirm-dl-row { display: flex; flex-direction: column; gap: 2px; }
.confirm-dl-row dt { font-size: 0.68rem; color: var(--color-text-secondary); }
.confirm-dl-row dd { margin: 0; font-size: 0.84rem; color: var(--color-text); font-weight: 500; }

.confirm-kv { display: flex; gap: 10px; font-size: 0.78rem; line-height: 1.5; padding: 6px 0; }
.confirm-kv + .confirm-kv { border-top: 1px dashed var(--color-border); }
.confirm-kv-key { flex-shrink: 0; width: 72px; color: var(--color-text-secondary); }
.confirm-kv-value { flex: 1; color: var(--color-text); white-space: pre-wrap; }

/* Legacy compact modal styles — preserved so any un-upgraded callsite still renders. */
.confirm-params {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; background: rgba(255,255,255,0.03);
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
}
.confirm-param { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--color-text); }
.confirm-param__key { color: var(--color-text-secondary); }
.confirm-progress {
  display: flex; align-items: center; gap: 10px; font-size: 0.82rem;
  color: var(--color-primary); padding: 10px;
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent); background: color-mix(in oklch, var(--color-sage-400) 5%, transparent);
  border-radius: var(--radius-md);
}
.confirm-progress-text { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.confirm-spinner {
  width: 18px; height: 18px; border: 2px solid var(--color-border);
  border-top-color: var(--color-primary); border-radius: 50%;
  animation: spin 0.8s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
.confirm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.02);
  border-top: 1px solid var(--color-border);
}
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn-primary, .btn-secondary { padding: 6px 16px; font-size: 0.82rem; font-weight: 600; border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.grid-btn__label { font-size: 0.82rem; font-weight: 600; color: inherit; }
.grid-btn__sub { font-size: 0.62rem; margin-top: 2px; color: var(--color-text-secondary); }

.npc-summary-card {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
}
.npc-summary-name { font-size: var(--font-size-md); font-weight: 600; color: var(--color-text); }
.npc-summary-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); display: flex; gap: var(--space-sm); margin-top: 2px; }
.badge-major { color: var(--color-warning); font-weight: 500; }
.npc-summary-desc { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-top: var(--space-xs); line-height: var(--line-height-normal); }

/* Anchor banner */
.anchor-banner {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  border: 1px solid;
}
.anchor-banner--active { background: color-mix(in oklch, var(--color-success) 8%, transparent); border-color: color-mix(in oklch, var(--color-success) 30%, transparent); color: var(--color-success); }
.anchor-banner--inactive { background: color-mix(in oklch, var(--color-amber-400) 8%, transparent); border-color: color-mix(in oklch, var(--color-amber-400) 30%, transparent); color: var(--color-warning); }
.anchor-banner--none { background: var(--color-surface-elevated); border-color: var(--color-border); color: var(--color-text-muted); }
.gen-nav-buttons { display: flex; gap: var(--space-xs); }

.gen-error {
  padding: var(--space-sm); background: var(--color-danger-muted);
  border: 1px solid var(--color-danger); border-radius: var(--radius-md);
  color: var(--color-danger); font-size: var(--font-size-sm);
}

/* ── Per-NPC task status display (Phase 3.1) ── */
.npc-task-status {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  margin-bottom: var(--space-sm);
}
.npc-task-status--active { border-color: var(--color-info); background: rgba(var(--color-info-rgb, 56, 189, 248), 0.08); }
.npc-task-status--complete { border-color: var(--color-success); }
.npc-task-status--failed { border-color: var(--color-danger); }
.task-status-header {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);
}
.task-status-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 9999px;
  font-size: var(--font-size-xs); font-weight: 600; line-height: 1.4;
}
.task-status-badge--info { background: rgba(var(--color-info-rgb, 56, 189, 248), 0.15); color: var(--color-info); }
.task-status-badge--warning { background: rgba(var(--color-warning-rgb, 245, 158, 11), 0.15); color: var(--color-warning); }
.task-status-badge--success { background: rgba(var(--color-success-rgb, 34, 197, 94), 0.15); color: var(--color-success); }
.task-status-badge--danger { background: rgba(var(--color-danger-rgb, 239, 68, 68), 0.15); color: var(--color-danger); }
.task-status-time { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.task-status-progress { font-size: var(--font-size-sm); color: var(--color-info); margin-top: 4px; }
.task-status-error { font-size: var(--font-size-sm); color: var(--color-danger); margin-top: 4px; }

/* Legacy preview styles removed — functionality moved to npc-preview-panel */
.prompt-details { margin-top: var(--space-xs); }
.prompt-details summary { font-size: var(--font-size-xs); color: var(--color-text-muted); cursor: pointer; }
.prompt-text { font-size: var(--font-size-xs); color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; background: var(--color-bg); padding: var(--space-sm); border-radius: var(--radius-sm); margin-top: var(--space-xs); }

.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-3xl); color: var(--color-text-muted); gap: var(--space-sm); }
.hint { font-size: var(--font-size-xs); }

/* Task badges (shared) */
.task-badge { padding: 2px 8px; border-radius: var(--radius-xs); font-size: var(--font-size-xs); font-weight: 500; }
.task-badge--complete { background: var(--color-success-muted); color: var(--color-success); }
.task-badge--failed { background: var(--color-danger-muted); color: var(--color-danger); }
.task-badge--generating { background: var(--color-warning-muted); color: var(--color-warning); }
.task-badge--tokenizing { background: var(--color-info); color: var(--color-text-bone); }
.task-badge--pending { background: var(--color-primary-muted); color: var(--color-primary); }

/* Queue tab v2 */
.queue-header-v2 {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  margin-bottom: var(--space-md); gap: var(--space-md);
}
.queue-clear-buttons { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
.task-list-v2 { display: flex; flex-direction: column; gap: var(--space-md); }
.queue-card-v2 {
  position: relative; padding: var(--space-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast);
}
.queue-card-v2:hover { border-color: var(--color-primary); }
.queue-type-corner {
  position: absolute; top: 0; right: 0;
  padding: 2px 8px; font-size: 10px; color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 212,175,55), 0.1);
  border-bottom: 1px solid var(--color-border); border-left: 1px solid var(--color-border);
  border-bottom-left-radius: var(--radius-md);
}
.queue-card-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.queue-card-title { padding-right: 80px; }
.queue-card-name { font-size: var(--font-size-md); font-weight: 500; color: var(--color-text); }
.queue-card-sub { font-size: 10px; color: var(--color-text-muted); display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-top: 2px; }
.queue-card-status-area { display: flex; align-items: center; gap: var(--space-xs); }
.queue-meta-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-xs); font-size: 11px;
}
.queue-meta-cell {
  padding: var(--space-xs); border: 1px solid var(--color-border);
  border-radius: var(--radius-xs); background: var(--color-surface-elevated);
}
.queue-meta-cell--progress { position: relative; overflow: hidden; }
.queue-meta-cell--progress::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--color-primary); opacity: 0.3;
}
.queue-meta-label { font-size: 10px; color: var(--color-primary); opacity: 0.5; margin-bottom: 2px; }
.queue-meta-value { color: var(--color-text-secondary); font-family: monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-card-failed-actions {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-xs);
  margin-top: var(--space-sm); padding-top: var(--space-xs); border-top: 1px solid var(--color-border);
}
.queue-card-prompts { margin-top: var(--space-xs); display: flex; flex-direction: column; gap: var(--space-2xs); }
.queue-card-actions-row {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-xs);
  margin-top: var(--space-sm); padding-top: var(--space-xs); border-top: 1px solid var(--color-border);
}

/* Gallery tab */
.gallery-layout { display: flex; gap: var(--space-md); height: 100%; }
.gallery-npc-list {
  width: 160px; flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  overflow-y: auto; padding-right: var(--space-sm);
  display: flex; flex-direction: column; gap: var(--space-2xs);
}
.gallery-npc-btn {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--space-xs) var(--space-sm);
  background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-md); color: var(--color-text-secondary);
  font-size: var(--font-size-sm); cursor: pointer;
  transition: all var(--duration-fast);
}
.gallery-npc-btn:hover { background: var(--color-primary-muted); color: var(--color-text); }
.gallery-npc-btn--active {
  background: var(--color-primary-muted); border-color: var(--color-primary);
  color: var(--color-primary); font-weight: 500;
}
.gallery-npc-name { flex: 1; text-align: left; }
.gallery-npc-count {
  background: var(--color-surface-elevated); padding: 1px 6px;
  border-radius: var(--radius-full); font-size: var(--font-size-xs);
}
.gallery-empty-list { padding: var(--space-lg); text-align: center; color: var(--color-text-muted); font-size: var(--font-size-sm); }

.gallery-grid-area { flex: 1; overflow-y: auto; }
.gallery-header {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: var(--space-sm); margin-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-md);
}
.gallery-header-left { display: flex; flex-direction: column; gap: var(--space-2xs); }
.gallery-header h3 { font-size: var(--font-size-xl); color: var(--color-primary); margin: 0; }
.gallery-header-badges { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.gallery-info-badge {
  padding: 2px 8px; border-radius: var(--radius-xs);
  border: 1px solid var(--color-border); background: var(--color-surface-elevated);
  font-size: 11px; color: var(--color-text-secondary);
}
.gallery-info-badge--count { color: var(--color-primary); border-color: rgba(var(--color-primary-rgb, 212, 175, 55), 0.3); }
.gallery-header-actions { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }

.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-md); }
.gallery-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-normal);
}
.gallery-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 20px rgba(var(--color-primary-rgb, 212, 175, 55), 0.15);
}
.gallery-card-image { position: relative; aspect-ratio: 3/4; overflow: hidden; }
.gallery-card-image :deep(.img-display) { width: 100%; height: 100%; border-radius: 0; }
.gallery-card-image :deep(.img-display__img) {
  transition: transform 700ms ease;
}
.gallery-card:hover .gallery-card-image :deep(.img-display__img) {
  transform: scale(1.03);
}

/* Overlay badges: stacked column at top-left */
.gallery-overlay-badges {
  position: absolute; top: var(--space-xs); left: var(--space-xs);
  display: flex; flex-direction: column; gap: 4px;
  opacity: 0.9; transition: opacity var(--duration-fast);
}
.gallery-card:hover .gallery-overlay-badges { opacity: 1; }

.gallery-status-badge {
  display: inline-block; width: fit-content;
  padding: 1px 8px; border-radius: var(--radius-xs);
  font-size: 10px; font-weight: 500;
  border: 1px solid; backdrop-filter: blur(4px);
  background: rgba(0, 0, 0, 0.6); box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.gallery-status-badge--complete { border-color: var(--color-success); color: var(--color-success); }
.gallery-status-badge--failed { border-color: var(--color-danger); color: var(--color-danger); }
.gallery-status-badge--generating,
.gallery-status-badge--tokenizing { border-color: var(--color-warning); color: var(--color-warning); }
.gallery-status-badge--pending { border-color: var(--color-text-muted); color: var(--color-text-muted); }

.gallery-usage-badge {
  display: inline-block; width: fit-content;
  padding: 1px 8px; border-radius: var(--radius-xs);
  font-size: 10px; font-weight: 500;
  border: 1px solid var(--color-primary); color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 212, 175, 55), 0.2);
  backdrop-filter: blur(4px);
  box-shadow: 0 0 10px rgba(var(--color-primary-rgb, 212, 175, 55), 0.3);
}
.gallery-card-meta {
  padding: var(--space-sm); display: flex; flex-direction: column; gap: var(--space-xs);
  background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.15));
}
.gallery-meta-top {
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2xs);
}
.gallery-meta-comp { font-size: var(--font-size-sm); color: var(--color-primary); opacity: 0.9; }
.gallery-meta-time { font-size: 10px; color: var(--color-text-muted); font-family: monospace; }
.gallery-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs); }
.gallery-meta-cell {
  border: 1px solid var(--color-border); background: var(--color-surface-elevated);
  border-radius: var(--radius-xs); padding: var(--space-2xs) var(--space-xs);
  text-align: center; cursor: help;
  transition: color var(--duration-fast);
}
.gallery-meta-cell:hover { color: var(--color-text); }
.gallery-meta-label { font-size: 10px; color: var(--color-primary); opacity: 0.5; margin-bottom: 2px; }
.gallery-meta-value { font-size: 11px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gallery-card-prompts { display: flex; flex-direction: column; gap: var(--space-2xs); margin-top: var(--space-2xs); }
.gallery-card-actions {
  padding: var(--space-xs) var(--space-sm) var(--space-sm);
  display: flex; flex-direction: column; gap: var(--space-2xs);
  border-top: 1px solid var(--color-border);
}
.gallery-actions-row {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2xs);
}

/* Scene tab v2 */
.scene-layout-v2 { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: var(--space-lg); height: 100%; }
.scene-left-col { display: flex; flex-direction: column; gap: var(--space-md); overflow-y: auto; }
.scene-right-col {
  display: flex; flex-direction: column; gap: var(--space-lg);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); padding: var(--space-md); overflow: hidden;
}
.scene-section { display: flex; flex-direction: column; gap: var(--space-2xs); }
.scene-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-xs); }
.scene-limit-row { display: flex; align-items: center; gap: var(--space-xs); margin-top: var(--space-2xs); }
.scene-limit-input { width: 80px; }
.scene-status-text {
  padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-md);
  border: 1px solid var(--color-primary); background: rgba(var(--color-primary-rgb, 212,175,55), 0.1);
  color: var(--color-primary); font-size: var(--font-size-sm);
}
.scene-form-actions { display: flex; gap: var(--space-sm); align-items: center; }

/* Scene queue section */
.scene-queue-section { flex-shrink: 0; max-height: 30%; display: flex; flex-direction: column; }
.scene-queue-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-xs); }
.scene-queue-actions { display: flex; gap: var(--space-2xs); }
.scene-queue-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2xs); }
.scene-queue-card {
  padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); background: var(--color-surface-elevated);
}
.scene-queue-card-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-xs); }
.scene-queue-summary { font-size: var(--font-size-sm); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-queue-card-meta { font-size: 10px; color: var(--color-text-muted); margin-top: 2px; }

/* Scene history section */
.scene-history-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.scene-history-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-sm); }
.scene-history-count { font-size: 10px; color: var(--color-text-muted); }
.scene-history-grid {
  flex: 1; overflow-y: auto; display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--space-md); padding-bottom: var(--space-md);
}
.scene-history-card {
  background: var(--color-surface-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-normal);
}
.scene-history-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 20px rgba(var(--color-primary-rgb, 212, 175, 55), 0.15);
}
.scene-history-card-image { position: relative; aspect-ratio: 16/9; overflow: hidden; }
.scene-history-card-image :deep(.img-display) { width: 100%; height: 100%; border-radius: 0; }
.scene-history-card-body { padding: var(--space-sm); display: flex; flex-direction: column; gap: var(--space-2xs); }
.scene-history-card-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2xs); }
.scene-history-card-time { font-size: 10px; color: var(--color-text-muted); font-family: monospace; }
.scene-history-card-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2xs); margin-top: var(--space-xs); }

/* Wallpaper card (shared) */
.wallpaper-card {
  position: relative; border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid var(--color-border); cursor: pointer;
  transition: border-color var(--duration-fast);
}
.wallpaper-card:hover { border-color: var(--color-primary); }
.wallpaper-card :deep(.img-display) { width: 100%; height: auto; aspect-ratio: 16/9; border-radius: 0; }
.wallpaper-badge {
  position: absolute; top: var(--space-xs); right: var(--space-xs);
  padding: 2px 8px; border-radius: var(--radius-xs);
  border: 1px solid var(--color-primary); color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 212, 175, 55), 0.2);
  backdrop-filter: blur(4px); font-size: 10px;
}
.wallpaper-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--space-xl); border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg); color: var(--color-text-muted);
  gap: var(--space-xs);
}

/* History tab v2 */
.history-header-v2 {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  margin-bottom: var(--space-md); gap: var(--space-md);
}
.history-header-actions { display: flex; flex-wrap: wrap; gap: var(--space-xs); align-items: center; }
.history-list-v2 { display: flex; flex-direction: column; gap: var(--space-md); }
.history-card-v2 {
  display: flex; flex-direction: row;
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); overflow: hidden;
  transition: border-color var(--duration-fast), box-shadow var(--duration-normal);
}
.history-card-v2:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 20px rgba(var(--color-primary-rgb, 212, 175, 55), 0.15);
}
.history-card-image-v2 {
  width: 33.33%; flex-shrink: 0; position: relative; overflow: hidden;
  aspect-ratio: 3/4; border-right: 1px solid var(--color-border);
}
.history-card-image-v2--landscape { aspect-ratio: 16/9; min-height: 240px; }
.history-card-image-v2 :deep(.img-display) { width: 100%; height: 100%; border-radius: 0; }
.history-card-image-v2 :deep(.img-display__img) {
  transition: transform 700ms ease;
}
.history-card-v2:hover .history-card-image-v2 :deep(.img-display__img) {
  transform: scale(1.03);
}
.history-type-badge-v2 {
  display: inline-block; width: fit-content;
  padding: 1px 8px; border-radius: var(--radius-xs);
  font-size: 10px; font-weight: 500;
  border: 1px solid var(--color-primary); color: var(--color-primary);
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
}
.history-card-body-v2 {
  flex: 1; padding: var(--space-md);
  display: flex; flex-direction: column; gap: var(--space-sm);
}
.history-card-title-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-sm);
  border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-sm);
}
.history-card-name-v2 { font-size: var(--font-size-lg); font-weight: 500; color: var(--color-text); }
.history-card-sub-v2 {
  font-size: 10px; color: var(--color-text-muted);
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); margin-top: 2px;
}
.history-comp-badge {
  padding: 1px 6px; border-radius: var(--radius-xs);
  border: 1px solid var(--color-border); background: var(--color-surface-elevated);
  color: var(--color-primary); font-size: 10px;
}
.history-meta-grid-v2 {
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-xs);
}
.history-meta-cell-v2 {
  padding: var(--space-xs); border: 1px solid var(--color-border);
  border-radius: var(--radius-xs); background: var(--color-surface-elevated);
}
.history-meta-cell-v2--error {
  border-color: color-mix(in oklch, var(--color-danger) 30%, transparent); background: color-mix(in oklch, var(--color-danger) 5%, transparent);
  color: var(--color-danger); font-size: var(--font-size-xs);
}
.history-meta-label-v2 { font-size: 10px; color: var(--color-primary); opacity: 0.5; margin-bottom: 2px; }
.history-meta-value-v2 { font-size: var(--font-size-xs); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-details-v2 { display: flex; flex-direction: column; gap: var(--space-2xs); }
.history-actions-v2 {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-xs);
  margin-top: auto; padding-top: var(--space-xs); border-top: 1px solid var(--color-border);
}

/* Settings tab */
.settings-tab { display: flex; flex-direction: column; gap: var(--space-md); }
.settings-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-md);
  padding: var(--space-xs) 0;
}
.settings-row-inline { display: flex; align-items: center; gap: var(--space-sm); }
.settings-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
.settings-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-md); }

/* Presets tab */
.presets-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--space-lg); }
.presets-sidebar { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.presets-scope-toggle { display: flex; gap: var(--space-2xs); }
.presets-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2xs); }
/* Preset card header */
.preset-card-header {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: var(--space-sm); margin-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-sm);
}
.preset-card-actions { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
/* PNG preset list with thumbnails */
.png-preset-list-col { width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
.png-preset-list { max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-xs); }
.preset-item--png { padding: var(--space-xs); }
.png-preset-item-inner { display: flex; gap: var(--space-xs); align-items: center; }
.png-preset-thumb {
  width: 80px; height: 56px; flex-shrink: 0; border-radius: var(--radius-xs);
  border: 1px solid var(--color-border); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-bg); font-size: 10px;
}
.png-preset-thumb img { width: 100%; height: 100%; object-fit: cover; }
.png-preset-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.png-import-footer { margin-top: var(--space-sm); padding-top: var(--space-sm); border-top: 1px solid var(--color-border); }
.png-import-status { display: flex; align-items: center; gap: var(--space-xs); }
/* Artist preset controls (scope + dropdown) */
.artist-preset-controls {
  display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.artist-preset-editor { display: flex; flex-direction: column; gap: var(--space-md); padding-top: var(--space-sm); border-top: 1px solid var(--color-border); }
/* PNG editor header */
.png-cover-area {
  width: 120px; flex-shrink: 0;
  border: 1px solid var(--color-border); border-radius: var(--radius-md);
  overflow: hidden; aspect-ratio: 4/3;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-bg); font-size: 10px; color: var(--color-text-muted);
}
.png-cover-area img { width: 100%; height: 100%; object-fit: cover; }
.png-source-meta { display: flex; flex-direction: column; gap: 2px; }
.preset-item {
  display: flex; flex-direction: column; padding: var(--space-xs) var(--space-sm);
  background: transparent; border: 1px solid transparent; border-radius: var(--radius-md);
  text-align: left; cursor: pointer; color: var(--color-text-secondary);
  font-size: var(--font-size-sm); transition: all var(--duration-fast);
}
.preset-item:hover { background: var(--color-primary-muted); }
.preset-item--active { border-color: var(--color-primary); background: var(--color-primary-muted); color: var(--color-primary); }
.preset-item-name { font-weight: 500; }
.preset-item-preview { font-size: var(--font-size-xs); color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.presets-actions { display: flex; gap: var(--space-2xs); align-items: center; }
.presets-actions .form-input { flex: 1; }
.presets-editor { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
.presets-editor-actions { display: flex; gap: var(--space-sm); }
.transformer-section {
  margin-top: var(--space-lg); padding: var(--space-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.transformer-crud-layout { display: flex; gap: var(--space-lg); margin-top: var(--space-sm); }
.transformer-sidebar { width: 200px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.transformer-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2xs); max-height: 200px; }
.transformer-editor { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
.transformer-scope-toggle { display: flex; gap: var(--space-2xs); }
.transformer-empty { padding: var(--space-sm); text-align: center; }

/* Preset card sections (MRJH bordered card pattern with corner badge) */
.preset-card {
  position: relative; margin-bottom: var(--space-lg); padding: var(--space-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  transition: border-color var(--duration-fast);
}
.preset-card:hover { border-color: var(--color-primary); }
.preset-card-badge {
  position: absolute; top: 0; right: 0;
  padding: 2px 8px; font-size: 10px; color: var(--color-primary);
  background: rgba(var(--color-primary-rgb, 212,175,55), 0.1);
  border-bottom: 1px solid var(--color-border); border-left: 1px solid var(--color-border);
  border-bottom-left-radius: var(--radius-md);
}
.auto-bindings { margin-bottom: var(--space-lg); padding: var(--space-md); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.bindings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-top: var(--space-sm); }

/* Rules tab */
.rules-layout { display: flex; flex-direction: column; gap: var(--space-md); }
.rules-header { display: flex; justify-content: space-between; align-items: center; }
.rules-header-actions { display: flex; gap: var(--space-xs); align-items: center; }
.rules-scope-tabs { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.rules-template-section {
  padding: var(--space-md); background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius-lg);
}
.rules-template-header {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: var(--space-sm); margin-bottom: var(--space-sm);
  border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-sm);
}
/* Model rulesets collapsible */
.model-ruleset-section {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); overflow: hidden;
}
.model-ruleset-toggle {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  width: 100%; background: transparent; border: none;
  cursor: pointer; color: var(--color-text); text-align: left;
  transition: background var(--duration-fast);
}
.model-ruleset-toggle:hover { background: var(--color-primary-muted); }
.model-ruleset-active-name {
  font-size: var(--font-size-xs); color: var(--color-primary);
  padding: 1px 6px; border-radius: var(--radius-xs);
  background: var(--color-primary-muted);
}
.model-ruleset-expand-text { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.model-ruleset-body { padding: var(--space-md); border-top: 1px solid var(--color-border); }
.model-ruleset-actions { display: flex; gap: var(--space-xs); margin-bottom: var(--space-md); }
.model-ruleset-two-col { display: flex; gap: var(--space-lg); }
.model-ruleset-left { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-md); }
.model-ruleset-right { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }

.rules-two-col { display: flex; gap: var(--space-lg); }
.rules-left-col { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-md); }
.rules-right-col { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
.rules-crud-buttons { display: flex; gap: var(--space-xs); }
.form-input {
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.form-input:focus { outline: none; border-color: var(--color-primary); }
.form-hint { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-2xs); }

/* Stats bar */
.stats-bar {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: var(--space-sm); padding: var(--space-sm) 0;
}
.stat-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.stat-value { font-size: var(--font-size-lg); font-weight: 600; color: var(--color-text); font-family: var(--font-mono); }
.stat-label { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.stat-card--success .stat-value { color: var(--color-success); }
.stat-card--danger .stat-value { color: var(--color-danger); }
.stat-card--info .stat-value { color: var(--color-info); }
.stat-card--warning .stat-value { color: var(--color-warning); }
.stat-card--bar { justify-content: center; }

/* Preset preview in manual form */
.preset-preview { margin-top: 2px; padding: var(--space-2xs) var(--space-xs); background: var(--color-surface-elevated); border-radius: var(--radius-xs); }

/* ── Secret part section (fuchsia theme) ── */
.secret-section {
  margin-top: var(--space-md); padding: 16px;
  border: 1px solid rgba(192, 38, 211, 0.3);
  border-radius: var(--radius-lg);
  background: rgba(192, 38, 211, 0.04);
}
.secret-header-row { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid rgba(192,38,211,0.15); padding-bottom: 10px; margin-bottom: 12px; }
.secret-title { font-size: 0.95rem; font-weight: 700; color: #c084fc; margin: 0; }
.secret-desc { font-size: 0.68rem; color: var(--color-text-secondary); margin: 3px 0 0; }
.secret-all-btn {
  padding: 5px 12px; font-size: 0.72rem; font-weight: 500;
  border: 1px solid rgba(192,38,211,0.4); border-radius: var(--radius-md);
  background: rgba(192,38,211,0.1); color: #d8b4fe; cursor: pointer;
  transition: all 0.2s;
}
.secret-all-btn:hover { background: rgba(192,38,211,0.2); }
.secret-all-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.secret-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px; }
.secret-status { padding: 8px 10px; border: 1px solid rgba(192,38,211,0.25); background: rgba(192,38,211,0.08); border-radius: var(--radius-md); font-size: 0.78rem; color: #d8b4fe; margin-bottom: 12px; }
.secret-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.secret-card { border: 1px solid rgba(192,38,211,0.2); background: rgba(0,0,0,0.3); border-radius: var(--radius-md); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.secret-card-header { display: flex; align-items: center; justify-content: space-between; }
.secret-card-label { font-size: 0.82rem; font-weight: 600; color: #d8b4fe; }
.secret-card-btn {
  font-size: 0.62rem; padding: 3px 8px;
  border: 1px solid rgba(192,38,211,0.35); border-radius: var(--radius-sm);
  background: rgba(0,0,0,0.5); color: #c084fc; cursor: pointer;
}
.secret-card-btn:hover { background: rgba(192,38,211,0.15); }
.secret-card-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.secret-card-image {
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  overflow: hidden;
  position: relative;
}
.secret-card-image--has-img {
  cursor: zoom-in;
  transition: transform 0.2s;
}
.secret-card-image--has-img:hover { transform: scale(1.02); }
.secret-card-img,
.secret-card-image :deep(img),
.secret-card-image :deep(.image-display) {
  width: 100%; height: 100%;
  object-fit: cover;
}
.secret-card-placeholder {
  width: 100%; height: 100%;
  border: 1px dashed rgba(192,38,211,0.2);
  background: rgba(0,0,0,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.72rem; color: var(--color-text-secondary);
}

/* Fuchsia-themed grid buttons */
.grid-btn--fuchsia { border-color: rgba(192,38,211,0.2); }
.grid-btn--fuchsia:hover { border-color: rgba(192,38,211,0.5); background: rgba(192,38,211,0.06); }
.grid-btn--fuchsia-active {
  border-color: #c084fc !important; background: rgba(192,38,211,0.2) !important;
  color: #d8b4fe !important; box-shadow: 0 0 10px rgba(192,38,211,0.2);
}
.form-textarea--fuchsia { border-color: color-mix(in oklch, #e879a0 20%, transparent); }
.form-textarea--fuchsia:focus { border-color: #e879a0; }
.secret-header { font-size: var(--font-size-sm); color: #e879a0; margin-bottom: var(--space-2xs); }
.secret-desc { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-sm); }
.secret-parts { display: flex; gap: var(--space-sm); }

/* PNG import */
.presets-import { display: flex; flex-direction: column; gap: var(--space-2xs); }
.png-import-btn {
  display: inline-flex; align-items: center; gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface-elevated); border: 1px dashed var(--color-border);
  border-radius: var(--radius-md); color: var(--color-text-secondary);
  font-size: var(--font-size-xs); cursor: pointer;
  transition: border-color var(--duration-fast);
}
.png-import-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.png-status { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.png-status--loading { color: var(--color-warning); }
/* Anchor management */
.anchor-section {
  margin-bottom: var(--space-lg); padding: var(--space-md);
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.anchor-layout { display: flex; gap: var(--space-lg); margin-top: var(--space-sm); }
.anchor-list-col { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; gap: var(--space-sm); }
.anchor-list { max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2xs); }
.anchor-editor-col { flex: 1; display: flex; flex-direction: column; gap: var(--space-md); }
.anchor-actions-row { display: flex; gap: var(--space-xs); }
.anchor-extract-msg {
  padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-md);
  font-size: var(--font-size-xs); border: 1px solid;
}
.anchor-extract-msg--info { border-color: var(--color-primary); background: rgba(var(--color-primary-rgb, 212,175,55), 0.08); color: var(--color-primary); }
.anchor-extract-msg--done { border-color: var(--color-success); background: color-mix(in oklch, var(--color-success) 8%, transparent); color: var(--color-success); }
.anchor-extract-msg--error { border-color: var(--color-danger); background: color-mix(in oklch, var(--color-danger) 8%, transparent); color: var(--color-danger); }
.anchor-toggles { display: flex; flex-direction: column; gap: var(--space-xs); }
.anchor-badges { display: flex; gap: var(--space-2xs); }
.anchor-badge--on { font-size: var(--font-size-xs); color: var(--color-success); }
.anchor-badge--off { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.anchor-badge--link { font-size: var(--font-size-xs); color: var(--color-info); }
.anchor-features {
  background: var(--color-bg); border-radius: var(--radius-md); padding: var(--space-sm);
  display: flex; flex-direction: column; gap: var(--space-2xs);
}
.anchor-feature-row { display: flex; gap: var(--space-sm); align-items: baseline; }
.anchor-status-card {
  display: flex; flex-direction: column; gap: 2px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface-elevated); border-radius: var(--radius-md);
}

.presets-io { display: flex; gap: var(--space-2xs); margin-top: var(--space-2xs); }

/* PNG deep editor */
.png-editor-header {
  display: flex; align-items: center; gap: var(--space-sm);
  padding: var(--space-xs); background: var(--color-surface-elevated);
  border-radius: var(--radius-md); margin-bottom: var(--space-xs);
}
.png-cover-thumb { width: 80px; height: 56px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
.png-no-cover {
  width: 80px; height: 56px; display: flex; align-items: center; justify-content: center;
  background: var(--color-bg); border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--color-text-muted); flex-shrink: 0;
}
.png-source-info { display: flex; flex-direction: column; gap: 2px; }
.png-metadata-details { margin-top: var(--space-xs); }
.png-metadata-details summary {
  font-size: var(--font-size-xs); color: var(--color-text-muted); cursor: pointer;
  padding: var(--space-2xs) 0;
}
.png-metadata-details summary:hover { color: var(--color-primary); }
.png-metadata-content { display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-xs); }
.png-meta-block { display: flex; flex-direction: column; gap: var(--space-2xs); }

.form-advanced {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--color-border, #2a2a3a);
  border-radius: 6px;
}
.form-advanced > summary {
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  user-select: none;
}
.form-advanced[open] > summary {
  margin-bottom: 8px;
  color: var(--color-text, #e0e0e6);
}
.form-textarea--error {
  border-color: var(--color-error, #f87171) !important;
}
.btn-sm {
  padding: 4px 12px;
  font-size: 0.8rem;
}
</style>
