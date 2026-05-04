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
import type { EngramRelation } from '@/engine/memory/engram/engram-types';
import type { EngramEdge } from '@/engine/memory/engram/knowledge-edge';
import Modal from '@/ui/components/common/Modal.vue';

const { isLoaded, get, setValue } = useGameState();
const debugStore = useEngramDebugStore();

// ─── 配置检查 ───

const engramConfig = computed(() => loadEngramConfig());
const debugEnabled = computed(() => engramConfig.value.debug);

// ─── Engram 状态读取 ───

interface EngramStateData {
  events?: EngramEventNode[];
  entities?: EngramEntity[];
  relations?: EngramRelation[];
  v2Edges?: EngramEdge[];
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
const v2Edges = computed(() => engramData.value.v2Edges ?? []);
const pendingEnrichCount = computed(() => entities.value.filter((e) => e._pendingEnrichment).length);

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
const embeddedEdgeCount = computed(
  () => v2Edges.value.filter((e) => e.is_embedded === true).length,
);
const edgeEmbedPct = computed(() =>
  v2Edges.value.length === 0 ? 0 : Math.round((embeddedEdgeCount.value / v2Edges.value.length) * 100),
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
  setValue(ENGRAM_PATH, { events: [], entities: [], relations: [], v2Edges: [], meta: { lastUpdated: Date.now(), eventCount: 0 } });
  debugStore.clear();
  showClearModal.value = false;
  clearStep.value = 1;
}

function rebuildEdges(): void {
  const data = get<EngramStateData>(ENGRAM_PATH);
  if (!data) return;
  // Clear v2Edges and reset schema → next round auto-rebuilds
  setValue(ENGRAM_PATH, {
    ...data,
    v2Edges: [],
    meta: { ...(data.meta ?? {}), schemaVersion: 4, lastUpdated: Date.now() },
  });
  alert('知识边已清空。下一轮 AI 回合将自动重新迁移。');
}

// ─── 导出 JSON ───

function exportJson(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    config: engramConfig.value,
    events: events.value,
    entities: entities.value,
    relations: relations.value,
    v2Edges: v2Edges.value,
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

// ─── Cytoscape Graphiti 知识图谱可视化 ───

import cytoscape from 'cytoscape';
import type { Core as CyCore, ElementDefinition, NodeSingular } from 'cytoscape';

const graphContainer = ref<HTMLDivElement | null>(null);
let cyInstance: CyCore | null = null;
const graphTooltip = ref<{ visible: boolean; html: string; x: number; y: number }>({ visible: false, html: '', x: 0, y: 0 });

// ── Filter state ──
const gfShowLabels = ref(true);
const gfNodeTypes = ref<Record<string, boolean>>({ player: true, npc: true, location: true, item: true, event: true });
const gfEdgeFact = ref(true);
const gfEdgeMentions = ref(true);
const gfEdgeInvalidated = ref(false);
const gfRoundMin = ref(0);
const gfRoundMax = ref(0);
const gfLayout = ref<'cose' | 'concentric' | 'breadthfirst' | 'circle'>('cose');

const maxRound = computed(() => {
  let m = 0;
  for (const ev of events.value) if ((ev.roundNumber ?? 0) > m) m = ev.roundNumber ?? 0;
  for (const e of v2Edges.value) if (e.lastSeenRound > m) m = e.lastSeenRound;
  return m;
});

watch(maxRound, (v) => { if (gfRoundMax.value === 0 || gfRoundMax.value < v) gfRoundMax.value = v; }, { immediate: true });

// Clamp min/max so they don't cross
watch(gfRoundMin, (v) => { if (v > gfRoundMax.value) gfRoundMax.value = v; });
watch(gfRoundMax, (v) => { if (v < gfRoundMin.value) gfRoundMin.value = v; });

import { buildGraphElements, filterVisibility, type GraphFilterState, type GraphElement } from '@/engine/memory/engram/engram-graph-builder';
let cachedGraphElements: GraphElement[] = [];
function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// @ts-expect-error cytoscape type package exports StylesheetCSS not Stylesheet
const CY_STYLES: cytoscape.Stylesheet[] = [
  { selector: 'node', style: {
    'background-color': 'data(bg)' as unknown as string, 'label': 'data(label)',
    'shape': 'data(shape)' as unknown as string,
    'width': 'data(w)' as unknown as number, 'height': 'data(h)' as unknown as number,
    'color': '#d4cfc5', 'font-size': '11px', 'font-weight': 500,
    'text-valign': 'center', 'text-halign': 'center',
    'border-width': 1, 'border-color': 'rgba(255,255,255,0.12)',
    'text-outline-width': 2, 'text-outline-color': '#1a1917',
  }},
  { selector: 'node[nodeCategory="player"]', style: {
    'border-width': 2.5, 'border-color': 'rgba(138,158,108,0.5)', 'font-weight': 700, 'font-size': '13px',
  }},
  { selector: 'node[nodeCategory="event"]', style: {
    'font-size': '8px', 'color': 'rgba(255,255,255,0.5)', 'border-width': 0, 'background-opacity': 0.6,
    'text-valign': 'bottom' as never, 'text-margin-y': 4,
  }},
  { selector: 'node[nodeCategory="location"]', style: { 'font-size': '9px' }},
  { selector: 'node[nodeCategory="item"]', style: { 'font-size': '9px' }},
  { selector: 'edge[edgeCategory="fact"]', style: {
    'width': 1.8, 'line-color': 'rgba(255,255,255,0.25)',
    'target-arrow-color': 'rgba(255,255,255,0.35)', 'target-arrow-shape': 'triangle',
    'arrow-scale': 0.7, 'curve-style': 'bezier',
    'label': 'data(label)', 'font-size': '8px', 'color': 'rgba(255,255,255,0.35)',
    'text-rotation': 'autorotate', 'text-outline-width': 1.5, 'text-outline-color': '#1a1917',
  }},
  { selector: 'edge[edgeCategory="invalidated"]', style: {
    'width': 1, 'line-color': 'rgba(223,107,107,0.25)', 'line-style': 'dashed',
    'target-arrow-color': 'rgba(223,107,107,0.25)', 'target-arrow-shape': 'triangle',
    'arrow-scale': 0.5, 'curve-style': 'bezier',
  }},
  { selector: 'edge[edgeCategory="mentions"]', style: {
    'width': 0.8, 'line-color': 'rgba(91,141,239,0.2)', 'line-style': 'dashed',
    'target-arrow-shape': 'none', 'curve-style': 'bezier',
  }},
];

function getLayoutOpts(): cytoscape.LayoutOptions {
  const base = { animate: true, animationDuration: 500, padding: 40 };
  if (gfLayout.value === 'cose') {
    return { ...base, name: 'cose', nodeRepulsion: () => 8000, idealEdgeLength: () => 140, gravity: 0.25, numIter: 300 } as cytoscape.LayoutOptions;
  }
  if (gfLayout.value === 'concentric') {
    return { ...base, name: 'concentric',
      concentric: (n: NodeSingular) => {
        const cat = n.data('nodeCategory');
        return cat === 'player' ? 3 : cat === 'npc' ? 2 : cat === 'event' ? 0 : 1;
      },
      levelWidth: () => 1,
    } as cytoscape.LayoutOptions;
  }
  return { ...base, name: gfLayout.value } as cytoscape.LayoutOptions;
}

function initGraph(): void {
  if (!graphContainer.value) { console.debug('[EngramGraph] no container ref'); return; }
  const rect = graphContainer.value.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) { console.debug('[EngramGraph] container has zero size', rect.width, rect.height); return; }
  destroyGraph();

  cachedGraphElements = buildGraphElements(entities.value, events.value, v2Edges.value);
  console.debug(`[EngramGraph] built ${cachedGraphElements.length} elements (${entities.value.length} entities, ${events.value.length} events, ${v2Edges.value.length} edges)`);
  if (cachedGraphElements.length === 0) return;
  const els = cachedGraphElements;

  cyInstance = cytoscape({
    container: graphContainer.value,
    elements: els as unknown as ElementDefinition[],
    style: CY_STYLES,
    layout: getLayoutOpts(),
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
    wheelSensitivity: 0.3,
    minZoom: 0.3,
    maxZoom: 3,
    textureOnViewport: true,
  });

  // ── Interactions ──
  cyInstance.on('tap', 'node', (evt) => highlightNeighborhood(evt.target));
  cyInstance.on('tap', (evt) => { if (evt.target === cyInstance) clearHighlight(); });

  cyInstance.on('mouseover', 'node', (evt) => {
    const d = evt.target.data();
    const e = evt.originalEvent as MouseEvent;
    if (d.nodeCategory === 'event') {
      graphTooltip.value = { visible: true, x: e.clientX, y: e.clientY,
        html: `<div class="gtt-type">事件 · 第${d.roundNumber}轮</div><div class="gtt-title">${esc(d.fullLabel)}</div><div class="gtt-body">${esc(d.summary)}</div><div class="gtt-meta">提及: ${(d.mentionedEntities||[]).map(esc).join(', ')}</div>` };
    } else {
      const typeMap: Record<string, string> = { player: '玩家', npc: 'NPC', location: '地点', item: '物品' };
      graphTooltip.value = { visible: true, x: e.clientX, y: e.clientY,
        html: `<div class="gtt-type">${typeMap[d.nodeCategory]||esc(d.nodeCategory)}</div><div class="gtt-title">${esc(d.fullLabel)}</div><div class="gtt-body">${esc(d.summary||'')}</div><div class="gtt-meta">提及${d.mentionCount}次 · 第${d.firstSeen}轮—第${d.lastSeen}轮 · ${d.embedded?'✓ 已向量化':'○ 未向量化'}</div>` };
    }
  });
  cyInstance.on('mouseover', 'edge', (evt) => {
    const d = evt.target.data();
    const e = evt.originalEvent as MouseEvent;
    if (d.edgeCategory === 'mentions') {
      graphTooltip.value = { visible: true, x: e.clientX, y: e.clientY, html: `<div class="gtt-type">MENTIONS</div><div class="gtt-meta">事件提及此实体</div>` };
    } else {
      const status = d.invalidatedAtRound ? `<span style="color:#df6b6b;">已失效（第${d.invalidatedAtRound}轮）</span>` : '有效';
      graphTooltip.value = { visible: true, x: e.clientX, y: e.clientY,
        html: `<div class="gtt-type">事实边 · ${status}</div><div class="gtt-fact">${esc(d.fullFact)}</div><div class="gtt-meta">出现${d.episodes}轮 · 第${d.createdAtRound}轮创建 · ${d.embedded?'✓ 已向量化':'○ 未向量化'}</div>` };
    }
  });
  cyInstance.on('mouseout', () => { graphTooltip.value.visible = false; });
  cyInstance.on('mousemove', (evt) => {
    if (!graphTooltip.value.visible) return;
    const e = evt.originalEvent as MouseEvent;
    graphTooltip.value.x = e.clientX;
    graphTooltip.value.y = e.clientY;
  });

  applyGraphFilters();
}

function applyGraphFilters(): void {
  if (!cyInstance) return;
  const filterState: GraphFilterState = {
    roundMin: gfRoundMin.value,
    roundMax: gfRoundMax.value,
    nodeTypes: gfNodeTypes.value,
    showFactEdges: gfEdgeFact.value,
    showMentions: gfEdgeMentions.value,
    showInvalidated: gfEdgeInvalidated.value,
  };

  const vis = filterVisibility(cachedGraphElements, filterState);

  cyInstance.batch(() => {
    cyInstance!.elements().forEach((el) => {
      const show = vis.get(el.id()) ?? false;
      el.style('display', show ? 'element' : 'none');
    });
  });

  if (!gfShowLabels.value) {
    cyInstance.edges('[edgeCategory="fact"]').style('label', '');
  } else {
    cyInstance.edges('[edgeCategory="fact"]').style('label', 'data(label)');
  }
}

let highlightActive = false;
function highlightNeighborhood(node: NodeSingular): void {
  if (!cyInstance) return;
  highlightActive = true;
  cyInstance.batch(() => {
    cyInstance!.elements().style('opacity', 0.12);
    const hood = node.neighborhood().add(node);
    hood.style('opacity', 1);
    if (node.data('nodeCategory') !== 'event') {
      hood.neighborhood().style('opacity', 0.6);
    }
  });
}
function clearHighlight(): void {
  if (!cyInstance || !highlightActive) return;
  highlightActive = false;
  cyInstance.batch(() => { cyInstance!.elements().style('opacity', 1); });
}

function destroyGraph(): void { if (cyInstance) { cyInstance.destroy(); cyInstance = null; } }
function runGraphLayout(): void { if (cyInstance) cyInstance.layout(getLayoutOpts()).run(); }

// ── Watchers ──
watch(graphContainer, (el) => { if (el && !cyInstance) setTimeout(() => initGraph(), 50); });
watch([entities, v2Edges, events], () => {
  if (isOpenExt('graph') && graphContainer.value) nextTick(() => initGraph());
});
watch([gfNodeTypes, gfEdgeFact, gfEdgeMentions, gfEdgeInvalidated, gfRoundMin, gfRoundMax, gfShowLabels], () => applyGraphFilters(), { deep: true });

// ─── 新增 section 折叠 ───

type SectionKeyExt = SectionKey | 'graph' | 'architecture';

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
        <button class="btn-sm" :disabled="v2Edges.length === 0" @click="rebuildEdges">重建事实边</button>
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
          <span class="stat-label">实体<span v-if="pendingEnrichCount > 0" class="stat-pending"> ({{ pendingEnrichCount }} 待补全)</span></span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ relations.length }}</span>
          <span class="stat-label">关系</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color: var(--color-success, #22c55e);">{{ v2Edges.length }}</span>
          <span class="stat-label">事实边</span>
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
        <div v-if="v2Edges.length > 0" class="embed-row">
          <div class="embed-row__header">
            <span class="embed-row__title">事实边向量化</span>
            <span class="embed-row__meta">
              <strong :class="edgeEmbedPct === 100 ? 'text-ok' : edgeEmbedPct > 0 ? 'text-partial' : 'text-zero'">
                {{ embeddedEdgeCount }} / {{ v2Edges.length }}
              </strong>
              <span class="embed-row__pct">{{ edgeEmbedPct }}%</span>
            </span>
          </div>
          <div class="embed-bar">
            <div
              class="embed-bar__fill"
              :class="edgeEmbedPct === 100 ? 'embed-bar__fill--ok' : edgeEmbedPct > 0 ? 'embed-bar__fill--partial' : 'embed-bar__fill--zero'"
              :style="{ width: edgeEmbedPct + '%' }"
            />
          </div>
        </div>
        <p v-if="eventEmbedPct < 100 || entityEmbedPct < 100 || edgeEmbedPct < 100" class="embed-hint">
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
                  <span class="event-sao">
                    <strong>{{ ev.subject }}</strong>
                    <span class="sao-sep">→</span>{{ ev.action }}
                    <template v-if="ev.object"><span class="sao-sep">→</span><strong>{{ ev.object }}</strong></template>
                  </span>
                  <span
                    :class="['embed-badge', ev.is_embedded ? 'embed-badge--ok' : 'embed-badge--pending']"
                    :title="ev.is_embedded ? '已向量化' : '尚未向量化'"
                  >{{ ev.is_embedded ? '✓' : '○' }}</span>
                </div>
                <p class="event-text">{{ ev.text }}</p>
                <div class="item-meta">
                  <span v-if="ev.roundNumber != null">第{{ ev.roundNumber }}轮</span>
                  <span v-if="ev.tags?.length">{{ ev.tags.join(' · ') }}</span>
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
                <span v-if="ent._pendingEnrichment" class="enrich-badge" title="Tier 1 桩实体，等待 AI 补全描述">待补全</span>
                <span
                  :class="['embed-badge', ent.is_embedded ? 'embed-badge--ok' : 'embed-badge--pending']"
                  :title="ent.is_embedded ? '已向量化' : '尚未向量化'"
                >{{ ent.is_embedded ? '✓' : '○' }}</span>
              </div>
              <div v-if="ent.summary" class="entity-desc">{{ ent.summary }}</div>
              <div class="item-meta">
                <span>提及{{ ent.mentionCount }}次</span>
                <span>第{{ ent.firstSeen }}轮首次出现</span>
                <span>第{{ ent.lastSeen }}轮最后出现</span>
              </div>
            </div>
          </div>
        </Transition>
      </section>

      <!-- ─── 关系/知识边列表 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSection('relations')">
          <span class="section-title">事实边</span>
          <span class="section-badge">{{ v2Edges.length }}</span>
          <svg :class="['chevron', { 'chevron--open': isOpen('relations') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpen('relations')" class="section-body">
            <div v-if="v2Edges.length === 0" class="empty-hint">暂无事实边 — 请运行几轮游戏</div>
            <template v-else>
              <div v-for="edge in v2Edges" :key="edge.id" class="relation-row" :class="{ 'relation-row--invalidated': (edge.invalidAtRound ?? edge.invalidatedAtRound) != null }">
                <div class="edge-header">
                  <span class="rel-from">{{ edge.sourceEntity }}</span>
                  <span class="rel-arrow">→</span>
                  <span class="rel-to">{{ edge.targetEntity }}</span>
                  <span
                    :class="['embed-badge', edge.is_embedded ? 'embed-badge--ok' : 'embed-badge--pending']"
                    :title="edge.is_embedded ? '已向量化' : '尚未向量化'"
                  >{{ edge.is_embedded ? '✓' : '○' }}</span>
                  <span v-if="(edge.invalidAtRound ?? edge.invalidatedAtRound) != null" class="rel-invalidated">已不再成立</span>
                </div>
                <div class="rel-fact" :title="edge.fact">{{ edge.fact }}</div>
                <div class="item-meta">
                  <span>出现{{ edge.episodes.length }}轮</span>
                  <span>第{{ edge.createdAtRound }}轮创建</span>
                  <span>第{{ edge.lastSeenRound }}轮最后出现</span>
                  <span v-if="(edge.invalidAtRound ?? edge.invalidatedAtRound) != null">第{{ edge.invalidAtRound ?? edge.invalidatedAtRound }}轮失效</span>
                </div>
              </div>
            </template>
          </div>
        </Transition>
      </section>

      <!-- ─── Graphiti 知识图谱 ─── -->
      <section class="debug-section">
        <button class="section-header" @click="toggleSectionExt('graph')">
          <span class="section-title">知识图谱</span>
          <svg :class="['chevron', { 'chevron--open': isOpenExt('graph') }]" viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>

        <Transition name="section-expand">
          <div v-if="isOpenExt('graph')" class="section-body section-body--graph">

            <!-- Filter bar -->
            <div class="gf-bar">
              <div class="gf-group gf-group--round-range">
                <span class="gf-label">回合</span>
                <input type="range" class="gf-range" min="0" :max="maxRound" v-model.number="gfRoundMin" title="起始回合" />
                <span class="gf-val">{{ gfRoundMin }} – {{ gfRoundMax }}</span>
                <input type="range" class="gf-range" min="0" :max="maxRound" v-model.number="gfRoundMax" title="结束回合" />
              </div>
              <span class="gf-sep" />
              <div class="gf-group">
                <span class="gf-label">节点</span>
                <button v-for="(on, key) in gfNodeTypes" :key="key"
                  :class="['gf-toggle', { 'gf-toggle--on': on }]"
                  @click="gfNodeTypes[key] = !gfNodeTypes[key]"
                >{{ { player:'玩家',npc:'NPC',location:'地点',item:'物品',event:'事件' }[key] }}</button>
              </div>
              <span class="gf-sep" />
              <div class="gf-group">
                <span class="gf-label">连线</span>
                <button :class="['gf-toggle', { 'gf-toggle--on': gfEdgeFact }]" @click="gfEdgeFact = !gfEdgeFact">事实边</button>
                <button :class="['gf-toggle', { 'gf-toggle--on': gfEdgeMentions }]" @click="gfEdgeMentions = !gfEdgeMentions">MENTIONS</button>
                <button :class="['gf-toggle', { 'gf-toggle--on': gfEdgeInvalidated }]" @click="gfEdgeInvalidated = !gfEdgeInvalidated">失效边</button>
              </div>
              <span class="gf-sep" />
              <div class="gf-group">
                <label class="gf-toggle gf-toggle--on" style="cursor:pointer;">
                  <input type="checkbox" v-model="gfShowLabels" style="display:none;" />
                  标签{{ gfShowLabels ? '开' : '关' }}
                </label>
                <select class="gf-select" v-model="gfLayout" @change="runGraphLayout()">
                  <option value="cose">力导向</option>
                  <option value="concentric">同心圆</option>
                  <option value="breadthfirst">层级</option>
                  <option value="circle">环形</option>
                </select>
                <button class="btn-sm" @click="runGraphLayout()">重排</button>
              </div>
            </div>

            <!-- Graph -->
            <div class="graph-card">
              <div v-if="entities.length === 0 && events.length === 0" class="empty-hint" style="padding:40px;">暂无数据</div>
              <div v-else ref="graphContainer" class="cy-container" />
            </div>

            <!-- Tooltip (positioned fixed via portal) -->
            <div
              v-if="graphTooltip.visible"
              class="graph-tooltip"
              :style="{ left: (graphTooltip.x + 12) + 'px', top: (graphTooltip.y + 12) + 'px' }"
              v-html="graphTooltip.html"
            />
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
                <span class="arch-step">事实边构建</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step arch-step--vec">向量化（事件+实体+边）</span>
              </div>
              <div class="arch-flow" style="margin-top: 6px;">
                <span class="arch-step">AI 回复</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step arch-step--triple">事实边提取</span>
                <span class="arch-arrow">→</span>
                <span class="arch-step">去重追加</span>
              </div>
            </div>
            <div class="arch-card">
              <h4 class="arch-card__title">向量化范围</h4>
              <div class="arch-items">
                <div class="arch-item"><span class="arch-dot arch-dot--vec"></span>事件 summary（burned 格式）</div>
                <div class="arch-item"><span class="arch-dot arch-dot--vec"></span>实体 name + summary</div>
                <div class="arch-item"><span class="arch-dot arch-dot--vec"></span>事实边 fact（完整句子）</div>
              </div>
            </div>
            <div class="arch-card">
              <h4 class="arch-card__title">检索通道</h4>
              <div class="arch-items">
                <div class="arch-item">1. Edge scope: Cosine + BM25 + BFS → RRF</div>
                <div class="arch-item">2. Entity scope: Cosine + BM25 → RRF</div>
                <div class="arch-item">3. Event scope: Cosine + BM25 → RRF</div>
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
  grid-template-columns: repeat(4, 1fr);
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
.enrich-badge {
  font-size: 0.62rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in oklch, var(--color-amber-400) 15%, transparent);
  color: var(--color-amber-400);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 30%, transparent);
  font-weight: 600;
}
.stat-pending { color: var(--color-amber-400); font-size: 0.68rem; }
.item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.68rem;
  color: var(--color-text-secondary, #8888a0);
  margin-top: 2px;
}
.edge-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* ── Relation rows ── */
.relation-row {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.02); border-radius: 5px;
}
.rel-from, .rel-to { font-weight: 600; color: var(--color-text,#e0e0e6); font-size: 0.82rem; }
.rel-arrow { font-family: monospace; color: var(--color-text-secondary,#8888a0); font-size: 0.72rem; }
.rel-fact { font-size: 0.78rem; color: var(--color-text, #e0e0e6); line-height: 1.4; }
.relation-row--invalidated { opacity: 0.4; }
.relation-row--invalidated .rel-fact { text-decoration: line-through; }
.rel-invalidated { font-size: 0.62rem; font-weight: 600; padding: 1px 5px; border-radius: 3px; color: var(--color-danger); background: color-mix(in oklch, var(--color-danger) 10%, transparent); margin-left: 4px; text-decoration: none; }

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
.score-source--edge   { color: var(--color-sage-400); background: color-mix(in oklch, var(--color-sage-400) 10%, transparent); }
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

.triple-right { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }

/* ── Graph filter bar ── */
.gf-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 10px; border-radius: 6px;
  background: rgba(255,255,255,0.02); border: 1px solid var(--color-border, #2a2a3a);
  margin-bottom: 8px;
}
.gf-group { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--color-text-secondary,#8888a0); }
.gf-label { font-weight: 600; margin-right: 2px; }
.gf-sep { width: 1px; height: 18px; background: var(--color-border, #2a2a3a); flex-shrink: 0; }
.gf-toggle {
  padding: 2px 7px; border-radius: 4px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--color-border, #2a2a3a); background: transparent; color: var(--color-text-secondary,#8888a0);
  transition: all 0.15s; user-select: none;
}
.gf-toggle:hover { border-color: var(--color-sage-400); }
.gf-toggle--on { border-color: var(--color-sage-400); background: rgba(138,158,108,0.15); color: var(--color-text, #e0e0e6); }
.gf-range { width: 80px; accent-color: var(--color-sage-400); cursor: pointer; }
.gf-group--round-range .gf-range { width: 64px; }
.gf-val { font-family: 'JetBrains Mono',monospace; font-size: 11px; min-width: 24px; color: var(--color-text); }
.gf-group--round-range .gf-val { min-width: 48px; text-align: center; }
.gf-select {
  background: var(--color-surface, #232220); color: var(--color-text); border: 1px solid var(--color-border);
  border-radius: 4px; padding: 3px 6px; font-size: 11px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a8580'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 5px center; padding-right: 18px;
}
.gf-select:focus { border-color: var(--color-sage-400, #8a9e6c); outline: none; }
.gf-select option { background: var(--color-surface, #232220); color: var(--color-text, #d4cfc5); }

/* ── Graph card + container ── */
.graph-card {
  border: 1px solid var(--color-border, #2a2a3a); border-radius: 8px;
  padding: 0; background: rgba(0,0,0,0.15); overflow: hidden;
}
.cy-container { width: 100%; height: 480px; }

/* ── Graph tooltip ── */
.graph-tooltip {
  position: fixed; max-width: 340px; padding: 10px 14px;
  background: rgba(30,29,26,0.95); border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px; font-size: 12px; line-height: 1.5; color: var(--color-text);
  z-index: 100; pointer-events: none; backdrop-filter: blur(8px);
}
:deep(.gtt-type) { font-size: 10px; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
:deep(.gtt-title) { font-weight: 600; margin-top: 2px; }
:deep(.gtt-body) { font-size: 11px; color: var(--color-text-secondary); margin-top: 4px; }
:deep(.gtt-meta) { font-size: 11px; color: var(--color-text-secondary); margin-top: 4px; opacity: 0.7; }
:deep(.gtt-fact) { font-style: italic; color: var(--color-amber-400); margin-top: 4px; }

/* ── Ming-style entity/relation list (kept for architecture section) ── */
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
