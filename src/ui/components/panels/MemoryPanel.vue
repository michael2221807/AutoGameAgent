<script setup lang="ts">
/**
 * MemoryPanel — displays short-term, mid-term, long-term, and sent memory lists.
 *
 * B.5 新增：
 * - 已发送 Tab（读取 `元数据.已发送记忆ID`，对短期+中期条目标注发送状态）
 * - 配置区（读取 `系统.记忆配置.*`，只读展示）
 * - 叙事小说导出（将短期+中期记忆合并为 .txt 文件）
 */
import { ref, computed } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { useConfig } from '@/ui/composables/useConfig';
import { eventBus } from '@/engine/core/event-bus';

const { isLoaded, useValue, get } = useGameState();
const { getConfig } = useConfig();

/**
 * Memory path configuration — customizable per game pack.
 * Falls back to sensible defaults if the pack doesn't define memory paths.
 */
interface MemoryPathConfig {
  shortTerm: string;
  midTerm: string;
  longTerm: string;
}

const defaultMemoryPaths: MemoryPathConfig = {
  shortTerm: '记忆.短期',
  midTerm: '记忆.中期',
  longTerm: '记忆.长期',
};

const memoryConfig = computed<MemoryPathConfig>(() => {
  const cfg = getConfig<Partial<MemoryPathConfig>>('memory');
  return { ...defaultMemoryPaths, ...cfg };
});

/** Individual memory entry — varies by game pack; normalized to display format */
interface MemoryEntry {
  id: string;
  content: string;
  timestamp?: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Normalize raw memory data into a displayable list.
 * Handles arrays of strings, arrays of objects, or single objects.
 */
function normalizeMemoryEntries(raw: unknown): MemoryEntry[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((entry, idx) => {
      if (typeof entry === 'string') {
        return { id: `mem_${idx}`, content: entry };
      }
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        return {
          id: String(obj['id'] ?? `mem_${idx}`),
          content: String(obj['内容'] ?? obj['content'] ?? obj['记忆主体'] ?? JSON.stringify(obj)),
          timestamp: (() => {
            const ts = obj['时间'] ?? obj['事件时间'];
            return typeof ts === 'string' ? ts : undefined;
          })(),
          tags: Array.isArray(obj['标签']) ? obj['标签'] as string[] : undefined,
        };
      }
      return { id: `mem_${idx}`, content: String(entry) };
    });
  }

  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([key, val]) => ({
      id: key,
      content: typeof val === 'string' ? val : JSON.stringify(val),
    }));
  }

  return [{ id: 'single', content: String(raw) }];
}

// ─── Reactive memory lists ───

const shortTermRaw = useValue<unknown>(memoryConfig.value.shortTerm);
const implicitMidTermRaw = useValue<unknown>('记忆.隐式中期');
const midTermRaw = useValue<unknown>(memoryConfig.value.midTerm);
const longTermRaw = useValue<unknown>(memoryConfig.value.longTerm);

const shortTermEntries = computed(() => normalizeMemoryEntries(shortTermRaw.value));
const implicitMidTermEntries = computed(() => normalizeMemoryEntries(implicitMidTermRaw.value));
const midTermEntries = computed(() => normalizeMemoryEntries(midTermRaw.value));
const longTermEntries = computed(() => normalizeMemoryEntries(longTermRaw.value));

// ─── 叙事历史（替代旧版"已发送"tab）───
// 引擎没有 "已发送记忆ID" 概念，改为展示 narrativeHistory（全部 user+assistant 消息对）。
// 这也是小说导出的数据源。

interface NarrativeMsg { role: string; content: string; _delta?: unknown }
const narrativeHistoryRaw = useValue<unknown>('元数据.叙事历史');
const narrativeEntries = computed<NarrativeMsg[]>(() => {
  const raw = narrativeHistoryRaw.value;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is NarrativeMsg => m && typeof m === 'object' && typeof (m as NarrativeMsg).content === 'string');
});

// ─── Active tab ───

type TabKey = 'memory' | 'narrative' | 'config';
const activeTab = ref<TabKey>('memory');

// ─── Collapsible sections (memory tab) ───

interface SectionConfig {
  key: string;
  title: string;
  entries: typeof shortTermEntries;
  color: string;
}

const sections = computed<SectionConfig[]>(() => [
  { key: 'short', title: '短期记忆', entries: shortTermEntries, color: 'var(--color-success, #22c55e)' },
  { key: 'implicit', title: '隐式中期', entries: implicitMidTermEntries, color: 'var(--color-info, #38bdf8)' },
  { key: 'mid', title: '中期记忆', entries: midTermEntries, color: 'var(--color-warning, #f59e0b)' },
  { key: 'long', title: '长期记忆', entries: longTermEntries, color: 'var(--color-primary, #6366f1)' },
]);

const collapsedSections = ref<Set<string>>(new Set());

function toggleSection(key: string): void {
  if (collapsedSections.value.has(key)) {
    collapsedSections.value.delete(key);
  } else {
    collapsedSections.value.add(key);
  }
}

function isSectionOpen(key: string): boolean {
  return !collapsedSections.value.has(key);
}

// ─── Expanded entry ───

const expandedEntryId = ref<string | null>(null);

function toggleEntry(id: string): void {
  expandedEntryId.value = expandedEntryId.value === id ? null : id;
}

// ─── Memory config display ───

const memorySystemConfig = computed<Record<string, string>>(() => {
  const raw = get<unknown>('系统.记忆配置');
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }
  return {};
});

const configEntries = computed(() =>
  Object.entries(memorySystemConfig.value).map(([key, value]) => ({ key, value }))
);

// ─── Tab badge counts ───

const totalNarrativeCount = computed(() => narrativeEntries.value.length);

// ─── Export 叙事小说 ───

function exportNarrative(): void {
  const entries = narrativeEntries.value;
  if (entries.length === 0) {
    eventBus.emit('ui:toast', { type: 'info', message: '叙事历史为空', duration: 1500 });
    return;
  }
  const lines: string[] = ['# 叙事导出', ''];
  for (const msg of entries) {
    lines.push(msg.role === 'user' ? `【玩家】${msg.content}` : msg.content);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `narrative-export-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="memory-panel">
    <template v-if="isLoaded">
      <header class="panel-header">
        <h2 class="panel-title">记忆系统</h2>
        <button class="btn-export" @click="exportNarrative" title="导出叙事小说（短期+中期）">
          导出叙事
        </button>
      </header>

      <!-- ─── Tabs ─── -->
      <div class="tab-bar">
        <button
          :class="['tab-btn', { 'tab-btn--active': activeTab === 'memory' }]"
          @click="activeTab = 'memory'"
        >
          记忆列表
        </button>
        <button
          :class="['tab-btn', { 'tab-btn--active': activeTab === 'narrative' }]"
          @click="activeTab = 'narrative'"
        >
          叙事历史
          <span v-if="totalNarrativeCount > 0" class="tab-badge">{{ totalNarrativeCount }}</span>
        </button>
        <button
          :class="['tab-btn', { 'tab-btn--active': activeTab === 'config' }]"
          @click="activeTab = 'config'"
        >
          配置
        </button>
      </div>

      <!-- ─── Memory tab ─── -->
      <div v-if="activeTab === 'memory'" class="sections">
        <section
          v-for="section in sections"
          :key="section.key"
          class="memory-section"
        >
          <!-- Section header (collapsible) -->
          <button
            class="section-header"
            @click="toggleSection(section.key)"
          >
            <div class="section-title-area">
              <span class="section-indicator" :style="{ background: section.color }" />
              <span class="section-title">{{ section.title }}</span>
              <span class="section-badge" :style="{ background: section.color }">
                {{ section.entries.value.length }}
              </span>
            </div>
            <svg
              :class="['chevron', { 'chevron--open': isSectionOpen(section.key) }]"
              viewBox="0 0 20 20"
              fill="currentColor"
              width="14"
              height="14"
            >
              <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>

          <!-- Section content -->
          <Transition name="section-expand">
            <div v-if="isSectionOpen(section.key)" class="section-content">
              <template v-if="section.entries.value.length">
                <div
                  v-for="entry in section.entries.value"
                  :key="entry.id"
                  :class="['memory-entry', { 'memory-entry--expanded': expandedEntryId === entry.id }]"
                  @click="toggleEntry(entry.id)"
                >
                  <div class="entry-header-row">
                    <div class="entry-content">
                      {{ entry.content }}
                    </div>
                  </div>
                  <div v-if="expandedEntryId === entry.id" class="entry-details">
                    <span v-if="entry.timestamp" class="entry-time">{{ entry.timestamp }}</span>
                    <div v-if="entry.tags?.length" class="entry-tags">
                      <span v-for="tag in entry.tags" :key="tag" class="entry-tag">{{ tag }}</span>
                    </div>
                  </div>
                </div>
              </template>
              <p v-else class="empty-hint">暂无记忆数据</p>
            </div>
          </Transition>
        </section>
      </div>

      <!-- ─── 叙事历史 tab ─── -->
      <div v-else-if="activeTab === 'narrative'" class="sections">
        <div v-if="narrativeEntries.length" class="section-content section-content--flat narrative-list">
          <div
            v-for="(msg, idx) in narrativeEntries"
            :key="idx"
            :class="['narrative-entry', `narrative-entry--${msg.role}`]"
          >
            <span class="narrative-role">{{ msg.role === 'user' ? '玩家' : '叙事' }}</span>
            <div class="narrative-text">{{ msg.content }}</div>
          </div>
        </div>
        <div v-else class="empty-state-tab">
          <p class="empty-hint">暂无叙事历史</p>
          <p class="empty-hint" style="opacity: 0.4;">每回合 AI 叙事和玩家输入会追加到此处</p>
        </div>
      </div>

      <!-- ─── Config tab ─── -->
      <div v-else-if="activeTab === 'config'" class="config-section">
        <p class="config-note">以下为 <code>系统.记忆配置</code> 的当前值（只读）</p>
        <div v-if="configEntries.length" class="config-list">
          <div v-for="cfg in configEntries" :key="cfg.key" class="config-row">
            <span class="config-key">{{ cfg.key }}</span>
            <span class="config-value">{{ cfg.value }}</span>
          </div>
        </div>
        <p v-else class="empty-hint">暂无记忆配置数据</p>
      </div>
    </template>

    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>
  </div>
</template>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  height: 100%;
  overflow-y: auto;
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
}

.btn-export {
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-export:hover {
  color: var(--color-text-bone);
  border-color: var(--color-sage-600);
}

/* ── Tabs ── */
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border, #2a2a3a);
  padding-bottom: 4px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-text-secondary, #8888a0);
  background: transparent;
  border: none;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  transition: all 0.15s ease;
}
.tab-btn:hover {
  color: var(--color-text, #e0e0e6);
  background: rgba(255, 255, 255, 0.04);
}
.tab-btn--active {
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-sage-500);
  border-radius: 9px;
}

/* ── Sections ── */
.sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-section {
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
  border: none;
  cursor: pointer;
  color: var(--color-text, #e0e0e6);
  transition: background 0.15s ease;
}
.section-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.section-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.section-title {
  font-size: 0.88rem;
  font-weight: 600;
}

.section-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-bone);
  border-radius: 10px;
}

.chevron {
  transition: transform 0.2s ease;
  color: var(--color-text-secondary, #8888a0);
}
.chevron--open {
  transform: rotate(0deg);
}
.chevron:not(.chevron--open) {
  transform: rotate(-90deg);
}

/* ── Section content ── */
.section-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.section-content--flat {
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
}

/* ── Memory entries ── */
.memory-entry {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.memory-entry:hover {
  background: rgba(255, 255, 255, 0.05);
}
.memory-entry--expanded {
  background: rgba(255, 255, 255, 0.04);
}
.memory-entry--sent {
  box-shadow: inset 3px 0 0 var(--color-sage-400);
}

.entry-header-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.entry-content {
  flex: 1;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.memory-entry--expanded .entry-content {
  -webkit-line-clamp: unset;
}

.sent-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--color-sage-400);
  opacity: 0.8;
}

.entry-details {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-id {
  font-size: 0.68rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text-secondary, #8888a0);
}

.entry-time {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
}

.entry-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.entry-tag {
  padding: 1px 6px;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border-radius: 6px;
}

/* ── Narrative tab ── */
.narrative-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 500px;
  overflow-y: auto;
}
.narrative-entry {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.narrative-entry--user {
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  box-shadow: inset 3px 0 0 var(--color-sage-400);
}
.narrative-entry--assistant {
  background: color-mix(in oklch, var(--color-success) 5%, transparent);
  box-shadow: inset 3px 0 0 var(--color-success);
}
.narrative-role {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 2px;
  opacity: 0.6;
}
.narrative-text {
  font-family: var(--font-serif-cjk);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: var(--narrative-line-height, 1.88);
  letter-spacing: var(--narrative-letter-spacing, 0.01em);
}

/* ── Config tab ── */
.config-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.7;
}

.config-note code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.72rem;
  color: var(--color-sage-400);
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-row {
  display: flex;
  gap: 12px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  font-size: 0.78rem;
}

.config-key {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-warning, #f59e0b);
  min-width: 120px;
  flex-shrink: 0;
}

.config-value {
  color: var(--color-text, #e0e0e6);
  word-break: break-all;
}

/* ── Transitions ── */
.section-expand-enter-active {
  transition: all 0.25s ease;
}
.section-expand-leave-active {
  transition: all 0.15s ease;
}
.section-expand-enter-from,
.section-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding: 0 8px;
}

/* ── Empty states ── */
.empty-hint {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
  padding: 8px;
  text-align: center;
  margin: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.88rem;
}

.empty-state-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  gap: 6px;
}

/* ── Scrollbar ── */
.memory-panel::-webkit-scrollbar { width: 5px; }
.memory-panel::-webkit-scrollbar-track { background: transparent; }
.memory-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }
</style>
