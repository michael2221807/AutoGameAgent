<script setup lang="ts">
/**
 * CharacterDetailsPanel — 角色详情面板。
 *
 * 三系统审计结论（2026-04-08）：
 * - 角色.基础信息.年龄 由 AI 直接 set，无需从出生年份推算
 * - 社交.关系 ← 数组，每项含 名称/好感度/内心想法/在做事项 等字段
 * - 属性读取路径与现有代码一致，schema 驱动优先
 *
 * 2026-04-08 升级：英雄头像区、Tab 结构（基础/属性/关系/成就）
 */
import { ref, computed, inject, watch } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { useConfig } from '@/ui/composables/useConfig';
import Modal from '@/ui/components/common/Modal.vue';
import SchemaForm from '@/ui/components/editing/SchemaForm.vue';
import ImageDisplay from '@/ui/components/image/ImageDisplay.vue';
import RegenerateSameModal from '@/ui/components/image/RegenerateSameModal.vue';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';
import AgaSelect from '@/ui/components/shared/AgaSelect.vue';
import type { SelectOption } from '@/ui/components/shared/AgaSelect.vue';
import AgaButton from '@/ui/components/shared/AgaButton.vue';
import { eventBus } from '@/engine/core/event-bus';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { readStatFields } from '@/engine/pack/stat-section-reader';
import { extractAnchorViaAI } from '@/engine/image/anchor-extractor';
import type { AIService } from '@/engine/ai/ai-service';
import type { ImageService } from '@/engine/image/image-service';
import type { ImageBackendType } from '@/engine/image/types';

const P = DEFAULT_ENGINE_PATHS;

const { isLoaded, useValue, setValue, get } = useGameState();
const imageService = inject<ImageService>('imageService');
const aiService = inject<AIService | undefined>('aiService', undefined);

// ─── Player image generation ───
const compositionOptions: SelectOption[] = [
  { label: '头像 (1:1)', value: 'portrait' },
  { label: '半身 (3:4)', value: 'half-body' },
  { label: '立绘 (全身)', value: 'full-length' },
];
const styleOptions: SelectOption[] = [
  { label: '通用', value: 'generic' },
  { label: '二次元', value: 'anime' },
  { label: '写实', value: 'realistic' },
  { label: '国风', value: 'chinese' },
];

const playerComposition = ref('portrait');
const playerStyle = ref('generic');
const playerExtraPrompt = ref('');
const playerArtistPreset = ref('');
const playerPngPreset = ref('');
const playerSize = ref('');
const playerGenerating = ref(false);
const playerGenError = ref('');

const playerArchiveReactive = useValue<Record<string, unknown>>('角色.图片档案');
const playerArchive = computed(() => {
  const raw = playerArchiveReactive.value;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
});
const playerArchiveHistory = computed(() => {
  const h = playerArchive.value['生图历史'];
  return Array.isArray(h) ? (h as Array<Record<string, unknown>>) : [];
});
const playerAvatarId = computed(() => String(playerArchive.value['已选头像图片ID'] ?? ''));
const playerPortraitId = computed(() => String(playerArchive.value['已选立绘图片ID'] ?? ''));

// Player image stats
const playerImageStats = computed(() => ({
  total: playerArchiveHistory.value.length,
  avatarBound: !!playerAvatarId.value,
  portraitBound: !!playerPortraitId.value,
  anchorName: (get('系统.扩展.image.characterAnchors') as Array<Record<string, unknown>> | undefined)
    ?.find((a) => a.npcName === '__player__')?.name as string | undefined,
}));

// Artist/PNG presets from state
const playerArtistPresetOptions = computed<SelectOption[]>(() => {
  const raw = get('系统.扩展.image.artistPresets');
  if (!Array.isArray(raw)) return [{ label: '不使用', value: '' }];
  const npcPresets = (raw as Array<Record<string, unknown>>).filter((p) => p.scope === 'npc' && !String(p.id ?? '').startsWith('png_'));
  return [{ label: '不使用', value: '' }, ...npcPresets.map((p) => ({ label: String(p.name ?? ''), value: String(p.id ?? '') }))];
});
const playerPngPresetOptions = computed<SelectOption[]>(() => {
  const raw = get('系统.扩展.image.artistPresets');
  if (!Array.isArray(raw)) return [{ label: '不启用', value: '' }];
  const pngPresets = (raw as Array<Record<string, unknown>>).filter((p) => p.scope === 'npc' && String(p.id ?? '').startsWith('png_'));
  return [{ label: '不启用', value: '' }, ...pngPresets.map((p) => ({ label: String(p.name ?? ''), value: String(p.id ?? '') }))];
});

// ─── Player anchor management ───
const extractingAnchor = ref(false);

const playerAnchor = computed(() => {
  const anchors = get('系统.扩展.image.characterAnchors') as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(anchors)) return null;
  return anchors.find((a) => a.subjectId === '__player__' || a.npcName === '__player__') ?? null;
});

const anchorPositive = ref('');
const anchorNegative = ref('');
const anchorEnabled = ref(true);
const anchorAppendDefault = ref(true);
const anchorAutoScene = ref(false);

watch(() => playerAnchor.value, (anchor) => {
  if (anchor) {
    anchorPositive.value = String(anchor.positivePrompt ?? '');
    anchorNegative.value = String(anchor.negativePrompt ?? '');
    anchorEnabled.value = anchor.enabled !== false;
    anchorAppendDefault.value = anchor.appendByDefault !== false;
    anchorAutoScene.value = anchor.autoInjectToScene === true;
  }
}, { immediate: true });

async function extractPlayerAnchor() {
  if (!aiService) {
    eventBus.emit('ui:toast', { type: 'error', message: 'AI 服务未就绪', duration: 2500 });
    return;
  }
  extractingAnchor.value = true;
  try {
    const playerName = get(P.playerName) as string ?? '主角';

    const npcData: Record<string, unknown> = { 姓名: playerName };
    const tryGet = (path: string) => { const v = get(path); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
    if (gender.value) npcData['性别'] = gender.value;
    if (age.value) npcData['年龄'] = age.value;
    if (occupation.value) npcData['身份'] = occupation.value;
    const descText = tryGet(P.characterDescription);
    if (descText) npcData['描述'] = descText;
    const appearance = tryGet('角色.外貌描写') ?? tryGet('角色.描述');
    if (appearance) npcData['外貌描述'] = appearance;
    const bodyDesc = tryGet('角色.身材描写');
    if (bodyDesc) npcData['身材描写'] = bodyDesc;
    const outfitStyle = tryGet('角色.衣着风格');
    if (outfitStyle) npcData['衣着风格'] = outfitStyle;
    if (traitText.value) npcData['特质'] = traitText.value;

    const result = await extractAnchorViaAI(
      aiService,
      JSON.stringify(npcData, null, 2),
      { displayName: playerName },
    );

    const anchors = (get('系统.扩展.image.characterAnchors') as unknown[] ?? []).filter(
      (a) => (a as Record<string, unknown>).subjectId !== '__player__' && (a as Record<string, unknown>).npcName !== '__player__'
    );
    const newAnchor = {
      id: `anchor_player_${Date.now()}`,
      subjectId: '__player__',
      npcName: '__player__',
      name: `${playerName} 锚点`,
      enabled: true,
      appendByDefault: true,
      autoInjectToScene: false,
      positivePrompt: result.positivePrompt,
      negativePrompt: result.negativePrompt,
      structuredFeatures: result.structuredFeatures,
      source: 'ai_extract',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    anchors.push(newAnchor);
    setValue('系统.扩展.image.characterAnchors', anchors);
    eventBus.emit('engine:request-save');
    eventBus.emit('ui:toast', { type: 'success', message: '锚点提取完成', duration: 2000 });
  } catch (err) {
    eventBus.emit('ui:toast', { type: 'error', message: `锚点提取失败：${(err as Error).message}`, duration: 3500 });
  } finally {
    extractingAnchor.value = false;
  }
}

function savePlayerAnchor() {
  const anchors = (get('系统.扩展.image.characterAnchors') as Array<Record<string, unknown>> ?? []).map((a) => {
    if (a.subjectId === '__player__' || a.npcName === '__player__') {
      return {
        ...a,
        positivePrompt: anchorPositive.value,
        negativePrompt: anchorNegative.value,
        enabled: anchorEnabled.value,
        appendByDefault: anchorAppendDefault.value,
        autoInjectToScene: anchorAutoScene.value,
        updatedAt: Date.now(),
      };
    }
    return a;
  });
  setValue('系统.扩展.image.characterAnchors', anchors);
  eventBus.emit('engine:request-save');
}

function deletePlayerAnchor() {
  const anchors = (get('系统.扩展.image.characterAnchors') as unknown[] ?? []).filter(
    (a) => (a as Record<string, unknown>).subjectId !== '__player__' && (a as Record<string, unknown>).npcName !== '__player__'
  );
  setValue('系统.扩展.image.characterAnchors', anchors);
  eventBus.emit('engine:request-save');
}

async function generatePlayerImage() {
  if (!imageService || playerGenerating.value) return;
  playerGenerating.value = true;
  playerGenError.value = '';
  try {
    const playerName = get(P.playerName) as string ?? '主角';
    const playerDesc = get(P.characterDescription) as string ?? '';
    const defaultBackend = String(get('系统.扩展.image.config.defaultBackend') ?? 'novelai') as import('@/engine/image/types').ImageBackendType;
    const anchor = playerAnchor.value;

    // Build NPC-format data JSON (MRJH: player mapped to NPC format)
    const npcData: Record<string, unknown> = { 姓名: playerName };
    const tryGet = (path: string) => { const v = get(path); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
    if (gender.value) npcData['性别'] = gender.value;
    if (age.value) npcData['年龄'] = age.value;
    if (occupation.value) npcData['身份'] = occupation.value;
    const bg = tryGet(P.characterDescription);
    if (bg) npcData['简介'] = bg;
    const appearance = tryGet('角色.外貌描写') ?? tryGet('角色.描述');
    if (appearance) npcData['外貌'] = appearance;

    // Parse custom size
    let w: number | undefined;
    let h: number | undefined;
    if (playerSize.value.trim()) {
      const m = playerSize.value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if (m) { w = Number(m[1]); h = Number(m[2]); }
    }

    // Use __player__ as characterName so image-service writes to 角色.图片档案 via ImageStateManager
    const task = await imageService.generateCharacterImage({
      characterName: '__player__',
      description: playerDesc,
      backend: defaultBackend,
      composition: playerComposition.value as 'portrait' | 'half-body' | 'full-length',
      artStyle: playerStyle.value === 'generic' ? '通用' : playerStyle.value === 'anime' ? '二次元' : playerStyle.value === 'realistic' ? '写实' : '国风',
      extraPrompt: playerExtraPrompt.value || undefined,
      anchorPositive: anchor?.enabled !== false ? String(anchor?.positivePrompt ?? '') || undefined : undefined,
      anchorNegative: anchor?.enabled !== false ? String(anchor?.negativePrompt ?? '') || undefined : undefined,
      npcDataJson: JSON.stringify(npcData, null, 2),
      preset: w && h ? { id: 'custom', width: w, height: h } : undefined,
    });

    if (task.status === 'failed') {
      playerGenError.value = task.error ?? '生成失败';
    }
    // Archive write is now handled by image-service via ImageStateManager.__player__ path
  } catch (err) {
    playerGenError.value = (err as Error).message ?? String(err);
  } finally {
    playerGenerating.value = false;
  }
}

function setPlayerAvatar(assetId: string) {
  const archive = { ...(get('角色.图片档案') ?? {}) } as Record<string, unknown>;
  archive['已选头像图片ID'] = playerAvatarId.value === assetId ? '' : assetId;
  setValue('角色.图片档案', archive);
  eventBus.emit('engine:request-save');
}

function setPlayerPortrait(assetId: string) {
  const archive = { ...(get('角色.图片档案') ?? {}) } as Record<string, unknown>;
  archive['已选立绘图片ID'] = playerPortraitId.value === assetId ? '' : assetId;
  setValue('角色.图片档案', archive);
  eventBus.emit('engine:request-save');
}

function deletePlayerImage(assetId: string) {
  const archive = { ...(get('角色.图片档案') ?? {}) } as Record<string, unknown>;
  const history = Array.isArray(archive['生图历史'])
    ? (archive['生图历史'] as Array<Record<string, unknown>>).filter((r) => String(r.id) !== assetId)
    : [];
  archive['生图历史'] = history;
  if (archive['已选头像图片ID'] === assetId) archive['已选头像图片ID'] = '';
  if (archive['已选立绘图片ID'] === assetId) archive['已选立绘图片ID'] = '';
  if (archive['最近生图结果'] === assetId) archive['最近生图结果'] = history[0]?.id ?? '';
  setValue('角色.图片档案', archive);
  eventBus.emit('engine:request-save');
}

// ── Regenerate-Same for player images ──
// Parallel to ImagePanel's version — uses the same ImageService API but scoped
// to __player__, so regenerated images flow back into 角色.图片档案.生图历史.
interface PlayerRegenPayload {
  subjectLabel: string;
  subtitle?: string;
  composition: 'portrait' | 'half-body' | 'full-length';
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  initialBackend: ImageBackendType;
  artStyle?: string;
}
const playerRegenPayload = ref<PlayerRegenPayload | null>(null);
const playerRegenBusy = ref(false);

function openPlayerRegenerate(img: Record<string, unknown>) {
  const positive = String(img.positivePrompt ?? '');
  if (!positive.trim()) {
    eventBus.emit('ui:toast', { type: 'error', message: '该记录未保存提示词，无法同款生成', duration: 2000 });
    return;
  }
  const comp = (String(img.composition ?? 'portrait') as 'portrait' | 'half-body' | 'full-length');
  const width = Number(img.width) || 832;
  const height = Number(img.height) || 1216;
  const rawBackend = String(img.backend ?? '');
  const bk = (rawBackend as ImageBackendType) || (String(get('系统.扩展.image.config.defaultBackend') ?? 'novelai') as ImageBackendType);
  const playerName = String(name.value ?? '主角');
  const compLabel = comp === 'portrait' ? '头像' : comp === 'half-body' ? '半身' : '立绘';
  playerRegenPayload.value = {
    subjectLabel: playerName,
    subtitle: [compLabel, `${width} × ${height}`, bk].filter(Boolean).join(' · '),
    composition: comp,
    positivePrompt: positive,
    negativePrompt: String(img.negativePrompt ?? ''),
    width,
    height,
    initialBackend: bk,
    artStyle: String(img.artStyle ?? '') || undefined,
  };
}

function cancelPlayerRegenerate() {
  if (playerRegenBusy.value) return;
  playerRegenPayload.value = null;
}

async function confirmPlayerRegenerate(opts: { backend: ImageBackendType }) {
  if (!imageService || !playerRegenPayload.value || playerRegenBusy.value) return;
  const p = playerRegenPayload.value;
  playerRegenBusy.value = true;
  try {
    const task = await imageService.regenerateFromPrompts({
      subjectType: 'character',
      targetCharacter: '__player__',
      composition: p.composition,
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
      eventBus.emit('ui:toast', { type: 'success', message: '同款任务已提交', duration: 2000 });
      playerRegenPayload.value = null;
    }
  } catch (err) {
    eventBus.emit('ui:toast', { type: 'error', message: `同款生成失败：${(err as Error).message}`, duration: 2500 });
  } finally {
    playerRegenBusy.value = false;
  }
}
const { getStateSchema } = useConfig();

// ─── Character basic info (reactive) ───

const name = useValue<string>(P.playerName);
const age = useValue<number>(P.characterAge);
const location = useValue<string>(P.playerLocation);
const gender = useValue<string>(P.characterGender);
const occupation = useValue<string>(P.characterOccupation);
const description = useValue<string>(P.characterDescription);

// 2026-04-11 fix：特质 schema 是 string（单个名称），不是 string[]。
// 旧代码按 string[] 读取会在 string 类型值上走 `.slice` / `v-for` 迭代字符，
// 导致显示异常。这里读为 unknown + 双形态 fallback（兼容旧存档）。
const traitsRaw = useValue<unknown>(P.characterTraits);
const traitText = computed<string>(() => {
  const v = traitsRaw.value;
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').join('、');
  }
  return '';
});

// 2026-04-11 fix：补全创角身份字段的读取 —— 出身 / 天赋档次 / 天赋列表 / 先天六维。
// 之前 CharacterDetailsPanel 只显示基础信息 + 后天属性，身份字段完全没展示，
// 导致玩家创角选的天资/出身/特质/天赋不出现在角色页面上。
const origin = useValue<string>(P.characterOrigin);
const talentTier = useValue<string>(P.characterTalentTier);
const talentList = useValue<unknown>(P.talents);
const innateStats = useValue<Record<string, unknown>>(P.characterInnateStats);

/** 天赋列表统一为 string[]（兼容 schema 定义的 string[] 和偶发的单字符串 fallback） */
const talentNames = computed<string[]>(() => {
  const v = talentList.value;
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  }
  if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
  return [];
});

const attributes = useValue<Record<string, unknown>>(P.characterAttributes);

// ─── Relationships ───

interface RelationEntry {
  名称: string;
  好感度?: number;
  内心想法?: string;
  在做事项?: string;
  [key: string]: unknown;
}

const relationships = useValue<RelationEntry[]>(P.relationships);

const relationList = computed<RelationEntry[]>(() => {
  const raw = relationships.value;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => typeof r?.名称 === 'string');
});

/** 好感度颜色 */
function affinityColor(val: number | undefined): string {
  if (val === undefined) return 'var(--color-text-secondary)';
  if (val >= 60) return 'var(--color-success)';
  if (val >= 30) return 'var(--color-sage-300)';
  if (val >= 0) return 'var(--color-text-secondary)';
  return 'var(--color-danger)';
}

/** 好感度 bar 宽度（0-100%，以50为中点） */
function affinityPct(val: number | undefined): number {
  if (val === undefined) return 50;
  return Math.min(100, Math.max(0, ((val + 100) / 200) * 100));
}

// ─── NSFW body data ───

const nsfwEnabled = computed(() => get<boolean>('系统.nsfwMode') === true);

interface BodyPart {
  部位名称: string;
  敏感度?: number;
  开发度?: number;
  特征描述?: string;
  特殊印记?: string;
}

interface UterusData {
  状态?: string;
  宫口状态?: string;
  内射记录?: Array<{ 日期?: string; 描述?: string; 怀孕判定日?: string }>;
}

interface PlayerBody {
  身高?: number;
  体重?: number;
  三围?: { 胸围?: number; 腰围?: number; 臀围?: number };
  胸部描述?: string;
  私处描述?: string;
  生殖器描述?: string;
  身体部位?: BodyPart[];
  子宫?: UterusData;
  敏感点?: string[];
  开发度?: Record<string, number>;
  纹身与印记?: string[];
}

const playerBody = useValue<PlayerBody>('角色.身体');

const hasBodyData = computed(() => {
  const b = playerBody.value;
  if (!b || typeof b !== 'object') return false;
  return !!(b.身高 || b.体重 || b.三围 || b.胸部描述 || b.私处描述 || b.生殖器描述
    || b.身体部位?.length || b.敏感点?.length || b.开发度 || b.纹身与印记?.length);
});

const bodyParts = computed<BodyPart[]>(() => {
  const raw = playerBody.value?.身体部位;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is BodyPart => !!p?.部位名称);
});

const devEntries = computed<Array<{ part: string; val: number }>>(() => {
  const raw = playerBody.value?.开发度;
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .filter(([, v]) => typeof v === 'number')
    .map(([part, val]) => ({ part, val: val as number }));
});

// ─── Tab state ───

type Tab = 'basic' | 'attributes' | 'relations' | 'achievements' | 'body' | 'playerImage';
const activeTab = ref<Tab>('basic');

const tabList = computed(() => {
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'basic', label: '基础' },
    { id: 'attributes', label: '属性' },
    { id: 'relations', label: '关系', count: relationList.value.length },
    { id: 'achievements', label: '成就' },
  ];
  if (nsfwEnabled.value) {
    tabs.push({ id: 'body', label: '身体' });
  }
  tabs.push({ id: 'playerImage', label: '主角生图' });
  return tabs;
});

// ─── Inline editing state ───

interface EditingField {
  path: string;
  label: string;
  value: string;
}

const editingField = ref<EditingField | null>(null);
const editInputValue = ref('');

function startInlineEdit(path: string, label: string, currentValue: unknown): void {
  editingField.value = { path, label, value: String(currentValue ?? '') };
  editInputValue.value = String(currentValue ?? '');
}

function commitInlineEdit(): void {
  if (!editingField.value) return;
  const { path } = editingField.value;
  const raw = editInputValue.value.trim();

  const numericPaths: string[] = [P.characterAge];
  if (numericPaths.includes(path) && !isNaN(Number(raw))) {
    setValue(path, Number(raw));
  } else {
    setValue(path, raw);
  }

  editingField.value = null;
  eventBus.emit('ui:toast', { type: 'success', message: '已更新', duration: 1500 });
}

function cancelInlineEdit(): void {
  editingField.value = null;
}

// ─── SchemaForm modal for complex editing ───

const showSchemaModal = ref(false);
const schemaModalData = ref<Record<string, unknown>>({});
const schemaModalPath = ref('');
const schemaModalTitle = ref('');

function getSubSchema(dotPath: string): Record<string, unknown> {
  const schema = getStateSchema();
  const segments = dotPath.split('.');
  let current: Record<string, unknown> = schema;
  for (const seg of segments) {
    const props = current['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props && props[seg]) {
      current = props[seg];
    } else {
      return {};
    }
  }
  return current;
}

function openSchemaEdit(path: string, title: string): void {
  const data = get<Record<string, unknown>>(path);
  schemaModalPath.value = path;
  schemaModalTitle.value = title;
  schemaModalData.value = data ? (JSON.parse(JSON.stringify(data)) as Record<string, unknown>) : {};
  showSchemaModal.value = true;
}

function onSchemaUpdate(newValue: unknown): void {
  schemaModalData.value = newValue as Record<string, unknown>;
}

function saveSchemaEdit(): void {
  setValue(schemaModalPath.value, schemaModalData.value);
  showSchemaModal.value = false;
  eventBus.emit('ui:toast', { type: 'success', message: '数据已保存', duration: 1500 });
}

// ─── Attributes computed ───

interface AttributeEntry {
  key: string;
  label: string;
  current: number;
  max: number | null;
}

const attributeList = computed<AttributeEntry[]>(() => {
  const raw = attributes.value;
  if (!raw || typeof raw !== 'object') return [];

  const schema = getStateSchema();
  const defs = readStatFields(schema, P.characterAttributes);

  if (defs.length > 0) {
    return defs.map((def) => ({
      key: def.key,
      label: def.key,
      current: typeof raw[def.key] === 'number' ? (raw[def.key] as number) : 0,
      max: def.max,
    }));
  }

  return Object.entries(raw)
    .filter(([, val]) => typeof val === 'number')
    .map(([key, val]) => ({
      key,
      label: key,
      current: val as number,
      max: null,
    }));
});

function attrPercent(entry: AttributeEntry): number {
  if (entry.max === null || entry.max === 0) return 100;
  return Math.min(100, Math.max(0, (entry.current / entry.max) * 100));
}

/**
 * 先天六维列表（基线 1-10）
 *
 * 与 `attributeList` 的区别：
 *   - `attributeList` 读 `角色.属性`（后天六维，1-20），schema 驱动 x-display 扫描
 *   - 此 list 读 `角色.身份.先天六维`（基线 1-10），使用相同的字段名但独立存储
 *
 * 字段顺序与后天六维保持一致 —— 都来自同一个 schema stat section 扫描结果，
 * 只是值从不同路径读取。若后天六维列表为空（pack 未声明 x-display），退化为
 * 按先天六维对象的 own keys 顺序显示。
 */
const innateStatList = computed<AttributeEntry[]>(() => {
  const raw = innateStats.value;
  if (!raw || typeof raw !== 'object') return [];

  // 优先使用后天六维的字段顺序（schema x-order）以保持两列对齐
  if (attributeList.value.length > 0) {
    return attributeList.value.map((def) => ({
      key: def.key,
      label: def.label,
      current: typeof raw[def.key] === 'number' ? (raw[def.key] as number) : 0,
      max: 10, // 先天六维上限固定 10（与创角分配 perAttributeMax 对齐）
    }));
  }

  return Object.entries(raw)
    .filter(([, val]) => typeof val === 'number')
    .map(([key, val]) => ({
      key,
      label: key,
      current: val as number,
      max: 10,
    }));
});

function attrBarColor(pct: number): string {
  if (pct <= 25) return 'var(--color-danger)';
  if (pct <= 50) return 'var(--color-amber-400)';
  return 'var(--color-success)';
}

/** Schema for the SchemaForm modal */
const modalSchema = computed(() => getSubSchema(schemaModalPath.value));

/** Avatar initial */
const avatarInitial = computed<string>(() => {
  const n = name.value;
  if (!n || typeof n !== 'string') return '？';
  return n.charAt(0);
});
</script>

<template>
  <div class="character-panel">
    <template v-if="isLoaded">
      <!-- ─── Hero Header ─── -->
      <div class="hero-header">
        <div class="hero-avatar">
          <ImageDisplay
            v-if="playerAvatarId"
            :asset-id="playerAvatarId"
            :fallback-letter="avatarInitial"
            size="md"
            class="hero-avatar-img"
          />
          <span v-else>{{ avatarInitial }}</span>
        </div>
        <div class="hero-info">
          <div class="hero-name-row">
            <h2 class="hero-name">{{ name ?? '未命名' }}</h2>
            <span v-if="occupation" class="occupation-badge">{{ occupation }}</span>
          </div>
          <div class="hero-sub">
            <span v-if="gender" class="hero-meta-item">{{ gender }}</span>
            <span v-if="age != null" class="hero-meta-item">{{ age }} 岁</span>
            <span v-if="location" class="hero-meta-item location-item">📍 {{ location }}</span>
          </div>
          <!--
            2026-04-11 fix：特质是 string（单个），不是 string[]。
            用一个 chip 显示；附带天赋档次作为第二个 chip（若存在）。
          -->
          <div v-if="traitText || talentTier" class="trait-strip">
            <span v-if="traitText" class="trait-chip">{{ traitText }}</span>
            <span v-if="talentTier" class="trait-chip trait-chip--tier">{{ talentTier }}</span>
          </div>
        </div>
        <button class="btn-edit-all" title="编辑基础信息" @click="openSchemaEdit(P.characterBaseInfo, '编辑基础信息')">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
        </button>
      </div>

      <!-- ─── Tab bar ─── -->
      <div class="tab-bar" role="tablist">
        <button
          v-for="tab in tabList"
          :key="tab.id"
          role="tab"
          :class="['tab-btn', { 'tab-btn--active': activeTab === tab.id }]"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <span v-if="tab.count && tab.count > 0" class="tab-count">{{ tab.count }}</span>
        </button>
      </div>

      <!-- ─── Tab: 基础 ─── -->
      <template v-if="activeTab === 'basic'">
        <section class="info-card" aria-label="基础信息">
          <div class="info-grid">
            <!-- Name -->
            <div class="info-row" @dblclick="startInlineEdit(P.playerName, '姓名', name)">
              <span class="info-label">姓名</span>
              <template v-if="editingField?.path === P.playerName">
                <input
                  v-model="editInputValue"
                  class="inline-input"
                  @keydown.enter="commitInlineEdit"
                  @keydown.escape="cancelInlineEdit"
                  @blur="commitInlineEdit"
                />
              </template>
              <span v-else class="info-value">{{ name ?? '—' }}</span>
            </div>

            <!-- Age -->
            <div class="info-row" @dblclick="startInlineEdit(P.characterAge, '年龄', age)">
              <span class="info-label">年龄</span>
              <template v-if="editingField?.path === P.characterAge">
                <input
                  v-model="editInputValue"
                  type="number"
                  class="inline-input inline-input--narrow"
                  @keydown.enter="commitInlineEdit"
                  @keydown.escape="cancelInlineEdit"
                  @blur="commitInlineEdit"
                />
              </template>
              <span v-else class="info-value info-value--mono">{{ age ?? '—' }}</span>
            </div>

            <!-- Gender -->
            <div class="info-row">
              <span class="info-label">性别</span>
              <span class="info-value">{{ gender ?? '—' }}</span>
            </div>

            <!-- Occupation -->
            <div class="info-row">
              <span class="info-label">职业/地位</span>
              <span class="info-value">{{ occupation ?? '—' }}</span>
            </div>

            <!-- Location -->
            <div class="info-row">
              <span class="info-label">当前位置</span>
              <span class="info-value">{{ location ?? '—' }}</span>
            </div>
          </div>
        </section>

        <!--
          2026-04-11 fix：新增「身份」section，展示创角选定的只读身份元数据。
          之前这些字段（出身 / 天赋档次 / 天赋列表 / 特质）没有在角色页面展示，
          玩家只能在 GameVariablePanel 里看到原始 JSON。
        -->
        <section
          v-if="origin || talentTier || traitText || talentNames.length"
          class="info-card"
          aria-label="身份"
        >
          <h3 class="card-title">身份</h3>
          <div class="info-grid">
            <div v-if="origin" class="info-row">
              <span class="info-label">出身</span>
              <span class="info-value">{{ origin }}</span>
            </div>
            <div v-if="talentTier" class="info-row">
              <span class="info-label">天资</span>
              <span class="info-value">{{ talentTier }}</span>
            </div>
            <div v-if="traitText" class="info-row">
              <span class="info-label">特质</span>
              <span class="info-value">{{ traitText }}</span>
            </div>
          </div>
          <div v-if="talentNames.length" class="talent-section">
            <div class="talent-header">
              <span class="talent-label">天赋</span>
              <span class="badge">{{ talentNames.length }}</span>
            </div>
            <div class="talent-list">
              <span v-for="(t, idx) in talentNames" :key="idx" class="talent-tag">{{ t }}</span>
            </div>
          </div>
        </section>

        <section v-if="description" class="info-card" aria-label="角色描述">
          <h3 class="card-title">地位描述</h3>
          <p class="description-text">{{ description }}</p>
        </section>
      </template>

      <!-- ─── Tab: 属性 ─── -->
      <template v-else-if="activeTab === 'attributes'">
        <!--
          2026-04-11 fix：新增先天六维展示（创角基线，1-10 范围，只读）。
          与下方后天六维（运行时值，1-20 范围）对应同一套字段名，但来自不同状态树路径。
          先天六维 = 玩家分配的基线；后天六维 = 基线 + 出身修正 + 天赋修正。
        -->
        <section v-if="innateStatList.length" class="info-card" aria-label="先天六维">
          <h3 class="card-title">先天六维 <span class="card-subtitle">基线 · 1-10</span></h3>
          <div class="attribute-list attribute-list--compact">
            <div v-for="attr in innateStatList" :key="attr.key" class="attribute-item">
              <div class="attribute-header">
                <span class="attribute-name">{{ attr.label }}</span>
                <span class="attribute-numbers">
                  {{ attr.current }}<template v-if="attr.max !== null"> / {{ attr.max }}</template>
                </span>
              </div>
              <div class="attribute-bar">
                <div
                  class="attribute-bar__fill"
                  :style="{ width: attrPercent(attr) + '%', background: 'var(--color-text-secondary, #8888a0)' }"
                />
              </div>
            </div>
          </div>
        </section>

        <section class="info-card" aria-label="后天六维">
          <h3 class="card-title">
            后天六维 <span class="card-subtitle">当前 · 1-20</span>
            <button class="btn-icon" title="编辑属性" @click="openSchemaEdit(P.characterAttributes, '编辑属性')">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          </h3>
          <div v-if="attributeList.length" class="attribute-list">
            <div v-for="attr in attributeList" :key="attr.key" class="attribute-item">
              <div class="attribute-header">
                <span class="attribute-name">{{ attr.label }}</span>
                <span class="attribute-numbers">
                  {{ attr.current }}<template v-if="attr.max !== null"> / {{ attr.max }}</template>
                </span>
              </div>
              <div class="attribute-bar">
                <div
                  class="attribute-bar__fill"
                  :style="{ width: attrPercent(attr) + '%', background: attrBarColor(attrPercent(attr)) }"
                />
              </div>
            </div>
          </div>
          <p v-else class="empty-hint">暂无属性数据</p>
        </section>
      </template>

      <!-- ─── Tab: 关系 ─── -->
      <template v-else-if="activeTab === 'relations'">
        <div v-if="relationList.length" class="relation-list">
          <div
            v-for="(rel, idx) in relationList"
            :key="idx"
            class="relation-card"
          >
            <div class="relation-header">
              <div class="relation-avatar">
                <ImageDisplay
                  :asset-id="rel['图片档案']?.['已选头像图片ID']"
                  :fallback-letter="rel.名称?.charAt(0) ?? '?'"
                  size="md"
                  class="relation-avatar-img"
                />
              </div>
              <div class="relation-info">
                <span class="relation-name">{{ rel.名称 }}</span>
                <span v-if="rel.在做事项" class="relation-activity">{{ rel.在做事项 }}</span>
              </div>
              <div v-if="rel.好感度 !== undefined" class="affinity-badge" :style="{ color: affinityColor(rel.好感度) }">
                {{ rel.好感度 > 0 ? '+' : '' }}{{ rel.好感度 }}
              </div>
            </div>
            <!-- Affinity bar -->
            <div v-if="rel.好感度 !== undefined" class="affinity-bar">
              <div
                class="affinity-bar__fill"
                :style="{ width: affinityPct(rel.好感度) + '%', background: affinityColor(rel.好感度) }"
              />
            </div>
            <p v-if="rel.内心想法" class="relation-thought">
              <span class="thought-quote">「</span>{{ rel.内心想法 }}<span class="thought-quote">」</span>
            </p>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>尚无社交关系记录</p>
        </div>
      </template>

      <!-- ─── Tab: 身体 (NSFW) ─── -->
      <template v-else-if="activeTab === 'body' && nsfwEnabled">
        <div v-if="hasBodyData" class="body-nsfw-card">
          <div class="body-nsfw-title">♥ 法身档案 <span class="body-nsfw-badge">PRIVATE</span></div>

          <!-- Measurements row -->
          <div v-if="playerBody?.身高 || playerBody?.体重" class="body-metrics-row">
            <div v-if="playerBody?.身高" class="body-metric">
              <span class="body-metric-val">{{ playerBody.身高 }}</span>
              <span class="body-metric-lbl">cm</span>
            </div>
            <div v-if="playerBody?.体重" class="body-metric">
              <span class="body-metric-val">{{ playerBody.体重 }}</span>
              <span class="body-metric-lbl">kg</span>
            </div>
            <template v-if="playerBody?.三围">
              <div v-if="playerBody.三围.胸围" class="body-metric">
                <span class="body-metric-val">{{ playerBody.三围.胸围 }}</span>
                <span class="body-metric-lbl">胸围</span>
              </div>
              <div v-if="playerBody.三围.腰围" class="body-metric">
                <span class="body-metric-val">{{ playerBody.三围.腰围 }}</span>
                <span class="body-metric-lbl">腰围</span>
              </div>
              <div v-if="playerBody.三围.臀围" class="body-metric">
                <span class="body-metric-val">{{ playerBody.三围.臀围 }}</span>
                <span class="body-metric-lbl">臀围</span>
              </div>
            </template>
          </div>

          <!-- Text descriptions -->
          <div v-if="playerBody?.胸部描述" class="body-desc-field">
            <span class="body-hint">胸部描述</span>
            <p class="body-desc-text">{{ playerBody.胸部描述 }}</p>
          </div>
          <div v-if="playerBody?.私处描述" class="body-desc-field">
            <span class="body-hint">私处描述</span>
            <p class="body-desc-text">{{ playerBody.私处描述 }}</p>
          </div>
          <div v-if="playerBody?.生殖器描述" class="body-desc-field">
            <span class="body-hint">生殖器描述</span>
            <p class="body-desc-text">{{ playerBody.生殖器描述 }}</p>
          </div>

          <!-- Body parts grid (mirrors NPC 私密信息.身体部位) -->
          <div v-if="bodyParts.length" class="body-parts-section">
            <span class="body-hint" style="display:block;margin-bottom:6px">身体部位</span>
            <div class="bp-grid">
              <div v-for="(bp, bi) in bodyParts" :key="bi" class="bp-card">
                <div class="bp-head">
                  {{ bp.部位名称 }}
                  <span v-if="bp.特殊印记" class="bp-mark">{{ bp.特殊印记 }}</span>
                </div>
                <p v-if="bp.特征描述" class="bp-desc">{{ bp.特征描述 }}</p>
                <div class="bp-meters">
                  <div class="bp-meter">
                    <span>敏感</span>
                    <div class="bp-bar"><div class="bp-fill" :style="{ width: (bp.敏感度 ?? 0) + '%' }" /></div>
                    <span>{{ bp.敏感度 ?? 0 }}</span>
                  </div>
                  <div class="bp-meter">
                    <span>开发</span>
                    <div class="bp-bar"><div class="bp-fill bp-fill--dev" :style="{ width: (bp.开发度 ?? 0) + '%' }" /></div>
                    <span>{{ bp.开发度 ?? 0 }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Uterus (mirrors NPC 子宫) -->
          <div v-if="playerBody?.子宫" class="body-uterus-section">
            <span class="body-hint" style="display:block;margin-bottom:6px">子宫</span>
            <div class="uterus-card">
              <div v-if="playerBody.子宫.状态" class="uterus-row">
                <span class="body-hint">状态</span>
                <span class="uterus-val">{{ playerBody.子宫.状态 }}</span>
              </div>
              <div v-if="playerBody.子宫.宫口状态" class="uterus-row">
                <span class="body-hint">宫口</span>
                <span class="uterus-val">{{ playerBody.子宫.宫口状态 }}</span>
              </div>
              <div v-if="playerBody.子宫.内射记录?.length" class="uterus-records">
                <span class="body-hint">内射记录 ({{ playerBody.子宫.内射记录.length }})</span>
                <div v-for="(rec, ri) in playerBody.子宫.内射记录" :key="ri" class="uterus-record-item">
                  <span v-if="rec.日期" class="uterus-record-date">{{ rec.日期 }}</span>
                  <span v-if="rec.描述" class="uterus-record-desc">{{ rec.描述 }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Legacy flat dev entries (for old saves that use 开发度 Record) -->
          <div v-if="devEntries.length && !bodyParts.length" class="body-dev-section">
            <span class="body-hint" style="display:block;margin-bottom:6px">开发度</span>
            <div class="body-dev-grid">
              <div v-for="d in devEntries" :key="d.part" class="body-dev-item">
                <span class="body-dev-name">{{ d.part }}</span>
                <div class="body-dev-bar"><div class="body-dev-fill" :style="{ width: d.val + '%' }" /></div>
                <span class="body-dev-num">{{ d.val }}</span>
              </div>
            </div>
          </div>

          <!-- Sensitive points -->
          <div v-if="playerBody?.敏感点?.length" class="body-tag-section">
            <span class="body-hint">敏感点</span>
            <div class="body-tag-row">
              <span v-for="s in playerBody.敏感点" :key="s" class="body-tag body-tag--nsfw">{{ s }}</span>
            </div>
          </div>

          <!-- Tattoos / marks -->
          <div v-if="playerBody?.纹身与印记?.length" class="body-tag-section">
            <span class="body-hint">纹身与印记</span>
            <div class="body-tag-row">
              <span v-for="t in playerBody.纹身与印记" :key="t" class="body-tag body-tag--mark">{{ t }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>尚无身体数据</p>
        </div>
      </template>

      <!-- ─── Tab: 成就 ─── -->
      <template v-else-if="activeTab === 'achievements'">
        <div class="achievement-placeholder">
          <span class="achievement-icon">🏆</span>
          <p>成就系统暂未开放</p>
        </div>
      </template>

      <!-- ─── Tab: 主角生图 ─── -->
      <template v-else-if="activeTab === 'playerImage'">
        <!-- Stats card (MRJH §C) -->
        <div class="player-stats-bar">
          <div class="player-stat-card"><span class="player-stat-val">{{ playerImageStats.total }} 张</span><span class="player-stat-lbl">影像总数</span></div>
          <div class="player-stat-card"><span class="player-stat-val" :style="{ color: playerImageStats.avatarBound ? 'var(--color-success, #22c55e)' : 'var(--color-text-muted, #888)' }">{{ playerImageStats.avatarBound ? '已设置' : '未设置' }}</span><span class="player-stat-lbl">头像绑定</span></div>
          <div class="player-stat-card"><span class="player-stat-val" :style="{ color: playerImageStats.portraitBound ? 'var(--color-success, #22c55e)' : 'var(--color-text-muted, #888)' }">{{ playerImageStats.portraitBound ? '已设置' : '未设置' }}</span><span class="player-stat-lbl">立绘绑定</span></div>
          <div class="player-stat-card"><span class="player-stat-val">{{ playerImageStats.anchorName ?? '未建立' }}</span><span class="player-stat-lbl">角色锚点</span></div>
        </div>

        <section class="player-image-section">
          <div class="player-image-form">
            <h3 class="section-label">生成主角肖像</h3>
            <p class="section-desc">为你的角色生成图片，可在下方设为头像或立绘</p>

            <div class="pi-form-row">
              <label class="pi-label">构图</label>
              <AgaSelect v-model="playerComposition" :options="compositionOptions" />
            </div>

            <div class="pi-form-row">
              <label class="pi-label">画风</label>
              <AgaSelect v-model="playerStyle" :options="styleOptions" />
            </div>

            <div v-if="playerArtistPresetOptions.length > 1" class="pi-form-row">
              <label class="pi-label">画师串预设</label>
              <AgaSelect v-model="playerArtistPreset" :options="playerArtistPresetOptions" />
            </div>

            <div v-if="playerPngPresetOptions.length > 1" class="pi-form-row">
              <label class="pi-label">PNG 画风预设</label>
              <AgaSelect v-model="playerPngPreset" :options="playerPngPresetOptions" />
            </div>

            <div class="pi-form-row">
              <label class="pi-label">额外要求</label>
              <textarea v-model="playerExtraPrompt" class="pi-textarea" rows="2" placeholder="如：月下持剑、白衣飘飘…" />
            </div>

            <div class="pi-form-row">
              <label class="pi-label">尺寸</label>
              <input v-model="playerSize" class="pi-select" placeholder="如 832x1216（留空使用默认）" style="max-width:200px" />
            </div>

            <AgaButton
              class="pi-gen-btn"
              :loading="playerGenerating"
              @click="generatePlayerImage"
            >
              {{ `生成${playerComposition === 'portrait' ? '头像' : playerComposition === 'half-body' ? '半身' : '立绘'}` }}
            </AgaButton>

            <div v-if="playerGenError" class="pi-error">{{ playerGenError }}</div>

            <!-- Player anchor management (UI-IMPLEMENTATION-DESIGN §3.1) -->
            <div class="anchor-section">
              <h3 class="section-label">主角角色锚点</h3>
              <p class="section-desc">锚点保存角色的稳定视觉特征，让多次生图保持一致</p>

              <div v-if="playerAnchor" class="anchor-editor">
                <div class="anchor-status anchor-status--active">锚点已建立：{{ playerAnchor.name || '主角锚点' }}</div>

                <div class="pi-form-row">
                  <label class="pi-label">正面提示词</label>
                  <textarea v-model="anchorPositive" class="pi-textarea" rows="2" placeholder="稳定的角色视觉特征标签" />
                </div>
                <div class="pi-form-row">
                  <label class="pi-label">负面提示词</label>
                  <textarea v-model="anchorNegative" class="pi-textarea" rows="1" placeholder="需要排除的视觉元素" />
                </div>

                <div class="anchor-toggles">
                  <div class="anchor-toggle-row">
                    <div>
                      <span class="pi-label">启用锚点</span>
                      <span class="section-desc">关闭后不参与生图</span>
                    </div>
                    <AgaToggle v-model="anchorEnabled" />
                  </div>
                  <div class="anchor-toggle-row">
                    <div>
                      <span class="pi-label">生图默认附加</span>
                      <span class="section-desc">NPC 单图自动带入</span>
                    </div>
                    <AgaToggle v-model="anchorAppendDefault" />
                  </div>
                  <div class="anchor-toggle-row">
                    <div>
                      <span class="pi-label">场景自动注入</span>
                      <span class="section-desc">场景图自动注入</span>
                    </div>
                    <AgaToggle v-model="anchorAutoScene" />
                  </div>
                </div>

                <div class="anchor-actions">
                  <AgaButton size="sm" @click="savePlayerAnchor">保存锚点</AgaButton>
                  <AgaButton size="sm" variant="danger" @click="deletePlayerAnchor">删除锚点</AgaButton>
                </div>
              </div>

              <div v-else class="anchor-empty">
                <p>还没有主角锚点。点击下方按钮由 AI 提取。</p>
                <AgaButton size="sm" :loading="extractingAnchor" @click="extractPlayerAnchor">
                  AI 提取锚点
                </AgaButton>
              </div>
            </div>
          </div>

          <!-- Player image archive -->
          <div class="player-archive">
            <h3 class="section-label">主角影像档案</h3>
            <div v-if="playerArchiveHistory.length > 0" class="player-grid">
              <div v-for="img in playerArchiveHistory" :key="String(img.id)" class="player-img-card">
                <div class="player-img-preview">
                  <ImageDisplay :asset-id="String(img.id)" :fallback-letter="name?.charAt(0) ?? '?'" size="lg" />
                  <div class="player-img-badges">
                    <span class="player-img-badge player-img-badge--status">{{ img.status === 'failed' ? '失败' : '成功' }}</span>
                    <span v-if="img.composition" class="player-img-badge">{{ img.composition === 'portrait' ? '头像' : img.composition === 'half-body' ? '半身' : '立绘' }}</span>
                    <span v-if="playerAvatarId === String(img.id)" class="player-img-badge player-img-badge--selected">已设头像</span>
                    <span v-if="playerPortraitId === String(img.id)" class="player-img-badge player-img-badge--selected">已设立绘</span>
                  </div>
                </div>
                <div v-if="img.positivePrompt || img.negativePrompt" class="player-img-prompts">
                  <details v-if="img.positivePrompt" class="prompt-details">
                    <summary>最终正向提示词</summary>
                    <pre class="prompt-text">{{ img.positivePrompt }}</pre>
                  </details>
                  <details v-if="img.negativePrompt" class="prompt-details">
                    <summary>最终负面提示词</summary>
                    <pre class="prompt-text">{{ img.negativePrompt }}</pre>
                  </details>
                </div>
                <div class="player-img-actions">
                  <AgaButton
                    v-if="img.positivePrompt"
                    size="sm"
                    @click="openPlayerRegenerate(img as Record<string, unknown>)"
                  >生成同款</AgaButton>
                  <AgaButton
                    v-if="img.status !== 'failed' && img.composition !== 'secret_part'"
                    size="sm"
                    variant="secondary"
                    @click="setPlayerAvatar(String(img.id))"
                  >{{ playerAvatarId === String(img.id) ? '取消头像' : '设为头像' }}</AgaButton>
                  <AgaButton
                    v-if="img.status !== 'failed' && img.composition !== 'secret_part'"
                    size="sm"
                    variant="secondary"
                    @click="setPlayerPortrait(String(img.id))"
                  >{{ playerPortraitId === String(img.id) ? '取消立绘' : '设为立绘' }}</AgaButton>
                  <AgaButton size="sm" variant="danger" @click="deletePlayerImage(String(img.id))">删除</AgaButton>
                </div>
              </div>
            </div>
            <p v-else class="pi-empty">还没有生成过主角图片</p>
          </div>
        </section>
      </template>
    </template>

    <!-- Player Regenerate-Same modal -->
    <RegenerateSameModal
      v-if="playerRegenPayload"
      :subject-label="playerRegenPayload.subjectLabel"
      :subtitle="playerRegenPayload.subtitle"
      :positive-prompt="playerRegenPayload.positivePrompt"
      :negative-prompt="playerRegenPayload.negativePrompt"
      :width="playerRegenPayload.width"
      :height="playerRegenPayload.height"
      :initial-backend="playerRegenPayload.initialBackend"
      :busy="playerRegenBusy"
      @confirm="confirmPlayerRegenerate"
      @cancel="cancelPlayerRegenerate"
    />

    <!-- Not loaded state -->
    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>

    <!-- ─── SchemaForm Modal ─── -->
    <Modal v-model="showSchemaModal" :title="schemaModalTitle" width="560px">
      <SchemaForm
        :schema="modalSchema"
        :value="schemaModalData"
        @update:value="onSchemaUpdate"
      />
      <template #footer>
        <AgaButton variant="secondary" @click="showSchemaModal = false">取消</AgaButton>
        <AgaButton @click="saveSchemaEdit">保存</AgaButton>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.character-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  height: 100%;
  overflow-y: auto;
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}

/* ── Hero header ── */
.hero-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 18%, transparent);
  border-radius: 12px;
  position: relative;
}

.hero-avatar {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-size: 1.4rem;
  font-weight: 700;
  border-radius: 50%;
  overflow: hidden;
}
.hero-avatar-img :deep(.img-display) { width: 52px; height: 52px; border-radius: 50%; }
.hero-avatar-img :deep(.img-display__img) { width: 100%; height: 100%; object-fit: cover; }

.hero-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hero-name {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
}

.occupation-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 25%, transparent);
  border-radius: 10px;
  white-space: nowrap;
}

.hero-sub {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.hero-meta-item {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
}

.location-item {
  word-break: break-word;
}

.trait-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.trait-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border-radius: 10px;
}

.trait-chip--more {
  opacity: 0.6;
}

.trait-chip--tier {
  color: var(--color-amber-300);
  background: color-mix(in oklch, var(--color-amber-400) 12%, transparent);
}

.btn-edit-all {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-edit-all:hover {
  color: var(--color-sage-400);
  border-color: var(--color-sage-600);
}

/* ── Tab bar ── */
.tab-bar {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  padding: 3px;
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 8px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary, #8888a0);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--color-text, #e0e0e6);
  background: rgba(255, 255, 255, 0.04);
}

.tab-btn--active {
  color: var(--color-text-bone);
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  font-weight: 600;
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-sage-500);
  border-radius: 8px;
}

/* ── Cards ── */
.info-card {
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #8888a0);
}

.card-subtitle {
  font-size: 0.68rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.65;
  margin-left: 2px;
}

/* ── Info grid ── */
.info-grid {
  display: flex;
  flex-direction: column;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 0;
  cursor: default;
}
.info-row + .info-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.info-row:hover {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  padding-left: 4px;
  padding-right: 4px;
}

.info-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #8888a0);
}

.info-value {
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
  font-weight: 500;
  word-break: break-word;
}

.info-value--mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Inline editing ── */
.inline-input {
  height: 26px;
  padding: 0 8px;
  font-size: 0.84rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-primary, #6366f1);
  border-radius: 6px;
  outline: none;
  max-width: 160px;
}

.inline-input--narrow {
  max-width: 80px;
}

/* ── Description ── */
.description-text {
  margin: 0;
  font-size: 0.84rem;
  color: var(--color-text, #e0e0e6);
  line-height: 1.65;
  opacity: 0.9;
}

/* ── Traits ── */
.trait-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trait-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-radius: 14px;
}

/* ── Talents section (basic tab 身份 sub-section) ── */
.talent-section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.talent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.talent-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, #8888a0);
}

.talent-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.talent-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-success);
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-success) 22%, transparent);
  border-radius: 14px;
}

/* ── Attributes ── */
.attribute-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* compact variant for 先天六维 (thinner bars, tighter spacing) */
.attribute-list--compact {
  gap: 6px;
}
.attribute-list--compact .attribute-bar {
  height: 4px;
}
.attribute-list--compact .attribute-numbers {
  font-size: 0.72rem;
}

.attribute-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.attribute-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.attribute-name {
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  font-weight: 500;
}

.attribute-numbers {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text-secondary, #8888a0);
}

.attribute-bar {
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.attribute-bar__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

/* ── Relations ── */
.relation-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.relation-card {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.relation-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.relation-avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
}
.relation-avatar-img :deep(.img-display) { width: 34px; height: 34px; border-radius: 50%; }
.relation-avatar-img :deep(.img-display__img) { width: 100%; height: 100%; object-fit: cover; }
.relation-avatar-img :deep(.img-display__fallback) {
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  color: var(--color-sage-400);
  font-size: 0.9rem;
  font-weight: 700;
}

.relation-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.relation-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
}

.relation-activity {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.affinity-badge {
  font-size: 0.78rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  flex-shrink: 0;
}

.affinity-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}

.affinity-bar__fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
  opacity: 0.6;
}

.relation-thought {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  font-style: italic;
  line-height: 1.5;
}

.thought-quote {
  font-style: normal;
  opacity: 0.5;
}

/* ── Achievement placeholder ── */
.achievement-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.5;
}

.achievement-icon {
  font-size: 2rem;
}

.achievement-placeholder p {
  font-size: 0.85rem;
}

/* ── Badge ── */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-sage-500);
  border-radius: 9px;
}

/* ── Buttons ── */
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--color-text-secondary, #8888a0);
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s ease;
}
.btn-icon:hover {
  color: var(--color-sage-400);
}

/* ── Empty states ── */
.empty-hint {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
  margin: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100px;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.9rem;
}

/* ── Scrollbar ── */
.character-panel::-webkit-scrollbar {
  width: 5px;
}
.character-panel::-webkit-scrollbar-track {
  background: transparent;
}
.character-panel::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--color-text-umber) 35%, transparent);
  border-radius: 3px;
}

/* Player image stats bar */
.player-stats-bar {
  display: flex; gap: 8px; padding: 8px 0; margin-bottom: 8px;
}
.player-stat-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 6px 12px; background: var(--color-surface, #1a1a24);
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px;
  min-width: 80px;
}
.player-stat-val { font-size: 13px; font-weight: 600; color: var(--color-text, #e0e0e6); }
.player-stat-lbl { font-size: 11px; color: var(--color-text-muted, #55556a); }

/* Player image tab */
.player-image-section { display: flex; gap: var(--space-xl, 24px); }
.player-image-form { flex: 1; display: flex; flex-direction: column; gap: var(--space-md, 12px); }
.section-label { font-size: var(--font-size-md, 14px); color: var(--color-text, #e0e0e6); }
.section-desc { font-size: var(--font-size-xs, 12px); color: var(--color-text-muted, #55556a); }
.pi-form-row { display: flex; flex-direction: column; gap: 4px; }
.pi-label { font-size: var(--font-size-xs, 12px); color: var(--color-text-secondary, #8888a0); }
.pi-select, .pi-textarea {
  padding: 6px 10px;
  background: var(--color-surface-input, #1a1a24);
  border: 1px solid var(--color-border-subtle, #222230);
  border-radius: var(--radius-md, 8px);
  color: var(--color-text, #e0e0e6);
  font-size: var(--font-size-sm, 13px);
  transition: border-color var(--duration-fast) var(--ease-out);
}
.pi-select:focus, .pi-textarea:focus {
  outline: none;
  border-color: var(--color-sage-600);
}
.pi-textarea { resize: vertical; font-family: var(--font-sans); }
.pi-gen-btn { align-self: flex-start; }
.pi-error { padding: 6px 10px; background: color-mix(in oklch, var(--color-danger) 12%, transparent); border: 1px solid var(--color-danger); border-radius: 6px; color: var(--color-danger); font-size: 12px; }
.pi-empty { color: var(--color-text-muted, #55556a); font-size: 13px; text-align: center; padding: 24px; }
.player-archive { width: 300px; flex-shrink: 0; }
.player-grid { display: flex; flex-direction: column; gap: var(--space-sm, 8px); }
.player-img-card { background: var(--color-surface, #1a1a24); border: 1px solid var(--color-border, #2a2a3a); border-radius: 8px; overflow: hidden; }
.player-img-preview { position: relative; }
.player-img-preview :deep(.img-display) { width: 100%; height: auto; aspect-ratio: 3/4; border-radius: 0; }
.player-img-badges {
  position: absolute; top: 4px; left: 4px;
  display: flex; flex-direction: column; gap: 3px;
}
.player-img-badge {
  display: inline-block; width: fit-content;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 500;
  border: 1px solid var(--color-border, #2a2a3a);
  background: rgba(0,0,0,0.6); color: var(--color-text-muted, #888);
  backdrop-filter: blur(4px);
}
.player-img-badge--status { border-color: var(--color-success, #22c55e); color: var(--color-success, #22c55e); }
.player-img-badge--selected { border-color: var(--color-sage-400); color: var(--color-sage-300); background: color-mix(in oklch, var(--color-sage-400) 18%, transparent); }
.player-img-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; }
.player-img-prompts { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px 0; }
.player-img-prompts .prompt-details summary {
  font-size: 11px; color: var(--color-text-muted, #888); cursor: pointer;
  list-style: none;
}
.player-img-prompts .prompt-details summary::-webkit-details-marker { display: none; }
.player-img-prompts .prompt-details summary::before { content: '▸ '; display: inline-block; transition: transform 0.15s; }
.player-img-prompts .prompt-details[open] summary::before { transform: rotate(90deg); }
.player-img-prompts .prompt-text {
  font-size: 11px; color: var(--color-text-secondary, #b0b0c0);
  white-space: pre-wrap; word-break: break-all;
  max-height: 120px; overflow-y: auto;
  background: var(--color-bg, #0d0d14);
  padding: 6px 8px; border-radius: 4px; margin-top: 4px;
}

/* Anchor section */
.anchor-section {
  margin-top: var(--space-lg, 16px);
  padding: var(--space-md, 12px);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  background: var(--color-surface-elevated, #22222e);
}
.anchor-status { padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 8px; }
.anchor-status--active { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); }
.anchor-toggles { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.anchor-toggle-row {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--color-border, #2a2a3a); background: var(--color-surface, #1a1a24);
}
.anchor-actions { display: flex; gap: 6px; }
.anchor-empty { text-align: center; padding: 16px; color: var(--color-text-muted, #55556a); font-size: 13px; }
.anchor-empty p { margin-bottom: 8px; }

/* ── Body / NSFW tab ── */
.body-nsfw-card {
  padding: 14px;
  border-radius: var(--radius-lg, 12px);
  background: rgba(232, 121, 160, 0.03);
  border: 1px solid rgba(232, 121, 160, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.body-nsfw-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #e879a0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.body-nsfw-badge {
  font-size: 0.58rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(232, 121, 160, 0.12);
  color: #e879a0;
  letter-spacing: 0.06em;
}
.body-metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.body-metric {
  display: flex;
  align-items: baseline;
  gap: 3px;
  padding: 6px 12px;
  background: rgba(232, 121, 160, 0.04);
  border: 1px solid rgba(232, 121, 160, 0.08);
  border-radius: 8px;
}
.body-metric-val {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-bone, #e0e0e6);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.body-metric-lbl {
  font-size: 0.68rem;
  color: var(--color-text-secondary, #8888a0);
}
.body-hint {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-secondary, #8888a0);
}
.body-desc-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.body-desc-text {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.55;
  color: color-mix(in oklch, var(--color-text-bone, #e0e0e6) 70%, transparent);
  font-style: italic;
}
.body-dev-section {
  margin-top: 2px;
}
.body-dev-grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.body-dev-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.body-dev-name {
  font-size: 0.74rem;
  color: var(--color-text-bone, #e0e0e6);
  min-width: 48px;
  font-weight: 500;
}
.body-dev-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(232, 121, 160, 0.1);
  overflow: hidden;
}
.body-dev-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #e879a0, #f472b6);
  transition: width 0.4s ease;
}
.body-dev-num {
  font-size: 0.7rem;
  font-weight: 600;
  color: #e879a0;
  min-width: 22px;
  text-align: right;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.body-tag-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.body-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.body-tag {
  padding: 3px 12px;
  font-size: 0.72rem;
  font-weight: 500;
  border-radius: 14px;
}
.body-tag--nsfw {
  background: rgba(232, 121, 160, 0.07);
  color: #e879a0;
  border: 1px solid rgba(232, 121, 160, 0.12);
}
.body-tag--mark {
  background: color-mix(in oklch, var(--color-sage-600, #4a8a6a) 10%, transparent);
  color: var(--color-sage-400, #6aaa8a);
  border: 1px solid color-mix(in oklch, var(--color-sage-600, #4a8a6a) 15%, transparent);
}

/* ── Body parts grid (mirrors RelationshipPanel .bp-*) ── */
.body-parts-section,
.body-uterus-section {
  margin-top: 2px;
}
.bp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.bp-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(232, 121, 160, 0.025);
  border: 1px solid rgba(232, 121, 160, 0.08);
  transition: border-color 0.15s;
}
.bp-card:hover {
  border-color: rgba(232, 121, 160, 0.2);
}
.bp-head {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-bone, #e0e0e6);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bp-mark {
  font-size: 0.65rem;
  color: #e879a0;
  opacity: 0.8;
}
.bp-desc {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  margin: 3px 0 6px;
  line-height: 1.4;
}
.bp-meters {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bp-meter {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.62rem;
  color: var(--color-text-secondary, #8888a0);
}
.bp-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in oklch, var(--color-text-bone, #e0e0e6) 6%, transparent);
  overflow: hidden;
}
.bp-fill {
  height: 100%;
  border-radius: 2px;
  background: #e879a0;
  transition: width 0.3s;
}
.bp-fill--dev {
  background: var(--color-sage-600, #4a8a6a);
}

/* ── Uterus card ── */
.uterus-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(232, 121, 160, 0.025);
  border: 1px solid rgba(232, 121, 160, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.uterus-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.uterus-val {
  font-size: 0.82rem;
  color: var(--color-text-bone, #e0e0e6);
}
.uterus-records {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}
.uterus-record-item {
  display: flex;
  gap: 8px;
  font-size: 0.72rem;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(232, 121, 160, 0.04);
}
.uterus-record-date {
  color: #e879a0;
  font-weight: 500;
  flex-shrink: 0;
}
.uterus-record-desc {
  color: var(--color-text-secondary, #8888a0);
  font-style: italic;
}
</style>
