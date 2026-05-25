<script setup lang="ts">
// App doc: docs/user-guide/pages/game-assistant.md §10.7
/**
 * BatchSummaryView — Story 3 Phase 4
 *
 * Shows a summary table of batch-generated patches when count > 5.
 * Displays type icon, name, validation status for each patch,
 * plus a knowledge_facts section below.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ValidatedPatch, KnowledgeFact } from '@/engine/services/assistant/types';

const props = defineProps<{
  patches: ValidatedPatch[];
  knowledgeFacts?: KnowledgeFact[];
}>();

const { t } = useI18n();

interface PatchRow {
  type: 'location' | 'npc' | 'item' | 'other';
  icon: string;
  name: string;
  status: 'ok' | 'warn' | 'error';
  issues: string[];
}

const rows = computed<PatchRow[]>(() =>
  props.patches.map(p => {
    const target = p.target.replace(/^\$\.?/, '');
    let type: PatchRow['type'] = 'other';
    let icon = '?';
    if (target.startsWith('世界.地点信息') || (target.startsWith('世界.') && target.includes('地点信息'))) {
      type = 'location';
      icon = '📍';
    } else if (target.startsWith('社交.关系') || target.startsWith('社交.')) {
      type = 'npc';
      icon = '👤';
    } else if (target.startsWith('背包.物品') || target.startsWith('背包.')) {
      type = 'item';
      icon = '🎒';
    }

    const val = p.value as Record<string, unknown> | undefined;
    const name = (val?.['名称'] ?? val?.['name'] ?? target.split('.').pop() ?? '?') as string;

    return { type, icon, name, status: p.status, issues: p.issues };
  }),
);

const locationCount = computed(() => rows.value.filter(r => r.type === 'location').length);
const npcCount = computed(() => rows.value.filter(r => r.type === 'npc').length);
const factCount = computed(() => props.knowledgeFacts?.length ?? 0);
</script>

<template>
  <div class="batch-summary">
    <div class="bs-header">
      <span class="bs-title">{{ t('assistant.worldBuilder.batchSummary.title') }}</span>
      <div class="bs-counts">
        <span v-if="locationCount" class="bs-count">{{ t('assistant.worldBuilder.batchSummary.locations', { count: locationCount }) }}</span>
        <span v-if="npcCount" class="bs-count">{{ t('assistant.worldBuilder.batchSummary.npcs', { count: npcCount }) }}</span>
        <span v-if="factCount" class="bs-count">{{ t('assistant.worldBuilder.batchSummary.facts', { count: factCount }) }}</span>
      </div>
    </div>

    <div class="bs-table">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="bs-row"
        :class="{ 'bs-warn': row.status === 'warn', 'bs-error': row.status === 'error' }"
      >
        <span class="bs-icon">{{ row.icon }}</span>
        <span class="bs-name">{{ row.name }}</span>
        <span class="bs-status" :class="'st-' + row.status">
          {{ row.status === 'ok' ? '✓' : row.status === 'warn' ? '⚠' : '✗' }}
          {{ row.issues.length > 0 ? row.issues[0] : (row.status === 'ok' ? 'OK' : '') }}
        </span>
      </div>
    </div>

    <div v-if="factCount > 0" class="bs-facts">
      <span class="bs-facts-title">{{ t('assistant.worldBuilder.batchSummary.factLabel') }}</span>
      <div v-for="(fact, i) in knowledgeFacts" :key="i" class="bs-fact-row">
        {{ fact.sourceEntity }} → {{ fact.targetEntity }}: {{ fact.fact }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-summary {
  position: relative;
  background: var(--glass-bg, rgba(255, 255, 255, 0.04));
  backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
  -webkit-backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
  box-shadow: var(--glass-shadow, 0 4px 24px rgba(0, 0, 0, 0.12));
  border: none;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
}
.batch-summary::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--glass-edge-gradient, linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04)));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.bs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.bs-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
}
.bs-counts {
  display: flex;
  gap: 10px;
}
.bs-count {
  font-size: 0.74rem;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px;
  border-radius: 10px;
}

.bs-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  background: transparent;
}
.bs-row:nth-child(odd) {
  background: rgba(255, 255, 255, 0.02);
}
.bs-warn { background: color-mix(in oklch, var(--color-amber-400) 6%, transparent) !important; }
.bs-error { background: color-mix(in oklch, var(--color-danger) 6%, transparent) !important; }

.bs-icon { font-size: 0.9rem; flex-shrink: 0; }
.bs-name { flex: 1; font-weight: 500; }
.bs-status { font-size: 0.74rem; flex-shrink: 0; }
.bs-status.st-ok { color: var(--color-success, #4ade80); }
.bs-status.st-warn { color: var(--color-amber-400, #fbbf24); }
.bs-status.st-error { color: var(--color-danger, #ef4444); }

.bs-facts {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.bs-facts-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  display: block;
  margin-bottom: 6px;
}
.bs-fact-row {
  font-size: 0.76rem;
  color: var(--color-text, #e0e0e6);
  padding: 3px 0;
  opacity: 0.85;
}

@media (max-width: 767px) {
  .bs-row {
    padding: 8px 10px;
    flex-wrap: wrap;
  }
  .bs-status {
    width: 100%;
    margin-top: 2px;
    padding-left: 26px;
  }
}
</style>
