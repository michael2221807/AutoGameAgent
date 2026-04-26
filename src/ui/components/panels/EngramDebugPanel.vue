<script setup lang="ts">
/**
 * EngramDebugPanel — E.6 实时 Engram 调试面板
 *
 * 只在 EngramConfig.debug = true 时显示实质内容（AC E.6 第一条）。
 * 内容来源：
 *  - 事件/实体/关系 → `useGameState().get('系统.扩展.engramMemory')`
 *  - 最近检索快照  → `useEngramDebugStore()`（由 UnifiedRetriever 在 debug 模式下写入）
 *  - Engram 配置   → `loadEngramConfig()`（localStorage `aga_engram_config`）
 */
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { useEngramDebugStore } from '@/engine/stores/engram-debug';
import { loadEngramConfig } from '@/engine/memory/engram/engram-config';
import { DEFAULT_ENGRAM_CONFIG } from '@/engine/memory/engram/engram-types';
import type { EngramEventNode } from '@/engine/memory/engram/event-builder';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import type { EngramRelation } from '@/engine/memory/engram/relation-builder';
import Modal from '@/ui/components/common/Modal.vue';

const { isLoaded, get, setValue } = useGameState();
const debugStore = useEngramDebugStore();
import type { SemanticTriple } from '@/engine/memory/engram/triple-builder';

// ─── 配置检查 ───

const engramConfig = computed(() => loadEngramConfig());
const debugEnabled = computed(() => engramConfig.value.debug);

// ─── Engram 状态读取 ───

interface EngramStateData {
  events?: EngramEventNode[];
  entities?: EngramEntity[];
  relations?: EngramRelation[];
  meta?: {
    lastUpdated?: number;
    eventCount?: number;
    embeddedEventCount?: number;
    embeddedEntityCount?: number;
    schemaVersion?: number;
  };
}

const ENGRAM_PATH = '系统.扩展.engramMemory';

const engramData = computed<EngramStateData>(() => {
  if (!isLoaded.value) return {};
  return (get<EngramStateData>(ENGRAM_PATH) as EngramStateData | null) ?? {};
});

const events   = computed<EngramEventNode[]>(() => engramData.value.events   ?? []);

// 找到真实玩家名（type=player 且不是字面 "玩家"/"player"）
const realPlayerName = computed(() => {
  const all = engramData.value.entities ?? [];
  const real = all.find((e) => e.type === 'player' && e.name !== '玩家' && e.name !== 'player');
  return real?.name ?? null;
});

// 过滤掉与真实玩家名重复的 "玩家" 实体
const entities = computed<EngramEntity[]>(() => {
  const all = engramData.value.entities ?? [];
  if (!realPlayerName.value) return all;
  return all.filter((e) => !(e.type === 'player' && (e.name === '玩家' || e.name === 'player')));
});

const relations = computed<EngramRelation[]>(() => engramData.value.relations ?? []);

// ─── 向量化统计（2026-04-14 新增：从 is_embedded 真实字段推算） ───

const embeddedEventCount = computed(
  () => events.value.filter((e) => e.is_embedded === true).length,
);
const embeddedEntityCount = computed(
  () => entities.value.filter((e) => e.is_embedded === true).length,
);
const eventEmbedPct = computed(() =>
  events.value.length === 0 ? 0 : Math.round((embeddedEventCount.value / events.value.length) * 100),
);
const entityEmbedPct = computed(() =>
  entities.value.length === 0 ? 0 : Math.round((embeddedEntityCount.value / entities.value.length) * 100),
);

const maxEvents   = computed(() => engramConfig.value.trim.countLimit ?? DEFAULT_ENGRAM_CONFIG.trim.countLimit);
const maxEntities = computed(() => engramConfig.value.maxEntities ?? DEFAULT_ENGRAM_CONFIG.maxEntities);

// ─── 分页（事件列表，每页 20 条） ───

const PAGE_SIZE = 20;
const eventPage = ref(0);

const totalEventPages = computed(() => Math.max(1, Math.ceil(events.value.length / PAGE_SIZE)));
const pagedEvents = computed(() =>
  events.value.slice(eventPage.value * PAGE_SIZE, (eventPage.value + 1) * PAGE_SIZE)
);

watch(() => events.value.length, () => { eventPage.value = 0; });

// ─── 折叠控制 ───

type SectionKey = 'events' | 'entities' | 'relations' | 'retrieval';
const collapsed = ref<Set<SectionKey>>(new Set(['entities', 'relations', 'retrieval']));

function toggleSection(key: SectionKey): void {
  if (collapsed.value.has(key)) collapsed.value.delete(key);
  else collapsed.value.add(key);
}
function isOpen(key: SectionKey): boolean {
  return !collapsed.value.has(key);
}

// ─── 清除 Engram 数据 ───

const showClearModal = ref(false);
const clearStep = ref(1);

function openClearModal(): void {
  clearStep.value = 1;
  showClearModal.value = true;
}

function confirmClear(): void {
  if (clearStep.value === 1) {
    clearStep.value = 2;
    return;
  }
  // 清除状态树中的 engramMemory
  setValue(ENGRAM_PATH, { events: [], entities: [], relations: [], meta: { lastUpdated: Date.now(), eventCount: 0 } });
  // 清除检索调试快照
  debugStore.clear();
  showClearModal.value = false;
  clearStep.value = 1;
}

// ─── 导出 JSON ───

function exportJson(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    config: engramConfig.value,
    events: events.value,
    entities: entities.value,
    relations: relations.value,
    lastRetrieve: debugStore.lastRetrieve,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `engram-debug-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── 格式化辅助 ───

function formatTs(ts: number | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function formatScore(s: number): string {
  return (s * 100).toFixed(0) + '%';
}

const ENTITY_TYPE_COLOR: Record<string, string> = {
  player:   'var(--color-primary, #6366f1)',
  npc:      'var(--color-success, #22c55e)',
  location: 'var(--color-warning, #f59e0b)',
  item:     'var(--color-sage-300)',
  other:    'var(--color-text-secondary, #8888a0)',
};

function entityColor(type: string): string {
  return ENTITY_TYPE_COLOR[type] ?? ENTITY_TYPE_COLOR.other;
}

// ─── 关系过滤（只显示有意义的社交关系，隐藏 co_occurs/appears_at 噪音）───

// 只显示 rel_* 社交关系（从 社交.关系[].与玩家关系 派生），其余全部是内部评分信号
const displayRelations = computed(() =>
  relations.value
    .filter((r) => r.type.startsWith('rel_'))
    .map((r) => ({
      ...r,
      displayLabel: r.type.slice(4), // rel_陌生人 → 陌生人
    })),
);

// ─── 语义三元组（系统.扩展.语义记忆.triples）───

const SEMANTIC_PATH = '系统.扩展.语义记忆';

interface SemanticMemStore { triples?: SemanticTriple[]; meta?: { tripleCount?: number } }

const semanticStore = computed<SemanticMemStore>(() => {
  if (!isLoaded.value) return {};
  return (get<SemanticMemStore>(SEMANTIC_PATH) as SemanticMemStore | null) ?? {};
});

const triples = computed<SemanticTriple[]>(() => semanticStore.value.triples ?? []);

const IMPORTANCE_COLOR: Record<string, string> = {
  high: 'var(--color-danger)',
  mid: 'var(--color-amber-400)',
  low: 'var(--color-text-secondary)',
};

function importanceClass(imp: number | undefined): string {
  const v = imp ?? 5;
  if (v >= 7) return 'high';
  if (v >= 4) return 'mid';
  return 'low';
}

// ─── Cytoscape 关系图（复用地图面板的 library）───

import cytoscape from 'cytoscape';
import type { Core as CyCore } from 'cytoscape';

const graphContainer = ref<HTMLDivElement | null>(null);
const showEdgeLabels = ref(true);
let cyInstance: CyCore | null = null;

const NODE_BG: Record<string, string> = {
  player: '#8a9080',
  npc: '#7aab78',
  location: '#c9a84c',
  item: '#6b9e8a',
  other: '#7a8590',
};

function buildCyElements(): { nodes: cytoscape.ElementDefinition[]; edges: cytoscape.ElementDefinition[] } {
  const entityTypeMap = new Map<string, string>();
  for (const e of entities.value) entityTypeMap.set(e.name, e.type);

  // 只把 player + npc 作为图节点（排除 location/item/other 避免噪音）
  const charEntities = entities.value.filter((e) => e.type === 'player' || e.type === 'npc');
  const charNames = new Set(charEntities.map((e) => e.name));

  const nodes: cytoscape.ElementDefinition[] = charEntities.map((e) => ({
    data: { id: e.name, label: e.name, type: e.type, bg: NODE_BG[e.type] ?? NODE_BG.other },
  }));

  // 边：只保留 rel_* 社交关系（和列表一致，排除 co_occurs/appears_at 噪音）
  const edgeSet = new Map<string, { from: string; to: string; label: string }>();
  for (const rel of relations.value) {
    if (!rel.type.startsWith('rel_')) continue;
    if (!charNames.has(rel.fromName) || !charNames.has(rel.toName)) continue;
    const key = `${rel.fromName}→${rel.toName}`;
    if (!edgeSet.has(key)) {
      edgeSet.set(key, { from: rel.fromName, to: rel.toName, label: rel.type.slice(4) });
    }
  }

  const edges: cytoscape.ElementDefinition[] = [];
  for (const [, e] of edgeSet) {
    edges.push({
      data: { source: e.from, target: e.to, label: e.label },
    });
  }

  return { nodes, edges };
}

function initGraph(): void {
  if (!graphContainer.value) return;
  destroyGraph();

  const { nodes, edges } = buildCyElements();
  if (nodes.length === 0) return;

  cyInstance = cytoscape({
    container: graphContainer.value,
    elements: [...nodes, ...edges],
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(bg)',
          'label': 'data(label)',
          'color': '#d4cfc5',
          'font-size': '11px',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 50,
          'height': 32,
          'shape': 'ellipse',
          'border-width': 1,
          'border-color': 'rgba(255,255,255,0.15)',
          'text-outline-width': 2,
          'text-outline-color': '#1e1d1a',
        },
      },
      {
        selector: 'node[type="player"]',
        style: {
          'width': 60,
          'height': 38,
          'font-weight': 700,
          'border-width': 2,
          'border-color': 'rgba(148,163,184,0.5)',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': 'rgba(255,255,255,0.15)',
          'target-arrow-color': 'rgba(255,255,255,0.25)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
          'curve-style': 'bezier',
          'label': showEdgeLabels.value ? 'data(label)' : '',
          'font-size': '9px',
          'color': 'rgba(255,255,255,0.4)',
          'text-rotation': 'autorotate',
          'text-outline-width': 1.5,
          'text-outline-color': '#1e1d1a',
        },
      },
    ],
    layout: {
      name: 'cose',
      animate: true,
      animationDuration: 600,
      nodeRepulsion: () => 6000,
      idealEdgeLength: () => 120,
      gravity: 0.3,
      numIter: 200,
      padding: 30,
    } as cytoscape.LayoutOptions,
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
  });
}

function destroyGraph(): void {
  if (cyInstance) { cyInstance.destroy(); cyInstance = null; }
}

function resetGraphLayout(): void {
  if (cyInstance) {
    cyInstance.layout({
      name: 'cose',
      animate: true,
      animationDuration: 600,
      nodeRepulsion: () => 6000,
      idealEdgeLength: () => 120,
      gravity: 0.3,
      numIter: 200,
      padding: 30,
    } as cytoscape.LayoutOptions).run();
  }
}

function toggleEdgeLabels(): void {
  if (!cyInstance) return;
  cyInstance.edges().style('label', showEdgeLabels.value ? 'data(label)' : '');
}

// 当 graph container DOM 出现时立即初始化 Cytoscape
watch(graphContainer, (el) => {
  if (el && !cyInstance) setTimeout(() => initGraph(), 50);
});

// 数据变化时重建图
watch([entities, relations], () => {
  if (isOpenExt('graph') && graphContainer.value) {
    nextTick(() => initGraph());
  }
});

watch(showEdgeLabels, () => toggleEdgeLabels());

// ─── 三元组排序/筛选 ───

const tripleSortField = ref<'timestamp' | 'importance'>('timestamp');
const tripleSortDir = ref<'desc' | 'asc'>('desc');
const tripleFilterText = ref('');
const tripleFilterCategory = ref('全部');
const tripleMinImportance = ref(0);
const tripleGroupBySubject = ref(false);

const tripleCategories = computed(() => {
  const cats = new Set<string>();
  for (const t of triples.value) { if (t.category) cats.add(t.category); }
  return ['全部', ...cats];
});

const filteredTriples = computed(() => {
  let list = [...triples.value];

  // Filter by text
  const q = tripleFilterText.value.trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      t.subject.toLowerCase().includes(q) ||
      t.object.toLowerCase().includes(q) ||
      t.predicate.toLowerCase().includes(q),
    );
  }

  // Filter by category
  if (tripleFilterCategory.value !== '全部') {
    list = list.filter((t) => t.category === tripleFilterCategory.value);
  }

  // Filter by min importance
  if (tripleMinImportance.value > 0) {
    list = list.filter((t) => (t.importance ?? 5) >= tripleMinImportance.value);
  }

  // Sort
  list.sort((a, b) => {
    const va = tripleSortField.value === 'importance' ? (a.importance ?? 5) : (a.timestamp ?? '');
    const vb = tripleSortField.value === 'importance' ? (b.importance ?? 5) : (b.timestamp ?? '');
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return tripleSortDir.value === 'desc' ? -cmp : cmp;
  });

  return list;
});

interface TripleGroup { subject: string; items: SemanticTriple[] }

const groupedTriples = computed<TripleGroup[]>(() => {
  if (!tripleGroupBySubject.value) return [];
  const map = new Map<string, SemanticTriple[]>();
  for (const t of filteredTriples.value) {
    const group = map.get(t.subject) ?? [];
    group.push(t);
    map.set(t.subject, group);
  }
  return [...map.entries()].map(([subject, items]) => ({ subject, items }));
});

function copyText(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─── 新增 section 折叠 ───

type SectionKeyExt = SectionKey | 'triples' | 'graph' | 'architecture';

function toggleSectionExt(key: SectionKeyExt): void {
  if (collapsed.value.has(key as SectionKey)) collapsed.value.delete(key as SectionKey);
  else collapsed.value.add(key as SectionKey);
  // Init/destroy cytoscape when graph section toggles
  // 延迟 initGraph 等 Transition 动画完成（enter-from max-height:0 → enter-to 需要时间）
  if (key === 'graph') {
    if (isOpenExt('graph')) {
      setTimeout(() => initGraph(), 300);
    } else {
      destroyGraph();
    }
  }
}
function isOpenExt(key: SectionKeyExt): boolean {
  return !collapsed.value.has(key as SectionKey);
}

onUnmounted(() => destroyGraph());
</script>

<template>
  <div class="engram-panel">
    <header class="panel-header">
      <h2 class="panel-title">Engram 调试</h2>
      <div class="header-actions">
        <button class="btn-sm" :disabled="events.length === 0" @click="exportJson">导出 JSON</button>
        <button class="btn-sm btn-sm--danger" :disabled="events.length === 0" @click="openClearModal">清空数据</button>
      </div>
    </header>

    <!-- Debug 模式未开启 -->
    <div v-if="!debugEnabled" class="debug-off">
      <p class="debug-off__title">Engram Debug 模式未开启</p>
      <p class="debug-off__hint">请前往 <strong>设置 → Engram → 开启 Debug 模式</strong> 后重新进入此面板。</p>
    </div>

    <template v-else-if="isLoaded">
      <!-- ─── 统计概览 ─── -->
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{{ events.length }}<span class="stat-limit"> / {{ maxEvents }}</span></span>
          <span class="stat-label">事件</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ entities.length }}<span class="stat-limit"> / {{ maxEntities }}</span></span>
          <span class="stat-label">实体</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ relations.length }}</span>
          <span class="stat-label">关系</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color: var(--color-success, #22c55e);">{{ triples.length }}</span>
          <span class="stat-label">三元组</span>
        </div>
      </div>

      <!-- ─── 向量化进度条（突出显示，方便调试） ─── -->
      <div class="embed-status">
        <div class="embed-row">
          <div class="embed-row__header">
            <span class="embed-row__title">事件向量化</span>
            <span class="embed-row__meta">
              <strong :class="eventEmbedPct === 100 ? 'text-ok' : eventEmbedPct > 0 ? 'text-partial' : 'text-zero'">
                {{ embeddedEventCount }} / {{ events.length }}
              </strong>
              <span class="embed-row__pct">{{ eventEmbedPct }}%</span>
            </span>
          </div>
          <div class="embed-bar">
            <div
              class="embed-bar__fill"
              :class="eventEmbedPct === 100 ? 'embed-bar__fill--ok' : eventEmbedPct > 0 ? 'embed-bar__fill--partial' : 'embed-bar__fill--zero'"
              :style="{ width: eventEmbedPct + '%' }"
            />
          </div>
        </div>
        <div class="embed-row">
          <div class="embed-row__header">
            <span class="embed-row__title">实体向量化</span>
            <span class="embed-row__meta">
              <strong :class="entityEmbedPct === 100 ? 'text-ok' : entityEmbedPct > 0 ? 'text-partial' : 'text-zero'">
                {{ embeddedEntityCount }} / {{ entities.length }}
              </strong>
              <span class="embed-row__pct">{{ entityEmbedPct }}%</span>
            </span>
          </div>
          <div class="embed-bar">
            <div
              class="embed-bar__fill"
              :class="entityEmbedPct === 100 ? 'embed-bar__fill--ok' : entityEmbedPct > 0 ? 'embed-bar__fill--partial' : 'embed-bar__fill--zero'"
              :style="{ width: entityEmbedPct + '%' }"
            />
          </div>
        </div>
        <p v-if="eventEmbedPct < 100 || entityEmbedPct < 100" class="embed-hint">
          提示：部分条目尚未向量化 — 可能是 embedding API 调用失败、尚未配置，或正在异步向量化中。重启游戏后会自动补充。
        </p>
      </div>

      <!-- ─── 事件列表 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSection('events')">
          <span class="section-title">事件列表</span>
          <span class="section-badge">{{ events.length }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpen('events') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpen('events')" class="section-body">
            <div v-if="events.length === 0" class="empty-hint">暂无事件数据</div>
            <template v-else>
              <div v-for="ev in pagedEvents" :key="ev.id" class="event-row">
                <div class="event-header-row">
                  <span class="mono event-id">{{ ev.id.slice(-8) }}</span>
                  <span v-if="ev.roundNumber != null" class="mono round-badge">R{{ ev.roundNumber }}</span>
                  <span
                    :class="['embed-badge', ev.is_embedded ? 'embed-badge--ok' : 'embed-badge--pending']"
                    :title="ev.is_embedded ? '已向量化' : '尚未向量化'"
                  >{{ ev.is_embedded ? '✓ 已向量化' : '○ 未向量化' }}</span>
                  <span class="event-sao">
                    <strong>{{ ev.subject }}</strong>
                    <span class="sao-sep">→</span>{{ ev.action }}
                    <template v-if="ev.object"><span class="sao-sep">→</span><strong>{{ ev.object }}</strong></template>
                  </span>
                </div>
                <p class="event-text">{{ ev.text }}</p>
                <div v-if="ev.tags?.length" class="event-tags">
                  <span v-for="tag in ev.tags" :key="tag" class="tag">{{ tag }}</span>
                </div>
              </div>

              <!-- 分页控件 -->
              <div v-if="totalEventPages > 1" class="pagination">
                <button class="btn-sm" :disabled="eventPage === 0" @click="eventPage--">←</button>
                <span class="page-info">{{ eventPage + 1 }} / {{ totalEventPages }}</span>
                <button class="btn-sm" :disabled="eventPage >= totalEventPages - 1" @click="eventPage++">→</button>
              </div>
            </template>
          </div>
        </Transition>
      </section>

      <!-- ─── 实体列表 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSection('entities')">
          <span class="section-title">实体列表</span>
          <span class="section-badge">{{ entities.length }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpen('entities') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpen('entities')" class="section-body">
            <div v-if="entities.length === 0" class="empty-hint">暂无实体数据</div>
            <div v-for="ent in entities" :key="ent.name" class="entity-row">
              <div class="entity-header">
                <span class="entity-name">{{ ent.name }}</span>
                <span class="entity-type" :style="{ color: entityColor(ent.type) }">{{ ent.type }}</span>
                <span class="entity-count">×{{ ent.mentionCount }}</span>
                <span
                  :class="['embed-badge', ent.is_embedded ? 'embed-badge--ok' : 'embed-badge--pending']"
                  :title="ent.is_embedded ? '已向量化' : '尚未向量化'"
                >{{ ent.is_embedded ? '✓' : '○' }}</span>
              </div>
              <div v-if="ent.description" class="entity-desc">{{ ent.description }}</div>
              <div class="entity-rounds">
                <span class="meta-text">首见 R{{ ent.firstSeen }} · 末见 R{{ ent.lastSeen }}</span>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ─── 关系列表 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSection('relations')">
          <span class="section-title">关系列表</span>
          <span class="section-badge">{{ relations.length }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpen('relations') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpen('relations')" class="section-body">
            <div v-if="relations.length === 0" class="empty-hint">暂无关系数据</div>
            <div v-for="(rel, idx) in relations" :key="idx" class="relation-row">
              <span class="rel-from">{{ rel.fromName }}</span>
              <span class="rel-arrow">–{{ rel.type }}→</span>
              <span class="rel-to">{{ rel.toName }}</span>
              <span class="rel-weight">{{ formatScore(rel.weight) }}</span>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ─── 语义记忆 (系统.扩展.语义记忆) ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSectionExt('triples')">
          <span class="section-title">语义记忆 (系统.扩展.语义记忆)</span>
          <span class="section-badge">{{ triples.length }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpenExt('triples') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpenExt('triples')" class="section-body section-body--triples">
            <!-- 排序/筛选控件 -->
            <div class="triple-toolbar">
              <label class="tb-label">排序
                <select v-model="tripleSortField" class="tb-select">
                  <option value="timestamp">timestamp</option>
                  <option value="importance">importance</option>
                </select>
              </label>
              <select v-model="tripleSortDir" class="tb-select">
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
              <label class="tb-label">筛选
                <input v-model="tripleFilterText" class="tb-input" placeholder="subject/object 包含" />
              </label>
              <select v-model="tripleFilterCategory" class="tb-select">
                <option v-for="c in tripleCategories" :key="c" :value="c">{{ c }}</option>
              </select>
              <input v-model.number="tripleMinImportance" class="tb-input tb-input--sm" type="number" min="0" max="10" placeholder="重要度≥" />
              <label class="tb-check">
                <input type="checkbox" v-model="tripleGroupBySubject" />
                按 subject 分组
              </label>
            </div>

            <div v-if="triples.length === 0" class="empty-hint">暂无三元组 — AI 尚未产出 semantic_memory.triples</div>

            <!-- 分组视图 -->
            <template v-else-if="tripleGroupBySubject">
              <div class="list-section-header">三元组 ({{ filteredTriples.length }})</div>
              <div v-for="group in groupedTriples" :key="group.subject" class="triple-group">
                <div class="triple-group__header">{{ group.subject }} ({{ group.items.length }})</div>
                <div v-for="(t, i) in group.items" :key="i" class="triple-row">
                  <span v-if="t.timestamp" class="triple-ts">{{ t.timestamp }}</span>
                  <span class="triple-subject">{{ t.subject }}</span>
                  <span class="triple-predicate">{{ t.predicate }}</span>
                  <span class="triple-object">{{ t.object }}</span>
                  <span class="triple-right">
                    <span v-if="t.importance" :class="['triple-imp', `triple-imp--${importanceClass(t.importance)}`]">重要度 {{ t.importance }}</span>
                    <span v-if="t.category" class="triple-category">{{ t.category }}</span>
                    <button class="btn-copy" @click="copyText(`${t.subject} ${t.predicate} ${t.object}`)">复制</button>
                  </span>
                </div>
              </div>
            </template>

            <!-- 平铺视图 -->
            <template v-else>
              <div class="list-section-header">三元组 ({{ filteredTriples.length }})</div>
              <div v-for="(t, idx) in filteredTriples" :key="idx" class="triple-row">
                <span v-if="t.timestamp" class="triple-ts">{{ t.timestamp }}</span>
                <span class="triple-subject">{{ t.subject }}</span>
                <span class="triple-predicate">{{ t.predicate }}</span>
                <span class="triple-object">{{ t.object }}</span>
                <span class="triple-right">
                  <span v-if="t.importance" :class="['triple-imp', `triple-imp--${importanceClass(t.importance)}`]">重要度 {{ t.importance }}</span>
                  <span v-if="t.category" class="triple-category">{{ t.category }}</span>
                  <button class="btn-copy" @click="copyText(`${t.subject} ${t.predicate} ${t.object}`)">复制</button>
                </span>
              </div>
            </template>
          </div>
        </Transition>
      </section>

      <!-- ─── 实体与语义 (游戏索引) ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSectionExt('graph')">
          <span class="section-title">实体与语义 (游戏索引)</span>
          <svg :class="['chevron', { 'chevron--open': isOpenExt('graph') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpenExt('graph')" class="section-body section-body--graph">
            <p class="graph-subtitle">实体与关系由 社交.关系+角色 派生；语义记忆由 LLM 在行动生成时产出并写入 系统.扩展.语义记忆。</p>

            <!-- 关系图 -->
            <div class="graph-card">
              <div class="graph-card__header">
                <strong>关系图</strong>
                <label class="graph-checkbox">
                  <input type="checkbox" v-model="showEdgeLabels" />
                  显示标签
                </label>
                <button class="btn-sm" @click="resetGraphLayout">恢复默认</button>
              </div>
              <div v-if="relations.length === 0" class="empty-hint" style="padding: 40px;">暂无关系数据</div>
              <div v-else ref="graphContainer" class="cy-container" />
            </div>

            <!-- 实体与关系列表 (ming 格式) -->
            <div class="graph-card">
              <strong class="graph-card__title">实体与关系 (由 社交.关系+角色 派生)</strong>

              <div class="list-section-header">实体 ({{ entities.length }})</div>
              <div v-if="entities.length === 0" class="empty-hint">暂无实体</div>
              <div v-for="ent in entities" :key="ent.name" class="ming-row">
                <span class="ming-type" :style="{ color: entityColor(ent.type) }">{{ ent.type }}</span>
                <span class="ming-name" :style="{ color: entityColor(ent.type) }">{{ ent.name }}</span>
                <span v-if="ent.description" class="ming-desc">{{ ent.description }}</span>
                <button class="btn-copy" @click="copyText(`${ent.type} ${ent.name} ${ent.description}`)">复制</button>
              </div>

              <div class="list-section-header">关系 ({{ displayRelations.length }})</div>
              <div v-if="displayRelations.length === 0" class="empty-hint">暂无社交关系</div>
              <div v-for="(rel, idx) in displayRelations" :key="idx" class="ming-row">
                <span class="ming-from">{{ rel.fromName }}</span>
                <span class="ming-rel" :style="{ color: 'var(--color-sage-300)' }">{{ rel.displayLabel }}</span>
                <span class="ming-to">{{ rel.toName }}</span>
                <span class="triple-right">
                  <button class="btn-copy" @click="copyText(`${rel.fromName} ${rel.displayLabel} ${rel.toName}`)">复制</button>
                </span>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ─── 架构说明 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSectionExt('architecture')">
          <span class="section-title">Engram 机制说明</span>
          <svg :class="['chevron', { 'chevron--open': isOpenExt('architecture') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpenExt('architecture')" class="section-body arch-body">
            <div class="arch-card">
              <h4 class="arch-card__title">数据流</h4>
              <div class="arch-flow">
                <span class="arch-step">AI 回复</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step">事件提取</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step">实体构建</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step">关系推断</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step arch-step--vec">向量化</span>
              </div>
              <div class="arch-flow" style="margin-top: 6px;">
                <span class="arch-step">AI 回复</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step arch-step--triple">三元组提取</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step">去重追加</span>
              </div>
            </div>
            <div class="arch-card">
              <h4 class="arch-card__title">向量化范围</h4>
              <div class="arch-items">
                <div class="arch-item"><span class="arch-dot arch-dot--vec"></span>事件 summary（burned 格式）</div>
                <div class="arch-item"><span class="arch-dot arch-dot--vec"></span>实体 name + description</div>
                <div class="arch-item"><span class="arch-dot arch-dot--kw"></span>三元组（关键词评分，不向量化）</div>
                <div class="arch-item"><span class="arch-dot arch-dot--kw"></span>关系边（图遍历，不向量化）</div>
              </div>
            </div>
            <div class="arch-card">
              <h4 class="arch-card__title">检索通道</h4>
              <div class="arch-items">
                <div class="arch-item">1. 向量相似度（事件 + 实体，cosine）</div>
                <div class="arch-item">2. 图遍历（BFS 2跳，关系权重衰减）</div>
                <div class="arch-item">3. 三元组关键词匹配（importance + recency）</div>
                <div class="arch-item">4. 当前地点 NPC 规则注入</div>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ─── 最近检索结果 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSection('retrieval')">
          <span class="section-title">最近检索快照</span>
          <span v-if="debugStore.lastRetrieve" class="section-ts">{{ new Date(debugStore.lastRetrieve.capturedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpen('retrieval') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpen('retrieval')" class="section-body">
            <div v-if="!debugStore.lastRetrieve" class="empty-hint">尚无检索快照（运行一次 AI 回合后可见）</div>
            <template v-else>
              <div class="retrieve-stats">
                <div class="rs-row"><span class="rs-label">向量候选</span><span class="rs-val">{{ debugStore.lastRetrieve.vectorCandidateCount }}</span></div>
                <div class="rs-row"><span class="rs-label">图遍历候选</span><span class="rs-val">{{ debugStore.lastRetrieve.graphCandidateCount }}</span></div>
                <div class="rs-row"><span class="rs-label">三元组候选</span><span class="rs-val">{{ debugStore.lastRetrieve.triplesCandidateCount }}</span></div>
                <div class="rs-row"><span class="rs-label">合并后</span><span class="rs-val">{{ debugStore.lastRetrieve.afterMergeCount }}</span></div>
                <div class="rs-row"><span class="rs-label">重排后</span><span class="rs-val">{{ debugStore.lastRetrieve.afterRerankCount }}</span></div>
                <div class="rs-row">
                  <span class="rs-label">重排</span>
                  <span :class="['rs-flag', debugStore.lastRetrieve.rerankUsed ? 'rs-flag--on' : 'rs-flag--off']">
                    {{ debugStore.lastRetrieve.rerankUsed ? '已启用' : '未启用' }}
                  </span>
                </div>
                <div class="rs-row">
                  <span class="rs-label">向量 fallback</span>
                  <span :class="['rs-flag', debugStore.lastRetrieve.embeddingFallback ? 'rs-flag--warn' : 'rs-flag--off']">
                    {{ debugStore.lastRetrieve.embeddingFallback ? '是' : '否' }}
                  </span>
                </div>
              </div>

              <h4 class="retrieve-subtitle">Top {{ debugStore.lastRetrieve.topScores.length }} 得分项</h4>
              <div v-for="(s, i) in debugStore.lastRetrieve.topScores" :key="i" class="score-row">
                <span class="score-rank">#{{ i + 1 }}</span>
                <span class="score-source" :class="`score-source--${s.source}`">{{ s.source }}</span>
                <span class="score-pct">{{ formatScore(s.score) }}</span>
                <span class="score-text">{{ s.text }}</span>
              </div>
            </template>
          </div>
        </Transition>
      </section>

      <!-- meta 信息 -->
      <p v-if="engramData.meta?.lastUpdated" class="meta-footer">
        最后更新：{{ formatTs(engramData.meta.lastUpdated) }}
      </p>
    </template>

    <div v-else class="empty-state">尚未加载游戏数据</div>

    <!-- ─── 清除确认 Modal ─── -->
    <Modal v-model="showClearModal" title="清空 Engram 数据" width="380px">
      <div v-if="clearStep === 1" style="color: var(--color-text,#e0e0e6);">
        <p>此操作将清除状态树中所有 Engram 数据（事件 / 实体 / 关系）。</p>
        <p>IndexedDB 中的向量数据不受影响（如需清除请使用存档面板的向量重建功能）。</p>
      </div>
      <div v-else style="color: var(--color-danger); font-weight: 600;">
        确定要清空全部 {{ events.length }} 条事件、{{ entities.length }} 个实体、{{ relations.length }} 条关系吗？此操作不可撤销。
      </div>
      <template #footer>
        <button class="btn-sm" @click="showClearModal = false; clearStep = 1">取消</button>
        <button class="btn-sm btn-sm--danger" @click="confirmClear">
          {{ clearStep === 1 ? '继续' : '确认清空' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.engram-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
}

/* ── Header ── */
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
.header-actions {
  display: flex;
  gap: 6px;
}

/* ── Buttons ── */
.btn-sm {
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover { color: var(--color-text,#e0e0e6); border-color: var(--color-primary,#6366f1); }
.btn-sm:disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
.btn-sm--danger { color: var(--color-danger); border-color: color-mix(in oklch, var(--color-danger) 30%, transparent); }
.btn-sm--danger:hover { background: color-mix(in oklch, var(--color-danger) 10%, transparent); border-color: var(--color-danger); }

/* ── Debug off notice ── */
.debug-off {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 40px 20px;
  text-align: center;
}
.debug-off__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
  margin: 0;
}
.debug-off__hint {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
  margin: 0;
}

/* ── Stats grid ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
}
.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: 'JetBrains Mono','Fira Code',monospace;
  color: var(--color-primary, #6366f1);
}
.stat-limit {
  font-size: 0.68rem;
  color: var(--color-text-secondary, #8888a0);
}
.stat-label {
  font-size: 0.68rem;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Sections ── */
.debug-section {
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  overflow: hidden;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: rgba(255,255,255,0.02);
  border: none;
  cursor: pointer;
  color: var(--color-text, #e0e0e6);
  transition: background 0.15s ease;
}
.section-header:hover { background: rgba(255,255,255,0.04); }
.section-title { font-size: 0.85rem; font-weight: 600; }
.section-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 5px;
  font-size: 0.62rem; font-weight: 700; color: var(--color-text-bone);
  background: var(--color-primary,#6366f1); border-radius: 9px;
}
.section-ts {
  font-size: 0.68rem;
  font-family: monospace;
  color: var(--color-text-secondary, #8888a0);
  margin-left: auto;
  margin-right: 4px;
}
.chevron { margin-left: auto; transition: transform 0.2s; color: var(--color-text-secondary,#8888a0); }
.section-header:has(.section-ts) .chevron { margin-left: 0; }
.chevron--open { transform: rotate(0deg); }
.chevron:not(.chevron--open) { transform: rotate(-90deg); }

.section-body { padding: 8px; display: flex; flex-direction: column; gap: 4px; }

/* ── Event rows ── */
.event-row {
  padding: 8px;
  background: rgba(255,255,255,0.02);
  border-radius: 6px;
  display: flex; flex-direction: column; gap: 3px;
}
.event-header-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mono { font-family: 'JetBrains Mono','Fira Code',monospace; }
.event-id { font-size: 0.65rem; color: var(--color-text-secondary,#8888a0); }
.round-badge {
  font-size: 0.62rem; font-weight: 700;
  color: var(--color-primary,#6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  padding: 1px 5px; border-radius: 4px;
}
.event-sao { font-size: 0.78rem; color: var(--color-text,#e0e0e6); }
.sao-sep { margin: 0 3px; color: var(--color-text-secondary,#8888a0); }
.event-text {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
  margin: 0;
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.event-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag {
  padding: 1px 5px; font-size: 0.62rem; font-weight: 500;
  color: var(--color-warning,#f59e0b);
  background: color-mix(in oklch, var(--color-amber-400) 8%, transparent); border-radius: 4px;
}

/* ── Pagination ── */
.pagination {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding-top: 6px;
}
.page-info { font-size: 0.72rem; color: var(--color-text-secondary,#8888a0); }

/* ── Entity rows ── */
.entity-row {
  padding: 6px 8px;
  background: rgba(255,255,255,0.02); border-radius: 6px;
  display: flex; flex-direction: column; gap: 2px;
}
.entity-header { display: flex; align-items: center; gap: 8px; }
.entity-name { font-size: 0.82rem; font-weight: 600; color: var(--color-text,#e0e0e6); }
.entity-type { font-size: 0.68rem; font-weight: 600; }
.entity-count { font-size: 0.68rem; color: var(--color-text-secondary,#8888a0); margin-left: auto; }
.entity-rounds { }
.meta-text { font-size: 0.68rem; color: var(--color-text-secondary,#8888a0); }

/* ── Relation rows ── */
.relation-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px;
  background: rgba(255,255,255,0.02); border-radius: 5px;
  font-size: 0.78rem;
}
.rel-from, .rel-to { font-weight: 600; color: var(--color-text,#e0e0e6); }
.rel-arrow { font-family: monospace; color: var(--color-text-secondary,#8888a0); font-size: 0.72rem; }
.rel-weight { margin-left: auto; font-size: 0.68rem; color: var(--color-success,#22c55e); }

/* ── Retrieval stats ── */
.retrieve-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
  padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;
  margin-bottom: 8px;
}
.rs-row { display: flex; justify-content: space-between; align-items: center; }
.rs-label { font-size: 0.72rem; color: var(--color-text-secondary,#8888a0); }
.rs-val { font-size: 0.72rem; font-family: monospace; color: var(--color-text,#e0e0e6); }
.rs-flag { font-size: 0.68rem; font-weight: 600; padding: 1px 5px; border-radius: 4px; }
.rs-flag--on { color: var(--color-success,#22c55e); background: color-mix(in oklch, var(--color-success) 10%, transparent); }
.rs-flag--off { color: var(--color-text-secondary,#8888a0); background: rgba(255,255,255,0.04); }
.rs-flag--warn { color: var(--color-warning,#f59e0b); background: color-mix(in oklch, var(--color-amber-400) 10%, transparent); }

.retrieve-subtitle { font-size: 0.75rem; font-weight: 600; color: var(--color-text-secondary,#8888a0); margin: 6px 0 4px; }
.score-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; background: rgba(255,255,255,0.02); border-radius: 5px;
}
.score-rank { font-size: 0.65rem; color: var(--color-text-secondary,#8888a0); width: 18px; flex-shrink: 0; }
.score-source {
  font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 3px;
  flex-shrink: 0;
}
.score-source--vector { color: var(--color-primary,#6366f1); background: color-mix(in oklch, var(--color-sage-400) 10%, transparent); }
.score-source--graph  { color: var(--color-success,#22c55e); background: color-mix(in oklch, var(--color-success) 10%, transparent); }
.score-pct { font-size: 0.68rem; font-family: monospace; color: var(--color-text,#e0e0e6); flex-shrink: 0; width: 36px; }
.score-text { font-size: 0.72rem; color: var(--color-text-secondary,#8888a0); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

/* ── Meta footer ── */
.meta-footer { font-size: 0.68rem; color: var(--color-text-secondary,#8888a0); text-align: right; margin: 0; opacity: 0.5; }

/* ── Empty states ── */
.empty-hint { font-size: 0.8rem; color: var(--color-text-secondary,#8888a0); opacity: 0.6; padding: 8px; text-align: center; margin: 0; }
.empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-secondary,#8888a0); font-size: 0.88rem; }

/* ── Section transition ── */
.section-expand-enter-active { transition: all 0.2s ease; }
.section-expand-leave-active { transition: all 0.12s ease; }
.section-expand-enter-from, .section-expand-leave-to { opacity: 0; max-height: 0; padding: 0 8px; }

/* ── Scrollbar ── */
.engram-panel::-webkit-scrollbar { width: 5px; }
.engram-panel::-webkit-scrollbar-track { background: transparent; }
.engram-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }

/* ── Embedding status (2026-04-14 新增) ── */

.stat-card--embed {
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

.embed-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.embed-dot--ok       { background: var(--color-success); box-shadow: 0 0 6px color-mix(in oklch, var(--color-success) 50%, transparent); }
.embed-dot--partial  { background: var(--color-amber-400); box-shadow: 0 0 5px color-mix(in oklch, var(--color-amber-400) 50%, transparent); }
.embed-dot--zero     { background: var(--color-danger); box-shadow: 0 0 5px color-mix(in oklch, var(--color-danger) 50%, transparent); }

.embed-status {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.embed-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.embed-row__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.82rem;
}

.embed-row__title {
  color: var(--color-text, #e0e0e6);
  font-weight: 500;
}

.embed-row__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.78rem;
}

.embed-row__pct {
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.72rem;
}

.text-ok      { color: var(--color-success); }
.text-partial { color: var(--color-amber-400); }
.text-zero    { color: var(--color-danger); }

.embed-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.embed-bar__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.embed-bar__fill--ok      { background: var(--color-success); }
.embed-bar__fill--partial { background: var(--color-amber-400); }
.embed-bar__fill--zero    { background: color-mix(in oklch, var(--color-danger) 30%, transparent); }

.embed-hint {
  margin: 4px 0 0;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.8;
  line-height: 1.4;
}

.embed-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.embed-badge--ok {
  color: var(--color-success);
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-success) 30%, transparent);
}
.embed-badge--pending {
  color: var(--color-amber-400);
  background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 25%, transparent);
}

.entity-desc {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  margin: 3px 0;
  line-height: 1.4;
}

/* ── Triple toolbar ── */
/* triple section 无独立限高，由外层 panel scroll */
.triple-toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 0; border-bottom: 1px solid var(--color-border, #2a2a3a); margin-bottom: 6px;
}
.tb-label { display: flex; align-items: center; gap: 4px; font-size: 0.72rem; color: var(--color-text-secondary); }
.tb-select {
  padding: 3px 6px; font-size: 0.72rem;
  background: rgba(255,255,255,0.06); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: 4px;
}
.tb-input {
  padding: 3px 6px; font-size: 0.72rem; width: 120px;
  background: rgba(255,255,255,0.06); color: var(--color-text);
  border: 1px solid var(--color-border); border-radius: 4px;
}
.tb-input--sm { width: 60px; }
.tb-check { display: flex; align-items: center; gap: 4px; font-size: 0.72rem; color: var(--color-text-secondary); cursor: pointer; }
.tb-check input { accent-color: var(--color-primary); }

.triple-group { margin-bottom: 8px; }
.triple-group__header { font-size: 0.75rem; font-weight: 700; color: var(--color-primary); padding: 4px 8px; }

/* ── Triple rows ── */
.triple-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px;
  background: rgba(255,255,255,0.02); border-radius: 5px;
  font-size: 0.78rem;
}
.triple-ts { font-size: 0.65rem; color: var(--color-text-secondary); font-family: monospace; flex-shrink: 0; }
.triple-right { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.triple-subject { font-weight: 600; color: var(--color-primary, #6366f1); }
.triple-predicate { color: var(--color-text, #e0e0e6); font-style: italic; }
.triple-object { font-weight: 600; color: var(--color-success, #22c55e); }
.triple-imp {
  margin-left: auto; font-size: 0.62rem; font-weight: 700;
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}
.triple-imp--high { color: var(--color-danger); background: color-mix(in oklch, var(--color-danger) 10%, transparent); }
.triple-imp--mid  { color: var(--color-amber-400); background: color-mix(in oklch, var(--color-amber-400) 10%, transparent); }
.triple-imp--low  { color: var(--color-text-secondary); background: rgba(255,255,255,0.04); }
.triple-category {
  font-size: 0.62rem; padding: 1px 5px; border-radius: 3px;
  color: var(--color-sage-300); background: color-mix(in oklch, var(--color-sage-300) 10%, transparent); flex-shrink: 0;
}

/* ── Cytoscape graph ── */
.section-body--graph { }
.graph-subtitle { font-size: 0.72rem; color: var(--color-text-secondary); margin: 0; line-height: 1.4; }
.graph-card {
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 8px;
  padding: 10px; background: rgba(255,255,255,0.015);
}
.graph-card__header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 0.82rem; color: var(--color-text); }
.graph-card__title { font-size: 0.82rem; font-weight: 700; color: var(--color-text); margin-bottom: 8px; }
.graph-checkbox { display: flex; align-items: center; gap: 5px; font-size: 0.75rem; color: var(--color-text-secondary); cursor: pointer; }
.graph-checkbox input { accent-color: var(--color-primary); }
.cy-container { width: 100%; height: 420px; border: 1px solid var(--color-border, #2a2a3a); border-radius: 6px; background: rgba(0,0,0,0.2); }

/* ── Ming-style entity/relation list ── */
.list-section-header { font-size: 0.78rem; font-weight: 700; color: var(--color-text); margin: 10px 0 4px; padding: 0 4px; }
.ming-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; background: rgba(255,255,255,0.02); border-radius: 5px;
  font-size: 0.78rem;
}
.ming-type { font-weight: 700; font-size: 0.68rem; flex-shrink: 0; }
.ming-name { font-weight: 600; flex-shrink: 0; }
.ming-desc { color: var(--color-text-secondary); font-size: 0.72rem; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ming-from, .ming-to { font-weight: 600; color: var(--color-text); flex-shrink: 0; }
.ming-rel { font-size: 0.75rem; font-weight: 500; flex-shrink: 0; }
.btn-copy {
  padding: 2px 8px; font-size: 0.62rem; font-weight: 500;
  color: var(--color-text-secondary); background: rgba(255,255,255,0.04);
  border: 1px solid var(--color-border); border-radius: 4px;
  cursor: pointer; flex-shrink: 0; margin-left: auto;
}
.btn-copy:hover { color: var(--color-text); border-color: var(--color-primary); }

/* ── Architecture explanation ── */
.arch-body { gap: 8px !important; }
.arch-card {
  padding: 10px 12px;
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent); border: 1px solid color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  border-radius: 8px;
}
.arch-card__title {
  margin: 0 0 6px; font-size: 0.75rem; font-weight: 700;
  color: var(--color-primary, #6366f1);
}
.arch-flow {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 0.72rem;
}
.arch-step {
  padding: 3px 8px; border-radius: 5px; font-weight: 500;
  background: rgba(255,255,255,0.06); color: var(--color-text);
}
.arch-step--vec { background: color-mix(in oklch, var(--color-sage-400) 15%, transparent); color: var(--color-primary); border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent); }
.arch-step--triple { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); border: 1px solid color-mix(in oklch, var(--color-success) 30%, transparent); }
.arch-arrow { color: var(--color-text-secondary); font-size: 0.68rem; }
.arch-items { display: flex; flex-direction: column; gap: 3px; }
.arch-item { font-size: 0.72rem; color: var(--color-text-secondary); display: flex; align-items: center; gap: 6px; }
.arch-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.arch-dot--vec { background: var(--color-primary, #6366f1); }
.arch-dot--kw { background: var(--color-warning, #f59e0b); }
</style>
