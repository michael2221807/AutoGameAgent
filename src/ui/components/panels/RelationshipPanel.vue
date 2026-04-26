<script setup lang="ts">
/**
 * RelationshipPanel — NPC 关系列表，路径见 `DEFAULT_ENGINE_PATHS.relationships`。
 *
 * Phase 6.2：
 * - 关注 toggle（眼睛图标）：标记为关注的 NPC 在列表置顶
 * - 心跳锁定 toggle（锁图标）：锁定后世界心跳不更新此 NPC 的状态
 * - 底部类型统计汇总
 *
 * §7.2（2026-04-11）：
 * - 每张 NPC 卡片底部新增 "💬 私聊" 快捷按钮 → 打开 NpcChatModal 异步对话
 * - 扩展 NPC edit Modal 字段：性别 / 年龄 / 背景 / 内心想法 / 在做事项 / 性格特征（tag） / 记忆（list）
 *   对齐 demo design note §70 "人物关系中的所有页面都在每项数据上增加一编辑按键"
 */
import { ref, computed, onActivated, watch } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import Modal from '@/ui/components/common/Modal.vue';
import NpcChatModal from '@/ui/components/shared/NpcChatModal.vue';
import { eventBus } from '@/engine/core/event-bus';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { formatMemoryEntry } from '@/engine/social/npc-memory-format';
import NpcMemoryTimeline from '@/ui/components/shared/NpcMemoryTimeline.vue';
import ImageDisplay from '@/ui/components/image/ImageDisplay.vue';
import ImageViewer from '@/ui/components/image/ImageViewer.vue';
import { useRouter, useRoute } from 'vue-router';

const { isLoaded, useValue, setValue, get } = useGameState();

/** 身体部位条目 */
interface BodyPartEntry {
  部位名称?: string;
  敏感度?: number;
  开发度?: number;
  特征描述?: string;
  特殊印记?: string;
}

/** NPC 私密信息子对象 */
interface PrivacyProfile {
  '是否为处女/处男'?: boolean;
  身体部位?: BodyPartEntry[];
  性格倾向?: string;
  性取向?: string;
  性癖好?: string[];
  性渴望程度?: number;
  当前性状态?: string;
  体液分泌状态?: string;
  性交总次数?: number;
  性伴侣名单?: string[];
  最近一次性行为时间?: string;
  特殊体质?: string[];
  /** 初夜夺取者（非处女/处男时必填）— 人名或 '未知'/情境描述 */
  初夜夺取者?: string;
  /** 初夜时间（非处女/处男时必填）— 游戏内时间戳或自然描述 */
  初夜时间?: string;
  /** 初夜描述（非处女/处男时必填）— 50-200 字情境描写 */
  初夜描述?: string;
  [key: string]: unknown;
}

/** 私聊历史条目（与 NpcChatMessage 对齐） */
interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** NPC relationship entry shape */
interface NpcRelation {
  名称: string;
  类型?: string;
  好感度?: number;
  位置?: string;
  描述?: string;
  外貌描述?: string;
  身材描写?: string;
  衣着风格?: string;
  性别?: string;
  年龄?: number;
  背景?: string;
  内心想法?: string;
  在做事项?: string;
  性格特征?: string[];
  记忆?: string[];
  私密信息?: PrivacyProfile;
  私聊历史?: ChatHistoryEntry[];
  关注?: boolean;
  心跳锁定?: boolean;
  [key: string]: unknown;
}

/** NSFW 是否开启（读状态树） */
const nsfwEnabled = computed(() => get<boolean>('系统.nsfwMode') === true);

const relationships = useValue<NpcRelation[]>(DEFAULT_ENGINE_PATHS.relationships);

// ─── Search & sort ───

const searchQuery = ref('');

type SortMode = 'name' | 'affinity' | 'gender' | 'importance' | 'recent' | 'location' | 'presence';
const SORT_KEY = 'aga_rel_sort';
const SORT_DIR_KEY = 'aga_rel_sort_dir';

const sortOptions: Array<{ label: string; value: SortMode }> = [
  { label: '首字母', value: 'name' },
  { label: '亲密度', value: 'affinity' },
  { label: '性别', value: 'gender' },
  { label: '重点角色', value: 'importance' },
  { label: '最近互动', value: 'recent' },
  { label: '位置', value: 'location' },
  { label: '在场', value: 'presence' },
];

const sortMode = ref<SortMode>(
  (localStorage.getItem(SORT_KEY) as SortMode) || 'name',
);
const sortAsc = ref<boolean>(
  localStorage.getItem(SORT_DIR_KEY) !== 'desc',
);

function setSortMode(mode: SortMode): void {
  if (sortMode.value === mode) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortMode.value = mode;
    sortAsc.value = true;
  }
  localStorage.setItem(SORT_KEY, mode);
  localStorage.setItem(SORT_DIR_KEY, sortAsc.value ? 'asc' : 'desc');
}

function compareBySortMode(a: NpcRelation, b: NpcRelation): number {
  switch (sortMode.value) {
    case 'affinity':
      return (b.好感度 ?? 0) - (a.好感度 ?? 0);
    case 'gender': {
      const ga = a.性别 ?? '';
      const gb = b.性别 ?? '';
      if (ga !== gb) return ga.localeCompare(gb);
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
    }
    case 'importance': {
      const am = a['是否主要角色'] ? 1 : 0;
      const bm = b['是否主要角色'] ? 1 : 0;
      if (am !== bm) return bm - am;
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
    }
    case 'recent': {
      const ta = a['最后互动时间'] as string | undefined;
      const tb = b['最后互动时间'] as string | undefined;
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      if (ta && tb) return tb.localeCompare(ta);
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
    }
    case 'location': {
      const la = (a.位置 ?? '') as string;
      const lb = (b.位置 ?? '') as string;
      if (la && !lb) return -1;
      if (!la && lb) return 1;
      if (la !== lb) return la.localeCompare(lb);
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
    }
    case 'presence': {
      const pa = a['是否在场'] ? 1 : 0;
      const pb = b['是否在场'] ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
    }
    default:
      return (a.名称 ?? '').localeCompare(b.名称 ?? '');
  }
}

const filteredRelations = computed<NpcRelation[]>(() => {
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  const dir = sortAsc.value ? 1 : -1;
  list.sort((a, b) => {
    if (a.关注 && !b.关注) return -1;
    if (!a.关注 && b.关注) return 1;
    return compareBySortMode(a, b) * dir;
  });
  if (!searchQuery.value.trim()) return list;
  const q = searchQuery.value.trim().toLowerCase();
  return list.filter(
    (npc) =>
      npc.名称.toLowerCase().includes(q) ||
      (npc.类型 ?? '').toLowerCase().includes(q) ||
      (npc.位置 ?? '').toLowerCase().includes(q),
  );
});

// ─── Phase 6.2: Attention + Heartbeat lock toggles ───────────

function toggleAttention(npc: NpcRelation, event: Event): void {
  event.stopPropagation();
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  const idx = list.findIndex((r) => r.名称 === npc.名称);
  if (idx < 0) return;
  list[idx] = { ...list[idx], 关注: !list[idx].关注 };
  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
}

function toggleHeartbeatLock(npc: NpcRelation, event: Event): void {
  event.stopPropagation();
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  const idx = list.findIndex((r) => r.名称 === npc.名称);
  if (idx < 0) return;
  list[idx] = { ...list[idx], 心跳锁定: !list[idx].心跳锁定 };
  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
  const locked = !npc.心跳锁定;
  eventBus.emit('ui:toast', {
    type: locked ? 'info' : 'success',
    message: `${npc.名称} 心跳锁定已${locked ? '开启' : '关闭'}`,
    duration: 1200,
  });
}

// ─── Sprint Social-3: Presence toggles ───────────────────────

const router = useRouter();
const route = useRoute();
const npcFields = DEFAULT_ENGINE_PATHS.npcFieldNames;

function openImageWorkbench(npcName: string, event: Event): void {
  event.stopPropagation();
  router.push({ path: '/game/image', query: { npc: npcName } });
}

function openAiEdit(npc: NpcRelation): void {
  router.push({ path: '/game/assistant', query: { editNpc: npc.名称 } });
}

function togglePresence(npc: NpcRelation, event: Event): void {
  event.stopPropagation();
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  const idx = list.findIndex((r) => r[npcFields.name] === npc[npcFields.name]);
  if (idx < 0) return;
  const current = list[idx][npcFields.isPresent] === true;
  list[idx] = { ...list[idx], [npcFields.isPresent]: !current };
  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
}

function toggleMajorRole(npc: NpcRelation, event: Event): void {
  event.stopPropagation();
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  const idx = list.findIndex((r) => r[npcFields.name] === npc[npcFields.name]);
  if (idx < 0) return;
  const current = list[idx][npcFields.isMajorRole] === true;
  list[idx] = { ...list[idx], [npcFields.isMajorRole]: !current };
  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
}


// ─── Phase 6.2: Type summary stats ───────────────────────────

const typeSummary = computed<Array<[string, number]>>(() => {
  const list = Array.isArray(relationships.value) ? relationships.value : [];
  const counts: Record<string, number> = {};
  for (const r of list) {
    const t = r.类型 ?? '未分类';
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
});

// ─── NPC detail / edit ───

const selectedNpc = ref<NpcRelation | null>(null);
const detailNpcIdx = ref<number>(-1);
const showEditModal = ref(false);
type DetailTab = 'basic' | 'status' | 'memory' | 'nsfw';
const detailTab = ref<DetailTab>('basic');

// Secret archive image/text toggle per body part (§4.2)
const bodyPartViewMode = ref<Record<string, 'text' | 'image'>>({});

// Portrait full-screen viewer
const portraitViewerOpen = ref(false);
const portraitViewerSrc = ref('');

async function openPortraitViewer(assetId: string) {
  if (!assetId) return;
  try {
    const { ImageAssetCache } = await import('@/engine/image/asset-cache');
    const cache = new ImageAssetCache();
    const result = await cache.retrieve(assetId);
    if (result) {
      portraitViewerSrc.value = URL.createObjectURL(result.blob);
      portraitViewerOpen.value = true;
    }
  } catch { /* silent */ }
}

function closePortraitViewer() {
  portraitViewerOpen.value = false;
  if (portraitViewerSrc.value) {
    URL.revokeObjectURL(portraitViewerSrc.value);
    portraitViewerSrc.value = '';
  }
}

function toggleDetail(npc: NpcRelation, index: number): void {
  detailNpcIdx.value = index;
  selectedNpc.value = npc;
  detailTab.value = 'basic';
}

function selectNpcByName(name: string): void {
  const list = filteredRelations.value;
  const idx = list.findIndex((r) => r.名称 === name);
  if (idx >= 0) toggleDetail(list[idx], idx);
}

onActivated(() => {
  const npcQuery = route.query.npc as string | undefined;
  if (npcQuery) {
    selectNpcByName(npcQuery);
    router.replace({ query: {} });
  }
});

watch(() => route.query.npc, (name) => {
  if (name && typeof name === 'string') {
    selectNpcByName(name);
    router.replace({ query: {} });
  }
});

// §7.2: NPC 私聊 modal 状态 — 独立于 edit modal，可以同时触发但通常用户只会看一个
const showChatModal = ref(false);
const chatNpc = ref<NpcRelation | null>(null);

interface NpcEditForm {
  名称: string;
  类型: string;
  好感度: number;
  位置: string;
  描述: string;
  外貌描述: string;
  身材描写: string;
  衣着风格: string;
  性别: string;
  年龄: number;
  背景: string;
  内心想法: string;
  在做事项: string;
  性格特征: string[];
  记忆: string[];
  关注: boolean;
  心跳锁定: boolean;
  私密信息: PrivacyProfile;
}

function clonePrivacy(p?: PrivacyProfile): PrivacyProfile {
  if (!p) return {};
  return JSON.parse(JSON.stringify(p)) as PrivacyProfile;
}

/** The 4 mandatory body-part names (matches PrivacyProfileValidator contract). */
const REQUIRED_BODY_PARTS = ['嘴', '胸部', '小穴', '屁穴'] as const;
type RequiredBodyPart = typeof REQUIRED_BODY_PARTS[number];

/** Seed the 4 mandatory parts on the current editForm (idempotent).
 *  Called from openEdit / openAddNew so the template can bind via index
 *  without mutating state during render. */
function seedRequiredBodyParts(): void {
  if (!Array.isArray(editForm.value.私密信息.身体部位)) {
    editForm.value.私密信息.身体部位 = [];
  }
  const list = editForm.value.私密信息.身体部位!;
  for (const name of REQUIRED_BODY_PARTS) {
    if (!list.some((p) => p.部位名称 === name)) {
      list.push({ 部位名称: name, 敏感度: 0, 开发度: 0, 特征描述: '', 特殊印记: '' });
    }
  }
}

/** Index of an existing required part (for v-model path stability); -1 if absent. */
function indexOfBodyPart(name: string): number {
  const list = editForm.value.私密信息.身体部位;
  if (!Array.isArray(list)) return -1;
  return list.findIndex((p) => p.部位名称 === name);
}

/** Extras: entries whose 部位名称 is NOT one of the fixed 4. */
function extraBodyPartIndices(): number[] {
  const list = editForm.value.私密信息.身体部位;
  if (!Array.isArray(list)) return [];
  const required = new Set<string>(REQUIRED_BODY_PARTS);
  const out: number[] = [];
  list.forEach((p, i) => {
    if (!required.has(String(p.部位名称 ?? ''))) out.push(i);
  });
  return out;
}

function addExtraBodyPart(): void {
  if (!Array.isArray(editForm.value.私密信息.身体部位)) {
    editForm.value.私密信息.身体部位 = [];
  }
  editForm.value.私密信息.身体部位!.push({
    部位名称: '',
    敏感度: 0,
    开发度: 0,
    特征描述: '',
    特殊印记: '',
  });
}

function removeBodyPart(index: number): void {
  const list = editForm.value.私密信息.身体部位;
  if (!Array.isArray(list)) return;
  list.splice(index, 1);
}

/** True when NPC is explicitly non-virgin → 初夜 fields become required. */
function isNonVirgin(): boolean {
  return editForm.value.私密信息['是否为处女/处男'] === false;
}

const editForm = ref<NpcEditForm>({
  名称: '',
  类型: '',
  好感度: 50,
  位置: '',
  描述: '',
  外貌描述: '',
  身材描写: '',
  衣着风格: '',
  性别: '',
  年龄: 20,
  背景: '',
  内心想法: '',
  在做事项: '',
  性格特征: [],
  记忆: [],
  关注: false,
  心跳锁定: false,
  私密信息: {},
});
const editIndex = ref<number>(-1);

/** 新增性格特征输入缓冲 — UI 独立字段，不存入 form */
const newTraitInput = ref('');
/** 新增记忆输入缓冲 */
const newMemoryInput = ref('');

function openEdit(npc: NpcRelation, _filteredIdx: number): void {
  selectedNpc.value = npc;
  const rawList = Array.isArray(relationships.value) ? relationships.value : [];
  editIndex.value = rawList.findIndex((r) => r.名称 === npc.名称);
  editForm.value = {
    名称: npc.名称 ?? '',
    类型: npc.类型 ?? '',
    好感度: typeof npc.好感度 === 'number' ? npc.好感度 : 50,
    位置: npc.位置 ?? '',
    描述: npc.描述 ?? '',
    外貌描述: npc.外貌描述 ?? '',
    身材描写: npc.身材描写 ?? '',
    衣着风格: npc.衣着风格 ?? '',
    性别: npc.性别 ?? '',
    年龄: typeof npc.年龄 === 'number' ? npc.年龄 : 20,
    背景: npc.背景 ?? '',
    内心想法: npc.内心想法 ?? '',
    在做事项: npc.在做事项 ?? '',
    性格特征: Array.isArray(npc.性格特征) ? [...npc.性格特征] : [],
    记忆: Array.isArray(npc.记忆) ? [...npc.记忆] : [],
    关注: npc.关注 === true,
    心跳锁定: npc.心跳锁定 === true,
    私密信息: clonePrivacy(npc.私密信息),
  };
  if (nsfwEnabled.value) seedRequiredBodyParts();
  newTraitInput.value = '';
  newMemoryInput.value = '';
  showEditModal.value = true;
}

function openAddNew(): void {
  selectedNpc.value = null;
  editIndex.value = -1;
  editForm.value = {
    名称: '',
    类型: '普通',
    好感度: 50,
    位置: '',
    描述: '',
    外貌描述: '',
    身材描写: '',
    衣着风格: '',
    性别: '',
    年龄: 20,
    背景: '',
    内心想法: '',
    在做事项: '',
    性格特征: [],
    记忆: [],
    关注: false,
    心跳锁定: false,
    私密信息: {},
  };
  if (nsfwEnabled.value) seedRequiredBodyParts();
  newTraitInput.value = '';
  newMemoryInput.value = '';
  showEditModal.value = true;
}

function saveNpc(): void {
  // CR-R26 (2026-04-11)：名称非空兜底。模板上 disabled 按钮按同样的 computed
  // 拦截，这里是防御性二次校验（防止外部脚本绕过）。空名 NPC 会破坏
  // NpcChatPipeline.findNpc 和其他"按名查询"的下游逻辑，必须拒绝。
  const trimmedName = editForm.value.名称?.trim() ?? '';
  if (!trimmedName) {
    eventBus.emit('ui:toast', {
      type: 'error',
      message: 'NPC 名称不能为空',
      duration: 2000,
    });
    return;
  }
  editForm.value.名称 = trimmedName;

  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  // Preserve unknown extra fields from existing entry, then overlay form data
  const existing = editIndex.value >= 0 ? list[editIndex.value] : {};
  const entry: NpcRelation = { ...existing, ...editForm.value };

  if (editIndex.value >= 0 && editIndex.value < list.length) {
    list[editIndex.value] = entry;
  } else {
    list.push(entry);
  }

  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
  showEditModal.value = false;
  eventBus.emit('ui:toast', {
    type: 'success',
    message: editIndex.value >= 0 ? '已更新 NPC 信息' : '已添加新 NPC',
    duration: 1500,
  });
}

// §7.2: 打开 NPC 私聊 modal — 直接打开，不经过 edit modal
//
// CR-R26 修复（2026-04-11）：仅当 NPC.名称 非空时允许打开私聊。
// 原因：NpcChatPipeline.chat 的唯一标识是 `名称`；空字符串会导致 find 匹配多个
// "未命名" NPC 或全部失败，产生不可预测的越权写入风险。
// UI 层拦在源头最便宜：点击按钮直接 toast 提示，不进入 pipeline。
function openChat(npc: NpcRelation, event: Event): void {
  event.stopPropagation(); // 防止冒泡触发卡片的 openEdit
  const name = typeof npc.名称 === 'string' ? npc.名称.trim() : '';
  if (!name) {
    eventBus.emit('ui:toast', {
      type: 'warning',
      message: '该 NPC 尚未设置名称，无法私聊',
      duration: 2500,
    });
    return;
  }
  chatNpc.value = npc;
  showChatModal.value = true;
}

// §7.2: 性格特征 tag 管理
function addTrait(): void {
  const v = newTraitInput.value.trim();
  if (!v) return;
  if (editForm.value.性格特征.includes(v)) return;
  editForm.value.性格特征.push(v);
  newTraitInput.value = '';
}

function removeTrait(idx: number): void {
  editForm.value.性格特征.splice(idx, 1);
}

// §7.2: 记忆条目管理
function addMemory(): void {
  const v = newMemoryInput.value.trim();
  if (!v) return;
  editForm.value.记忆.push(v);
  newMemoryInput.value = '';
}

function removeMemory(idx: number): void {
  editForm.value.记忆.splice(idx, 1);
}

function deleteNpc(): void {
  if (editIndex.value < 0) return;
  const list = Array.isArray(relationships.value) ? [...relationships.value] : [];
  list.splice(editIndex.value, 1);
  setValue(DEFAULT_ENGINE_PATHS.relationships, list);
  showEditModal.value = false;
  eventBus.emit('ui:toast', { type: 'warning', message: '已删除 NPC', duration: 1500 });
}

/** Affinity color gradient: red → yellow → green */
function shortLocation(loc: string): string {
  const parts = loc.split('·');
  return parts.length > 2 ? parts.slice(-2).join('·') : loc;
}

function affinityColor(value: number): string {
  if (value <= 30) return 'var(--color-danger, #ef4444)';
  if (value <= 60) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-success, #22c55e)';
}

/** NPC type label colors */
function typeClass(type: string | undefined): string {
  const map: Record<string, string> = {
    同伴: 'type--companion',
    商人: 'type--merchant',
    敌对: 'type--hostile',
    中立: 'type--neutral',
  };
  return map[type ?? ''] ?? 'type--default';
}
</script>

<template>
  <div class="relationship-panel">
    <template v-if="isLoaded">
      <div class="rel-layout">
        <!-- ══ LEFT: Character Roster ══ -->
        <aside class="rel-roster">
          <div class="roster-header">
            <div class="roster-title">
              社交关系
              <span v-if="relationships?.length" class="badge">{{ relationships.length }}</span>
            </div>
            <button class="btn-add" @click="openAddNew">+</button>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="roster-search"
            placeholder="搜索 NPC…"
          />
          <div class="sort-bar">
            <button
              v-for="opt in sortOptions"
              :key="opt.value"
              :class="['sort-chip', { 'sort-chip--active': sortMode === opt.value }]"
              @click="setSortMode(opt.value)"
            >{{ opt.label }}<span v-if="sortMode === opt.value" class="sort-arrow">{{ sortAsc ? '↑' : '↓' }}</span></button>
          </div>
          <div class="roster-list">
            <template v-if="filteredRelations.length">
              <div
                v-for="(npc, idx) in filteredRelations"
                :key="npc.名称 ?? idx"
                :class="['rc', { 'rc--selected': detailNpcIdx === idx, 'rc--attention': npc.关注 }]"
                @click="toggleDetail(npc, idx)"
              >
                <div class="rc-avatar-wrap">
                  <ImageDisplay
                    :asset-id="npc['图片档案']?.['已选头像图片ID']"
                    :fallback-letter="npc.名称?.charAt(0) ?? '?'"
                    :alt="npc.名称"
                    size="sm"
                    class="rc-avatar-img"
                  />
                </div>
                <div class="rc-body">
                  <span class="rc-name">{{ npc.名称 }}</span>
                  <div class="rc-meta">
                    <span :class="['rc-presence', npc['是否在场'] ? 'rc-presence--on' : 'rc-presence--off']">
                      {{ npc['是否在场'] ? '在场' : '离线' }}
                    </span>
                    <span v-if="npc.类型" :class="['rc-type-label', typeClass(npc.类型)]">{{ npc.类型 }}</span>
                  </div>
                  <span v-if="npc.位置" class="rc-location">{{ shortLocation(npc.位置) }}</span>
                </div>
                <div class="rc-right">
                  <span class="rc-affinity" :style="{ color: affinityColor(npc.好感度 ?? 50) }">♡ {{ npc.好感度 ?? '—' }}</span>
                  <span v-if="npc['是否主要角色']" class="rc-badge-main">MAIN</span>
                </div>
              </div>
            </template>
            <div v-else class="roster-empty">
              <p>{{ searchQuery ? '无匹配' : '暂无 NPC' }}</p>
            </div>
          </div>
          <div v-if="typeSummary.length" class="roster-stats">
            <span
              v-for="([type, count]) in typeSummary"
              :key="type"
              :class="['type-stat', typeClass(type)]"
            >{{ type }} {{ count }}</span>
          </div>
        </aside>

        <!-- ══ RIGHT: Detail Pane ══ -->
        <main class="rel-detail">
          <template v-if="selectedNpc">
            <!-- Hero header -->
            <div class="rd-hero">
              <button class="rd-hero-avatar-btn" title="点击生成/管理图片" @click="openImageWorkbench(selectedNpc.名称, $event)">
                <ImageDisplay
                  :asset-id="selectedNpc['图片档案']?.['已选头像图片ID']"
                  :fallback-letter="selectedNpc.名称?.charAt(0) ?? '?'"
                  size="lg"
                  class="rd-hero-avatar-img"
                />
              </button>
              <div class="rd-hero-info">
                <h2 class="rd-hero-name">{{ selectedNpc.名称 }}</h2>
                <div class="rd-hero-chips">
                  <span v-if="selectedNpc.性别 || selectedNpc.年龄" class="rd-chip">{{ [selectedNpc.性别, selectedNpc.年龄 ? selectedNpc.年龄 + '岁' : ''].filter(Boolean).join(' | ') }}</span>
                  <span v-if="selectedNpc.描述" class="rd-chip">{{ selectedNpc.描述 }}</span>
                  <span v-if="selectedNpc['是否在场']" class="rd-chip rd-chip--presence">在场中</span>
                </div>
                <div class="rd-hero-actions">
                  <button class="rd-action-btn" @click="togglePresence(selectedNpc, $event)">◎ {{ selectedNpc['是否在场'] ? '标为离场' : '标为在场' }}</button>
                  <button class="rd-action-btn" @click="toggleMajorRole(selectedNpc, $event)">☆ {{ selectedNpc['是否主要角色'] ? '取消重要' : '设为重要' }}</button>
                  <button class="rd-action-btn" @click="toggleAttention(selectedNpc, $event)">👁 {{ selectedNpc.关注 ? '取消关注' : '关注' }}</button>
                  <button class="rd-action-btn" @click="toggleHeartbeatLock(selectedNpc, $event)">{{ selectedNpc.心跳锁定 ? '🔓 解除锁定' : '🔒 心跳锁定' }}</button>
                  <button class="rd-action-btn" @click="openChat(selectedNpc, $event)">💬 私聊</button>
                  <button class="rd-action-btn" @click="openEdit(selectedNpc, detailNpcIdx)">✏ 编辑</button>
                  <button class="rd-action-btn" @click="openAiEdit(selectedNpc)">🤖 AI编辑</button>
                  <button class="rd-action-btn" @click="openImageWorkbench(selectedNpc.名称, $event)">🖼 生图</button>
                </div>
              </div>
              <div class="rd-affinity-block">
                <div class="rd-affinity-label">AFFECTION POINT</div>
                <div class="rd-affinity-num" :style="{ color: affinityColor(selectedNpc.好感度 ?? 50) }">{{ selectedNpc.好感度 ?? '—' }}</div>
                <span v-if="selectedNpc.类型" :class="['rd-affinity-type', typeClass(selectedNpc.类型)]">{{ selectedNpc.类型 }}</span>
              </div>
            </div>

            <!-- 2-column flowing detail body (no tabs — matches demo layout) -->
            <div class="rd-body">
              <!-- ── Main Column ── -->
              <div class="rd-main">
                <!-- 人物生平 -->
                <div v-if="selectedNpc.描述 || selectedNpc.背景" class="rd-section">
                  <div class="rd-section-title">● 人物生平</div>
                  <p v-if="selectedNpc.描述" class="prose prose--focal">{{ selectedNpc.描述 }}</p>
                  <p v-if="selectedNpc.背景" class="prose">{{ selectedNpc.背景 }}</p>
                </div>

                <!-- 性格特征 -->
                <div v-if="selectedNpc.性格特征?.length" class="trait-cloud">
                  <span v-for="t in selectedNpc.性格特征" :key="t" class="trait">{{ t }}</span>
                </div>

                <!-- 内心想法 -->
                <div v-if="selectedNpc.内心想法" class="thought-cloud">
                  <span class="section-hint">内心想法</span>
                  <p class="thought-text">{{ selectedNpc.内心想法 }}</p>
                </div>

                <!-- 在做事项 -->
                <div v-if="selectedNpc.在做事项" class="action-strip">
                  <span class="section-hint">在做事项</span>
                  <p class="action-text">{{ selectedNpc.在做事项 }}</p>
                </div>

                <!-- 最近对话 -->
                <div v-if="selectedNpc.私聊历史?.length" class="chat-section">
                  <div class="rd-section-title">● 最近对话</div>
                  <div class="chat-list">
                    <div v-for="(msg, ci) in selectedNpc.私聊历史.slice(-8)" :key="ci" :class="['chat-bubble', `chat-bubble--${msg.role}`]">
                      <span class="chat-who">{{ msg.role === 'user' ? '你' : selectedNpc.名称 }}</span>
                      <span>{{ msg.content }}</span>
                    </div>
                  </div>
                  <p v-if="selectedNpc.私聊历史.length > 8" class="hint">最近 8 条 / 共 {{ selectedNpc.私聊历史.length }}</p>
                </div>

                <!-- 共同记忆 -->
                <div v-if="selectedNpc.记忆?.length" class="rd-section">
                  <div class="rd-section-title">● 共同记忆</div>
                  <NpcMemoryTimeline :memories="selectedNpc.记忆 ?? []" :summaries="selectedNpc.总结记忆" />
                </div>

                <p v-if="!selectedNpc.描述 && !selectedNpc.背景 && !selectedNpc.内心想法 && !selectedNpc.在做事项 && !selectedNpc.私聊历史?.length && !selectedNpc.记忆?.length && !selectedNpc.性格特征?.length" class="hint">暂无详细信息</p>

                <!-- Portrait gallery (bottom of main column) -->
                <div v-if="selectedNpc['图片档案']?.['已选立绘图片ID']" class="portrait-gallery">
                  <div class="portrait-frame" @click="openPortraitViewer(selectedNpc['图片档案']['已选立绘图片ID'])">
                    <ImageDisplay :asset-id="selectedNpc['图片档案']['已选立绘图片ID']" :fallback-letter="selectedNpc.名称?.charAt(0) ?? '?'" size="lg" class="portrait-image" />
                    <div class="portrait-vignette" />
                    <div class="portrait-hint">点击查看大图</div>
                  </div>
                </div>
              </div>

              <!-- ── Side Column ── -->
              <div class="rd-side">
                <!-- 外貌/容颜 -->
                <div v-if="selectedNpc.外貌描述" class="rd-section">
                  <div class="rd-section-title">● 容颜</div>
                  <div class="rd-quote">{{ selectedNpc.外貌描述 }}</div>
                </div>

                <!-- 身材/衣着 info -->
                <div v-if="selectedNpc.性别 || selectedNpc.年龄 || selectedNpc.身材描写 || selectedNpc.衣着风格" class="rd-side-info">
                  <div v-if="selectedNpc.性别 || selectedNpc.年龄" class="rd-side-row">
                    <span class="rd-side-label">生日</span><span class="rd-side-val">不详</span>
                    <span class="rd-side-label" style="margin-left:16px">称呼</span><span class="rd-side-val">{{ selectedNpc.类型 ?? '—' }}</span>
                  </div>
                  <div v-if="selectedNpc.身材描写" class="rd-side-row">
                    <span class="rd-side-label">身材</span><span class="rd-side-val">{{ selectedNpc.身材描写 }}</span>
                  </div>
                  <div v-if="selectedNpc.衣着风格" class="rd-side-row">
                    <span class="rd-side-label">衣着</span><span class="rd-side-val">{{ selectedNpc.衣着风格 }}</span>
                  </div>
                </div>

                <!-- 香闺秘档 (NSFW) -->
                <div v-if="nsfwEnabled && selectedNpc.私密信息" class="nsfw-card">
                  <div class="rd-section-title rd-section-title--nsfw">♥ 香闺秘档 <span class="nsfw-badge">TOP SECRET</span></div>

                  <div v-if="selectedNpc.私密信息.性格倾向 || selectedNpc.私密信息.性取向" class="nsfw-row">
                    <div v-if="selectedNpc.私密信息.性格倾向" class="nsfw-field"><span class="section-hint">性格倾向</span><span class="nsfw-val">{{ selectedNpc.私密信息.性格倾向 }}</span></div>
                    <div v-if="selectedNpc.私密信息.性取向" class="nsfw-field"><span class="section-hint">性取向</span><span class="nsfw-val">{{ selectedNpc.私密信息.性取向 }}</span></div>
                  </div>
                  <div v-if="selectedNpc.私密信息.当前性状态" class="nsfw-field" style="margin-top:8px"><span class="section-hint">当前状态</span><p class="nsfw-status">{{ selectedNpc.私密信息.当前性状态 }}</p></div>
                  <div v-if="selectedNpc.私密信息.性渴望程度 != null" style="margin-top:10px">
                    <span class="section-hint">性渴望程度</span>
                    <div class="desire-bar-wrap"><div class="desire-bar"><div class="desire-fill" :style="{ width: selectedNpc.私密信息.性渴望程度 + '%' }" /></div><span class="desire-num">{{ selectedNpc.私密信息.性渴望程度 }}</span></div>
                  </div>
                  <div v-if="selectedNpc.私密信息.体液分泌状态" class="nsfw-field" style="margin-top:8px"><span class="section-hint">体液状态</span><span class="nsfw-val">{{ selectedNpc.私密信息.体液分泌状态 }}</span></div>
                  <div v-if="selectedNpc.私密信息.性交总次数 != null" class="nsfw-field" style="margin-top:6px"><span class="section-hint">性交次数</span><span class="nsfw-val">{{ selectedNpc.私密信息.性交总次数 }}</span></div>

                  <!-- 身体部位 -->
                  <div v-if="selectedNpc.私密信息.身体部位?.length" style="margin-top:10px"><span class="section-hint" style="display:block;margin-bottom:6px">身体部位</span><div class="bp-grid">
                    <div v-for="(bp, bi) in selectedNpc.私密信息.身体部位" :key="bi" class="bp-card">
                      <div class="bp-head">
                        {{ bp.部位名称 }}
                        <span v-if="bp.特殊印记" class="bp-mark">{{ bp.特殊印记 }}</span>
                        <button v-if="bp.已选背景图片ID" class="bp-view-toggle" @click="bodyPartViewMode[`${selectedNpc.名称}_${bi}`] = bodyPartViewMode[`${selectedNpc.名称}_${bi}`] === 'image' ? 'text' : 'image'">{{ bodyPartViewMode[`${selectedNpc.名称}_${bi}`] === 'image' ? '看文' : '看图' }}</button>
                      </div>
                      <template v-if="bodyPartViewMode[`${selectedNpc.名称}_${bi}`] === 'image' && bp.已选背景图片ID">
                        <ImageDisplay :asset-id="bp.已选背景图片ID" :fallback-letter="bp.部位名称?.charAt(0) ?? '?'" size="lg" class="bp-image" />
                      </template>
                      <template v-else><p v-if="bp.特征描述" class="bp-desc">{{ bp.特征描述 }}</p></template>
                      <div class="bp-meters">
                        <div class="bp-meter"><span>敏感</span><div class="bp-bar"><div class="bp-fill" :style="{width:(bp.敏感度??0)+'%'}" /></div><span>{{bp.敏感度??0}}</span></div>
                        <div class="bp-meter"><span>开发</span><div class="bp-bar"><div class="bp-fill bp-fill--dev" :style="{width:(bp.开发度??0)+'%'}" /></div><span>{{bp.开发度??0}}</span></div>
                      </div>
                    </div>
                  </div></div>

                  <!-- 处女状态 -->
                  <div v-if="selectedNpc.私密信息['是否为处女/处男'] !== undefined" class="nsfw-field" style="margin-top:10px">
                    <span class="section-hint">处女/处男状态</span>
                    <span class="nsfw-val">{{ selectedNpc.私密信息['是否为处女/处男'] === true ? '是' : selectedNpc.私密信息['是否为处女/处男'] === false ? '否' : '未设' }}</span>
                  </div>
                  <template v-if="selectedNpc.私密信息['是否为处女/处男'] === false || selectedNpc.私密信息.初夜夺取者">
                    <div v-if="selectedNpc.私密信息.初夜夺取者" class="nsfw-field" style="margin-top:8px"><span class="section-hint">初夜夺取者</span><span class="nsfw-val">{{ selectedNpc.私密信息.初夜夺取者 }}</span></div>
                    <div v-if="selectedNpc.私密信息.初夜时间" class="nsfw-field" style="margin-top:6px"><span class="section-hint">初夜时间</span><span class="nsfw-val">{{ selectedNpc.私密信息.初夜时间 }}</span></div>
                    <div v-if="selectedNpc.私密信息.初夜描述" class="nsfw-field" style="margin-top:8px"><span class="section-hint">初夜描述</span><p class="nsfw-status">{{ selectedNpc.私密信息.初夜描述 }}</p></div>
                  </template>

                  <!-- 偏好 -->
                  <div v-if="selectedNpc.私密信息.性癖好?.length" style="margin-top:10px"><span class="section-hint">性癖好</span><div class="tag-row"><span v-for="f in selectedNpc.私密信息.性癖好" :key="f" class="detail-tag detail-tag--nsfw">{{ f }}</span></div></div>
                  <div v-if="selectedNpc.私密信息.特殊体质?.length" style="margin-top:8px"><span class="section-hint">特殊体质</span><div class="tag-row"><span v-for="t in selectedNpc.私密信息.特殊体质" :key="t" class="detail-tag detail-tag--trait">{{ t }}</span></div></div>
                  <div v-if="selectedNpc.私密信息.性伴侣名单?.length" style="margin-top:8px"><span class="section-hint">性伴侣</span><div class="tag-row"><span v-for="p in selectedNpc.私密信息.性伴侣名单" :key="p" class="detail-tag">{{ p }}</span></div></div>
                </div>
              </div>
            </div>
          </template>

          <!-- Empty state when no NPC selected -->
          <div v-else class="detail-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p>选择左侧名册中的角色查看详情</p>
          </div>
        </main>
      </div>
    </template>

    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>

    <!-- ─── NPC Edit Modal ─── -->
    <Modal v-model="showEditModal" :title="editIndex >= 0 ? '编辑 NPC' : '添加 NPC'" width="520px">
      <div class="edit-form">
        <!-- 基本信息 -->
        <div class="form-section">
          <h4 class="form-section-title">基本信息</h4>

          <div class="form-row">
            <div class="form-group form-group--half">
              <label class="form-label">名称</label>
              <input v-model="editForm.名称" type="text" class="form-input" placeholder="NPC 名称" />
            </div>
            <div class="form-group form-group--half">
              <label class="form-label">类型</label>
              <select v-model="editForm.类型" class="form-input">
                <option value="">未分类</option>
                <option value="重点">重点</option>
                <option value="同伴">同伴</option>
                <option value="商人">商人</option>
                <option value="中立">中立</option>
                <option value="敌对">敌对</option>
                <option value="普通">普通</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group form-group--half">
              <label class="form-label">性别</label>
              <select v-model="editForm.性别" class="form-input">
                <option value="">未设置</option>
                <option value="男">男</option>
                <option value="女">女</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div class="form-group form-group--half">
              <label class="form-label">年龄</label>
              <input v-model.number="editForm.年龄" type="number" class="form-input" min="0" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">好感度 ({{ editForm.好感度 }})</label>
            <input v-model.number="editForm.好感度" type="range" min="0" max="100" class="form-range" />
          </div>

          <div class="form-group">
            <label class="form-label">当前位置</label>
            <input v-model="editForm.位置" type="text" class="form-input" placeholder="当前位置" />
          </div>
        </div>

        <!-- 外貌与描述 -->
        <div class="form-section">
          <h4 class="form-section-title">描述与视觉档案</h4>

          <div class="form-group">
            <label class="form-label">一句话描述</label>
            <input v-model="editForm.描述" type="text" class="form-input" placeholder="身份/气质一句话概述" />
            <span class="form-hint">列表卡片与摘要用；不写外貌细节。</span>
          </div>

          <div class="form-group">
            <label class="form-label">外貌描述</label>
            <textarea v-model="editForm.外貌描述" class="form-textarea" rows="3" placeholder="面容、发型发色、瞳色、肤色、体型基调、神情气质…" />
            <span class="form-hint">生图 tokenizer / 锚点提取的主视觉输入；长期稳定。</span>
          </div>

          <div class="form-group">
            <label class="form-label">身材描写</label>
            <textarea v-model="editForm.身材描写" class="form-textarea" rows="2" placeholder="身高、体态、胸/腰/臀、肌肉脂肪分布、气场…" />
          </div>

          <div class="form-group">
            <label class="form-label">衣着风格</label>
            <textarea v-model="editForm.衣着风格" class="form-textarea" rows="2" placeholder="日常穿着偏好：材质、色调、款式、常驻佩饰…" />
            <span class="form-hint">临时/场景穿着写在叙事文本里，不在此处。</span>
          </div>

          <div class="form-group">
            <label class="form-label">背景故事</label>
            <textarea v-model="editForm.背景" class="form-textarea" rows="3" placeholder="出身、经历、目的…" />
          </div>
        </div>

        <!-- 当前状态 -->
        <div class="form-section">
          <h4 class="form-section-title">当前状态</h4>

          <div class="form-group">
            <label class="form-label">内心想法</label>
            <textarea v-model="editForm.内心想法" class="form-textarea" rows="2" placeholder="NPC 当前的内心想法…" />
          </div>

          <div class="form-group">
            <label class="form-label">在做事项</label>
            <input v-model="editForm.在做事项" type="text" class="form-input" placeholder="如：在茶馆里打探消息" />
          </div>
        </div>

        <!-- 性格特征 tag list -->
        <div class="form-section">
          <h4 class="form-section-title">性格特征</h4>

          <div class="tag-list">
            <span v-for="(trait, idx) in editForm.性格特征" :key="idx" class="tag-item">
              {{ trait }}
              <button class="tag-delete" @click="removeTrait(idx)" aria-label="删除">&times;</button>
            </span>
            <span v-if="editForm.性格特征.length === 0" class="tag-empty">尚未添加特征</span>
          </div>
          <div class="tag-input-row">
            <input
              v-model="newTraitInput"
              type="text"
              class="form-input tag-input"
              placeholder="例如：多疑、沉稳"
              @keyup.enter="addTrait"
            />
            <button class="btn-secondary btn-sm" @click="addTrait">添加</button>
          </div>
        </div>

        <!-- 记忆 list -->
        <div class="form-section">
          <h4 class="form-section-title">记忆条目</h4>

          <div class="memory-list">
            <div v-for="(mem, idx) in editForm.记忆" :key="idx" class="memory-item">
              <!-- Social-1: 同 display 侧，混合 string/{内容,时间} 形态 — 统一渲染。 -->
              <span class="memory-text">{{ formatMemoryEntry(mem) }}</span>
              <button class="memory-delete" @click="removeMemory(idx)" aria-label="删除">&times;</button>
            </div>
            <div v-if="editForm.记忆.length === 0" class="memory-empty">尚无记忆条目</div>
          </div>
          <div class="tag-input-row">
            <input
              v-model="newMemoryInput"
              type="text"
              class="form-input tag-input"
              placeholder="例如：初次与玩家在茶馆相遇"
              @keyup.enter="addMemory"
            />
            <button class="btn-secondary btn-sm" @click="addMemory">添加</button>
          </div>
        </div>

        <!-- 私密信息（NSFW 开启时显示） -->
        <div v-if="nsfwEnabled" class="form-section">
          <h4 class="form-section-title" style="color: #e879a0;">私密信息</h4>

          <div class="form-row">
            <div class="form-group form-group--half">
              <label class="form-label">性格倾向</label>
              <input v-model="editForm.私密信息.性格倾向" type="text" class="form-input" placeholder="温顺/支配/…" />
            </div>
            <div class="form-group form-group--half">
              <label class="form-label">性取向</label>
              <input v-model="editForm.私密信息.性取向" type="text" class="form-input" placeholder="异性恋/双性恋/…" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group form-group--half">
              <label class="form-label">当前性状态</label>
              <input v-model="editForm.私密信息.当前性状态" type="text" class="form-input" />
            </div>
            <div class="form-group form-group--half">
              <label class="form-label">体液分泌状态</label>
              <input v-model="editForm.私密信息.体液分泌状态" type="text" class="form-input" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group form-group--half">
              <label class="form-label">性渴望程度 ({{ editForm.私密信息.性渴望程度 ?? 0 }})</label>
              <input type="range" min="0" max="100" v-model.number="editForm.私密信息.性渴望程度" class="form-range" />
            </div>
            <div class="form-group form-group--half">
              <label class="form-label">性交总次数</label>
              <input v-model.number="editForm.私密信息.性交总次数" type="number" min="0" class="form-input" />
            </div>
          </div>

          <!-- 处女状态 + 初夜（非处女时显示） -->
          <div class="form-group">
            <label class="form-check-label">
              <input
                type="checkbox"
                :checked="editForm.私密信息['是否为处女/处男'] === true"
                @change="(e) => editForm.私密信息['是否为处女/处男'] = (e.target as HTMLInputElement).checked"
              />
              <span>仍为处女/处男</span>
            </label>
            <span class="form-hint">取消勾选 → 必须填写下方「初夜」3 字段。</span>
          </div>

          <div v-if="isNonVirgin()" class="nested-block">
            <h5 class="nested-title">初夜档案（非处女/处男必填）</h5>
            <div class="form-row">
              <div class="form-group form-group--half">
                <label class="form-label">初夜夺取者</label>
                <input
                  v-model="editForm.私密信息.初夜夺取者"
                  type="text"
                  class="form-input"
                  placeholder="人名 / 未知 / 童年被拐…"
                />
              </div>
              <div class="form-group form-group--half">
                <label class="form-label">初夜时间</label>
                <input
                  v-model="editForm.私密信息.初夜时间"
                  type="text"
                  class="form-input"
                  placeholder="如「14 岁冬」「入赘前夜」"
                />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">初夜描述</label>
              <textarea
                v-model="editForm.私密信息.初夜描述"
                class="form-textarea"
                rows="3"
                placeholder="50-200 字：地点、氛围、关系性质、NPC 当时感受…"
              />
            </div>
          </div>

          <!-- 身体部位编辑器 — 4 个固定部位 + 可追加的其他部位 -->
          <div class="nested-block">
            <h5 class="nested-title">身体部位</h5>
            <span class="form-hint">固定 4 项（嘴 / 胸部 / 小穴 / 屁穴）用于生图特写流程，必须填写「特征描述」。可在下方追加任意额外部位。</span>

            <div
              v-for="partName in REQUIRED_BODY_PARTS"
              :key="'req-' + partName"
              class="bp-edit-card"
            >
              <div class="bp-edit-head">
                <span class="bp-edit-name bp-edit-name--fixed">{{ partName }}</span>
                <span class="bp-edit-badge">必填</span>
              </div>
              <template v-if="indexOfBodyPart(partName) >= 0">
                <div class="form-group">
                  <label class="form-label">特征描述</label>
                  <textarea
                    v-model="editForm.私密信息.身体部位![indexOfBodyPart(partName)].特征描述"
                    class="form-textarea"
                    rows="2"
                    placeholder="具体形态、触感、尺寸、颜色、细节…"
                  />
                </div>
                <div class="form-row">
                  <div class="form-group form-group--half">
                    <label class="form-label">特殊印记</label>
                    <input
                      v-model="editForm.私密信息.身体部位![indexOfBodyPart(partName)].特殊印记"
                      type="text"
                      class="form-input"
                      placeholder="环、纹、伤…（可留空）"
                    />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group form-group--half">
                    <label class="form-label">敏感度 ({{ editForm.私密信息.身体部位![indexOfBodyPart(partName)].敏感度 ?? 0 }})</label>
                    <input
                      type="range" min="0" max="100"
                      v-model.number="editForm.私密信息.身体部位![indexOfBodyPart(partName)].敏感度"
                      class="form-range"
                    />
                  </div>
                  <div class="form-group form-group--half">
                    <label class="form-label">开发度 ({{ editForm.私密信息.身体部位![indexOfBodyPart(partName)].开发度 ?? 0 }})</label>
                    <input
                      type="range" min="0" max="100"
                      v-model.number="editForm.私密信息.身体部位![indexOfBodyPart(partName)].开发度"
                      class="form-range"
                    />
                  </div>
                </div>
              </template>
            </div>

            <!-- 额外部位 — 可自由命名与删除 -->
            <div
              v-for="idx in extraBodyPartIndices()"
              :key="'extra-' + idx"
              class="bp-edit-card bp-edit-card--extra"
            >
              <div class="bp-edit-head">
                <input
                  v-model="editForm.私密信息.身体部位![idx].部位名称"
                  type="text"
                  class="form-input bp-name-input"
                  placeholder="部位名称（如 乳首 / 臀部 / 后穴 / 阳具）"
                />
                <button
                  type="button"
                  class="bp-remove-btn"
                  @click="removeBodyPart(idx)"
                  aria-label="删除此部位"
                >移除</button>
              </div>
              <div class="form-group">
                <label class="form-label">特征描述</label>
                <textarea
                  v-model="editForm.私密信息.身体部位![idx].特征描述"
                  class="form-textarea"
                  rows="2"
                />
              </div>
              <div class="form-row">
                <div class="form-group form-group--half">
                  <label class="form-label">特殊印记</label>
                  <input v-model="editForm.私密信息.身体部位![idx].特殊印记" type="text" class="form-input" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group form-group--half">
                  <label class="form-label">敏感度 ({{ editForm.私密信息.身体部位![idx].敏感度 ?? 0 }})</label>
                  <input type="range" min="0" max="100" v-model.number="editForm.私密信息.身体部位![idx].敏感度" class="form-range" />
                </div>
                <div class="form-group form-group--half">
                  <label class="form-label">开发度 ({{ editForm.私密信息.身体部位![idx].开发度 ?? 0 }})</label>
                  <input type="range" min="0" max="100" v-model.number="editForm.私密信息.身体部位![idx].开发度" class="form-range" />
                </div>
              </div>
            </div>

            <button type="button" class="btn-secondary btn-sm bp-add-btn" @click="addExtraBodyPart">
              + 追加其他部位
            </button>
          </div>
        </div>

        <!-- Flags -->
        <div class="form-section">
          <h4 class="form-section-title">标记</h4>

          <div class="form-group form-group--row">
            <label class="form-check-label">
              <input type="checkbox" v-model="editForm.关注" />
              <span>关注（置顶显示）</span>
            </label>
            <label class="form-check-label">
              <input type="checkbox" v-model="editForm.心跳锁定" />
              <span>心跳锁定（AI 不更新此 NPC）</span>
            </label>
          </div>
        </div>
      </div>
      <template #footer>
        <button v-if="editIndex >= 0" class="btn-danger" @click="deleteNpc">删除</button>
        <div style="flex: 1" />
        <button class="btn-secondary" @click="showEditModal = false">取消</button>
        <button class="btn-primary" :disabled="!editForm.名称?.trim()" @click="saveNpc">保存</button>
      </template>
    </Modal>

    <!-- §7.2: NPC 私聊 modal -->
    <NpcChatModal v-model="showChatModal" :npc="chatNpc" />

    <!-- Portrait full-screen viewer -->
    <ImageViewer v-if="portraitViewerOpen" :src="portraitViewerSrc" @close="closePortraitViewer" />
  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   RelationshipPanel — Master-Detail Sanctuary Layout
   Left roster sidebar (280px) + right scrollable detail pane.
   All tokens from tokens.css; NO #fff, NO indigo, NO raw rgba.
   ══════════════════════════════════════════════════════════════ */

/* ── Root container ── */
.relationship-panel {
  height: 100%;
  overflow: hidden;
}

.rel-layout {
  display: flex;
  flex-direction: row;
  height: 100%;
  overflow: hidden;
  padding-left: var(--sidebar-left-reserve, 40px);
  padding-right: var(--sidebar-right-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}

/* ══════════════════════════════════════════════════════════════
   LEFT ROSTER SIDEBAR
   ══════════════════════════════════════════════════════════════ */
.rel-roster {
  width: 280px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: hidden;
}

/* ── Roster header ── */
.roster-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.roster-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  font-family: var(--font-serif-cjk);
  letter-spacing: 0.15em;
  color: var(--color-text-bone);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-sage-400);
  border-radius: var(--radius-full);
}

.btn-add {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 1.1rem;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-radius: 50%;
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-add:hover {
  background: color-mix(in oklch, var(--color-sage-400) 18%, transparent);
  border-color: var(--color-sage-400);
}

/* ── Roster search ── */
.roster-search {
  width: calc(100% - 24px);
  height: 34px;
  margin: 0 12px 10px;
  padding: 0 12px;
  font-size: 0.82rem;
  color: var(--color-text-bone);
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--duration-fast) ease;
}
.roster-search:focus {
  border-color: var(--color-sage-400);
}

/* ── Sort bar ── */
.sort-bar {
  display: flex;
  gap: 4px;
  padding: 0 12px 8px;
  flex-wrap: wrap;
}
.sort-chip {
  padding: 2px 8px;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  white-space: nowrap;
}
.sort-chip:hover {
  color: var(--color-text-bone);
  border-color: color-mix(in oklch, var(--color-sage-400) 40%, transparent);
}
.sort-chip--active {
  color: var(--color-sage-300);
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}
.sort-arrow {
  margin-left: 2px;
  font-size: 0.6rem;
}

/* ── Roster list ── */
.roster-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.roster-list::-webkit-scrollbar { width: 4px; }
.roster-list::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 2px; }
.rel-detail::-webkit-scrollbar { width: 5px; }
.rel-detail::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }

/* ── Roster card (NPC row) ── */
.rc {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease;
  border: 1px solid transparent;
}
.rc:hover {
  background: color-mix(in oklch, var(--color-text-bone) 4%, transparent);
}
.rc--selected {
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}
.rc--attention {
  box-shadow: inset 3px 0 0 var(--color-sage-400);
}

/* ── Roster card: avatar ── */
.rc-avatar-wrap {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-sage-400);
  font-weight: 700;
  font-size: 0.88rem;
}
.rc-avatar-img :deep(.img-display) {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}
.rc-avatar-img :deep(.img-display__img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rc-avatar-img :deep(.img-display__fallback) {
  font-size: 0.9rem;
}

/* ── Roster card: body ── */
.rc-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rc-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-bone);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rc-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rc-presence {
  font-size: 0.62rem;
  font-weight: 500;
  flex-shrink: 0;
}
.rc-presence--on {
  color: var(--color-success);
}
.rc-presence--off {
  color: var(--color-text-muted);
}
.rc-location {
  font-size: 0.6rem;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
}
.rc-type-label {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* ── Roster card: right column ── */
.rc-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}
.rc-affinity {
  font-size: 0.78rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-secondary);
}
.rc-badge-main {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--color-amber-400) 15%, transparent);
  color: var(--color-amber-400);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ── Roster stats (bottom summary) ── */
.roster-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border-subtle);
}

.roster-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 0.82rem;
  padding: 32px 16px;
  text-align: center;
}

/* ── Type badges (shared: roster + detail) ── */
.type-stat {
  padding: 2px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: var(--radius-full);
}

.type--companion {
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
}
.type--merchant {
  color: var(--color-amber-400);
  background: color-mix(in oklch, var(--color-amber-400) 12%, transparent);
}
.type--hostile {
  color: var(--color-danger);
  background: color-mix(in oklch, var(--color-danger) 12%, transparent);
}
.type--neutral {
  color: var(--color-text-secondary);
  background: color-mix(in oklch, var(--color-text-secondary) 12%, transparent);
}
.type--default {
  color: var(--color-sage-600);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
}

/* ══════════════════════════════════════════════════════════════
   RIGHT DETAIL PANE
   ══════════════════════════════════════════════════════════════ */
.rel-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--color-bg);
}

/* ── Detail empty state ── */
.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  font-size: 0.88rem;
  gap: 8px;
  padding: 48px;
}

/* ── Hero header ── */
.rd-hero {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 24px 28px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-surface);
}

.rd-hero-avatar-btn {
  background: none;
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease;
}
.rd-hero-avatar-btn:hover {
  border-color: var(--color-sage-400);
  box-shadow: var(--shadow-glow);
}

.rd-hero-avatar-img :deep(.img-display) {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-lg);
  object-fit: cover;
}

/* ── Hero info ── */
.rd-hero-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rd-hero-name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: var(--font-serif-cjk);
  color: var(--color-text-bone);
  letter-spacing: 0.04em;
}
.rd-hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.rd-chip {
  padding: 2px 10px;
  font-size: 0.7rem;
  font-weight: 500;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  background: color-mix(in oklch, var(--color-text-secondary) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-text-secondary) 12%, transparent);
}
.rd-chip--presence {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rd-hero-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.rd-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  white-space: nowrap;
}
.rd-action-btn:hover {
  background: color-mix(in oklch, var(--color-sage-400) 18%, transparent);
  border-color: var(--color-sage-400);
  transform: translateY(-1px);
}

/* ── Hero affinity block ── */
.rd-affinity-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  min-width: 72px;
  padding-top: 4px;
}
.rd-affinity-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}
.rd-affinity-num {
  font-size: 1.4rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-bone);
  line-height: 1.1;
}
.rd-affinity-type {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

/* ══════════════════════════════════════════════════════════════
   DETAIL TABS
   ══════════════════════════════════════════════════════════════ */
/* ── 2-Column Detail Body ── */
.rd-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  min-height: 0;
}
.rd-main {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  border-right: 1px solid var(--color-border-subtle);
}
.rd-side {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.rd-section {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-surface) 60%, transparent);
}
.rd-section-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-bone);
  margin: 0 0 10px;
}
.rd-section-title--nsfw {
  color: #e879a0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.nsfw-badge {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in oklch, #e879a0 12%, transparent);
  color: #e879a0;
  border: 1px solid color-mix(in oklch, #e879a0 25%, transparent);
}
.rd-quote {
  padding: 14px 18px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  font-family: var(--font-serif-cjk);
  font-size: 0.88rem;
  line-height: 1.8;
  color: color-mix(in oklch, var(--color-text) 80%, transparent);
  font-style: italic;
  position: relative;
}
.rd-quote::before {
  content: '\201C';
  position: absolute;
  top: 4px;
  left: 8px;
  font-size: 2rem;
  opacity: 0.1;
  color: var(--color-sage-400);
  font-style: normal;
}
.rd-side-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}
.rd-side-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.rd-side-label {
  color: var(--color-sage-400);
  font-size: 0.72rem;
  font-weight: 600;
  min-width: 36px;
  flex-shrink: 0;
}
.rd-side-val {
  color: var(--color-text-bone);
  flex: 1;
  min-width: 0;
}

@media (max-width: 900px) {
  .rd-body { grid-template-columns: 1fr; }
  .rd-main { border-right: none; }
  .rd-side { border-top: 1px solid var(--color-border-subtle); }
}

/* ══════════════════════════════════════════════════════════════
   BASIC TAB — bio, prose, traits
   ══════════════════════════════════════════════════════════════ */
.bio-line {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary);
  opacity: 0.7;
}

.prose {
  margin: 0;
  font-family: var(--font-serif-cjk);
  font-size: 0.88rem;
  line-height: 1.75;
  letter-spacing: var(--narrative-letter-spacing, 0.01em);
  color: color-mix(in oklch, var(--color-text-bone) 85%, transparent);
  white-space: pre-wrap;
}
.prose--focal {
  font-size: 0.95rem;
  color: var(--color-text-bone);
  line-height: 1.8;
}

.section-hint {
  display: block;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  opacity: 0.55;
  margin-bottom: 4px;
}

.trait-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}
.trait {
  padding: 4px 14px;
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 7%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-radius: var(--radius-full);
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
.trait:hover {
  background: color-mix(in oklch, var(--color-sage-400) 14%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* ══════════════════════════════════════════════════════════════
   STATUS TAB — thoughts, actions, chat preview
   ══════════════════════════════════════════════════════════════ */
.thought-cloud {
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  position: relative;
}
.thought-cloud::before {
  content: '\201C';
  position: absolute;
  top: 6px;
  left: 10px;
  font-size: 1.8rem;
  line-height: 1;
  opacity: 0.12;
  color: var(--color-sage-400);
}
.thought-text {
  margin: 0;
  font-family: var(--font-serif-cjk);
  font-size: 0.88rem;
  line-height: 1.75;
  font-style: italic;
  color: color-mix(in oklch, var(--color-text-bone) 80%, transparent);
  padding-left: 8px;
}

.action-strip {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in oklch, var(--color-success) 15%, transparent);
  background: color-mix(in oklch, var(--color-success) 4%, transparent);
  box-shadow: inset 3px 0 0 var(--color-success);
}
.action-text {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.6;
  color: var(--color-text-bone);
}

.chat-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-surface) 60%, transparent);
}
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 240px;
  overflow-y: auto;
}
.chat-bubble {
  padding: 8px 10px;
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  line-height: 1.5;
}
.chat-bubble--user {
  background: color-mix(in oklch, var(--color-sage-400) 5%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}
.chat-bubble--assistant {
  background: color-mix(in oklch, var(--color-success) 3%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in oklch, var(--color-success) 30%, transparent);
}
.chat-who {
  font-size: 0.62rem;
  font-weight: 600;
  opacity: 0.4;
  display: block;
  margin-bottom: 2px;
}

/* ══════════════════════════════════════════════════════════════
   MEMORY TAB — timeline
   ══════════════════════════════════════════════════════════════ */
.memory-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-left: 16px;
  position: relative;
}
.memory-timeline::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-radius: 1px;
}

.tl-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid color-mix(in oklch, var(--color-text-bone) 3%, transparent);
}
.tl-item:last-child {
  border-bottom: none;
}
.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 6px;
  background: var(--color-sage-400);
  box-shadow: 0 0 6px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}
.tl-text {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--color-text-bone);
}

/* ══════════════════════════════════════════════════════════════
   NSFW TAB — cards, desire meters, tags
   ══════════════════════════════════════════════════════════════ */
.nsfw-card {
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: rgba(232, 121, 160, 0.03);
  border: 1px solid rgba(232, 121, 160, 0.08);
}

.nsfw-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.nsfw-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nsfw-val {
  font-size: 0.86rem;
  color: var(--color-text-bone);
}
.nsfw-status {
  margin: 6px 0 0;
  font-size: 0.82rem;
  line-height: 1.5;
  color: color-mix(in oklch, var(--color-text-bone) 65%, transparent);
  font-style: italic;
}

.desire-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.desire-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(232, 121, 160, 0.1);
  overflow: hidden;
}
.desire-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #e879a0, #f472b6);
  transition: width 0.4s ease;
}
.desire-num {
  font-size: 0.78rem;
  font-weight: 600;
  color: #e879a0;
  min-width: 20px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.detail-tag {
  padding: 3px 12px;
  font-size: 0.72rem;
  font-weight: 500;
  background: color-mix(in oklch, var(--color-sage-400) 7%, transparent);
  color: var(--color-sage-400);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border-radius: var(--radius-full);
}
.detail-tag--nsfw {
  background: rgba(232, 121, 160, 0.07);
  color: #e879a0;
  border-color: rgba(232, 121, 160, 0.12);
}
.detail-tag--trait {
  background: color-mix(in oklch, var(--color-sage-600) 10%, transparent);
  color: var(--color-sage-600);
  border-color: color-mix(in oklch, var(--color-sage-600) 15%, transparent);
}

/* ══════════════════════════════════════════════════════════════
   BODY PARTS — grid, cards, meters
   ══════════════════════════════════════════════════════════════ */
.bp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.bp-card {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(232, 121, 160, 0.025);
  border: 1px solid rgba(232, 121, 160, 0.08);
  transition: border-color var(--duration-fast);
}
.bp-card:hover {
  border-color: rgba(232, 121, 160, 0.2);
}
.bp-head {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-bone);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bp-mark {
  font-size: 0.65rem;
  color: #e879a0;
  opacity: 0.8;
}
.bp-view-toggle {
  margin-left: auto;
  font-size: 0.6rem;
  color: #e879a0;
  background: transparent;
  border: 1px solid rgba(232, 121, 160, 0.3);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  cursor: pointer;
  transition: all var(--duration-fast);
}
.bp-view-toggle:hover {
  background: rgba(232, 121, 160, 0.1);
}
.bp-image :deep(.img-display) {
  width: 100%;
  height: auto;
  aspect-ratio: 3/4;
  border-radius: var(--radius-md);
  margin: 4px 0;
}
.bp-desc {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
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
  color: var(--color-text-secondary);
}
.bp-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in oklch, var(--color-text-bone) 6%, transparent);
  overflow: hidden;
}
.bp-fill {
  height: 100%;
  border-radius: 2px;
  background: #e879a0;
  transition: width 0.3s;
}
.bp-fill--dev {
  background: var(--color-sage-600);
}

/* ── Portrait display ── */
/* ── Portrait gallery — character showcase at bottom of main column ── */
.portrait-gallery {
  animation: portrait-enter 600ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
}
@keyframes portrait-enter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.portrait-frame {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: var(--color-surface, #1a1a24);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.4),
    0 16px 48px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.portrait-image :deep(.img-display) {
  width: 100%;
  height: auto;
  min-height: 300px;
  max-height: 600px;
  border-radius: 0;
  object-fit: cover;
  transition: transform 800ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.portrait-frame:hover .portrait-image :deep(.img-display) {
  transform: scale(1.03);
}
.portrait-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 50% 30%,
    transparent 50%,
    rgba(0, 0, 0, 0.2) 100%
  );
  box-shadow: inset 0 -48px 40px -24px var(--color-bg, #0f0f14);
}
.portrait-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.06em;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--duration-normal, 240ms) var(--ease-out);
}
.portrait-frame:hover .portrait-hint {
  opacity: 1;
}

/* ══════════════════════════════════════════════════════════════
   SHARED — hints, empty states
   ══════════════════════════════════════════════════════════════ */
.hint {
  font-size: 0.78rem;
  opacity: 0.35;
  margin: 0;
}
.hint--center {
  text-align: center;
  padding: 20px 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  color: var(--color-text-secondary);
  font-size: 0.88rem;
}

/* ══════════════════════════════════════════════════════════════
   EDIT MODAL — form elements
   ══════════════════════════════════════════════════════════════ */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 4px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: color-mix(in oklch, var(--color-text-bone) 2%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.form-section-title {
  margin: 0 0 2px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.form-row {
  display: flex;
  gap: 10px;
}
.form-group--half {
  flex: 1;
  min-width: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group--row {
  flex-direction: row;
  gap: 16px;
  flex-wrap: wrap;
}

.form-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.form-input,
.form-textarea {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--color-text-bone);
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--duration-fast) ease;
  font-family: inherit;
}
.form-input:focus,
.form-textarea:focus {
  border-color: var(--color-sage-400);
}

.form-textarea {
  resize: vertical;
  min-height: 60px;
}

.form-range {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: color-mix(in oklch, var(--color-text-bone) 8%, transparent);
  border-radius: 2px;
  outline: none;
}
.form-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e879a0;
  cursor: pointer;
}

.form-hint {
  display: block;
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.form-check-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--color-text-bone);
  cursor: pointer;
}

/* ── NSFW form nested blocks ── */
.nested-block {
  margin-top: 14px;
  padding: 12px 12px 10px;
  background: rgba(232, 121, 160, 0.04);
  border: 1px solid rgba(232, 121, 160, 0.18);
  border-radius: var(--radius-md);
}
.nested-title {
  margin: 0 0 8px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #e879a0;
  letter-spacing: 0.04em;
}

/* ── Body part edit cards ── */
.bp-edit-card {
  margin-top: 10px;
  padding: 10px 12px;
  background: color-mix(in oklch, var(--color-text-bone) 2%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 7px;
}
.bp-edit-card--extra {
  border-style: dashed;
}
.bp-edit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.bp-edit-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text-bone);
}
.bp-edit-name--fixed {
  color: #e879a0;
}
.bp-edit-badge {
  font-size: 0.64rem;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(232, 121, 160, 0.12);
  color: #e879a0;
  letter-spacing: 0.05em;
}
.bp-name-input {
  flex: 1;
  font-size: 0.85rem;
}
.bp-remove-btn {
  padding: 3px 10px;
  font-size: 0.72rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}
.bp-remove-btn:hover {
  color: var(--color-danger);
  border-color: var(--color-danger);
  background: color-mix(in oklch, var(--color-danger) 6%, transparent);
}
.bp-add-btn {
  margin-top: 12px;
}

/* ── Tag list ── */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 26px;
  padding: 4px 0;
}
.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 0.78rem;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 28%, transparent);
  border-radius: 12px;
  font-weight: 500;
}
.tag-delete {
  background: none;
  border: none;
  color: var(--color-sage-400);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
  transition: opacity var(--duration-fast) ease;
}
.tag-delete:hover {
  opacity: 1;
  color: var(--color-danger);
}
.tag-empty {
  font-size: 0.76rem;
  color: var(--color-text-secondary);
  opacity: 0.5;
  font-style: italic;
}
.tag-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.tag-input {
  flex: 1;
}

/* ── Memory list (edit modal) ── */
.memory-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
  padding-right: 4px;
}
.memory-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: 5px;
}
.memory-text {
  flex: 1;
  font-size: 0.78rem;
  color: var(--color-text-bone);
  line-height: 1.45;
}
.memory-delete {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 3px;
  opacity: 0.5;
  transition: all var(--duration-fast) ease;
  flex-shrink: 0;
}
.memory-delete:hover {
  opacity: 1;
  color: var(--color-danger);
}
.memory-empty {
  font-size: 0.76rem;
  color: var(--color-text-secondary);
  opacity: 0.5;
  font-style: italic;
  text-align: center;
  padding: 10px;
}

/* ══════════════════════════════════════════════════════════════
   BUTTONS
   ══════════════════════════════════════════════════════════════ */
.btn-primary {
  padding: 6px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-bone);
  background: var(--color-sage-400);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) ease;
}
.btn-primary:hover {
  background: var(--color-sage-300);
}

.btn-secondary {
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: color-mix(in oklch, var(--color-text-bone) 4%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-secondary:hover {
  color: var(--color-text-bone);
  border-color: var(--color-sage-400);
}

.btn-danger {
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-danger);
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 25%, transparent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-danger:hover {
  background: var(--color-danger);
  color: var(--color-text-bone);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
}
.btn-sm:hover {
  background: var(--color-sage-400);
  color: var(--color-text-bone);
}
</style>
