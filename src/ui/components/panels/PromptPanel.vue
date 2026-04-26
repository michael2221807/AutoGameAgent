<script setup lang="ts">
/**
 * PromptPanel — 提示词管理面板（B.4 全功能版）
 *
 * 新增：
 * - 分类折叠分组（category-based grouping）
 * - 展开全部 / 折叠全部
 * - 每条 prompt 权重编辑（1–10），颜色区分（≥9红/≥6黄/其余绿）
 * - 导出单条 prompt（JSON 下载）
 * - 导出全部（仅已修改条目）
 * - 导入（选择 JSON，合并不清空）
 * - 权重持久化到 localStorage
 */
import { ref, computed, inject } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import { eventBus } from '@/engine/core/event-bus';
import type { GamePack } from '@/engine/types/game-pack';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_PROMPT_SETTINGS, type PromptSettings } from '@/engine/prompt/world-book';
import { BUILTIN_SLOTS } from '@/engine/prompt/builtin-slots';
import { createEmptyHeroinePlan, type HeroinePlan, type HeroineEntry, type HeroineInteractionEvent } from '@/engine/story/heroine-plan';
import type { PromptRegistry } from '@/engine/prompt/prompt-registry';

const pack = inject<GamePack>('gamePack');
const promptRegistry = inject<PromptRegistry>('promptRegistry');
const { get, setValue } = useGameState();

// ─── Tab state ──────────────────────────────────────────────
type PanelTab = 'prompts' | 'settings' | 'heroine';
const activeTab = ref<PanelTab>('prompts');

// ─── Prompt Settings (from state tree) ──────────────────────
const promptSettings = computed<PromptSettings>(() => {
  const raw = get<Partial<PromptSettings>>('系统.设置.prompt');
  return { ...DEFAULT_PROMPT_SETTINGS, ...raw };
});

function updatePromptSetting<K extends keyof PromptSettings>(key: K, value: PromptSettings[K]) {
  const current = promptSettings.value;
  setValue('系统.设置.prompt', { ...current, [key]: value });
}

// ─── Heroine Plan state ─────────────────────────────────────
const heroinePlan = computed<HeroinePlan>(() => {
  const raw = get<HeroinePlan>('元数据.女主规划');
  return raw ?? createEmptyHeroinePlan();
});

const heroineEditName = ref('');
const heroineEditType = ref('主线女主');
const heroineEditRelation = ref('');
const heroineEditStage = ref('');

function addHeroineEntry() {
  if (!heroineEditName.value.trim()) return;
  const entry: HeroineEntry = {
    name: heroineEditName.value.trim(),
    type: heroineEditType.value,
    currentRelationStatus: heroineEditRelation.value || '陌生',
    currentStage: heroineEditStage.value || '初识期',
    establishedFacts: [],
    stageGoals: [],
    progressionMethods: [],
    blockingFactors: [],
    breakthroughConditions: [],
    failureRollback: [],
  };
  const plan = { ...heroinePlan.value };
  plan.heroineEntries = [...plan.heroineEntries, entry];
  setValue('元数据.女主规划', plan);
  heroineEditName.value = '';
  heroineEditRelation.value = '';
  heroineEditStage.value = '';
}

function removeHeroineEntry(name: string) {
  const plan = { ...heroinePlan.value };
  plan.heroineEntries = plan.heroineEntries.filter((e) => e.name !== name);
  plan.interactionEvents = plan.interactionEvents.filter((e) => e.heroineName !== name);
  plan.scenePlans = plan.scenePlans.filter((e) => e.heroineName !== name);
  setValue('元数据.女主规划', plan);
}

const heroineEventName = ref('');
const heroineEventDesc = ref('');
const heroineEventTarget = ref('');

function addHeroineEvent() {
  if (!heroineEventName.value.trim() || !heroineEventTarget.value) return;
  const event: HeroineInteractionEvent = {
    heroineName: heroineEventTarget.value,
    eventName: heroineEventName.value.trim(),
    eventDescription: heroineEventDesc.value.trim(),
    plannedTriggerTime: '',
    earliestTriggerTime: '',
    latestTriggerTime: '',
    prerequisites: [],
    triggerConditions: [],
    blockConditions: [],
    successOutcomes: [],
    failureOutcomes: [],
    relatedQuests: [],
    status: '待触发',
  };
  const plan = { ...heroinePlan.value };
  plan.interactionEvents = [...plan.interactionEvents, event];
  setValue('元数据.女主规划', plan);
  heroineEventName.value = '';
  heroineEventDesc.value = '';
}

function removeHeroineEvent(idx: number) {
  const plan = { ...heroinePlan.value };
  plan.interactionEvents = plan.interactionEvents.filter((_, i) => i !== idx);
  setValue('元数据.女主规划', plan);
}

// ─── Prompt entry & persistence ──────────────────────────────

interface PromptEntry {
  id: string;
  category: string;
  content: string;
  defaultContent: string;
  enabled: boolean;
  modified: boolean;
  weight: number;
  scope: string[];
  injectionMode: 'always' | 'match_any';
  keywords: string[];
  type: 'world_lore' | 'system_rule' | 'command_rule' | 'output_rule';
}

const SCOPE_OPTIONS = [
  { value: 'main', label: '主回合' },
  { value: 'opening', label: '开局' },
  { value: 'all', label: '全部' },
  { value: 'world_evolution', label: '世界演化' },
  { value: 'story_plan', label: '剧情规划' },
  { value: 'heroine_plan', label: '女主规划' },
  { value: 'recall', label: '回忆' },
] as const;

const TYPE_OPTIONS = [
  { value: 'system_rule', label: '系统规则' },
  { value: 'world_lore', label: '世界设定' },
  { value: 'command_rule', label: '指令规则' },
  { value: 'output_rule', label: '输出规则' },
] as const;

function storageKey(id: string): string {
  const packId = pack?.manifest.id ?? 'unknown';
  return `aga_prompt_${packId}_${id}`;
}
function enabledKey(id: string): string {
  const packId = pack?.manifest.id ?? 'unknown';
  return `aga_prompt_enabled_${packId}_${id}`;
}
function weightKey(id: string): string {
  const packId = pack?.manifest.id ?? 'unknown';
  return `aga_prompt_weight_${packId}_${id}`;
}
function metaKey(id: string): string {
  const packId = pack?.manifest.id ?? 'unknown';
  return `aga_prompt_meta_${packId}_${id}`;
}

/** 读取高级字段（scope/injectionMode/keywords/type） */
function loadMeta(id: string): { scope: string[]; injectionMode: 'always' | 'match_any'; keywords: string[]; type: PromptEntry['type'] } {
  try {
    const raw = localStorage.getItem(metaKey(id));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        scope: Array.isArray(parsed.scope) ? parsed.scope as string[] : ['all'],
        injectionMode: parsed.injectionMode === 'match_any' ? 'match_any' : 'always',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords as string[] : [],
        type: (['world_lore', 'system_rule', 'command_rule', 'output_rule'].includes(parsed.type as string)
          ? parsed.type : 'system_rule') as PromptEntry['type'],
      };
    }
  } catch { /* ignore */ }
  return { scope: ['all'], injectionMode: 'always', keywords: [], type: 'system_rule' };
}

function saveMeta(id: string, meta: { scope: string[]; injectionMode: string; keywords: string[]; type: string }): void {
  localStorage.setItem(metaKey(id), JSON.stringify(meta));
}

/** Prompt ID → Chinese display name (from BUILTIN_SLOTS + manual mapping) */
const PROMPT_DISPLAY_NAMES: Record<string, string> = {
  // Core
  narratorFrame: '叙事者身份框架',
  narratorEnforcement: '执行强化提醒',
  core: '核心规则·输出格式',
  mainRound: '主回合生成指令',
  // Opening
  opening: '开局场景',
  // Memory
  memorySummary: '记忆总结',
  midTermRefine: '中期记忆精炼',
  longTermCompact: '长期记忆压缩',
  // Split gen
  splitGenStep1: '分步生成 Step1（叙事）',
  splitGenStep2: '分步生成 Step2（指令）',
  splitGenContext: '分步生成上下文',
  // World
  worldGen: '世界生成',
  worldHeartbeat: '世界心跳',
  // Action
  actionOptions: '行动选项（行动导向）',
  actionOptionsStory: '行动选项（剧情导向）',
  // History
  historyFraming: '历史对话说明',
  assistantInjectionContract: '助手注入协议',
  // Privacy
  privacyRepair: '私密信息修复',
  // NPC
  npcChat: 'NPC 私聊',
  npcMemorySummary: 'NPC 记忆总结',
  presencePartition: 'NPC 在场分区',
  // CoT
  'cot-preamble': 'COT 思维链协议',
  'cot-masquerade': 'COT 伪装历史消息',
  'cot-judge': 'COT 判定协议',
  'cot-opening': 'COT 开局思考',
  'cot-no-thinking-guard': 'COT 禁止思考标签',
  // Writing
  perspectiveFirst: '写作·第一人称',
  perspectiveSecond: '写作·第二人称',
  perspectiveThird: '写作·第三人称',
  writeStyle: '写作·文风指导',
  emotionGuard: '写作·避免极端情绪',
  noControl: '写作·禁止操控玩家 (NoControl)',
  narrativeConstraints: '写作·叙事总约束',
  wordCountReq: '写作·字数要求',
  // Body polish
  bodyPolish: '文章优化（润色）',
  // Story Styles
  storyStyleGeneral: '风格·一般（写实纪实）',
  storyStyleHarem: '风格·后宫',
  storyStylePureLove: '风格·纯爱',
  storyStyleCultivation: '风格·修炼',
  storyStyleShura: '风格·修罗场',
  storyStyleNtlHarem: '风格·NTL后宫',
  // Image
  imageCharacterTokenizer: '生图·角色词组转化器',
  imageSceneTokenizer: '生图·场景词组转化器',
  imageSceneJudge: '生图·场景类型判定',
  imageSecretPartTokenizer: '生图·私密部位转化器',
  imageAnchorExtractor: '生图·角色锚点提取',
  imageStyleRefinement: '生图·PNG 画风提炼',
  // Plot Direction
  plotDirective: '剧情引导·叙事方向注入',
  plotEvaluationStep2: '剧情引导·节点完成评估',
  plotDecompose: '剧情引导·大纲 AI 拆解',
};

/** Prompt ID → category (Chinese) */
function inferCategory(id: string): string {
  // Check builtin slots first — find which slot references this promptId
  for (const slot of Object.values(BUILTIN_SLOTS)) {
    if (slot.defaultPromptId === id) return slot.category;
  }
  // Fallback pattern matching
  if (id.startsWith('core') || id === 'narratorFrame' || id === 'narratorEnforcement') return '常驻';
  if (id.startsWith('main') || id.includes('Round') || id.includes('round')) return '主剧情';
  if (id.startsWith('open') || id.includes('Opening') || id.includes('opening')) return '开局';
  if (id.includes('memory') || id.includes('Memory') || id.includes('midTerm') || id.includes('MidTerm')) return '记忆';
  if (id.includes('heartbeat') || id.includes('Heartbeat')) return '世界';
  if (id.includes('npc') || id.includes('Npc') || id.includes('NPC') || id.includes('presence')) return 'NPC';
  if (id.includes('split') || id.includes('Split')) return '分步生成';
  if (id.includes('cot') || id.startsWith('cot-')) return 'COT';
  if (id.includes('perspective') || id.includes('write') || id.includes('Write') || id.includes('emotion') || id.includes('noControl') || id.includes('narrative') || id.includes('wordCount')) return '写作';
  if (id.includes('storyStyle')) return '剧情风格';
  if (id.includes('image') || id.includes('Image') || id.includes('anchor') || id.includes('Anchor')) return '生图';
  if (id.includes('action') || id.includes('Action')) return '行动选项';
  if (id.includes('privacy') || id.includes('Privacy')) return 'NSFW';
  if (id.includes('bodyPolish')) return '文章优化';
  return '其他';
}

function getDisplayName(id: string): string {
  return PROMPT_DISPLAY_NAMES[id] ?? id;
}

// ─── Pluggable radio-group options ──────────────────────────
// Style options are data-driven: built-in + any pack prompt whose ID starts with 'storyStyle'
interface RadioOption { value: string; label: string; desc: string }

const BUILTIN_STYLE_OPTIONS: RadioOption[] = [
  { value: 'general', label: '一般（写实纪实）', desc: '写实低夸张，按事实推进' },
  { value: 'harem', label: '后宫', desc: '多角色关系经营，独立人格' },
  { value: 'pureLove', label: '纯爱', desc: '一对一主线，长期陪伴双向奔赴' },
  { value: 'cultivation', label: '修炼', desc: '境界体系闭环，突破代价' },
  { value: 'shura', label: '修罗场', desc: '多方施压高张力，动态博弈' },
  { value: 'ntlHarem', label: 'NTL后宫', desc: '主纯爱辅NTL，苦主单向受挫' },
];

const storyStyleOptions = computed<RadioOption[]>(() => {
  const builtinValues = new Set(BUILTIN_STYLE_OPTIONS.map((o) => o.value));
  const extra: RadioOption[] = [];
  // Discover additional style prompts from pack (any ID starting with 'storyStyle' not in builtins)
  if (pack) {
    for (const id of Object.keys(pack.prompts)) {
      if (id.startsWith('storyStyle') && !builtinValues.has(id.replace('storyStyle', '').replace(/^./, (c) => c.toLowerCase()))) {
        const displayName = PROMPT_DISPLAY_NAMES[id] ?? id;
        const value = id.replace('storyStyle', '');
        // Only add if not already a builtin
        if (!builtinValues.has(value) && !builtinValues.has(value.charAt(0).toLowerCase() + value.slice(1))) {
          extra.push({ value: id, label: displayName, desc: '自定义风格' });
        }
      }
    }
  }
  return [...BUILTIN_STYLE_OPTIONS, ...extra];
});

// Perspective options (also pluggable)
const BUILTIN_PERSPECTIVE_OPTIONS: RadioOption[] = [
  { value: '第一人称', label: '第一人称（我）', desc: '叙述者使用"我"' },
  { value: '第二人称', label: '第二人称（你）', desc: '默认。叙述者使用"你"' },
  { value: '第三人称', label: '第三人称（他/她/姓名）', desc: '叙述者使用角色名或代词' },
];

/**
 * Determine if a prompt is active based on radio-group settings.
 * For mutually-exclusive prompts (perspective, style), only the selected one is "on".
 */
function isPromptActiveByRadio(id: string): boolean | null {
  // Perspective prompts — only selected one is active
  const perspectiveMap: Record<string, string> = {
    perspectiveFirst: '第一人称',
    perspectiveSecond: '第��人称',
    perspectiveThird: '第三人称',
  };
  if (id in perspectiveMap) {
    return promptSettings.value.perspective === perspectiveMap[id];
  }

  // Style prompts — only selected one is active
  const styleReverseMap: Record<string, string> = {
    storyStyleGeneral: 'general',
    storyStyleHarem: 'harem',
    storyStylePureLove: 'pureLove',
    storyStyleCultivation: 'cultivation',
    storyStyleShura: 'shura',
    storyStyleNtlHarem: 'ntlHarem',
  };
  if (id in styleReverseMap) {
    return promptSettings.value.storyStyle === styleReverseMap[id];
  }

  // Not a radio-group prompt
  return null;
}

const promptEntries = computed<PromptEntry[]>(() => {
  if (!pack) return [];
  const entries: PromptEntry[] = [];
  for (const [id, defaultContent] of Object.entries(pack.prompts)) {
    const savedContent = localStorage.getItem(storageKey(id));
    const savedEnabled = localStorage.getItem(enabledKey(id));
    const savedWeight = localStorage.getItem(weightKey(id));
    const content = savedContent ?? defaultContent;

    // Radio-group override: if this prompt is part of a mutually-exclusive group,
    // its enabled state is determined by settings, not localStorage
    const radioState = isPromptActiveByRadio(id);
    const enabled = radioState !== null
      ? radioState
      : (savedEnabled !== null ? savedEnabled === 'true' : true);

    const weight = savedWeight !== null ? Math.min(10, Math.max(1, Number(savedWeight))) : 5;
    const meta = loadMeta(id);
    entries.push({
      id,
      category: inferCategory(id),
      content,
      defaultContent,
      enabled,
      modified: content !== defaultContent,
      weight,
      scope: meta.scope,
      injectionMode: meta.injectionMode,
      keywords: meta.keywords,
      type: meta.type,
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
});

// ─── Category grouping ────────────────────────────────────────

const CATEGORY_ORDER = ['常驻', '主剧情', '剧情导向', 'COT', '写作', '剧情风格', '开局', '记忆', 'NPC', '世界', '分步生成', '行动选项', '生图', '文章优化', 'NSFW', '其他'];

interface CategoryGroup {
  name: string;
  entries: PromptEntry[];
  collapsed: boolean;
}

const collapsedCategories = ref<Set<string>>(new Set());

const categoryGroups = computed<CategoryGroup[]>(() => {
  const filtered = filteredPrompts.value;
  const groupMap = new Map<string, PromptEntry[]>();

  for (const entry of filtered) {
    const cat = entry.category;
    if (!groupMap.has(cat)) groupMap.set(cat, []);
    groupMap.get(cat)!.push(entry);
  }

  const groups: CategoryGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (groupMap.has(cat)) {
      groups.push({ name: cat, entries: groupMap.get(cat)!, collapsed: collapsedCategories.value.has(cat) });
    }
  }
  // Any category not in CATEGORY_ORDER (shouldn't happen but safe)
  for (const [cat, entries] of groupMap.entries()) {
    if (!CATEGORY_ORDER.includes(cat)) {
      groups.push({ name: cat, entries, collapsed: collapsedCategories.value.has(cat) });
    }
  }
  return groups;
});

function toggleCategory(cat: string): void {
  if (collapsedCategories.value.has(cat)) {
    collapsedCategories.value.delete(cat);
  } else {
    collapsedCategories.value.add(cat);
  }
  collapsedCategories.value = new Set(collapsedCategories.value); // trigger reactivity
}

function expandAll(): void {
  collapsedCategories.value = new Set();
}

function collapseAll(): void {
  collapsedCategories.value = new Set(categoryGroups.value.map((g) => g.name));
}

// ─── Search & filter ──────────────────────────────────────────

const searchQuery = ref('');
const filterMode = ref<'all' | 'enabled' | 'disabled' | 'modified'>('all');

const filteredPrompts = computed<PromptEntry[]>(() => {
  let list = promptEntries.value;
  if (filterMode.value === 'enabled') list = list.filter((p) => p.enabled);
  if (filterMode.value === 'disabled') list = list.filter((p) => !p.enabled);
  if (filterMode.value === 'modified') list = list.filter((p) => p.modified);
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(
      (p) => p.id.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
    );
  }
  return list;
});

// ─── Toggle enabled ───────────────────────────────────────────

function toggleEnabled(entry: PromptEntry): void {
  const newVal = !entry.enabled;
  localStorage.setItem(enabledKey(entry.id), String(newVal));
  promptRegistry?.setEnabled(entry.id, newVal);
  eventBus.emit('ui:toast', {
    type: newVal ? 'success' : 'warning',
    message: `${entry.id} 已${newVal ? '启用' : '禁用'}`,
    duration: 1200,
  });
}

// ─── Weight editing ───────────────────────────────────────────

function setWeight(entry: PromptEntry, val: number): void {
  const clamped = Math.min(10, Math.max(1, val));
  localStorage.setItem(weightKey(entry.id), String(clamped));
}

function weightColor(w: number): string {
  if (w >= 9) return 'var(--color-danger, #ef4444)';
  if (w >= 6) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-success, #22c55e)';
}

// ─── View/edit modal ─────────────────────────────────────────

const showModal = ref(false);
const editingPrompt = ref<PromptEntry | null>(null);
const editContent = ref('');
const editScope = ref<string[]>(['all']);
const editInjectionMode = ref<'always' | 'match_any'>('always');
const editKeywordsText = ref('');
const editType = ref<PromptEntry['type']>('system_rule');

function openPrompt(entry: PromptEntry): void {
  editingPrompt.value = entry;
  editContent.value = entry.content;
  editScope.value = [...entry.scope];
  editInjectionMode.value = entry.injectionMode;
  editKeywordsText.value = entry.keywords.join(', ');
  editType.value = entry.type;
  showModal.value = true;
}

function savePrompt(): void {
  if (!editingPrompt.value) return;
  const id = editingPrompt.value.id;
  localStorage.setItem(storageKey(id), editContent.value);
  saveMeta(id, {
    scope: editScope.value,
    injectionMode: editInjectionMode.value,
    keywords: editKeywordsText.value.split(',').map((s) => s.trim()).filter(Boolean),
    type: editType.value,
  });
  promptRegistry?.setUserContent(id, editContent.value);
  showModal.value = false;
  eventBus.emit('ui:toast', { type: 'success', message: 'Prompt 已保存', duration: 1500 });
}

function resetPrompt(): void {
  if (!editingPrompt.value) return;
  const id = editingPrompt.value.id;
  editContent.value = editingPrompt.value.defaultContent;
  localStorage.removeItem(storageKey(id));
  localStorage.removeItem(enabledKey(id));
  localStorage.removeItem(weightKey(id));
  localStorage.removeItem(metaKey(id));
  promptRegistry?.resetToDefault(id);
  promptRegistry?.setEnabled(id, true);
  editScope.value = ['all'];
  editInjectionMode.value = 'always';
  editKeywordsText.value = '';
  editType.value = 'system_rule';
  showModal.value = false;
  eventBus.emit('ui:toast', { type: 'info', message: 'Prompt 已重置为默认', duration: 1500 });
}

function toggleScope(val: string): void {
  const idx = editScope.value.indexOf(val);
  if (idx >= 0) editScope.value.splice(idx, 1);
  else editScope.value.push(val);
}

// ─── Export single prompt ─────────────────────────────────────

function exportSingle(entry: PromptEntry, event: Event): void {
  event.stopPropagation();
  const data = { id: entry.id, content: entry.content, weight: entry.weight, enabled: entry.enabled, exportedAt: new Date().toISOString() };
  downloadJson(data, `prompt-${entry.id}-${Date.now()}.json`);
}

// ─── Export all modified prompts ──────────────────────────────

function exportAll(): void {
  const modified = promptEntries.value.filter((p) => p.modified || !p.enabled || p.weight !== 5);
  if (!modified.length) {
    eventBus.emit('ui:toast', { type: 'info', message: '无已修改的 Prompt，无需导出', duration: 2000 });
    return;
  }
  const data = {
    packId: pack?.manifest.id ?? 'unknown',
    prompts: modified.map((p) => ({ id: p.id, content: p.content, weight: p.weight, enabled: p.enabled })),
    exportedAt: new Date().toISOString(),
  };
  downloadJson(data, `prompts-export-${Date.now()}.json`);
  eventBus.emit('ui:toast', { type: 'success', message: `已导出 ${modified.length} 条已修改 Prompt`, duration: 2000 });
}

// ─── Import prompts ───────────────────────────────────────────

function importPrompts(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as { prompts?: Array<{ id: string; content?: string; weight?: number; enabled?: boolean }> };
      if (!Array.isArray(raw.prompts)) throw new Error('无效格式：缺少 prompts 数组');
      let count = 0;
      for (const item of raw.prompts) {
        if (!item.id) continue;
        if (item.content !== undefined) {
          localStorage.setItem(storageKey(item.id), item.content);
          promptRegistry?.setUserContent(item.id, item.content);
        }
        if (item.weight !== undefined) localStorage.setItem(weightKey(item.id), String(item.weight));
        if (item.enabled !== undefined) {
          localStorage.setItem(enabledKey(item.id), String(item.enabled));
          promptRegistry?.setEnabled(item.id, item.enabled);
        }
        count++;
      }
      eventBus.emit('ui:toast', { type: 'success', message: `已导入 ${count} 条 Prompt 覆盖`, duration: 2000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析失败';
      eventBus.emit('ui:toast', { type: 'error', message: msg, duration: 3000 });
    }
  };
  input.click();
}

// ─── Utilities ────────────────────────────────────────────────

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function previewContent(content: string, maxLen = 100): string {
  const stripped = content.replace(/\n/g, ' ').trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}
</script>

<template>
  <div class="prompt-panel">
    <template v-if="pack">
      <header class="panel-header">
        <h2 class="panel-title">提示词与世界书管理</h2>
        <div class="panel-tabs">
          <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'prompts' }]" @click="activeTab = 'prompts'">内置提示词</button>
          <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'settings' }]" @click="activeTab = 'settings'">游戏设定</button>
          <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'heroine' }]" @click="activeTab = 'heroine'">剧情规划</button>
        </div>
      </header>

      <!-- ═══ Tab: 游戏设定 ═══ -->
      <div v-if="activeTab === 'settings'" class="settings-tab">
        <div class="settings-group">
          <h3 class="settings-group-title">叙事人称（互斥选择）</h3>
          <p class="settings-desc">控制 AI 如何称呼玩家角色。同一时间只有一种人称生效。</p>
          <div class="style-radio-group">
            <label v-for="opt in BUILTIN_PERSPECTIVE_OPTIONS" :key="opt.value" :class="['style-radio-item', { 'style-radio-item--active': promptSettings.perspective === opt.value }]">
              <input type="radio" name="perspective" :value="opt.value" :checked="promptSettings.perspective === opt.value" @change="updatePromptSetting('perspective', opt.value as PromptSettings['perspective'])" />
              <div class="style-radio-info">
                <span class="style-radio-label">{{ opt.label }}</span>
                <span class="style-radio-desc">{{ opt.desc }}</span>
              </div>
            </label>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group-title">字数要求</h3>
          <p class="settings-desc">每回合 AI 叙事正文的最低字数</p>
          <input type="number" class="settings-input" min="200" max="3000" step="50"
            :value="promptSettings.wordCountRequirement"
            @change="updatePromptSetting('wordCountRequirement', Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="settings-group">
          <h3 class="settings-group-title">剧情风格（互斥选择）</h3>
          <p class="settings-desc">选择一种风格后，对应的叙事偏好提示词会替换当前风格位。同一时间只有一个风格生效。</p>
          <div class="style-radio-group">
            <label v-for="opt in storyStyleOptions" :key="opt.value" :class="['style-radio-item', { 'style-radio-item--active': promptSettings.storyStyle === opt.value }]">
              <input type="radio" name="storyStyle" :value="opt.value" :checked="promptSettings.storyStyle === opt.value" @change="updatePromptSetting('storyStyle', opt.value as PromptSettings['storyStyle'])" />
              <div class="style-radio-info">
                <span class="style-radio-label">{{ opt.label }}</span>
                <span class="style-radio-desc">{{ opt.desc }}</span>
              </div>
            </label>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group-title">角色边界</h3>
          <div class="settings-row">
            <label class="settings-label">
              <input type="checkbox" :checked="promptSettings.enableNoControl" @change="updatePromptSetting('enableNoControl', ($event.target as HTMLInputElement).checked)" />
              启用 NoControl（禁止 AI 操控玩家）
            </label>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group-title">行动选项</h3>
          <div class="settings-row">
            <label class="settings-label">
              <input type="checkbox" :checked="promptSettings.enableActionOptions" @change="updatePromptSetting('enableActionOptions', ($event.target as HTMLInputElement).checked)" />
              启用行动选项生成
            </label>
          </div>
          <div v-if="promptSettings.enableActionOptions" class="settings-row">
            <select class="settings-select" :value="promptSettings.actionOptionsMode" @change="updatePromptSetting('actionOptionsMode', ($event.target as HTMLSelectElement).value as 'action' | 'story')">
              <option value="action">行动导向</option>
              <option value="story">剧情导向</option>
            </select>
            <select class="settings-select" :value="promptSettings.actionPace" @change="updatePromptSetting('actionPace', ($event.target as HTMLSelectElement).value as 'fast' | 'slow')">
              <option value="fast">快节奏</option>
              <option value="slow">慢节奏</option>
            </select>
          </div>
        </div>

        <div class="settings-group">
          <h3 class="settings-group-title">额外系统提示词</h3>
          <p class="settings-desc">自定义附加到系统提示词末尾的内容</p>
          <textarea class="settings-textarea" rows="4"
            :value="promptSettings.customSystemPrompt"
            @input="updatePromptSetting('customSystemPrompt', ($event.target as HTMLTextAreaElement).value)"
            placeholder="输入额外的系统提示词（可选）…"
          />
        </div>
      </div>

      <!-- ═══ Tab: 剧情规划 ═══ -->
      <div v-if="activeTab === 'heroine'" class="heroine-tab">
        <p class="settings-desc">管理女主/男主剧情规划。添加的条目会作为上下文注入到 AI 的每回合推理中，指导剧情推进方向。</p>

        <!-- Heroine Entries -->
        <div class="settings-group">
          <h3 class="settings-group-title">角色条目 ({{ heroinePlan.heroineEntries.length }})</h3>

          <div v-for="entry in heroinePlan.heroineEntries" :key="entry.name" class="heroine-card">
            <div class="heroine-card-header">
              <span class="heroine-card-name">{{ entry.name }}</span>
              <span class="heroine-card-type">{{ entry.type }}</span>
              <span class="heroine-card-stage">{{ entry.currentStage }}</span>
              <button class="btn btn--ghost btn--sm" style="margin-left:auto;color:var(--color-danger,#ef4444)" @click="removeHeroineEntry(entry.name)">删除</button>
            </div>
            <div class="heroine-card-meta">
              关系: {{ entry.currentRelationStatus }}
            </div>
          </div>

          <div v-if="heroinePlan.heroineEntries.length === 0" class="heroine-empty">暂无角色条目</div>

          <div class="heroine-add-form">
            <input v-model="heroineEditName" class="settings-input" placeholder="角色名" style="flex:1" />
            <select v-model="heroineEditType" class="settings-select" style="width:120px">
              <option value="主线女主">主线女主</option>
              <option value="支线女主">支线女主</option>
              <option value="隐藏女主">隐藏女主</option>
              <option value="主线男主">主线男主</option>
              <option value="支线角色">支线角色</option>
            </select>
            <input v-model="heroineEditRelation" class="settings-input" placeholder="关系状态" style="width:100px" />
            <input v-model="heroineEditStage" class="settings-input" placeholder="当前阶段" style="width:100px" />
            <button class="btn btn--primary btn--sm" @click="addHeroineEntry">添加</button>
          </div>
        </div>

        <!-- Interaction Events -->
        <div class="settings-group">
          <h3 class="settings-group-title">互动事件 ({{ heroinePlan.interactionEvents.length }})</h3>

          <div v-for="(evt, idx) in heroinePlan.interactionEvents" :key="idx" class="heroine-card">
            <div class="heroine-card-header">
              <span class="heroine-card-name">[{{ evt.heroineName }}] {{ evt.eventName }}</span>
              <span :class="['heroine-status', `heroine-status--${evt.status === '待触发' ? 'pending' : evt.status === '已完成' ? 'done' : 'active'}`]">{{ evt.status }}</span>
              <button class="btn btn--ghost btn--sm" style="margin-left:auto;color:var(--color-danger,#ef4444)" @click="removeHeroineEvent(idx)">删除</button>
            </div>
            <div v-if="evt.eventDescription" class="heroine-card-meta">{{ evt.eventDescription }}</div>
          </div>

          <div v-if="heroinePlan.interactionEvents.length === 0" class="heroine-empty">暂无互动事件</div>

          <div class="heroine-add-form">
            <select v-model="heroineEventTarget" class="settings-select" style="width:120px">
              <option value="" disabled>选择角色</option>
              <option v-for="h in heroinePlan.heroineEntries" :key="h.name" :value="h.name">{{ h.name }}</option>
            </select>
            <input v-model="heroineEventName" class="settings-input" placeholder="事件名" style="flex:1" />
            <input v-model="heroineEventDesc" class="settings-input" placeholder="事件说明" style="flex:2" />
            <button class="btn btn--primary btn--sm" @click="addHeroineEvent">添加</button>
          </div>
        </div>

        <!-- Stage Progression (read-only summary for now) -->
        <div class="settings-group">
          <h3 class="settings-group-title">阶段推进 ({{ heroinePlan.stageProgression.length }})</h3>
          <div v-for="(stage, idx) in heroinePlan.stageProgression" :key="idx" class="heroine-card">
            <div class="heroine-card-header">
              <span class="heroine-card-name">{{ stage.stageName }}</span>
            </div>
            <div class="heroine-card-meta">目标: {{ stage.stageGoals.join('、') || '无' }}</div>
          </div>
          <div v-if="heroinePlan.stageProgression.length === 0" class="heroine-empty">暂无阶段规划（可通过 AI 指令自动生成）</div>
        </div>
      </div>

      <!-- ═══ Tab: 内置提示词 ═══ -->
      <template v-if="activeTab === 'prompts'">
      <div class="prompts-header-actions">
        <div class="header-actions">
          <button class="btn btn--ghost btn--sm" @click="expandAll" title="展开全部">展开</button>
          <button class="btn btn--ghost btn--sm" @click="collapseAll" title="折叠全部">折叠</button>
          <button class="btn btn--ghost btn--sm" @click="importPrompts" title="导入 Prompt JSON">导入</button>
          <button class="btn btn--primary btn--sm" @click="exportAll" title="导出已修改的 Prompt">导出</button>
        </div>
      </div>

      <!-- ─── Toolbar ─── -->
      <div class="toolbar">
        <input
          v-model="searchQuery"
          type="text"
          class="search-field"
          placeholder="搜索 prompt ID 或内容…"
          aria-label="搜索 Prompt"
        />
        <select v-model="filterMode" class="filter-select" aria-label="过滤方式">
          <option value="all">全部</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已禁用</option>
          <option value="modified">已修改</option>
        </select>
      </div>

      <!-- ─── Category groups ─── -->
      <div v-if="filteredPrompts.length" class="groups-list">
        <div
          v-for="group in categoryGroups"
          :key="group.name"
          class="category-group"
        >
          <!-- Category header -->
          <button
            class="category-header"
            @click="toggleCategory(group.name)"
            :aria-expanded="!group.collapsed"
          >
            <svg
              :class="['chevron', { 'chevron--collapsed': group.collapsed }]"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="14"
              height="14"
            >
              <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
            <span class="category-name">{{ group.name }}</span>
            <span class="category-count">{{ group.entries.length }}</span>
          </button>

          <!-- Entries -->
          <Transition name="group-expand">
            <div v-if="!group.collapsed" class="prompt-list">
              <div
                v-for="entry in group.entries"
                :key="entry.id"
                :class="['prompt-card', { 'prompt-card--disabled': !entry.enabled }]"
              >
                <div class="prompt-header">
                  <div class="prompt-title-area" @click="openPrompt(entry)">
                    <span class="prompt-id" :title="entry.id">{{ getDisplayName(entry.id) }}</span>
                    <span v-if="entry.modified" class="modified-badge">已修改</span>
                  </div>
                  <div class="prompt-controls">
                    <!-- Weight input -->
                    <div class="weight-control" title="优先级权重 1–10">
                      <span class="weight-label" :style="{ color: weightColor(entry.weight) }">W</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        :value="entry.weight"
                        class="weight-input"
                        :style="{ color: weightColor(entry.weight) }"
                        @change="setWeight(entry, Number(($event.target as HTMLInputElement).value))"
                        @click.stop
                        aria-label="权重"
                      />
                    </div>
                    <!-- Export single -->
                    <button class="icon-btn" title="导出此 Prompt" @click="exportSingle(entry, $event)">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                        <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>
                      </svg>
                    </button>
                    <!-- Enable toggle -->
                    <button
                      :class="['enable-toggle', { 'enable-toggle--on': entry.enabled }]"
                      @click.stop="toggleEnabled(entry)"
                      :title="entry.enabled ? '点击禁用' : '点击启用'"
                    >
                      {{ entry.enabled ? 'ON' : 'OFF' }}
                    </button>
                  </div>
                </div>
                <p class="prompt-preview" @click="openPrompt(entry)">
                  {{ previewContent(entry.content) }}
                </p>
              </div>
            </div>
          </Transition>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>没有匹配的 Prompt</p>
      </div>
      </template><!-- end activeTab === 'prompts' -->
    </template><!-- end v-if="pack" -->

    <div v-else class="empty-state">
      <p>未加载 GamePack — 无 Prompt 数据</p>
    </div>

    <!-- ─── Edit Modal ─── -->
    <Modal v-model="showModal" :title="editingPrompt ? `编辑: ${getDisplayName(editingPrompt.id)}` : ''" width="720px">
      <!-- 高级字段区域 -->
      <div class="meta-fields">
        <div class="meta-row">
          <label class="meta-label">类型</label>
          <select v-model="editType" class="meta-select">
            <option v-for="opt in TYPE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>

          <label class="meta-label">注入模式</label>
          <select v-model="editInjectionMode" class="meta-select">
            <option value="always">始终注入</option>
            <option value="match_any">关键词匹配</option>
          </select>
        </div>

        <div class="meta-row">
          <label class="meta-label">适用范围</label>
          <div class="scope-checks">
            <label v-for="opt in SCOPE_OPTIONS" :key="opt.value" class="scope-check">
              <input type="checkbox" :checked="editScope.includes(opt.value)" @change="toggleScope(opt.value)" />
              {{ opt.label }}
            </label>
          </div>
        </div>

        <div v-if="editInjectionMode === 'match_any'" class="meta-row">
          <label class="meta-label">关键词</label>
          <input v-model="editKeywordsText" class="meta-input" placeholder="逗号分隔，如：天剑门, 李明阳, 苍穹峰" />
        </div>
      </div>

      <!-- 内容编辑 -->
      <div class="edit-area">
        <textarea
          v-model="editContent"
          class="prompt-editor"
          rows="18"
          spellcheck="false"
          aria-label="Prompt 内容编辑器"
        />
      </div>
      <template #footer>
        <button
          v-if="editingPrompt?.modified"
          class="btn-warning"
          @click="resetPrompt"
        >
          重置为默认
        </button>
        <div style="flex: 1" />
        <button class="btn-secondary" @click="showModal = false">取消</button>
        <button class="btn-primary" @click="savePrompt">保存修改</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.prompt-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
  height: 100%;
  overflow-y: auto;
}

/* ── Tabs ── */
.panel-tabs { display: flex; gap: 4px; margin-left: auto; }
.tab-btn {
  padding: 4px 12px; border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px; background: transparent; color: var(--color-text-secondary, #8888a0);
  font-size: 13px; cursor: pointer; transition: all 0.15s;
}
.tab-btn:hover { background: var(--color-primary-muted, rgba(99,102,241,.1)); }
.tab-btn--active { background: var(--color-primary, #6366f1); color: var(--color-text-bone); border-color: var(--color-primary, #6366f1); }

.prompts-header-actions { display: flex; justify-content: flex-end; }

/* ── Settings Tab ── */
.settings-tab { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
.settings-group {
  padding: 12px 16px; background: var(--color-surface, #1a1a24);
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.settings-group-title { font-size: 14px; font-weight: 600; color: var(--color-text, #e0e0e6); margin: 0; }
.settings-desc { font-size: 12px; color: var(--color-text-muted, #55556a); margin: 0; }
.settings-select, .settings-input {
  padding: 5px 10px; background: var(--color-bg, #111118);
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px;
  color: var(--color-text, #e0e0e6); font-size: 13px; max-width: 300px;
}
.settings-select:focus, .settings-input:focus { outline: none; border-color: var(--color-primary, #6366f1); }
.settings-textarea {
  padding: 8px 10px; background: var(--color-bg, #111118);
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px;
  color: var(--color-text, #e0e0e6); font-size: 13px; resize: vertical;
  font-family: inherit;
}
.settings-textarea:focus { outline: none; border-color: var(--color-primary, #6366f1); }
.settings-row { display: flex; gap: 8px; align-items: center; }
.settings-label { font-size: 13px; color: var(--color-text-secondary, #8888a0); display: flex; align-items: center; gap: 6px; cursor: pointer; }

/* Style radio group */
.style-radio-group { display: flex; flex-direction: column; gap: 4px; }
.style-radio-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 10px;
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px;
  cursor: pointer; transition: all 0.15s;
}
.style-radio-item:hover { border-color: var(--color-primary, #6366f1); }
.style-radio-item--active { border-color: var(--color-primary, #6366f1); background: color-mix(in oklch, var(--color-sage-400) 6%, transparent); }
.style-radio-item input[type="radio"] { margin-top: 3px; accent-color: var(--color-primary, #6366f1); }
.style-radio-info { display: flex; flex-direction: column; }
.style-radio-label { font-size: 13px; font-weight: 500; color: var(--color-text, #e0e0e6); }
.style-radio-desc { font-size: 11px; color: var(--color-text-muted, #55556a); }

/* Heroine plan tab */
.heroine-tab { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
.heroine-card {
  padding: 8px 12px; background: var(--color-bg, #111118);
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px;
  margin-bottom: 4px;
}
.heroine-card-header { display: flex; align-items: center; gap: 8px; }
.heroine-card-name { font-size: 13px; font-weight: 600; color: var(--color-text, #e0e0e6); }
.heroine-card-type { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--color-primary-muted, rgba(99,102,241,.1)); color: var(--color-primary, #6366f1); }
.heroine-card-stage { font-size: 11px; color: var(--color-text-muted, #55556a); }
.heroine-card-meta { font-size: 12px; color: var(--color-text-secondary, #8888a0); margin-top: 4px; }
.heroine-status { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.heroine-status--pending { background: color-mix(in oklch, var(--color-amber-400) 10%, transparent); color: var(--color-amber-400); }
.heroine-status--active { background: color-mix(in oklch, var(--color-sage-300) 10%, transparent); color: var(--color-sage-300); }
.heroine-status--done { background: color-mix(in oklch, var(--color-success) 10%, transparent); color: var(--color-success); }
.heroine-empty { font-size: 12px; color: var(--color-text-muted, #55556a); padding: 8px; text-align: center; }
.heroine-add-form { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }

/* ── Header ── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-primary, #6366f1);
  border-radius: 10px;
}

.header-actions {
  display: flex;
  gap: 6px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.15s ease;
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

/* ── Toolbar ── */
.toolbar {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.search-field {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  outline: none;
}
.search-field:focus { border-color: var(--color-primary, #6366f1); }

.filter-select {
  height: 36px;
  padding: 0 10px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
}

/* ── Category groups ── */
.groups-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-group {
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  overflow: hidden;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  background: rgba(255,255,255,0.02);
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.category-header:hover { background: rgba(255,255,255,0.04); }

.chevron {
  color: var(--color-text-secondary, #8888a0);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.chevron--collapsed { transform: rotate(-90deg); }

.category-name {
  flex: 1;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.category-count {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255,255,255,0.06);
  padding: 1px 7px;
  border-radius: 8px;
}

/* ── Prompt list ── */
.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: 1px solid var(--color-border, #2a2a3a);
}

.prompt-card {
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.01);
  transition: background 0.15s ease;
}
.prompt-card:hover { background: rgba(255, 255, 255, 0.03); }
.prompt-card--disabled { opacity: 0.45; }

.prompt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.prompt-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.prompt-id {
  font-size: 0.84rem;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modified-badge {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 1px 6px;
  color: var(--color-warning, #f59e0b);
  background: color-mix(in oklch, var(--color-amber-400) 10%, transparent);
  border-radius: 8px;
  flex-shrink: 0;
}

/* ── Prompt controls ── */
.prompt-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.weight-control {
  display: flex;
  align-items: center;
  gap: 2px;
}

.weight-label {
  font-size: 0.7rem;
  font-weight: 700;
  width: 14px;
}

.weight-input {
  width: 34px;
  height: 24px;
  padding: 0 4px;
  font-size: 0.78rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 4px;
  outline: none;
  text-align: center;
  -moz-appearance: textfield;
}
.weight-input::-webkit-inner-spin-button,
.weight-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.weight-input:focus { border-color: var(--color-primary, #6366f1); }

.icon-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.icon-btn:hover { color: var(--color-text, #e0e0e6); background: rgba(255,255,255,0.06); }

.enable-toggle {
  padding: 2px 10px;
  font-size: 0.7rem;
  font-weight: 700;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.15s ease;
}
.enable-toggle--on {
  color: var(--color-success, #22c55e);
  border-color: color-mix(in oklch, var(--color-success) 25%, transparent);
  background: color-mix(in oklch, var(--color-success) 8%, transparent);
}

.prompt-preview {
  margin: 5px 0 0;
  font-size: 0.76rem;
  color: var(--color-text-secondary, #8888a0);
  line-height: 1.5;
  cursor: pointer;
}

/* ── Meta fields (advanced world book fields) ── */
.meta-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  border-radius: 8px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.meta-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  flex-shrink: 0;
}
.meta-select {
  padding: 4px 8px;
  font-size: 0.75rem;
  background: rgba(255,255,255,0.06);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 5px;
}
.meta-input {
  flex: 1;
  padding: 4px 8px;
  font-size: 0.75rem;
  background: rgba(255,255,255,0.06);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  min-width: 200px;
}
.scope-checks {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.scope-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.scope-check input { accent-color: var(--color-primary); }

/* ── Edit area ── */
.edit-area {
  display: flex;
  flex-direction: column;
}

.prompt-editor {
  width: 100%;
  min-height: 400px;
  padding: 12px;
  font-size: 0.82rem;
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
.prompt-editor:focus { border-color: var(--color-primary, #6366f1); }

/* ── Buttons ── */
.btn-primary {
  padding: 6px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-bone);
  background: var(--color-primary, #6366f1);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.btn-primary:hover { background: var(--color-primary-hover, #4f46e5); }

.btn-secondary {
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
}
.btn-secondary:hover { color: var(--color-text, #e0e0e6); border-color: var(--color-primary, #6366f1); }

.btn-warning {
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-warning, #f59e0b);
  background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 20%, transparent);
  border-radius: 6px;
  cursor: pointer;
}
.btn-warning:hover { background: var(--color-warning, #f59e0b); color: #000; }

/* ── Empty ── */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.88rem;
}

/* ── Transitions ── */
.group-expand-enter-active { transition: all 0.2s ease; }
.group-expand-leave-active { transition: all 0.15s ease; }
.group-expand-enter-from, .group-expand-leave-to { opacity: 0; max-height: 0; overflow: hidden; }
.group-expand-enter-to, .group-expand-leave-from { opacity: 1; max-height: 2000px; }

/* ── Scrollbar ── */
.prompt-panel::-webkit-scrollbar { width: 5px; }
.prompt-panel::-webkit-scrollbar-track { background: transparent; }
.prompt-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }
</style>
