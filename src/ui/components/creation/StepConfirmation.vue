<script setup lang="ts">
/**
 * StepConfirmation — 创角步骤：最终确认。
 *
 * 接收父组件传入的所有先前步骤选择（通过 selection prop），
 * 以摘要卡片形式展示角色预览信息（名称、特征、属性等），
 * 并提供 "开始游戏" 按钮。
 */
import { computed, ref } from 'vue';
import type { CreationStep } from '@/engine/types';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

/** 单条摘要 — 步骤 ID + 显示标签 + 选择内容 */
interface SummaryItem {
  stepId: string;
  label: string;
  display: string;
}

const props = defineProps<{
  step: CreationStep;
  presets: unknown[];
  /**
   * 所有步骤的选择结果汇总 — 父组件传入
   * 结构: Record<stepId, { label, value }>
   */
  selection: unknown;
  budget: number;
}>();

const emit = defineEmits<{
  select: [value: unknown];
}>();

/** 将 selection 解析为 SummaryItem[] */
const summaryItems = computed<SummaryItem[]>(() => {
  if (typeof props.selection !== 'object' || props.selection === null) return [];

  const entries = Object.entries(props.selection as Record<string, unknown>);
  return entries.map(([stepId, raw]) => {
    const item = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const label = typeof item.label === 'string' ? item.label : stepId;
    const value = item.value ?? raw;
    return {
      stepId,
      label,
      display: formatValue(value),
    };
  });
});

/**
 * 将任意选择值格式化为显示文本。
 * 对象取 name/label，数组逗号拼接，其余直接 String()。
 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (Array.isArray(val)) {
    return val.map((v) => formatValue(v)).join('、') || '—';
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
    const keys = Object.keys(obj);
    if (keys.length === 0) return '—';
    return keys
      .map((k) => `${k}: ${formatValue(obj[k])}`)
      .join('、');
  }
  return String(val);
}

/** 从单步 value（表单键、预设条目等）解析显示用姓名 */
function extractCharacterNameFromValue(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return null;
  const o = val as Record<string, unknown>;
  const keys = [
    DEFAULT_ENGINE_PATHS.playerName,
    '名字',
    'name',
    '角色名',
    'characterName',
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
  return null;
}

/**
 * 提取角色名称 — 兼容：
 * - 父组件传入的汇总：`{ stepId: { label, value } }`
 * - 预设单选：`value` 为带 `name`/`label` 的对象
 * - 表单：`value` 为含 `角色.基础信息.姓名` 等键的平铺对象
 */
const characterName = computed<string>(() => {
  if (typeof props.selection !== 'object' || props.selection === null) return '未命名角色';
  const sel = props.selection as Record<string, unknown>;
  for (const entry of Object.values(sel)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const raw = obj.value !== undefined ? obj.value : obj;
    const name = extractCharacterNameFromValue(raw);
    if (name) return name;
  }
  return '未命名角色';
});

// ─── 开局选项 ────────────────────────────────────────────────

/** 是否开启流式叙事（逐字输出 vs 一次性显示） */
const streamingEnabled = ref(true);

/** 生成模式：分步（step）或一次性（single） */
const generationMode = ref<'step' | 'single'>('single');

/**
 * §4.1c: toggle 改变时立即 emit，让 CreationView 持续同步 generationMode
 *
 * 之前这个 toggle 只在用户点内部"开始游戏"按钮时才 emit，但用户也可能点
 * CreationView 底栏的"开始游戏"按钮（那个直接调 onFinalize），该路径不会
 * 触发任何 emit → toggle 状态从未同步 → 分步开局永远是 'single'。
 *
 * 解决方案：每次 toggle 变化都主动 emit，CreationView 的 onStepSelect
 * confirmation 分支会持续捕获最新值到 `splitGenOpening` ref。
 */
function emitCurrentOptions(): void {
  emit('select', {
    __confirm: false, // 非最终确认，仅同步当前 toggle
    options: {
      streaming: streamingEnabled.value,
      generationMode: generationMode.value,
    },
  });
}

function toggleStreaming(): void {
  streamingEnabled.value = !streamingEnabled.value;
  emitCurrentOptions();
}

function toggleGenerationMode(): void {
  generationMode.value = generationMode.value === 'step' ? 'single' : 'step';
  emitCurrentOptions();
}

// 2026-04-11：移除了内部 "开始游戏" 按钮 —— 原本这里有一个冗余的 `startGame()`
// 触发 `__confirm: true` emit，但 CreationView 底栏已经有唯一的 "开始游戏" 按钮
// 直接调用 onFinalize()，两个入口视觉上重复而且容易让玩家困惑。
// 现在 StepConfirmation 只负责展示摘要 + 选项 toggle，"开始游戏" 由底栏统一处理。
// CreationView.onStepSelect 的 `__confirm: true` 分支保留（死分支），不会被触发
// 但也不会出错。
</script>

<template>
  <div class="step-confirmation">
    <h3 class="step-title">{{ step.label }}</h3>

    <!-- 角色预览卡 -->
    <div class="character-preview">
      <div class="avatar-placeholder">{{ characterName.charAt(0) }}</div>
      <h4 class="character-name">{{ characterName }}</h4>
    </div>

    <!-- 摘要列表 -->
    <div class="summary-list">
      <div v-for="item in summaryItems" :key="item.stepId" class="summary-row">
        <span class="summary-label">{{ item.label }}</span>
        <span class="summary-value">{{ item.display }}</span>
      </div>

      <div v-if="summaryItems.length === 0" class="summary-empty">
        尚无选择数据
      </div>
    </div>

    <!-- 开局选项 -->
    <div class="options-section">
      <h4 class="options-title">开局选项</h4>

      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">流式叙事</span>
          <span class="toggle-desc">AI 叙事逐字出现，提供打字机效果</span>
        </div>
        <button
          class="toggle-switch"
          :class="{ active: streamingEnabled }"
          role="switch"
          :aria-checked="streamingEnabled"
          aria-label="流式叙事开关"
          @click="toggleStreaming"
        >
          <span class="toggle-thumb" />
        </button>
      </div>

      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">分步生成开局</span>
          <span class="toggle-desc">分两次 API 调用：先产出开场正文，再生成初始指令。减少单次生成的复杂度，提高稳定性，但耗时加倍。</span>
        </div>
        <button
          class="toggle-switch"
          :class="{ active: generationMode === 'step' }"
          role="switch"
          :aria-checked="generationMode === 'step'"
          aria-label="分步生成开关"
          @click="toggleGenerationMode"
        >
          <span class="toggle-thumb" />
        </button>
      </div>
    </div>

    <!--
      2026-04-11 fix：移除了 StepConfirmation 内部的冗余 "开始游戏" 按钮。
      底栏（CreationView.footer）已经有一个 "开始游戏" 按钮直接调用 onFinalize()，
      两处重复按钮视觉上误导玩家。现在只保留底栏那个。
    -->
  </div>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - avatar-placeholder `#fff` on sage fill → sage tinted surface + sage-100
     font + sage border (matches ManagementView avatar language)
   - toggle-thumb `background: white` → `--color-text-bone` warm bone
   - toggle-switch active: raw primary → sage mix + halo (matches AgaToggle)
   - character-name / labels: serif + sanctuary letter-spacing
   - Cards migrated from raw bg to surface-elevated */

.step-confirmation {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  max-width: 560px;
  margin: 0 auto;
}

.step-title {
  font-family: var(--font-serif-cjk);
  font-size: 1.2rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-text);
  align-self: flex-start;
}

.character-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
  padding: 1.625rem 2rem;
  background: color-mix(in oklch, var(--color-surface) 75%, transparent);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xl);
  width: 100%;
  box-shadow: inset 0 1px 0 color-mix(in oklch, var(--color-text) 4%, transparent);
}

.avatar-placeholder {
  width: 68px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--color-sage-400) 14%, var(--color-surface-elevated));
  color: var(--color-sage-100);
  font-family: var(--font-serif-cjk);
  font-size: 1.7rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
  border-radius: 50%;
}

.character-name {
  font-family: var(--font-serif-cjk);
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--color-text);
}

.summary-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.625rem 0.875rem;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  gap: 1rem;
}

.summary-label {
  font-family: var(--font-sans);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  flex-shrink: 0;
}

.summary-value {
  font-family: var(--font-serif-cjk);
  font-size: 0.86rem;
  letter-spacing: 0.02em;
  color: var(--color-text);
  text-align: right;
  word-break: break-word;
}

.summary-empty {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-muted);
  font-family: var(--font-serif-cjk);
  font-style: italic;
  font-size: 0.86rem;
}

/* ── Options section ── */

.options-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.options-title {
  font-family: var(--font-serif-cjk);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-umber);
  letter-spacing: 0.12em;
  margin-bottom: 0.25rem;
  padding-left: 4px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0.875rem;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  gap: 1rem;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.toggle-row:hover {
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.toggle-label {
  font-family: var(--font-serif-cjk);
  font-size: 0.88rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--color-text);
}

.toggle-desc {
  font-family: var(--font-serif-cjk);
  font-size: 0.74rem;
  color: var(--color-text-umber);
  font-style: italic;
  line-height: 1.6;
  letter-spacing: 0.01em;
}

.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  background: var(--color-border);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.toggle-switch.active {
  background: color-mix(in oklch, var(--color-sage-400) 70%, var(--color-border));
  box-shadow: 0 0 10px color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: var(--color-text-bone);
  border-radius: 50%;
  transition: transform var(--duration-normal) var(--ease-out);
}

.toggle-switch.active .toggle-thumb {
  transform: translateX(18px);
}
</style>
