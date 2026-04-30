<script setup lang="ts">
/**
 * EngramRoundViewer — per-round Engram visualization showing write path
 * (what was extracted) and read path (what was recalled and why).
 *
 * Core design: every recalled candidate shows a stacked score bar with
 * color-coded components so users can see at a glance WHY a memory was
 * chosen (or rejected).
 */
import { computed, ref } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import type {
  EngramWriteSnapshot,
  EngramReadSnapshot,
  ScoredCandidateTrace,
  ScoredComponent,
} from '@/engine/memory/engram/engram-types';

interface Props {
  modelValue: boolean;
  write?: EngramWriteSnapshot | null;
  read?: EngramReadSnapshot | null;
  roundNumber?: number;
}

const props = withDefaults(defineProps<Props>(), {
  write: null,
  read: null,
  roundNumber: 0,
});

defineEmits<{ 'update:modelValue': [value: boolean] }>();

const expandedInjected = ref<number | null>(null);
const expandedFiltered = ref<number | null>(null);
const showFiltered = ref(false);

function toggleInjected(idx: number): void {
  expandedInjected.value = expandedInjected.value === idx ? null : idx;
  expandedFiltered.value = null;
}

function toggleFiltered(idx: number): void {
  expandedFiltered.value = expandedFiltered.value === idx ? null : idx;
  expandedInjected.value = null;
}

const title = computed(() =>
  props.roundNumber > 0
    ? `Engram · 第 ${props.roundNumber} 回合`
    : 'Engram 详情',
);

const injectedCandidates = computed(() =>
  (props.read?.candidates ?? []).filter((c) => c.outcome === 'injected'),
);

const filteredCandidates = computed(() =>
  (props.read?.candidates ?? []).filter((c) => c.outcome !== 'injected'),
);

const componentColorMap: Record<ScoredComponent['color'], string> = {
  blue: '#5b8def',
  green: '#5bba6f',
  orange: 'var(--color-amber-400)',
  purple: '#a87bdf',
  red: '#df6b6b',
  gray: '#8a8a8a',
};

function barFillWidth(c: ScoredCandidateTrace): string {
  return `${Math.min(c.finalScore * 100, 100)}%`;
}

function sourceLabel(s: ScoredCandidateTrace['source']): string {
  const map: Record<string, string> = {
    'edge': '事实边',
    'entity': '实体',
    'event': '事件',
  };
  return map[s] ?? s;
}

function outcomeLabel(o: ScoredCandidateTrace['outcome']): string {
  const map: Record<string, string> = {
    'injected': '已注入',
    'filtered-by-topK': 'topK 截断',
    'filtered-by-rerank': '重排淘汰',
    'filtered-as-redundant': '去重淘汰',
  };
  return map[o] ?? o;
}

function fmtScore(n: number): string {
  return n.toFixed(3);
}

</script>

<template>
  <Modal
    :model-value="props.modelValue"
    :title="title"
    width="720px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="erv">
      <!-- ═══ WRITE PATH ═══ -->
      <section v-if="props.write" class="erv__section">
        <h3 class="erv__heading erv__heading--write">写入</h3>

        <!-- Event -->
        <div v-if="props.write.event" class="erv__card">
          <div class="erv__card-label">事件提取</div>
          <div class="erv__card-title">{{ props.write.event.title || '(无标题)' }}</div>
          <div class="erv__card-meta">
            <span v-if="props.write.event.roles.length">角色: {{ props.write.event.roles.join(', ') }}</span>
            <span v-if="props.write.event.location.length">地点: {{ props.write.event.location.join(', ') }}</span>
            <span v-if="props.write.event.timeAnchor">时间: {{ props.write.event.timeAnchor }}</span>
          </div>
        </div>

        <!-- Entity deltas -->
        <div v-if="props.write.entities.deltas.length > 0" class="erv__card">
          <div class="erv__card-label">实体变化 <span class="erv__muted">({{ props.write.entities.total }} 总计)</span></div>
          <div v-for="d in props.write.entities.deltas" :key="d.name" class="erv__delta-row">
            <span class="erv__delta-badge" :class="d.isNew ? 'erv__delta-badge--new' : 'erv__delta-badge--update'">
              {{ d.isNew ? '+' : '↻' }}
            </span>
            <span class="erv__delta-name">{{ d.name }}</span>
            <span class="erv__muted">({{ d.type }}{{ d.descriptionUpdated ? ' · 描述更新' : '' }})</span>
          </div>
        </div>

        <!-- 事实边变化 -->
        <div v-if="props.write.edges" class="erv__card">
          <div class="erv__card-label">事实边变化 <span class="erv__muted">({{ props.write.edges.total }} 总计 · +{{ props.write.edges.newCount }} 新 · ↻{{ props.write.edges.reinforcedCount }} 加固)</span></div>
          <div v-for="e in props.write.edges.topNew" :key="`${e.sourceEntity}→${e.targetEntity}`" class="erv__delta-row">
            <span class="erv__delta-badge erv__delta-badge--new">+</span>
            <span>{{ e.sourceEntity }} → {{ e.targetEntity }}</span>
            <span class="erv__muted">{{ e.fact.length > 30 ? e.fact.slice(0, 30) + '…' : e.fact }}</span>
            <span class="erv__muted">({{ e.episodeCount }}ep)</span>
          </div>
        </div>

        <!-- Trim + vectorize summary -->
        <div class="erv__summary-row">
          <span v-if="props.write.trimmed.eventsBefore !== props.write.trimmed.eventsAfter">
            事件修剪 {{ props.write.trimmed.eventsBefore }} → {{ props.write.trimmed.eventsAfter }}
          </span>
          <span v-if="props.write.edges?.prunedCount">边修剪 {{ props.write.edges.prunedCount }} 条</span>
          <span v-if="props.write.vectorizeQueued > 0">排队向量化 {{ props.write.vectorizeQueued }} 条</span>
          <span class="erv__muted">{{ props.write.totalDurationMs.toFixed(0) }}ms</span>
        </div>
      </section>

      <!-- ═══ WRITE PATH — Review Result ═══ -->
      <section v-if="props.write?.reviewResult" class="erv__section">
        <h3 class="erv__heading erv__heading--review">知识边审查</h3>
        <div class="erv__card">
          <div class="erv__card-label">审查结果</div>
          <div class="erv__review-stats">
            <span>审查 {{ props.write.reviewResult.reviewed }} 条</span>
            <span class="erv__review-invalidated">已不再成立 {{ props.write.reviewResult.invalidated }} 条</span>
            <span>保留 {{ props.write.reviewResult.kept }} 条</span>
          </div>
        </div>
        <template v-if="props.write.reviewResult.invalidatedEdges?.length">
          <div v-for="ie in props.write.reviewResult.invalidatedEdges" :key="ie.edgeId" class="erv__review-detail erv__review-detail--invalidated">
            <span class="erv__review-badge erv__review-badge--invalidated">已不再成立</span>
            <span class="erv__review-fact">{{ ie.fact }}</span>
            <span v-if="ie.reason" class="erv__review-reason">{{ ie.reason }}</span>
          </div>
        </template>
        <template v-if="props.write.reviewResult.keptEdges?.length">
          <div v-for="ke in props.write.reviewResult.keptEdges" :key="ke.edgeId" class="erv__review-detail erv__review-detail--kept">
            <span class="erv__review-badge erv__review-badge--kept">保留</span>
            <span class="erv__review-fact">{{ ke.fact }}</span>
            <span v-if="ke.reason" class="erv__review-reason">{{ ke.reason }}</span>
          </div>
        </template>
      </section>

      <!-- ═══ READ PATH ═══ -->
      <section v-if="props.read" class="erv__section">
        <h3 class="erv__heading erv__heading--read">召回</h3>

        <!-- Pipeline summary -->
          <div class="erv__pipeline-bar">
            <span class="erv__pipeline-query">查询: "{{ props.read.query.length > 60 ? props.read.query.slice(0, 60) + '…' : props.read.query }}"</span>
            <div class="erv__pipeline-stats">
              <span title="事件语义命中">事件{{ props.read.pipeline.vectorEventCount }}</span>
              <span title="实体语义命中">实体{{ props.read.pipeline.vectorEntityCount }}</span>
              <span title="事实候选">事实{{ props.read.pipeline.graphCount }}</span>
              <span class="erv__pipeline-arrow">→</span>
              <span title="融合后候选">融合{{ props.read.pipeline.afterMerge }}</span>
              <span v-if="props.read.config.rerankEnabled" class="erv__pipeline-arrow">→</span>
              <span v-if="props.read.config.rerankEnabled" title="精排后">精排{{ props.read.pipeline.afterRerank }}</span>
              <span class="erv__pipeline-arrow">→</span>
              <span class="erv__pipeline-injected" title="最终注入数">注入{{ props.read.pipeline.injectedCount }}</span>
              <span class="erv__muted">{{ props.read.totalDurationMs.toFixed(0) }}ms</span>
            </div>
          </div>

        <!-- Config context -->
        <div class="erv__config-row">
          向量{{ props.read.config.embeddingEnabled ? '开' : '关' }} · 阈值 {{ fmtScore(props.read.config.minScore) }} · 候选 {{ props.read.config.maxCandidates }}（边{{ props.read.config.edgeBudget }}/实体{{ props.read.config.entityBudget }}/事件{{ props.read.config.eventBudget }}）
          <span v-if="props.read.config.rerankEnabled"> · 精排 topN {{ props.read.config.rerankTopN }}</span>
        </div>

        <!-- Injected candidates -->
        <div
          v-for="(c, idx) in injectedCandidates"
          :key="'inj-' + idx"
          class="erv__candidate"
          :class="{ 'erv__candidate--expanded': expandedInjected === idx }"
          role="button"
          tabindex="0"
          :aria-expanded="expandedInjected === idx"
          @click="toggleInjected(idx)"
          @keydown.enter.prevent="toggleInjected(idx)"
          @keydown.space.prevent="toggleInjected(idx)"
        >
          <!-- Score bar: outer track (full width) → inner fill (proportional to finalScore) → segments (proportional to contribution) -->
          <div class="erv__bar-container">
            <div class="erv__bar-track">
              <div class="erv__bar-fill" :style="{ width: barFillWidth(c) }">
                <div
                  v-for="(comp, ci) in c.components"
                  :key="ci"
                  class="erv__bar-segment"
                  :style="{ flex: `${comp.contribution} 0 0%`, backgroundColor: componentColorMap[comp.color] }"
                  :title="`${comp.label}: ${fmtScore(comp.rawValue)} × ${fmtScore(comp.weight)} = ${fmtScore(comp.contribution)}`"
                />
              </div>
            </div>
            <span class="erv__bar-score">{{ fmtScore(c.finalScore) }}</span>
          </div>

          <!-- Text + source tag -->
          <div class="erv__candidate-text">{{ c.text }}</div>
          <div class="erv__candidate-tags">
            <span class="erv__tag" :class="'erv__tag--' + c.source">{{ sourceLabel(c.source) }}</span>
            <span v-if="c.roundNumber != null" class="erv__muted">R{{ c.roundNumber }}</span>
            <span v-if="c.rerankBlendedScore != null" class="erv__muted">rerank {{ fmtScore(c.rerankBlendedScore) }}</span>
          </div>

          <!-- Expanded detail card -->
          <div v-if="expandedInjected === idx" class="erv__detail" @click.stop>
            <div class="erv__detail-title">评分分解</div>
            <div v-for="(comp, ci) in c.components" :key="'d-' + ci" class="erv__detail-row">
              <span class="erv__detail-swatch" :style="{ backgroundColor: componentColorMap[comp.color] }" />
              <span class="erv__detail-label">{{ comp.label }}</span>
              <span class="erv__detail-formula">{{ fmtScore(comp.rawValue) }} × {{ fmtScore(comp.weight) }}</span>
              <span class="erv__detail-value">= {{ fmtScore(comp.contribution) }}</span>
            </div>
            <div v-if="c.preRerankScore != null" class="erv__detail-section">
              <div class="erv__detail-title">重排</div>
              <div class="erv__detail-row">
                <span class="erv__detail-label">重排前</span>
                <span class="erv__detail-value">{{ fmtScore(c.preRerankScore) }}</span>
              </div>
              <div class="erv__detail-row">
                <span class="erv__detail-label">重排后</span>
                <span class="erv__detail-value">{{ fmtScore(c.finalScore) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Filtered (collapsed by default) -->
        <div v-if="filteredCandidates.length > 0" class="erv__filtered-toggle">
          <button class="erv__filtered-btn" @click.stop="showFiltered = !showFiltered">
            {{ showFiltered ? '收起' : '展开' }} 被淘汰 ({{ filteredCandidates.length }})
          </button>
        </div>
        <template v-if="showFiltered">
          <div
            v-for="(c, idx) in filteredCandidates"
            :key="'fil-' + idx"
            class="erv__candidate erv__candidate--filtered"
            role="button"
            tabindex="0"
            :aria-expanded="expandedFiltered === idx"
            @click="toggleFiltered(idx)"
            @keydown.enter.prevent="toggleFiltered(idx)"
            @keydown.space.prevent="toggleFiltered(idx)"
          >
            <div class="erv__bar-container">
              <div class="erv__bar-track">
                <div class="erv__bar-fill erv__bar-fill--filtered" :style="{ width: barFillWidth(c) }">
                  <div
                    v-for="(comp, ci) in c.components"
                    :key="ci"
                    class="erv__bar-segment"
                    :style="{ flex: `${comp.contribution} 0 0%`, backgroundColor: componentColorMap[comp.color], opacity: 0.5 }"
                  />
                </div>
              </div>
              <span class="erv__bar-score">{{ fmtScore(c.finalScore) }}</span>
            </div>
            <div class="erv__candidate-text erv__candidate-text--filtered">{{ c.text }}</div>
            <div class="erv__candidate-tags">
              <span class="erv__tag erv__tag--filtered">{{ outcomeLabel(c.outcome) }}</span>
              <span class="erv__tag" :class="'erv__tag--' + c.source">{{ sourceLabel(c.source) }}</span>
            </div>
            <div v-if="expandedFiltered === idx" class="erv__detail" @click.stop>
              <div class="erv__detail-title">评分分解</div>
              <div v-for="(comp, ci) in c.components" :key="'fd-' + ci" class="erv__detail-row">
                <span class="erv__detail-swatch" :style="{ backgroundColor: componentColorMap[comp.color] }" />
                <span class="erv__detail-label">{{ comp.label }}</span>
                <span class="erv__detail-formula">{{ fmtScore(comp.rawValue) }} × {{ fmtScore(comp.weight) }}</span>
                <span class="erv__detail-value">= {{ fmtScore(comp.contribution) }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Legend -->
        <div class="erv__legend">
          <span v-for="(color, label) in { '向量相似度': 'blue', '关键词命中': 'green', '时间衰减': 'orange', '角色命中': 'purple', '图权重': 'red' }" :key="label" class="erv__legend-item">
            <span class="erv__legend-swatch" :style="{ backgroundColor: componentColorMap[color as ScoredComponent['color']] }" />
            {{ label }}
          </span>
        </div>
      </section>

      <!-- Empty state -->
      <div v-if="!props.write && !props.read" class="erv__empty">
        本回合无 Engram 数据
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.erv {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  padding: var(--space-sm) 0;
}

.erv__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.erv__heading {
  font-family: var(--font-sans);
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  margin: 0;
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--color-border-subtle);
}

.erv__heading--write { color: var(--color-sage-400); }
.erv__heading--read { color: var(--color-amber-400); }

.erv__card {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-surface-elevated) 50%, transparent);
  border: 1px solid var(--color-border-subtle);
}

.erv__card-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-umber);
  margin-bottom: 4px;
}

.erv__card-title {
  font-family: var(--font-serif-cjk);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  margin-bottom: 4px;
}

.erv__card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  font-size: 11px;
  color: var(--color-text-umber);
}

.erv__delta-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 12px;
  padding: 2px 0;
}

.erv__delta-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.erv__delta-badge--new {
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  color: var(--color-sage-400);
}

.erv__delta-badge--update {
  background: color-mix(in oklch, var(--color-amber-400) 15%, transparent);
  color: var(--color-amber-400);
}

.erv__delta-name { font-weight: 500; }

.erv__summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: 11px;
  color: var(--color-text-umber);
  padding: var(--space-xs) 0;
}

.erv__muted {
  color: var(--color-text-umber);
  opacity: 0.65;
}

/* ── Pipeline bar ── */
.erv__pipeline-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-surface-elevated) 50%, transparent);
  border: 1px solid var(--color-border-subtle);
}

.erv__pipeline-query {
  font-size: 11px;
  color: var(--color-text-umber);
  font-style: italic;
}

.erv__pipeline-stats {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text);
}

.erv__pipeline-arrow {
  color: var(--color-text-umber);
  opacity: 0.5;
}

.erv__pipeline-injected {
  font-weight: 700;
  color: var(--color-sage-400);
}

.erv__config-row {
  font-size: 10px;
  color: var(--color-text-umber);
  opacity: 0.7;
}

/* ── Candidate rows ── */
.erv__candidate {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: border-color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}

.erv__candidate:hover {
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent);
}

.erv__candidate--expanded {
  border-color: color-mix(in oklch, var(--color-sage-400) 40%, var(--color-border));
}

.erv__candidate--filtered {
  opacity: 0.55;
}

.erv__candidate--filtered:hover { opacity: 0.8; }

/* ── Score bar ── */
.erv__bar-container {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: 4px;
}

.erv__bar-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: color-mix(in oklch, var(--color-text-umber) 10%, transparent);
  position: relative;
  overflow: hidden;
}

.erv__bar-fill {
  height: 100%;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
}

.erv__bar-fill--filtered { opacity: 0.5; }

.erv__bar-segment {
  height: 100%;
  min-width: 1px;
  transition: width 0.3s ease;
}

.erv__bar-score {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
  flex-shrink: 0;
  width: 40px;
  text-align: right;
}

.erv__candidate-text {
  font-size: 12px;
  color: var(--color-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
}

.erv__candidate-text--filtered { color: var(--color-text-umber); }

.erv__candidate-tags {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 10px;
}

.erv__tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.erv__tag--edge { background: color-mix(in oklch, var(--color-sage-400) 15%, transparent); color: var(--color-sage-400); }
.erv__tag--entity { background: color-mix(in oklch, #a87bdf 15%, transparent); color: #a87bdf; }
.erv__tag--event { background: color-mix(in oklch, #5b8def 15%, transparent); color: #5b8def; }
.erv__tag--filtered { background: color-mix(in oklch, var(--color-text-umber) 10%, transparent); color: var(--color-text-umber); }

/* ── Detail card ── */
.erv__detail {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  background: color-mix(in oklch, var(--color-surface) 80%, transparent);
  border: 1px solid var(--color-border-subtle);
}

.erv__detail-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-umber);
  margin-bottom: 4px;
}

.erv__detail-section { margin-top: var(--space-sm); }

.erv__detail-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 0;
}

.erv__detail-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.erv__detail-label {
  flex: 1;
  font-family: var(--font-sans);
  color: var(--color-text);
}

.erv__detail-formula {
  color: var(--color-text-umber);
  opacity: 0.7;
}

.erv__detail-value {
  font-weight: 600;
  color: var(--color-text);
  text-align: right;
  min-width: 50px;
}

/* ── Filtered toggle ── */
.erv__filtered-toggle {
  display: flex;
  justify-content: center;
  padding: var(--space-xs) 0;
}

.erv__filtered-btn {
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  padding: 3px 12px;
  font-size: 11px;
  color: var(--color-text-umber);
  cursor: pointer;
  transition: border-color var(--duration-normal) var(--ease-out);
}

.erv__filtered-btn:hover {
  border-color: var(--color-text-umber);
}

/* ── Legend ── */
.erv__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-border-subtle);
}

.erv__legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-text-umber);
}

.erv__legend-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.erv__empty {
  text-align: center;
  color: var(--color-text-umber);
  font-size: var(--font-size-sm);
  padding: var(--space-xl) 0;
}

/* ── Review result ── */
.erv__heading--review { color: var(--color-danger, #ef4444); }
.erv__review-stats { display: flex; gap: 12px; font-size: var(--font-size-sm); color: var(--color-text-umber); }
.erv__review-invalidated { color: var(--color-danger, #ef4444); font-weight: 600; }

.erv__review-detail {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-umber);
}
.erv__review-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.erv__review-badge--invalidated {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-danger, #ef4444);
}
.erv__review-badge--kept {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}
.erv__review-fact {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.erv__review-reason {
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
  font-style: italic;
}

</style>
