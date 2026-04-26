<script setup lang="ts">
/**
 * SettingsPanel — game settings UI.
 *
 * B.2 扩展：行动选项深度 + 心跳高级参数 + NPC设置 + 高级(Debug/文本替换/导入导出)
 * Persists to localStorage / game state tree.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { eventBus } from '@/engine/core/event-bus';
import Modal from '@/ui/components/common/Modal.vue';
import EngramSettingsSection from '../settings/EngramSettingsSection.vue';
import { useGameState } from '@/ui/composables/useGameState';
import type { ProfileManager } from '@/engine/persistence/profile-manager';
import type { SaveManager } from '@/engine/persistence/save-manager';
import AgaToggle from '@/ui/components/shared/AgaToggle.vue';

const SETTINGS_KEY = 'aga_user_settings';

/** User settings shape */
interface UserSettings {
  fontSize: number;
  showActionOptions: boolean;
  themeAccent: string;
  enableAnimations: boolean;
  autoSaveInterval: number;
  language: string;
}

const defaultSettings: UserSettings = {
  fontSize: 14,
  showActionOptions: true,
  themeAccent: '#91c49b',
  enableAnimations: true,
  autoSaveInterval: 5,
  language: 'zh-CN',
};

const settings = ref<UserSettings>({ ...defaultSettings });

// ─── Persistence ───

function loadSettings(): void {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<UserSettings>;
      settings.value = { ...defaultSettings, ...parsed };
    }
  } catch {
    settings.value = { ...defaultSettings };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch (e) {
    console.error('[Settings] 保存失败:', e);
  }
}

// ─── Auto-save on changes ───

watch(settings, () => {
  saveSettings();
  applyRootMetrics(settings.value.fontSize, uiScale.value);
}, { deep: true });

// ─── Actions ───

function resetAll(): void {
  settings.value = { ...defaultSettings };
  saveSettings();
  actionOptions.value = { ...defaultActionOptions };
  localStorage.setItem(ACTION_OPTIONS_KEY, JSON.stringify(actionOptions.value));
  debugSettings.value = { ...defaultDebug };
  localStorage.setItem(DEBUG_KEY, JSON.stringify(debugSettings.value));
  textReplaceRules.value = [];
  localStorage.setItem(TEXT_REPLACE_KEY, JSON.stringify([]));
  eventBus.emit('ui:toast', { type: 'info', message: '已重置所有设置', duration: 1500 });
}

function applyFontSize(): void {
  const size = settings.value.fontSize;
  applyRootMetrics(size, uiScale.value);
  eventBus.emit('ui:toast', { type: 'success', message: `字体大小已调整为 ${size}px`, duration: 1200 });
}

// Font size × UI scale both drive the root font-size so rem units scale
// consistently. The `--narrative-font-size` var stays in sync for narrative
// text that explicitly opts in.
function applyRootMetrics(fontPx: number, scalePct: number): void {
  const rootPx = (fontPx * scalePct) / 100;
  document.documentElement.style.fontSize = `${rootPx}px`;
  document.documentElement.style.setProperty('--base-font-size', `${fontPx}px`);
  document.documentElement.style.setProperty('--narrative-font-size', `${fontPx}px`);
  document.documentElement.style.setProperty('--ui-scale', `${scalePct}%`);
}

function applyThemeColor(): void {
  document.documentElement.style.setProperty('--color-primary', settings.value.themeAccent);
  eventBus.emit('ui:toast', { type: 'success', message: '主题颜色已更新', duration: 1200 });
}

const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

/** Whether settings differ from defaults */
const hasChanges = computed(() =>
  JSON.stringify(settings.value) !== JSON.stringify(defaultSettings),
);

// ─── B.2.1 Action Options deep settings ───────────────────────

const ACTION_OPTIONS_KEY = 'aga_action_options_settings';

interface ActionOptionsSettings {
  mode: 'action' | 'story';
  pace: 'fast' | 'slow';
  customPrompt: string;
}

const defaultActionOptions: ActionOptionsSettings = {
  mode: 'action',
  pace: 'fast',
  customPrompt: '',
};

const actionOptions = ref<ActionOptionsSettings>({ ...defaultActionOptions });

function loadActionOptions(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTION_OPTIONS_KEY) ?? '{}') as Partial<ActionOptionsSettings>;
    actionOptions.value = { ...defaultActionOptions, ...raw };
  } catch { actionOptions.value = { ...defaultActionOptions }; }
}

watch(actionOptions, () => {
  localStorage.setItem(ACTION_OPTIONS_KEY, JSON.stringify(actionOptions.value));
}, { deep: true });

// ─── Memory system settings (2026-04-11 Feature A) ───────────
//
// 四层记忆系统的用户可调阈值。写入 localStorage `aga_memory_settings`。
// MemoryManager.readSettingsOverride() 每次决策时实时读取，无需重启游戏。
//
// 每个字段有合理范围 cap（见 MemoryManager.getEffectiveConfig 的 clamp 逻辑）。
const MEMORY_SETTINGS_KEY = 'aga_memory_settings';

type ShortTermInjectionStyle = 'single_assistant_block' | 'few_shot_pairs';

interface MemorySettings {
  shortTermLimit: number;           // 1-50, default 5
  midTermRefineThreshold: number;   // 5-200, default 25
  longTermSummaryThreshold: number; // 10-500, default 50
  longTermSummarizeCount: number;   // 1-200, default 50
  midTermKeep: number;              // 0-200, default 0
  longTermCap: number;              // 5-200, default 30
  /** 2026-04-14 新增：短期记忆注入 prompt 的方式 */
  shortTermInjectionStyle: ShortTermInjectionStyle;
  /** 2026-04-14 新增：few_shot_pairs 模式下保留几对对话轮次 */
  fewShotPairs: number;             // 1-10, default 3
}

const defaultMemorySettings: MemorySettings = {
  shortTermLimit: 5,
  midTermRefineThreshold: 25,
  longTermSummaryThreshold: 50,
  longTermSummarizeCount: 50,
  midTermKeep: 0,
  longTermCap: 30,
  shortTermInjectionStyle: 'few_shot_pairs',
  fewShotPairs: 3,
};

const memorySettings = ref<MemorySettings>({ ...defaultMemorySettings });

function loadMemorySettings(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_SETTINGS_KEY) ?? '{}') as Partial<MemorySettings>;
    memorySettings.value = { ...defaultMemorySettings, ...raw };
  } catch { memorySettings.value = { ...defaultMemorySettings }; }
}

watch(memorySettings, () => {
  try {
    localStorage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify(memorySettings.value));
  } catch { /* localStorage 不可用时静默忽略 */ }
}, { deep: true });

// ─── B.2.2 Heartbeat advanced settings (game state) ──────────

const { isLoaded, get, setValue } = useGameState();

// ─── Action Options → state tree sync (bugfix 2026-04-11) ───
//
// 原版 actionOptions 只存 localStorage，context-assembly 读不到，导致用户在
// UI 选的"剧情导向"模式永远不生效（prompt flow 不 branch）。修复：把
// actionOptions 的 mode/pace/customPrompt 同步写到状态树 `系统.actionOptions.*`，
// context-assembly 从状态树读取后注入条件变量让 prompt flow 按 mode 分支。
function syncActionOptionsToStateTree(): void {
  setValue('系统.actionOptions.mode', actionOptions.value.mode);
  setValue('系统.actionOptions.pace', actionOptions.value.pace);
  setValue('系统.actionOptions.customPrompt', actionOptions.value.customPrompt);
}

// 载入时和任何字段变化时都同步（仅当游戏已加载，否则无状态树可写）
watch(actionOptions, () => {
  if (isLoaded.value) syncActionOptionsToStateTree();
}, { deep: true });

// 游戏加载后也做一次同步（HomeView modal 里改了 localStorage 但 isLoaded=false
// 时没能写状态树，等游戏真正 load 后 watch 触发一次把 localStorage 的值推入）
watch(() => isLoaded.value, (loaded) => {
  if (loaded) syncActionOptionsToStateTree();
});

// ─── §11.2 NSFW settings ─────────────────────────────────────
//
// 必须放在 `useGameState()` 解构之后，因为 loadNsfwSettings / saveNsfwSettings /
// syncNsfwToStateTree / watch(isLoaded) 都引用 `isLoaded` 和 `setValue`。
// 若放在前面会触发 TDZ（ReferenceError: Cannot access 'isLoaded' before initialization）。
//
// 双层存储：
// - localStorage 'aga_nsfw_settings' 保存 user-level 偏好（跨存档持久化）
// - 状态树 系统.nsfwMode / 系统.nsfwGenderFilter 是 save-level（本次游戏覆盖）
//
// UI 切换时同时写两处：
// - localStorage 立即保存，未来游戏加载后默认读此值
// - setValue() 即时写入当前状态树，使本次游戏立即生效（ContextAssemblyStage
//   的 nsfwMode 判断、CommandExecutionStage 的私密信息校验、ContentFilter 的
//   tag 剥离都读状态树）
//
// 读取顺序（与 privacy-profile-validator.readNsfwSettings 一致）：
//   状态树 → localStorage → 硬编码默认 false / 'female'

const NSFW_KEY = 'aga_nsfw_settings';
type NsfwGenderFilter = 'all' | 'male' | 'female';

interface NsfwSettings {
  nsfwMode: boolean;
  nsfwGenderFilter: NsfwGenderFilter;
}

const defaultNsfw: NsfwSettings = {
  nsfwMode: false,
  nsfwGenderFilter: 'female',
};

const nsfwSettings = ref<NsfwSettings>({ ...defaultNsfw });

const nsfwGenderOptions: Array<{ value: NsfwGenderFilter; label: string }> = [
  { value: 'all',    label: '全部性别' },
  { value: 'male',   label: '仅男性 NPC' },
  { value: 'female', label: '仅女性 NPC' },
];

function loadNsfwSettings(): void {
  try {
    const raw = localStorage.getItem(NSFW_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NsfwSettings>;
      nsfwSettings.value = {
        nsfwMode: typeof parsed.nsfwMode === 'boolean' ? parsed.nsfwMode : defaultNsfw.nsfwMode,
        nsfwGenderFilter:
          parsed.nsfwGenderFilter === 'all' ||
          parsed.nsfwGenderFilter === 'male' ||
          parsed.nsfwGenderFilter === 'female'
            ? parsed.nsfwGenderFilter
            : defaultNsfw.nsfwGenderFilter,
      };
    }
  } catch {
    nsfwSettings.value = { ...defaultNsfw };
  }

  // 启动时把 localStorage 值同步到状态树（若游戏已加载）
  if (isLoaded.value) {
    syncNsfwToStateTree();
  }
}

function saveNsfwSettings(): void {
  try {
    localStorage.setItem(NSFW_KEY, JSON.stringify(nsfwSettings.value));
  } catch (e) {
    console.error('[NSFW] 保存失败:', e);
  }
  // 同时写入状态树 — 立即生效
  if (isLoaded.value) {
    syncNsfwToStateTree();
  }
}

function syncNsfwToStateTree(): void {
  setValue('系统.nsfwMode', nsfwSettings.value.nsfwMode);
  setValue('系统.nsfwGenderFilter', nsfwSettings.value.nsfwGenderFilter);
  eventBus.emit('engine:request-save');
}

// 启动时和游戏加载时都要同步（游戏加载后 isLoaded 变 true，此时再 sync 一次）
watch(() => isLoaded.value, (loaded) => {
  if (loaded) syncNsfwToStateTree();
});

watch(nsfwSettings, () => saveNsfwSettings(), { deep: true });

const HEARTBEAT_BASE = '世界.状态.心跳';

const heartbeatHistoryLimit = computed(() => {
  const v = get<number>(`${HEARTBEAT_BASE}.历史条数`);
  return typeof v === 'number' ? v : 20;
});
const heartbeatForgetRounds = computed(() => {
  const v = get<number>(`${HEARTBEAT_BASE}.遗忘回合数`);
  return typeof v === 'number' ? v : 30;
});

function setHeartbeatHistoryLimit(v: number): void {
  setValue(`${HEARTBEAT_BASE}.历史条数`, Math.max(5, Math.min(100, v)));
  eventBus.emit('engine:request-save');
}
function setHeartbeatForgetRounds(v: number): void {
  setValue(`${HEARTBEAT_BASE}.遗忘回合数`, Math.max(0, Math.min(999, v)));
  eventBus.emit('engine:request-save');
}

// ─── B.2.3 NPC settings (game state) ─────────────────────────

const npcDemotionThreshold = computed(() => {
  const v = get<number>('系统.npcDemotionThreshold');
  return typeof v === 'number' ? v : 5;
});
const npcRangeMin = computed(() => {
  const v = get<number>('系统.importantNpcGenerationRange.min');
  return typeof v === 'number' ? v : 0;
});
const npcRangeMax = computed(() => {
  const v = get<number>('系统.importantNpcGenerationRange.max');
  return typeof v === 'number' ? v : 1;
});

function setNpcDemotion(v: number): void {
  setValue('系统.npcDemotionThreshold', Math.max(1, Math.min(999, v)));
  eventBus.emit('engine:request-save');
}
function setNpcRangeMin(v: number): void {
  const clamped = Math.max(0, Math.min(npcRangeMax.value, v));
  setValue('系统.importantNpcGenerationRange.min', clamped);
  eventBus.emit('engine:request-save');
}
function setNpcRangeMax(v: number): void {
  const clamped = Math.max(npcRangeMin.value, Math.min(10, v));
  setValue('系统.importantNpcGenerationRange.max', clamped);
  eventBus.emit('engine:request-save');
}

// ─── B.2.4 Advanced settings ──────────────────────────────────

const DEBUG_KEY = 'aga_debug_settings';

interface DebugSettings {
  debugMode: boolean;
  consoleDebug: boolean;
  aiLogging: boolean;
}

const defaultDebug: DebugSettings = {
  debugMode: false,
  consoleDebug: false,
  aiLogging: false,
};

const debugSettings = ref<DebugSettings>({ ...defaultDebug });

function loadDebugSettings(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(DEBUG_KEY) ?? '{}') as Partial<DebugSettings>;
    debugSettings.value = { ...defaultDebug, ...raw };
  } catch { debugSettings.value = { ...defaultDebug }; }
}

watch(debugSettings, () => {
  localStorage.setItem(DEBUG_KEY, JSON.stringify(debugSettings.value));
  eventBus.emit('settings:debug-mode-changed', debugSettings.value.debugMode);
}, { deep: true });

// ─── Plot Direction Settings (Sprint Plot-1 P6) ─────────────

const PLOT_SETTINGS_KEY = 'aga_plot_settings';

interface PlotSettings {
  enabled: boolean;
  criticalConfirmGate: boolean;
  confidenceThreshold: number;
  showGaugesInMainPanel: boolean;
  opportunityMaxTier: 1 | 2 | 3;
  autoAdvanceSkippable: boolean;
  showEvalLog: boolean;
}

const defaultPlotSettings: PlotSettings = {
  enabled: true,
  criticalConfirmGate: true,
  confidenceThreshold: 0.7,
  showGaugesInMainPanel: true,
  opportunityMaxTier: 3,
  autoAdvanceSkippable: true,
  showEvalLog: false,
};

const plotSettings = ref<PlotSettings>({ ...defaultPlotSettings });

function loadPlotSettings(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(PLOT_SETTINGS_KEY) ?? '{}') as Partial<PlotSettings>;
    plotSettings.value = { ...defaultPlotSettings, ...raw };
  } catch { plotSettings.value = { ...defaultPlotSettings }; }
}

function syncPlotSettingsToStateTree(): void {
  setValue('系统.设置.plot.enabled', plotSettings.value.enabled);
  setValue('系统.设置.plot.criticalConfirmGate', plotSettings.value.criticalConfirmGate);
  setValue('系统.设置.plot.confidenceThreshold', plotSettings.value.confidenceThreshold);
  setValue('系统.设置.plot.showGaugesInMainPanel', plotSettings.value.showGaugesInMainPanel);
  setValue('系统.设置.plot.opportunityMaxTier', plotSettings.value.opportunityMaxTier);
  setValue('系统.设置.plot.autoAdvanceSkippable', plotSettings.value.autoAdvanceSkippable);
  setValue('系统.设置.plot.showEvalLog', plotSettings.value.showEvalLog);
}

watch(plotSettings, () => {
  localStorage.setItem(PLOT_SETTINGS_KEY, JSON.stringify(plotSettings.value));
  if (isLoaded.value) syncPlotSettingsToStateTree();
}, { deep: true });

watch(() => isLoaded.value, (loaded) => {
  if (loaded) syncPlotSettingsToStateTree();
});

// ─── B.2.4.2 Text replace rules ──────────────────────────────

const TEXT_REPLACE_KEY = 'aga_text_replace_rules';

interface TextReplaceRule {
  id: string;
  enabled: boolean;
  mode: 'regex' | 'text';
  pattern: string;
  replacement: string;
  ignoreCase: boolean;
  global: boolean;
}

const textReplaceRules = ref<TextReplaceRule[]>([]);
const showReplaceModal = ref(false);

function loadTextRules(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(TEXT_REPLACE_KEY) ?? '[]');
    textReplaceRules.value = Array.isArray(raw) ? raw : [];
  } catch { textReplaceRules.value = []; }
}

function saveTextRules(): void {
  localStorage.setItem(TEXT_REPLACE_KEY, JSON.stringify(textReplaceRules.value));
}

const editingRule = ref<TextReplaceRule | null>(null);
const ruleForm = ref<Omit<TextReplaceRule, 'id'>>({
  enabled: true, mode: 'text', pattern: '', replacement: '', ignoreCase: false, global: true,
});
const ruleFormError = ref('');
const showRuleEditor = ref(false);

function openNewRule(): void {
  editingRule.value = null;
  ruleForm.value = { enabled: true, mode: 'text', pattern: '', replacement: '', ignoreCase: false, global: true };
  ruleFormError.value = '';
  showRuleEditor.value = true;
}

function openEditRule(rule: TextReplaceRule): void {
  editingRule.value = rule;
  ruleForm.value = { ...rule };
  ruleFormError.value = '';
  showRuleEditor.value = true;
}

function submitRuleForm(): void {
  if (!ruleForm.value.pattern.trim()) {
    ruleFormError.value = '匹配模式不能为空';
    return;
  }
  if (ruleForm.value.mode === 'regex') {
    try { new RegExp(ruleForm.value.pattern); }
    catch { ruleFormError.value = '正则表达式格式无效'; return; }
  }
  if (editingRule.value) {
    const idx = textReplaceRules.value.findIndex((r) => r.id === editingRule.value!.id);
    if (idx >= 0) textReplaceRules.value[idx] = { id: editingRule.value.id, ...ruleForm.value };
  } else {
    textReplaceRules.value.push({ id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...ruleForm.value });
  }
  saveTextRules();
  showRuleEditor.value = false;
}

function deleteRule(id: string): void {
  textReplaceRules.value = textReplaceRules.value.filter((r) => r.id !== id);
  saveTextRules();
}

function toggleRule(id: string): void {
  const rule = textReplaceRules.value.find((r) => r.id === id);
  if (rule) { rule.enabled = !rule.enabled; saveTextRules(); }
}

// ─── B.2.4.3 Import / Export settings ────────────────────────

function exportSettings(): void {
  const data = {
    settings: settings.value,
    actionOptions: actionOptions.value,
    debugSettings: debugSettings.value,
    textReplaceRules: textReplaceRules.value,
    exportedAt: new Date().toISOString(),
    version: 1,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aga-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  eventBus.emit('ui:toast', { type: 'success', message: '设置已导出', duration: 1500 });
}

function openImportSettings(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      if (raw.settings) settings.value = { ...defaultSettings, ...(raw.settings as Partial<typeof settings.value>) };
      if (raw.actionOptions) actionOptions.value = { ...defaultActionOptions, ...(raw.actionOptions as Partial<ActionOptionsSettings>) };
      if (raw.debugSettings) debugSettings.value = { ...defaultDebug, ...(raw.debugSettings as Partial<DebugSettings>) };
      if (Array.isArray(raw.textReplaceRules)) {
        textReplaceRules.value = (raw.textReplaceRules as unknown[]).filter(
          (item): item is TextReplaceRule =>
            typeof (item as TextReplaceRule).id === 'string' &&
            typeof (item as TextReplaceRule).pattern === 'string' &&
            typeof (item as TextReplaceRule).replacement === 'string',
        );
        saveTextRules();
      }
      eventBus.emit('ui:toast', { type: 'success', message: '设置已导入', duration: 1500 });
    } catch {
      eventBus.emit('ui:toast', { type: 'error', message: '设置文件解析失败', duration: 2000 });
    }
  };
  input.click();
}

// ─── B.2.4.4 Clear cache ─────────────────────────────────────

const showClearCacheConfirm = ref(false);

/** Keys that must never be cleared by "clear cache" — they hold user config, not transient caches */
const CACHE_PROTECTED_KEYS = new Set([
  'aga_api_management',
  'aga_ai_settings',
  'aga_engram_config',
  'aga_user_settings',
  'aga_action_options_settings',
  'aga_debug_settings',
  'aga_text_replace_rules',
  'aga_autosave_settings',
  'aga_feature_toggles',
  'aga_memory_settings',
  'aga_nsfw_settings',
  'aga_plot_settings',
  'aga_heartbeat_settings',
  'aga_assistant_settings',
  'aga_ui_scale',
  'aga_text_speed',
]);

function clearCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('aga_') || k.startsWith('aga-')) && !CACHE_PROTECTED_KEYS.has(k)) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
  showClearCacheConfirm.value = false;
  eventBus.emit('ui:toast', { type: 'success', message: `已清除 ${keysToRemove.length} 条缓存`, duration: 2000 });
}

// ─── 6.1 UI 缩放 ─────────────────────────────────────────────

const UI_SCALE_KEY = 'aga_ui_scale';
const uiScale = ref(Number(localStorage.getItem(UI_SCALE_KEY) ?? 100));

function applyUiScale(val: number): void {
  applyRootMetrics(settings.value.fontSize, val);
}

watch(uiScale, (val) => {
  applyUiScale(val);
  localStorage.setItem(UI_SCALE_KEY, String(val));
});

// ─── 6.1 文本速度 ─────────────────────────────────────────────

const TEXT_SPEED_KEY = 'aga_text_speed';
type TextSpeed = '0.5x' | '1x' | '2x' | 'max';
const textSpeed = ref<TextSpeed>((localStorage.getItem(TEXT_SPEED_KEY) as TextSpeed) ?? '1x');
const textSpeedOptions: TextSpeed[] = ['0.5x', '1x', '2x', 'max'];

watch(textSpeed, (val) => {
  localStorage.setItem(TEXT_SPEED_KEY, val);
});

// ─── 6.1 数据管理 ─────────────────────────────────────────────

const profileManager = inject<ProfileManager>('profileManager');
const saveManager = inject<SaveManager>('saveManager');
const router = useRouter();

const isExportingAllSaves = ref(false);
const showClearAllConfirm = ref(false);
const clearAllStep = ref<1 | 2>(1);

async function exportAllSaves(): Promise<void> {
  if (!profileManager || !saveManager) return;
  isExportingAllSaves.value = true;
  try {
    const profiles = profileManager.listProfiles();
    const data = await Promise.all(
      profiles.map(async (p) => {
        const slots: Record<string, unknown> = {};
        for (const slotId of Object.keys(p.slots)) {
          const state = await saveManager.loadGame(p.profileId, slotId);
          slots[slotId] = { meta: p.slots[slotId], state };
        }
        return { profile: p, slots };
      }),
    );
    const bundle = { profiles: data, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `autogame-all-saves-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    eventBus.emit('ui:toast', { type: 'success', message: '所有存档已导出', duration: 2000 });
  } catch (err) {
    console.error('[Settings] exportAllSaves failed:', err);
    eventBus.emit('ui:toast', { type: 'error', message: '导出失败', duration: 2500 });
  } finally {
    isExportingAllSaves.value = false;
  }
}

function openImportSaves(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as { profiles?: unknown[] };
      if (!Array.isArray(raw.profiles)) throw new Error('无效格式：缺少 profiles 数组');
      eventBus.emit('ui:toast', { type: 'info', message: `找到 ${raw.profiles.length} 个档案，功能待完整后端实现`, duration: 3000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析失败';
      eventBus.emit('ui:toast', { type: 'error', message: msg, duration: 3000 });
    }
  };
  input.click();
}

async function clearAllData(): Promise<void> {
  try {
    if (profileManager) {
      await profileManager.clearAll();
    }
    // Delete independent IDB databases that profileManager.clearAll doesn't cover
    for (const dbName of ['aga-config', 'aga-prompts', 'aga_image_cache']) {
      try { indexedDB.deleteDatabase(dbName); } catch { /* best effort */ }
    }
    localStorage.clear();
    eventBus.emit('ui:toast', { type: 'success', message: '所有数据已清除', duration: 2000 });
    showClearAllConfirm.value = false;
    void router.push('/');
  } catch (err) {
    console.error('[Settings] clearAllData failed:', err);
    eventBus.emit('ui:toast', { type: 'error', message: '清除失败', duration: 2500 });
  }
}

// ─── Mount ────────────────────────────────────────────────────

onMounted(() => {
  loadSettings();
  loadActionOptions();
  loadDebugSettings();
  loadPlotSettings();
  loadTextRules();
  loadNsfwSettings();
  loadMemorySettings();
  loadFeatureToggles();
  loadCotSettings();
  loadPresenceEnabled();
  loadBodyPolish();
  loadImageGen();
  // Sync state-tree toggles → aga_feature_toggles so API panel can read one source
  featureToggles.value.cot = cotSettings.value.enabled;
  featureToggles.value.bodyPolish = bodyPolishEnabled.value;
  featureToggles.value.imageGeneration = imageGenEnabled.value;
  saveFeatureToggles();
  // fontSize × uiScale are coupled — apply together so rem units scale correctly
  applyRootMetrics(settings.value.fontSize, uiScale.value);
});

// ─── Feature toggles ─────────────────────────────────────────
//
// Consolidated toggles for all optional AI features.
// Each is stored in the game state tree and synced to localStorage
// where appropriate so the engine can read them at runtime.

const FEATURE_TOGGLES_KEY = 'aga_feature_toggles';

interface FeatureToggles {
  text_optimization: boolean;
  world_heartbeat: boolean;
  location_npc_generation: boolean;
  npc_chat: boolean;
  field_repair: boolean;
  plot_decompose: boolean;
  assistant: boolean;
  cot: boolean;
  bodyPolish: boolean;
  imageGeneration: boolean;
  privacy_repair: boolean;
}

const defaultFeatureToggles: FeatureToggles = {
  text_optimization: false,
  world_heartbeat: true,
  location_npc_generation: true,
  npc_chat: true,
  field_repair: true,
  plot_decompose: true,
  assistant: true,
  cot: false,
  bodyPolish: false,
  imageGeneration: false,
  privacy_repair: true,
};

const featureToggles = ref<FeatureToggles>({ ...defaultFeatureToggles });

function loadFeatureToggles(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(FEATURE_TOGGLES_KEY) ?? '{}') as Partial<FeatureToggles>;
    featureToggles.value = { ...defaultFeatureToggles, ...raw };
  } catch {
    featureToggles.value = { ...defaultFeatureToggles };
  }
}

function saveFeatureToggles(): void {
  try {
    localStorage.setItem(FEATURE_TOGGLES_KEY, JSON.stringify(featureToggles.value));
  } catch { /* ignore */ }
}

function toggleFeature(key: keyof FeatureToggles): void {
  featureToggles.value[key] = !featureToggles.value[key];
  saveFeatureToggles();
}

watch(featureToggles, () => saveFeatureToggles(), { deep: true });

const cotSettings = ref({
  enabled: false,
  judgeEnabled: false,
  injectStep2: true,
  ringSize: 3,
});

function loadCotSettings(): void {
  cotSettings.value = {
    enabled: get('系统.设置.cot.enabled') === true,
    judgeEnabled: get('系统.设置.cot.judgeEnabled') === true,
    injectStep2: get('系统.设置.cot.injectStep2') !== false,
    ringSize: typeof get('系统.设置.cot.reasoningRingSize') === 'number'
      ? (get('系统.设置.cot.reasoningRingSize') as number)
      : 3,
  };
}

function toggleCotSetting(key: 'enabled' | 'judgeEnabled' | 'injectStep2'): void {
  cotSettings.value[key] = !cotSettings.value[key];
  setValue(`系统.设置.cot.${key}`, cotSettings.value[key]);
  if (key === 'enabled') {
    featureToggles.value.cot = cotSettings.value.enabled;
    saveFeatureToggles();
  }
}

function updateCotRingSize(val: string): void {
  const n = Math.min(10, Math.max(1, parseInt(val) || 3));
  cotSettings.value.ringSize = n;
  setValue('系统.设置.cot.reasoningRingSize', n);
}

const presenceEnabled = ref(false);
function loadPresenceEnabled(): void {
  presenceEnabled.value = get('系统.设置.social.presenceEnabled') === true;
}
function togglePresenceEnabled(): void {
  presenceEnabled.value = !presenceEnabled.value;
  setValue('系统.设置.social.presenceEnabled', presenceEnabled.value);
}

const bodyPolishEnabled = ref(false);
function loadBodyPolish(): void {
  bodyPolishEnabled.value = get('系统.设置.bodyPolish') === true;
}
function toggleBodyPolish(): void {
  bodyPolishEnabled.value = !bodyPolishEnabled.value;
  setValue('系统.设置.bodyPolish', bodyPolishEnabled.value);
  featureToggles.value.bodyPolish = bodyPolishEnabled.value;
  saveFeatureToggles();
}

const imageGenEnabled = ref(false);
function loadImageGen(): void {
  imageGenEnabled.value = get('系统.扩展.image.enabled') === true;
}
function toggleImageGen(): void {
  imageGenEnabled.value = !imageGenEnabled.value;
  setValue('系统.扩展.image.enabled', imageGenEnabled.value);
  featureToggles.value.imageGeneration = imageGenEnabled.value;
  saveFeatureToggles();
  eventBus.emit('engine:request-save');
}

// ─── Sprint UI-3: VSCode-style navigation infrastructure ──────

const settingsSearch = ref('');
const settingsContentRef = ref<HTMLElement | null>(null);
const activeNavId = ref('settings-nsfw');

interface NavCategory {
  id: string;
  label: string;
}

const navCategories: NavCategory[] = [
  { id: 'settings-nsfw', label: '内容过滤' },
  { id: 'settings-ai-features', label: 'AI 功能开关' },
  { id: 'settings-ui', label: '界面偏好' },
  { id: 'settings-game', label: '游戏设置' },
  { id: 'settings-action', label: '行动选项' },
  { id: 'settings-heartbeat', label: '世界心跳' },
  { id: 'settings-npc', label: 'NPC 设置' },
  { id: 'settings-plot', label: '剧情导向' },
  { id: 'settings-memory', label: '记忆系统' },
  { id: 'settings-advanced', label: '高级设置' },
  { id: 'settings-scale', label: '界面缩放' },
  { id: 'settings-data', label: '数据管理' },
];

function sectionMatchesSearch(sectionId: string): boolean {
  const q = settingsSearch.value.trim().toLowerCase();
  if (!q) return true;
  const cat = navCategories.find((c) => c.id === sectionId);
  if (cat && cat.label.toLowerCase().includes(q)) return true;
  const container = settingsContentRef.value;
  if (!container) return true;
  const el = container.querySelector(`#${sectionId}`);
  if (!el) return true;
  return el.textContent?.toLowerCase().includes(q) ?? true;
}

const visibleCategoryIds = computed(() => {
  const q = settingsSearch.value.trim().toLowerCase();
  if (!q) return new Set(navCategories.map((c) => c.id));
  return new Set(navCategories.filter((c) => sectionMatchesSearch(c.id)).map((c) => c.id));
});

let scrollSuppressed = false;

function scrollToSection(sectionId: string): void {
  activeNavId.value = sectionId;
  const container = settingsContentRef.value;
  if (!container) return;
  const el = container.querySelector(`#${sectionId}`) as HTMLElement | null;
  if (!el) return;
  scrollSuppressed = true;
  container.scrollTo({
    top: el.offsetTop - container.offsetTop,
    behavior: 'smooth',
  });
  setTimeout(() => { scrollSuppressed = false; }, 600);
}

let scrollSpyObserver: IntersectionObserver | null = null;

function setupScrollSpy(): void {
  const container = settingsContentRef.value;
  if (!container) return;
  scrollSpyObserver?.disconnect();

  const visibleSections = new Set<string>();

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      if (scrollSuppressed) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visibleSections.add(entry.target.id);
        } else {
          visibleSections.delete(entry.target.id);
        }
      }
      for (const cat of navCategories) {
        if (visibleSections.has(cat.id)) {
          activeNavId.value = cat.id;
          break;
        }
      }
    },
    { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );

  for (const cat of navCategories) {
    const el = container.querySelector(`#${cat.id}`);
    if (el) scrollSpyObserver.observe(el);
  }
}

onMounted(() => {
  nextTick(() => setupScrollSpy());
});

onBeforeUnmount(() => {
  scrollSpyObserver?.disconnect();
});
</script>

<template>
  <div class="settings-panel settings-panel--vscode">
    <header class="panel-header">
      <h2 class="panel-title">设置</h2>
      <input
        v-model="settingsSearch"
        type="text"
        class="settings-search"
        placeholder="搜索设置…"
      />
      <button v-if="hasChanges" class="btn-secondary" @click="resetAll">重置全部</button>
    </header>

    <div class="settings-layout">
      <!-- VSCode-style left navigation -->
      <nav class="settings-nav">
        <button
          v-for="cat in navCategories"
          v-show="visibleCategoryIds.has(cat.id)"
          :key="cat.id"
          :class="['settings-nav__item', { 'settings-nav__item--active': activeNavId === cat.id }]"
          @click="scrollToSection(cat.id)"
        >
          {{ cat.label }}
        </button>
      </nav>

      <!-- Scrollable content area -->
      <div ref="settingsContentRef" class="settings-content">

    <!-- ─── NSFW 内容开关 ─── -->
    <section id="settings-nsfw" v-show="visibleCategoryIds.has('settings-nsfw')" class="settings-section">
      <h3 class="section-title">��容过滤</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">成人内容 (NSFW)</span>
          <span class="setting-desc">
            开启后 AI 会生成成人向扩展内容（NPC 私��信息、角色身体等）。
            关闭后相关 prompt 指令不发送给 AI，已有数据保留但不再影响生成。
          </span>
        </div>
        <button
          :class="['toggle-switch', { 'toggle-switch--on': nsfwSettings.nsfwMode }]"
          role="switch"
          :aria-checked="nsfwSettings.nsfwMode"
          aria-label="成人内容开关"
          @click="nsfwSettings.nsfwMode = !nsfwSettings.nsfwMode"
        >
          <span class="toggle-track"><span class="toggle-thumb" /></span>
        </button>
      </div>

      <div class="setting-row" :class="{ 'setting-row--disabled': !nsfwSettings.nsfwMode }">
        <div class="setting-info">
          <span class="setting-label">性别过滤</span>
          <span class="setting-desc">
            只为匹配性别的 NPC 生成扩展字段。玩家法身不受此过滤影响。
          </span>
        </div>
        <select
          v-model="nsfwSettings.nsfwGenderFilter"
          class="setting-select"
          :disabled="!nsfwSettings.nsfwMode"
        >
          <option v-for="opt in nsfwGenderOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </section>

    <!-- ─── AI 功能开关 ─── -->
    <section id="settings-ai-features" v-show="visibleCategoryIds.has('settings-ai-features')" class="settings-section">
      <h3 class="section-title">AI 功能开关</h3>
      <p class="setting-desc" style="margin-bottom: 12px; opacity: 0.7">
        控制各项可选 AI 功能的启用状态。关闭后对应功能不会消耗 API 额度。
        在「API 管理 → 功能分配」中可为每项功能指定不同的 API。
      </p>

      <div class="setting-subsection-header">正文生成</div>

      <div v-if="isLoaded" class="setting-row">
        <div class="setting-info">
          <span class="setting-label">思维链推理（CoT）</span>
          <span class="setting-desc">
            主回合生成前执行独立推理步骤，让 AI 先"想清楚"再写故事。
            提升剧情逻辑一致性和技能判定质量，但会额外消耗一次 API 调用。
          </span>
        </div>
        <AgaToggle :model-value="cotSettings.enabled" @update:model-value="toggleCotSetting('enabled')" />
      </div>

      <template v-if="cotSettings.enabled && isLoaded">
        <div class="setting-row setting-row--indent">
          <div class="setting-info">
            <span class="setting-label">判定推理（Judge）</span>
            <span class="setting-desc">技能检定和博弈时进行独立推理分析</span>
          </div>
          <AgaToggle :model-value="cotSettings.judgeEnabled" @update:model-value="toggleCotSetting('judgeEnabled')" />
        </div>
        <div class="setting-row setting-row--indent">
          <div class="setting-info">
            <span class="setting-label">Step2 注入推理上下文</span>
            <span class="setting-desc">将 Step1 推理结果注入 Step2 的指令生成（分步模式下）</span>
          </div>
          <AgaToggle :model-value="cotSettings.injectStep2" @update:model-value="toggleCotSetting('injectStep2')" />
        </div>
        <div class="setting-row setting-row--indent">
          <div class="setting-info">
            <span class="setting-label">推理历史保留轮数</span>
            <span class="setting-desc">保留最近 N 轮的推理内容用于上下文注入（1-10）</span>
          </div>
          <input
            type="number"
            class="form-input form-input--sm"
            :value="cotSettings.ringSize"
            min="1"
            max="10"
            style="width: 70px"
            @change="updateCotRingSize(($event.target as HTMLInputElement).value)"
          />
        </div>
      </template>

      <div v-if="isLoaded" class="setting-row">
        <div class="setting-info">
          <span class="setting-label">文本润色（Body Polish）</span>
          <span class="setting-desc">
            主回合叙事生成完成后，由独立 AI 对文本进行修辞润色。
            可提升文笔质量，但每回合额外消耗一次 API 调用。
          </span>
        </div>
        <AgaToggle :model-value="bodyPolishEnabled" @update:model-value="toggleBodyPolish" />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">文本优化</span>
          <span class="setting-desc">
            对 AI 生成文本做语法和文笔后处理。与润色类似但更轻量，
            适合分配给较便宜的模型以节省成本。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.text_optimization" @update:model-value="toggleFeature('text_optimization')" />
      </div>

      <div class="setting-subsection-header">世界与记忆</div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">世界心跳</span>
          <span class="setting-desc">
            每隔数回合自动让 AI 更新世界背景状态（天气变化、势力动态、物价波动等），
            模拟一个"活着的世界"。关闭后世界状态固定不变。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.world_heartbeat" @update:model-value="toggleFeature('world_heartbeat')" />
      </div>

      <div class="setting-subsection-header">NPC 与社交</div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">NPC 私聊</span>
          <span class="setting-desc">
            在关系面板中与 NPC 发起独立于主回合的 1:1 对话。
            关闭后关系面板中不显示私聊入口。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.npc_chat" @update:model-value="toggleFeature('npc_chat')" />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">地点 NPC 自动生成</span>
          <span class="setting-desc">
            玩家到达新地点时自动用 AI 生成当地 NPC。
            关闭后只会遇到剧情预设的 NPC。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.location_npc_generation" @update:model-value="toggleFeature('location_npc_generation')" />
      </div>

      <div v-if="isLoaded" class="setting-row">
        <div class="setting-info">
          <span class="setting-label">NPC 在场分区</span>
          <span class="setting-desc">
            AI 区分当前场景中在场和不在场的 NPC，
            为在场角色提供更丰富的上下文描述和互动。
          </span>
        </div>
        <AgaToggle :model-value="presenceEnabled" @update:model-value="togglePresenceEnabled" />
      </div>

      <div class="setting-subsection-header">剧情与指令</div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">剧情大纲 AI 拆解</span>
          <span class="setting-desc">
            创建剧情弧线时，用 AI 将你输入的大纲自动拆解为可追踪的节点链。
            关闭后需要手动创建每个节点。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.plot_decompose" @update:model-value="toggleFeature('plot_decompose')" />
      </div>

      <div class="setting-subsection-header">修复与补齐</div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">字段自动补齐</span>
          <span class="setting-desc">
            AI 回复缺少必填字段（属性、装备等）时自动发起补齐请求，
            减少数据缺失问题。每次补齐消耗一次额外 API 调用。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.field_repair" @update:model-value="toggleFeature('field_repair')" />
      </div>

      <div class="setting-subsection-header">图像相关</div>

      <div v-if="isLoaded" class="setting-row">
        <div class="setting-info">
          <span class="setting-label">图像生成</span>
          <span class="setting-desc">
            开启后可在图像工作台中生成场景和角色插图。
            需要配置图像生成 API（DALL-E / ComfyUI / SD WebUI 等）。
          </span>
        </div>
        <AgaToggle :model-value="imageGenEnabled" @update:model-value="toggleImageGen" />
      </div>

      <template v-if="imageGenEnabled">
        <p class="setting-desc setting-row--indent" style="padding: var(--space-sm) 0">
          图像生成的详细设置已迁移至
          <router-link to="/game?panel=image&tab=settings" class="settings-link">图像工作台 → 设置</router-link>。
        </p>
      </template>

      <div class="setting-subsection-header">工具</div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">AI 助手</span>
          <span class="setting-desc">
            游戏内 AI 聊天助手，可回答关于游戏世界、角色、规则等方面的问题。
            使用独立的 API 调用，不影响主回合叙事。
          </span>
        </div>
        <AgaToggle :model-value="featureToggles.assistant" @update:model-value="toggleFeature('assistant')" />
      </div>
    </section>

    <!-- ─── UI preferences ─── -->
    <section id="settings-ui" v-show="visibleCategoryIds.has('settings-ui')" class="settings-section">
      <h3 class="section-title">界面偏好</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">字体大小</span>
          <span class="setting-desc">调整全局文字大小</span>
        </div>
        <div class="font-size-control">
          <button class="adj-btn" @click="settings.fontSize = Math.max(10, settings.fontSize - 1)">−</button>
          <span class="font-size-value">{{ settings.fontSize }}px</span>
          <button class="adj-btn" @click="settings.fontSize = Math.min(24, settings.fontSize + 1)">+</button>
          <button class="btn-sm" @click="applyFontSize">应用</button>
          <button class="btn-sm btn-sm--muted" @click="settings.fontSize = 14; applyFontSize()">重置</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">主题色</span>
          <span class="setting-desc">自定义界面强调色</span>
        </div>
        <div class="color-control">
          <input
            v-model="settings.themeAccent"
            type="color"
            class="color-picker"
          />
          <span class="color-value">{{ settings.themeAccent }}</span>
          <button class="btn-sm" @click="applyThemeColor">应用</button>
          <button class="btn-sm btn-sm--muted" @click="settings.themeAccent = '#91c49b'; applyThemeColor()">重置</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">显示行动选项</span>
          <span class="setting-desc">AI 回复后展示可选行动</span>
        </div>
        <button
          :class="['toggle-switch', { 'toggle-switch--on': settings.showActionOptions }]"
          @click="settings.showActionOptions = !settings.showActionOptions"
        >
          <span class="toggle-track">
            <span class="toggle-thumb" />
          </span>
        </button>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">启用动画</span>
          <span class="setting-desc">界面过渡和动画效果</span>
        </div>
        <button
          :class="['toggle-switch', { 'toggle-switch--on': settings.enableAnimations }]"
          @click="settings.enableAnimations = !settings.enableAnimations"
        >
          <span class="toggle-track">
            <span class="toggle-thumb" />
          </span>
        </button>
      </div>
    </section>

    <!-- ─── Game settings ─── -->
    <section id="settings-game" v-show="visibleCategoryIds.has('settings-game')" class="settings-section">
      <h3 class="section-title">游戏设置</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">自动保存间隔</span>
          <span class="setting-desc">每隔多少回合自动保存</span>
        </div>
        <div class="number-control">
          <input
            v-model.number="settings.autoSaveInterval"
            type="number"
            min="0"
            max="50"
            class="number-input"
          />
          <span class="number-unit">回合</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">语言</span>
          <span class="setting-desc">界面显示语言</span>
        </div>
        <select v-model="settings.language" class="setting-select">
          <option v-for="opt in languageOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </section>

    <!-- ─── B.2.1 行动选项深度设置 ─── -->
    <section v-if="settings.showActionOptions" v-show="visibleCategoryIds.has('settings-action')" id="settings-action" class="settings-section">
      <h3 class="section-title">行动选项深度</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">行动模式</span>
          <span class="setting-desc">控制 AI 生成行动选项的风格</span>
        </div>
        <div class="radio-group">
          <label class="radio-opt">
            <input type="radio" v-model="actionOptions.mode" value="action" />
            <span>行动导向</span>
          </label>
          <label class="radio-opt">
            <input type="radio" v-model="actionOptions.mode" value="story" />
            <span>剧情导向</span>
          </label>
        </div>
      </div>

      <Transition name="fade-row">
        <div v-if="actionOptions.mode === 'action'" class="setting-row">
          <div class="setting-info">
            <span class="setting-label">行动节奏</span>
            <span class="setting-desc">快速推进 vs. 慢速体验</span>
          </div>
          <div class="radio-group">
            <label class="radio-opt">
              <input type="radio" v-model="actionOptions.pace" value="fast" />
              <span>快速</span>
            </label>
            <label class="radio-opt">
              <input type="radio" v-model="actionOptions.pace" value="slow" />
              <span>慢速</span>
            </label>
          </div>
        </div>
      </Transition>

      <div class="setting-row setting-row--column">
        <div class="setting-info">
          <span class="setting-label">自定义选项 Prompt</span>
          <span class="setting-desc">引导 AI 生成特定风格的行动选项（可留空）</span>
        </div>
        <textarea
          v-model="actionOptions.customPrompt"
          class="setting-textarea"
          placeholder="例如：每个选项应包含潜在风险提示…"
          rows="3"
          maxlength="500"
        />
        <span class="char-count">{{ actionOptions.customPrompt.length }}/500</span>
      </div>
    </section>

    <!-- ─── B.2.2 世界心跳高级设置 ─── -->
    <section v-if="isLoaded" v-show="visibleCategoryIds.has('settings-heartbeat')" id="settings-heartbeat" class="settings-section">
      <h3 class="section-title">世界心跳</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">历史保留条数</span>
          <span class="setting-desc">心跳历史最多保留多少条（5–100）</span>
        </div>
        <div class="number-control">
          <input
            type="number" class="number-input" min="5" max="100"
            :value="heartbeatHistoryLimit"
            @change="setHeartbeatHistoryLimit(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="number-unit">条</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">遗忘回合数</span>
          <span class="setting-desc">超过 N 回合未更新的 NPC 不参与心跳（0 = 不遗忘）</span>
        </div>
        <div class="number-control">
          <input
            type="number" class="number-input" min="0" max="999"
            :value="heartbeatForgetRounds"
            @change="setHeartbeatForgetRounds(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="number-unit">回合</span>
        </div>
      </div>
    </section>

    <!-- ─── B.2.3 NPC 设置 ─── -->
    <section v-if="isLoaded" v-show="visibleCategoryIds.has('settings-npc')" id="settings-npc" class="settings-section">
      <h3 class="section-title">NPC 设置</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">NPC 降级阈值</span>
          <span class="setting-desc">重点 NPC 超过 N 回合未活跃降为普通 NPC</span>
        </div>
        <div class="number-control">
          <input
            type="number" class="number-input" min="1" max="999"
            :value="npcDemotionThreshold"
            @change="setNpcDemotion(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="number-unit">回合</span>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">重点 NPC 生成范围</span>
          <span class="setting-desc">到达新地点时生成的重点 NPC 数量（min ≤ max，范围 0–10）</span>
        </div>
        <div class="range-pair">
          <input
            type="number" class="number-input" min="0" max="10"
            :value="npcRangeMin"
            @change="setNpcRangeMin(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="range-sep">–</span>
          <input
            type="number" class="number-input" min="0" max="10"
            :value="npcRangeMax"
            @change="setNpcRangeMax(Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>
    </section>

    <!-- ─── Plot Direction Settings (Sprint Plot-1 P6) ─── -->
    <section v-if="isLoaded" v-show="visibleCategoryIds.has('settings-plot')" id="settings-plot" class="settings-section">
      <h3 class="section-title">剧情导向</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">启用剧情导向</span>
          <span class="setting-desc">开启后，活跃弧线的 directive 会注入 AI prompt</span>
        </div>
        <button
          :class="['toggle-switch', { 'toggle-switch--on': plotSettings.enabled }]"
          role="switch"
          :aria-checked="plotSettings.enabled"
          @click="plotSettings.enabled = !plotSettings.enabled"
        ><span class="toggle-track"><span class="toggle-thumb" /></span></button>
      </div>

      <template v-if="plotSettings.enabled">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">关键节点确认</span>
            <span class="setting-desc">critical 节点推进前需玩家确认</span>
          </div>
          <button
            :class="['toggle-switch', { 'toggle-switch--on': plotSettings.criticalConfirmGate }]"
            role="switch"
            :aria-checked="plotSettings.criticalConfirmGate"
            @click="plotSettings.criticalConfirmGate = !plotSettings.criticalConfirmGate"
          ><span class="toggle-track"><span class="toggle-thumb" /></span></button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">置信度阈值</span>
            <span class="setting-desc">AI 评估 confidence 需达到此值才算通过 (0-1)</span>
          </div>
          <input
            type="number"
            class="number-input"
            min="0.1" max="1.0" step="0.05"
            :value="plotSettings.confidenceThreshold"
            @change="plotSettings.confidenceThreshold = Math.max(0.1, Math.min(1, Number(($event.target as HTMLInputElement).value)))"
          />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">引导最高层级</span>
            <span class="setting-desc">opportunity 引导最多升级到哪一层 (1-3)</span>
          </div>
          <input
            type="number"
            class="number-input"
            min="1" max="3" step="1"
            :value="plotSettings.opportunityMaxTier"
            @change="plotSettings.opportunityMaxTier = Math.max(1, Math.min(3, Math.round(Number(($event.target as HTMLInputElement).value)))) as 1 | 2 | 3"
          />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">主面板显示度量值</span>
            <span class="setting-desc">在主游戏面板顶部显示 gauge 进度条</span>
          </div>
          <button
            :class="['toggle-switch', { 'toggle-switch--on': plotSettings.showGaugesInMainPanel }]"
            role="switch"
            :aria-checked="plotSettings.showGaugesInMainPanel"
            @click="plotSettings.showGaugesInMainPanel = !plotSettings.showGaugesInMainPanel"
          ><span class="toggle-track"><span class="toggle-thumb" /></span></button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">评估日志</span>
            <span class="setting-desc">在 PlotPanel 底部显示评估日志</span>
          </div>
          <button
            :class="['toggle-switch', { 'toggle-switch--on': plotSettings.showEvalLog }]"
            role="switch"
            :aria-checked="plotSettings.showEvalLog"
            @click="plotSettings.showEvalLog = !plotSettings.showEvalLog"
          ><span class="toggle-track"><span class="toggle-thumb" /></span></button>
        </div>
      </template>
    </section>

    <!-- ─── B.2.4 高级设置 ─── -->
    <section id="settings-advanced" v-show="visibleCategoryIds.has('settings-advanced')" class="settings-section">
      <h3 class="section-title">高级设置</h3>

      <!-- Debug mode -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Debug 模式</span>
          <span class="setting-desc">显示 Prompt 组装面板入口，启用详细日志</span>
        </div>
        <button
          :class="['toggle-switch', { 'toggle-switch--on': debugSettings.debugMode }]"
          @click="debugSettings.debugMode = !debugSettings.debugMode"
        >
          <span class="toggle-track"><span class="toggle-thumb" /></span>
        </button>
      </div>

      <Transition name="fade-row">
        <div v-if="debugSettings.debugMode" class="debug-sub">
          <label class="check-opt">
            <input type="checkbox" v-model="debugSettings.consoleDebug" />
            <span>Console 详细日志</span>
          </label>
          <label class="check-opt">
            <input type="checkbox" v-model="debugSettings.aiLogging" />
            <span>AI API 完整记录（含 prompt/response）</span>
          </label>
        </div>
      </Transition>

      <!-- Text replace rules -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">文本替换规则</span>
          <span class="setting-desc">{{ textReplaceRules.length }} 条规则，在叙事文本渲染前应用</span>
        </div>
        <button class="btn-sm" @click="showReplaceModal = true">编辑规则</button>
      </div>

      <!-- Import / Export settings -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">导入 / 导出设置</span>
          <span class="setting-desc">将当前所有设置项保存为 JSON 文件</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn-sm" @click="exportSettings">导出</button>
          <button class="btn-sm" @click="openImportSettings">导入</button>
        </div>
      </div>

      <!-- Clear cache -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">清除缓存</span>
          <span class="setting-desc">清除 aga_* 临时数据（不含 API 配置）</span>
        </div>
        <button class="btn-sm btn-sm--danger" @click="showClearCacheConfirm = true">清除</button>
      </div>
    </section>

    <!-- ─── 6.1 界面缩放 + 文本速度 ─── -->
    <section id="settings-scale" v-show="visibleCategoryIds.has('settings-scale')" class="settings-section">
      <h3 class="section-title">界面缩放</h3>

      <!-- UI Scale -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">UI 缩放 ({{ uiScale }}%)</span>
          <span class="setting-desc">调整整体界面大小，范围 80–120%</span>
        </div>
        <div class="scale-control">
          <button class="adj-btn" @click="uiScale = Math.max(80, uiScale - 5)">−</button>
          <input
            type="range"
            min="80"
            max="120"
            step="5"
            v-model.number="uiScale"
            class="scale-slider"
            aria-label="UI 缩放"
          />
          <button class="adj-btn" @click="uiScale = Math.min(120, uiScale + 5)">+</button>
          <button class="btn-sm" @click="uiScale = 100">重置</button>
        </div>
      </div>

      <!-- Text speed -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">文本速度</span>
          <span class="setting-desc">流式叙事的回放速度倍率</span>
        </div>
        <div class="radio-group">
          <label
            v-for="opt in textSpeedOptions"
            :key="opt"
            :class="['speed-opt', { 'speed-opt--active': textSpeed === opt }]"
          >
            <input type="radio" :value="opt" v-model="textSpeed" class="sr-only" />
            {{ opt }}
          </label>
        </div>
      </div>
    </section>

    <!-- ─── 6.1 数据管理 ─── -->
    <section id="settings-data" v-show="visibleCategoryIds.has('settings-data')" class="settings-section">
      <h3 class="section-title">数据管理</h3>

      <!-- Export all saves -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">导出所有存档</span>
          <span class="setting-desc">将所有角色档案和存档槽下载为 JSON 文件</span>
        </div>
        <button class="btn-sm" :disabled="isExportingAllSaves" @click="exportAllSaves">
          {{ isExportingAllSaves ? '导出中…' : '导出存档' }}
        </button>
      </div>

      <!-- Import saves -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">导入存档</span>
          <span class="setting-desc">从 JSON 文件恢复之前导出的存档数据</span>
        </div>
        <button class="btn-sm" @click="openImportSaves">选择文件</button>
      </div>

      <!-- Clear all data -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">清除所有数据</span>
          <span class="setting-desc" style="color: var(--color-danger, #ef4444);">不可恢复，将删除所有存档和配置</span>
        </div>
        <button class="btn-sm btn-sm--danger" @click="showClearAllConfirm = true; clearAllStep = 1">
          清除所有数据
        </button>
      </div>
    </section>

    <!-- ─── 记忆系统阈值（2026-04-11 四层记忆） ─── -->
    <section id="settings-memory" v-show="visibleCategoryIds.has('settings-memory')" class="settings-section">
      <h3 class="section-title">记忆系统阈值</h3>
      <p class="section-subtitle" style="color: var(--color-text-muted, #888); font-size: 12px; margin: -4px 0 10px;">
        调整短期/中期/长期记忆的容量与触发点。默认值已针对大多数游戏调优，仅在你对记忆系统有深入理解时修改。
      </p>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">短期记忆容量</span>
          <span class="setting-desc">保留的最近回合数（超出后最旧的一条晋升为中期）。默认 5</span>
        </div>
        <input
          type="number"
          min="1"
          max="20"
          step="1"
          v-model.number="memorySettings.shortTermLimit"
          class="num-input"
          aria-label="短期记忆容量"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">中期精炼阈值</span>
          <span class="setting-desc">中期记忆超过此数时触发「就地精炼」（去重合并）。默认 25</span>
        </div>
        <input
          type="number"
          min="5"
          max="200"
          step="1"
          v-model.number="memorySettings.midTermRefineThreshold"
          class="num-input"
          aria-label="中期精炼阈值"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">长期总结阈值</span>
          <span class="setting-desc">中期记忆超过此数时触发「世界观演化」为长期条目。默认 50</span>
        </div>
        <input
          type="number"
          min="10"
          max="500"
          step="1"
          v-model.number="memorySettings.longTermSummaryThreshold"
          class="num-input"
          aria-label="长期总结阈值"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">总结消耗条数</span>
          <span class="setting-desc">每次世界观演化一次消耗的中期条目数。默认 50（= 阈值）</span>
        </div>
        <input
          type="number"
          min="5"
          max="500"
          step="1"
          v-model.number="memorySettings.longTermSummarizeCount"
          class="num-input"
          aria-label="总结消耗条数"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">演化后保留中期</span>
          <span class="setting-desc">世界观演化后保留多少条最新中期（0 = 全部清空）。默认 0</span>
        </div>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          v-model.number="memorySettings.midTermKeep"
          class="num-input"
          aria-label="演化后保留中期"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">长期记忆容量</span>
          <span class="setting-desc">超过此数时触发「二级精炼」（最旧条目压缩为主题存档）。默认 30</span>
        </div>
        <input
          type="number"
          min="10"
          max="200"
          step="1"
          v-model.number="memorySettings.longTermCap"
          class="num-input"
          aria-label="长期记忆容量"
        />
      </div>

      <!-- 2026-04-14 新增：短期记忆注入方式 + few-shot 对数 -->
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">短期记忆注入方式</span>
          <span class="setting-desc">
            决定主回合 prompt 如何包含最近历史。
            <strong>单块注入</strong>：短期记忆合并成一条 assistant 消息（API 总消息固定 3 条，最省 token）。
            <strong>Few-shot 轮次</strong>：保留最近 N 对 user↔assistant 对话（每回合约 3+2N 条消息，更利于 AI 保持输出格式）。
          </span>
        </div>
        <select
          v-model="memorySettings.shortTermInjectionStyle"
          class="select-input"
          aria-label="短期记忆注入方式"
        >
          <option value="few_shot_pairs">Few-shot 轮次（推荐）</option>
          <option value="single_assistant_block">单块注入（极省 token）</option>
        </select>
      </div>

      <div
        v-if="memorySettings.shortTermInjectionStyle === 'few_shot_pairs'"
        class="setting-row"
      >
        <div class="setting-info">
          <span class="setting-label">Few-shot 对数</span>
          <span class="setting-desc">
            保留最近几对（user, assistant）真实对话作为格式示范。默认 3；
            超过 5 容易显著推高 token 成本。
          </span>
        </div>
        <input
          type="number"
          min="1"
          max="10"
          step="1"
          v-model.number="memorySettings.fewShotPairs"
          class="num-input"
          aria-label="Few-shot 对数"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">恢复默认</span>
          <span class="setting-desc">将以上所有阈值恢复为引擎默认值</span>
        </div>
        <button class="btn-sm" @click="memorySettings = { ...defaultMemorySettings }">恢复默认</button>
      </div>
    </section>

    <!-- ─── Engram 记忆增强 ─── -->
    <EngramSettingsSection />

    <!-- ─── About ─── -->
    <section class="settings-section settings-section--about">
      <h3 class="section-title">关于</h3>
      <div class="about-info">
        <div class="about-row">
          <span class="about-label">版本</span>
          <span class="about-value">0.1.0</span>
        </div>
        <div class="about-row">
          <span class="about-label">引擎</span>
          <span class="about-value">AutoGameAgent</span>
        </div>
      </div>
    </section>

      </div><!-- end settings-content -->
    </div><!-- end settings-layout -->
  </div>

  <!-- Text replace rules modal -->
  <Modal v-model="showReplaceModal" title="文本替换规则" width="600px">
    <div class="rules-header">
      <span class="rules-count">{{ textReplaceRules.length }} 条规则</span>
      <button class="btn-sm" @click="openNewRule">+ 新增规则</button>
    </div>
    <div v-if="textReplaceRules.length" class="rules-list">
      <div v-for="rule in textReplaceRules" :key="rule.id" class="rule-row">
        <button
          :class="['rule-toggle', { 'rule-toggle--on': rule.enabled }]"
          @click="toggleRule(rule.id)"
          :title="rule.enabled ? '已启用' : '已禁用'"
        >{{ rule.enabled ? '●' : '○' }}</button>
        <div class="rule-info">
          <code class="rule-pattern">{{ rule.pattern }}</code>
          <span class="rule-arrow">→</span>
          <span class="rule-replacement">{{ rule.replacement || '(空)' }}</span>
        </div>
        <span :class="['rule-mode', `rule-mode--${rule.mode}`]">{{ rule.mode }}</span>
        <div class="rule-flags">
          <span v-if="rule.ignoreCase" class="rule-flag">i</span>
          <span v-if="rule.global" class="rule-flag">g</span>
        </div>
        <button class="btn-icon-sm" @click="openEditRule(rule)" title="编辑">✏️</button>
        <button class="btn-icon-sm btn-icon-sm--danger" @click="deleteRule(rule.id)" title="删除">🗑️</button>
      </div>
    </div>
    <p v-else class="rules-empty">暂无规则。点击「新增规则」添加。</p>
  </Modal>

  <!-- Rule editor modal -->
  <Modal v-model="showRuleEditor" :title="editingRule ? '编辑规则' : '新增规则'" width="480px">
    <div class="form-field">
      <label class="form-label">匹配模式 <span class="req">*</span></label>
      <input v-model="ruleForm.pattern" class="form-input" placeholder="输入文本或正则表达式" maxlength="500" />
    </div>
    <div class="form-field">
      <label class="form-label">替换内容</label>
      <input v-model="ruleForm.replacement" class="form-input" placeholder="替换为（留空则删除匹配内容）" maxlength="1500" />
    </div>
    <div class="form-row">
      <label class="form-label">匹配模式</label>
      <div class="radio-group">
        <label class="radio-opt"><input type="radio" v-model="ruleForm.mode" value="text" /> 文本</label>
        <label class="radio-opt"><input type="radio" v-model="ruleForm.mode" value="regex" /> 正则</label>
      </div>
    </div>
    <div class="form-checks">
      <label class="check-opt"><input type="checkbox" v-model="ruleForm.ignoreCase" /> 忽略大小写</label>
      <label class="check-opt"><input type="checkbox" v-model="ruleForm.global" /> 全局替换</label>
    </div>
    <p v-if="ruleFormError" class="form-error">{{ ruleFormError }}</p>
    <template #footer>
      <button class="btn-modal btn-modal--secondary" @click="showRuleEditor = false">取消</button>
      <button class="btn-modal btn-modal--primary" @click="submitRuleForm">{{ editingRule ? '保存' : '添加' }}</button>
    </template>
  </Modal>

  <!-- Clear cache confirm -->
  <Modal v-model="showClearCacheConfirm" title="确认清除缓存" width="360px">
    <p class="confirm-text">将清除所有 aga_* 前缀的临时缓存数据（不包含 API 配置和备份数据）。</p>
    <template #footer>
      <button class="btn-modal btn-modal--secondary" @click="showClearCacheConfirm = false">取消</button>
      <button class="btn-modal btn-modal--danger" @click="clearCache">确认清除</button>
    </template>
  </Modal>

  <!-- Clear ALL data confirm (2-step) -->
  <Modal v-model="showClearAllConfirm" title="⚠️ 清除所有数据" width="400px">
    <template v-if="clearAllStep === 1">
      <p class="confirm-text danger-text">此操作将永久删除：</p>
      <ul class="danger-list">
        <li>所有角色档案和存档</li>
        <li>所有 localStorage 配置</li>
        <li>Engram 向量索引</li>
      </ul>
      <p class="confirm-text">此操作<strong>不可撤销</strong>。确定要继续吗？</p>
    </template>
    <template v-else>
      <p class="confirm-text danger-text">最后确认：</p>
      <p class="confirm-text">请再次点击「确认清除所有数据」以执行。</p>
    </template>
    <template #footer>
      <button class="btn-modal btn-modal--secondary" @click="showClearAllConfirm = false">取消</button>
      <button v-if="clearAllStep === 1" class="btn-modal btn-modal--danger" @click="clearAllStep = 2">
        继续
      </button>
      <button v-else class="btn-modal btn-modal--danger" @click="clearAllData">
        确认清除所有数据
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  position: absolute;
  inset: 0;
  overflow: hidden;
  padding-left: var(--sidebar-left-reserve, 40px);
  padding-right: var(--sidebar-right-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}

.settings-panel--vscode .panel-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.settings-search {
  flex: 1;
  max-width: 300px;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-family: var(--font-sans);
}
.settings-search:focus { outline: none; border-color: var(--color-primary); }
.settings-search::placeholder { color: var(--color-text-muted); }

.settings-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.settings-nav {
  width: clamp(200px, 18%, 260px);
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  padding: var(--space-md) var(--space-sm);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav__item {
  display: block;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 6px;
  text-align: left;
  color: var(--color-text-secondary);
  font-size: 0.88rem;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}
.settings-nav__item:hover {
  color: var(--color-text);
  background: var(--color-primary-muted);
}
.settings-nav__item--active {
  color: var(--color-primary);
  border-left-color: var(--color-primary);
  background: var(--color-primary-muted);
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-lg);
  padding-bottom: 40vh;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.setting-subsection-header {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-border-subtle);
  margin-top: var(--space-xs);
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
}

/* ── Sections ── */
/*
 * 2026-04-11 defensive fix: `flex-shrink: 0` 防止 flex 压缩陷阱。
 *
 * `.settings-panel` 是 `display: flex; flex-direction: column`，子项默认
 * `flex-shrink: 1`。若任何 section 有 `overflow: hidden/scroll/auto`，其
 * 隐式 `min-height` 会从 `auto` 变成 `0`，在内容超出容器时被压成 0 高度
 * （EngramSettingsSection 的 `.engram-section` 曾因此"消失"于游戏内 —
 *  见 2026-04-11 changelog）。当前 `.settings-section` 本身没有 overflow，
 *  不受影响，但加 `flex-shrink: 0` 作为防御 —— 未来任何 section 加了
 *  overflow 都不会再踩坑。
 */
.settings-section {
  flex-shrink: 0;
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
}

.section-title {
  margin: 0 0 14px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Setting rows ── */
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  gap: 16px;
}
.setting-row + .setting-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.setting-row--indent {
  padding-left: 20px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--color-text, #e0e0e6);
}

.setting-desc {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
}

.setting-select {
  padding: 6px 10px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  max-width: 200px;
}

/* ── Toggle switch ── */
.toggle-switch {
  display: flex;
  align-items: center;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
}

.toggle-track {
  position: relative;
  width: 40px;
  height: 22px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 11px;
  transition: background 0.2s ease;
}

.toggle-switch--on .toggle-track {
  background: var(--color-primary, #91c49b);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: var(--color-text-bone);
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.toggle-switch--on .toggle-thumb {
  transform: translateX(18px);
}

/* ── Font size control ── */
.font-size-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.adj-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.adj-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-primary, #91c49b);
}

.font-size-value {
  font-size: 0.88rem;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  min-width: 36px;
  text-align: center;
}

/* ── Color picker ── */
.color-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-picker {
  width: 32px;
  height: 32px;
  border: 2px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  background: none;
}
.color-picker::-webkit-color-swatch-wrapper {
  padding: 2px;
}
.color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.color-value {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Number control ── */
.number-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.number-input {
  width: 60px;
  height: 30px;
  padding: 0 8px;
  font-size: 0.85rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  outline: none;
  text-align: center;
}
.number-input:focus { border-color: var(--color-primary, #91c49b); }

.number-unit {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Buttons ── */
.btn-sm {
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-primary, #91c49b);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, transparent);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover { background: var(--color-primary, #91c49b); color: var(--color-text-bone); }
.btn-sm--muted {
  color: var(--color-text-muted);
  background: transparent;
  border-color: var(--color-border);
}
.btn-sm--muted:hover { background: color-mix(in oklch, var(--color-text-muted) 12%, transparent); color: var(--color-text-secondary); }

.num-input {
  width: 72px;
  padding: 5px 8px;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text, #e8e8f0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  text-align: right;
  transition: border-color 0.15s ease;
}
.num-input:focus {
  outline: none;
  border-color: var(--color-primary, #91c49b);
}

/* 2026-04-14：短期记忆注入模式下拉 */
.select-input {
  min-width: 180px;
  padding: 5px 8px;
  font-size: 0.82rem;
  color: var(--color-text, #e8e8f0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  transition: border-color 0.15s ease;
  cursor: pointer;
}
.select-input:focus {
  outline: none;
  border-color: var(--color-primary, #91c49b);
}

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
.btn-secondary:hover { color: var(--color-text, #e0e0e6); border-color: var(--color-primary, #91c49b); }

/* ── About ── */
.about-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.about-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.82rem;
}

.about-label {
  color: var(--color-text-secondary, #8888a0);
}

.about-value {
  color: var(--color-text, #e0e0e6);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* ── Slim themed scrollbar for every scrollable region inside settings ── */
.settings-panel ::-webkit-scrollbar { width: 6px; height: 6px; }
.settings-panel ::-webkit-scrollbar-track { background: transparent; }
.settings-panel ::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--color-text-umber) 35%, transparent);
  border-radius: 3px;
}
.settings-panel ::-webkit-scrollbar-thumb:hover { background: color-mix(in oklch, var(--color-text-umber) 55%, transparent); }
.settings-panel { scrollbar-width: thin; scrollbar-color: color-mix(in oklch, var(--color-text-umber) 35%, transparent) transparent; }
.settings-panel * { scrollbar-width: thin; scrollbar-color: color-mix(in oklch, var(--color-text-umber) 35%, transparent) transparent; }

/* ── B.2 additions ── */

.setting-row--column {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.setting-textarea {
  width: 100%;
  padding: 8px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 7px;
  color: var(--color-text, #e0e0e6);
  font-size: 0.82rem;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}
.setting-textarea:focus { outline: none; border-color: var(--color-primary, #91c49b); }

.char-count {
  font-size: 0.68rem;
  color: var(--color-text-secondary, #8888a0);
  align-self: flex-end;
}

.radio-group {
  display: flex;
  gap: 14px;
}

.radio-opt {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  cursor: pointer;
  user-select: none;
}
.radio-opt input { accent-color: var(--color-primary, #91c49b); }

.check-opt {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  cursor: pointer;
  user-select: none;
}
.check-opt input { accent-color: var(--color-primary, #91c49b); }

.debug-sub {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255,255,255,0.02);
  border-radius: 7px;
  margin: -4px 0 4px;
}

.range-pair {
  display: flex;
  align-items: center;
  gap: 6px;
}

.range-sep {
  font-size: 0.88rem;
  color: var(--color-text-secondary, #8888a0);
}

/* Btn-sm danger variant */
.btn-sm--danger {
  color: var(--color-danger, #ef4444) !important;
  background: color-mix(in oklch, var(--color-danger) 8%, transparent) !important;
  border-color: color-mix(in oklch, var(--color-danger) 25%, transparent) !important;
}
.btn-sm--danger:hover { background: var(--color-danger, #ef4444) !important; color: var(--color-text-bone) !important; }

/* ── Text replace modal ── */
.rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.rules-count {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #8888a0);
}
.rules-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 7px;
}
.rule-toggle {
  background: none;
  border: none;
  font-size: 0.9rem;
  cursor: pointer;
  color: var(--color-text-secondary, #8888a0);
  flex-shrink: 0;
}
.rule-toggle--on { color: var(--color-success, #22c55e); }
.rule-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.rule-pattern {
  font-size: 0.78rem;
  font-family: 'JetBrains Mono','Fira Code',monospace;
  color: var(--color-text, #e0e0e6);
  background: rgba(255,255,255,0.05);
  padding: 1px 5px;
  border-radius: 4px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rule-arrow { font-size: 0.75rem; color: var(--color-text-secondary, #8888a0); flex-shrink: 0; }
.rule-replacement {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
.rule-mode {
  font-size: 0.64rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.rule-mode--text  { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); }
.rule-mode--regex { background: rgba(251,146,60,0.12); color: #fb923c; }
.rule-flags { display: flex; gap: 3px; flex-shrink: 0; }
.rule-flag {
  font-size: 0.6rem;
  font-family: monospace;
  padding: 1px 4px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  color: var(--color-text-secondary, #8888a0);
}
.rules-empty {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
  text-align: center;
  padding: 12px 0;
  margin: 0;
}
.btn-icon-sm {
  background: none;
  border: none;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
  flex-shrink: 0;
}
.btn-icon-sm:hover { background: rgba(255,255,255,0.08); }
.btn-icon-sm--danger:hover { background: color-mix(in oklch, var(--color-danger) 15%, transparent); }

/* ── Rule editor form ── */
.form-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.form-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.form-label { font-size: 0.78rem; font-weight: 600; color: var(--color-text-secondary, #8888a0); }
.req { color: var(--color-danger, #ef4444); }
.form-input {
  padding: 7px 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 7px;
  color: var(--color-text, #e0e0e6);
  font-size: 0.84rem;
  font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--color-primary, #91c49b); }
.form-checks { display: flex; gap: 16px; margin-bottom: 8px; }
.form-error { font-size: 0.78rem; color: var(--color-danger, #ef4444); margin: 0 0 6px; }
.confirm-text { font-size: 0.88rem; color: var(--color-text, #e0e0e6); line-height: 1.5; margin: 0; }

/* ── Modal buttons ── */
.btn-modal {
  padding: 7px 16px;
  border: none;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-modal--primary  { background: var(--color-primary, #91c49b); color: var(--color-text-bone); }
.btn-modal--primary:hover { opacity: 0.88; }
.btn-modal--secondary { background: rgba(255,255,255,0.07); color: var(--color-text, #e0e0e6); }
.btn-modal--secondary:hover { background: rgba(255,255,255,0.12); }
.btn-modal--danger   { background: var(--color-danger, #ef4444); color: var(--color-text-bone); }
.btn-modal--danger:hover { opacity: 0.88; }

/* ── Transitions ── */
.fade-row-enter-active { transition: all 0.15s ease; }
.fade-row-leave-active { transition: all 0.1s ease; }
.fade-row-enter-from, .fade-row-leave-to { opacity: 0; max-height: 0; }
.fade-row-enter-to, .fade-row-leave-from { opacity: 1; max-height: 200px; }

/* ── UI scale control ── */
.scale-control {
  display: flex;
  align-items: center;
  gap: 6px;
}
.scale-slider {
  width: 110px;
  accent-color: var(--color-primary, #91c49b);
}

/* ── Text speed radio buttons ── */
.speed-opt {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255,255,255,0.02);
  transition: all 0.15s ease;
}
.speed-opt:first-child { border-radius: 6px 0 0 6px; }
.speed-opt:last-child { border-radius: 0 6px 6px 0; }
.speed-opt + .speed-opt { border-left: none; }
.speed-opt--active {
  color: var(--color-primary, #91c49b);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

/* ── sr-only ── */
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}

/* ── Danger styles for data management modal ── */
.danger-text { color: var(--color-danger, #ef4444); font-weight: 600; }
.danger-list {
  margin: 8px 0 12px 0;
  padding-left: 20px;
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
  line-height: 1.8;
}
</style>
