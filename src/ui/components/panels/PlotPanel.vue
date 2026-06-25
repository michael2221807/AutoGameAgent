<script setup lang="ts">
// App doc: docs/user-guide/pages/game-plot.md
import { ref, computed, watch, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGameState } from '@/ui/composables/useGameState';
import { usePlotStore } from '@/engine/plot/plot-store';

const { t } = useI18n();
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';
import { DEFAULT_GAUGE_MAX_DELTA } from '@/engine/plot/types';
import type { PlotDirectionState, PlotArc, PlotNode } from '@/engine/plot/types';
import type { PlotDecomposer } from '@/engine/plot/plot-decomposer';
import Modal from '@/ui/components/common/Modal.vue';
import GaugeBar from './plot/GaugeBar.vue';
import PlotNodeList from './plot/PlotNodeList.vue';

import { usePlotEditor } from '@/ui/composables/editors';

const { isLoaded, useValue, setValue } = useGameState();
const plotStore = usePlotStore();
const plotEditor = usePlotEditor();
const plotDecomposer = inject<PlotDecomposer | null>('plotDecomposer', null);
const plotEvaluation = inject<import('@/engine/plot/plot-evaluation-pipeline').PlotEvaluationPipeline | null>('plotEvaluation', null);

const plotState = useValue<PlotDirectionState | undefined>(DEFAULT_ENGINE_PATHS.plotDirection);
const currentRound = useValue<number>(DEFAULT_ENGINE_PATHS.roundNumber);

// Sync eval log from state tree (written by PlotEvaluationPipeline)
const evalLogFromState = useValue<import('@/engine/plot/types').PlotEvalLog[] | undefined>(
  DEFAULT_ENGINE_PATHS.plotDirection + '._evalLog',
);

// GAP-02: Sync _evaluating flag from state tree → store mutex
const evaluatingFromState = useValue<boolean | undefined>(
  DEFAULT_ENGINE_PATHS.plotDirection + '._evaluating',
);

// Which arc the panel currently shows. Explicit user navigation (arc switcher,
// or auto-select after creating a new arc) wins over the active-arc default.
// Without this, a 2nd arc created after the first completed was invisible —
// displayArc always fell back to arcs[0]. Keyed by id so it survives state
// reloads (rollback / import / save load). Declared before the immediate watch
// below because that watch reads it on setup.
const selectedArcId = ref<string | null>(null);

watch(plotState, (v) => {
  plotStore.loadFromState(v);
  // Drop a selection that no longer resolves (e.g. after import / rollback /
  // loading a different game) so displayArc falls back cleanly.
  if (selectedArcId.value && !plotStore.arcs.some(a => a.id === selectedArcId.value)) {
    selectedArcId.value = null;
  }
}, { immediate: true });

watch(evalLogFromState, (logs) => {
  if (logs && Array.isArray(logs)) {
    plotStore.evaluationLog.splice(0, plotStore.evaluationLog.length, ...logs);
  }
}, { immediate: true });

// GAP-02: When orchestrator sets _evaluating flag, sync to store's mutex
watch(evaluatingFromState, (v) => {
  plotStore.setEvaluating(v === true);
}, { immediate: true });

function persist(): void {
  const snapshot = plotStore.toStateSnapshot();
  setValue(DEFAULT_ENGINE_PATHS.plotDirection, snapshot);
  eventBus.emit('engine:request-save');
}

const activeArc = computed(() => plotStore.activeArc);

const latestEvalLog = computed(() => {
  const logs = plotStore.evaluationLog;
  return logs.length > 0 ? logs[logs.length - 1] : null;
});

const showCreateArc = ref(false);
const newArcTitle = ref('');
const newArcSynopsis = ref('');

const decomposing = ref(false);
const decomposeError = ref('');

async function createArc(): Promise<void> {
  if (!newArcTitle.value.trim()) return;
  const title = newArcTitle.value.trim();
  const synopsis = newArcSynopsis.value.trim();

  // Close modal immediately
  newArcTitle.value = '';
  newArcSynopsis.value = '';
  showCreateArc.value = false;

  const arc = plotStore.createArc(title, synopsis);
  // Switch the panel to the new arc immediately so the player sees decompose
  // progress and the AI-generated nodes land on it — instead of the view
  // staying stuck on the previously-displayed arc (arcs[0]).
  selectedArcId.value = arc.id;
  persist();

  // AI decomposition runs in background with progress shown in main panel
  if (synopsis && plotDecomposer) {
    decomposing.value = true;
    decomposeError.value = '';
    try {
      const result = await plotDecomposer.decompose(synopsis);
      if (result) {
        for (const nodeData of result.nodes) {
          plotStore.addNode(arc.id, {
            ...nodeData,
            completionConditions: [],
            activationConditions: [],
            completionMode: nodeData.completionMode ?? 'hint_only',
            importance: nodeData.importance ?? 'critical',
            opportunityTiers: nodeData.opportunityTiers ?? [],
            maxRounds: nodeData.maxRounds ?? 6,
          });
        }
        for (const gaugeData of result.suggestedGauges) {
          plotStore.addGauge(arc.id, {
            ...gaugeData,
            maxDeltaPerRound: gaugeData.maxDeltaPerRound ?? DEFAULT_GAUGE_MAX_DELTA,
          });
        }
        persist();
      } else {
        decomposeError.value = t('plot.arc.decomposeNoResult');
      }
    } catch (err) {
      decomposeError.value = t('plot.arc.decomposeFailed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      decomposing.value = false;
    }
  }
}

const displayArc = computed<PlotArc | null>(() => {
  if (selectedArcId.value) {
    const sel = plotStore.arcs.find(a => a.id === selectedArcId.value);
    if (sel) return sel;
  }
  if (activeArc.value) return activeArc.value;
  return plotStore.arcs[0] ?? null;
});

function selectArc(arcId: string): void {
  selectedArcId.value = arcId;
}

function activateCurrentArc(): void {
  const arc = displayArc.value;
  if (!arc) return;
  const ok = plotStore.activateArc(arc.id, currentRound.value ?? 0);
  if (ok) {
    persist();
  } else {
    // The activate button only shows for draft/abandoned arcs with nodes, so the
    // only realistic failure is the single-active-arc constraint. Surface it
    // instead of silently no-opping (otherwise the button looks broken).
    eventBus.emit('ui:toast', {
      type: 'info',
      i18nKey: 'plot.arc.activeBlocked',
      message: 'An arc is already active. Complete or abandon it before activating another.',
      duration: 3500,
    });
  }
}

function abandonCurrentArc(): void {
  const arc = activeArc.value;
  if (!arc) return;
  plotStore.abandonArc(arc.id);
  persist();
}

function deleteCurrentArc(): void {
  const arc = displayArc.value;
  if (!arc || arc.status === 'active') return;
  // Clear the selection before mutating the store so displayArc never briefly
  // points at a just-removed arc id.
  if (selectedArcId.value === arc.id) selectedArcId.value = null;
  plotStore.deleteArc(arc.id);
  persist();
}

// ─── Story 2: Arc title/synopsis inline editing ───

const editingArcTitle = ref(false);
const editingArcSynopsis = ref(false);
const arcTitleDraft = ref('');
const arcSynopsisDraft = ref('');
const arcTitleCancelled = ref(false);
const arcSynopsisCancelled = ref(false);

function startEditArcTitle(): void {
  const arc = displayArc.value;
  if (!arc) return;
  arcTitleDraft.value = arc.title;
  arcTitleCancelled.value = false;
  editingArcTitle.value = true;
}

function commitArcTitle(): void {
  if (arcTitleCancelled.value) { arcTitleCancelled.value = false; return; }
  const arc = displayArc.value;
  if (!arc) { editingArcTitle.value = false; return; }
  const result = plotEditor.updateArc(arc.id, { title: arcTitleDraft.value });
  if (!result.ok && result.error) {
    eventBus.emit('ui:toast', { type: 'error', i18nKey: result.error.i18nKey, message: result.error.message, duration: 3000 });
    return;
  }
  editingArcTitle.value = false;
}

function cancelArcTitle(): void {
  arcTitleCancelled.value = true;
  editingArcTitle.value = false;
}

function startEditArcSynopsis(): void {
  const arc = displayArc.value;
  if (!arc) return;
  arcSynopsisDraft.value = arc.synopsis ?? '';
  arcSynopsisCancelled.value = false;
  editingArcSynopsis.value = true;
}

function commitArcSynopsis(): void {
  if (arcSynopsisCancelled.value) { arcSynopsisCancelled.value = false; return; }
  const arc = displayArc.value;
  if (!arc) { editingArcSynopsis.value = false; return; }
  plotEditor.updateArc(arc.id, { synopsis: arcSynopsisDraft.value });
  editingArcSynopsis.value = false;
}

function cancelArcSynopsis(): void {
  arcSynopsisCancelled.value = true;
  editingArcSynopsis.value = false;
}

const showAddNode = ref(false);
const newNodeTitle = ref('');
const newNodeGoal = ref('');
const newNodeDirective = ref('');
const newNodeHint = ref('');

function addNode(): void {
  const arc = displayArc.value;
  if (!arc || !newNodeTitle.value.trim()) return;

  const nodeData: Partial<import('@/engine/plot/types').PlotNode> = {
    title: newNodeTitle.value.trim(),
    narrativeGoal: newNodeGoal.value.trim(),
    directive: newNodeDirective.value.trim() || newNodeTitle.value.trim(),
    completionHint: newNodeHint.value.trim() || newNodeTitle.value.trim(),
    completionConditions: [],
    completionMode: 'hint_only',
    activationConditions: [],
    importance: 'critical',
    opportunityTiers: [],
    maxRounds: 6,
  };

  if (insertAfterIndex.value >= 0) {
    plotStore.insertNode(arc.id, insertAfterIndex.value, nodeData);
  } else {
    plotStore.addNode(arc.id, nodeData as Parameters<typeof plotStore.addNode>[1]);
  }

  newNodeTitle.value = '';
  newNodeGoal.value = '';
  newNodeDirective.value = '';
  newNodeHint.value = '';
  insertAfterIndex.value = -1;
  showAddNode.value = false;
  persist();
}

const insertAfterIndex = ref(-1);

function handleInsertAfter(index: number): void {
  if (!displayArc.value) return;
  insertAfterIndex.value = index;
  showAddNode.value = true;
}

function handleRemoveNode(nodeId: string): void {
  const arc = displayArc.value;
  if (!arc) return;
  plotStore.removeNode(arc.id, nodeId);
  persist();
}

const showNodeDetail = ref(false);
const selectedNodeId = ref<string | null>(null);
const selectedNode = computed<PlotNode | null>(() => {
  if (!selectedNodeId.value || !displayArc.value) return null;
  return displayArc.value.nodes.find(n => n.id === selectedNodeId.value) ?? null;
});

function handleSelectNode(nodeId: string): void {
  selectedNodeId.value = nodeId;
  showNodeDetail.value = true;
}

const editingDirective = ref('');
const editingHint = ref('');
const editingGoal = ref('');
const editingMaxRounds = ref<number | undefined>(undefined);
const editingImportance = ref<'critical' | 'skippable'>('critical');
const editingCompletionMode = ref<import('@/engine/plot/types').CompletionMode>('hint_only');

watch(selectedNode, (n) => {
  if (n) {
    editingDirective.value = n.directive;
    editingHint.value = n.completionHint;
    editingGoal.value = n.narrativeGoal;
    editingMaxRounds.value = n.maxRounds;
    editingImportance.value = n.importance;
    editingCompletionMode.value = n.completionMode;
  }
});

function saveNodeEdits(): void {
  const arc = displayArc.value;
  const node = selectedNode.value;
  if (!arc || !node) return;
  plotStore.updateNode(arc.id, node.id, {
    directive: editingDirective.value,
    completionHint: editingHint.value,
    narrativeGoal: editingGoal.value,
    maxRounds: editingMaxRounds.value,
    importance: editingImportance.value,
    completionMode: editingCompletionMode.value,
  });
  showNodeDetail.value = false;
  persist();
}

const plotSettingsFromState = useValue<{ showEvalLog?: boolean } | undefined>('系统.设置.plot');
const showEvalLog = ref(false);
// Sync from settings panel
watch(plotSettingsFromState, (s) => {
  if (s && typeof s.showEvalLog === 'boolean') showEvalLog.value = s.showEvalLog;
}, { immediate: true });

const showConfirmAbandon = ref(false);

// ─── Gauge management (GAP-06) ───
const showAddGauge = ref(false);
const newGaugeName = ref('');
const newGaugeDesc = ref('');
const newGaugeMax = ref(100);
const newGaugeUnit = ref('%');

function removeGauge(gaugeId: string): void {
  const arc = displayArc.value;
  if (!arc) return;
  plotStore.removeGauge(arc.id, gaugeId);
  persist();
}

const showEditGauge = ref(false);
const editGaugeId = ref('');
const editGaugeName = ref('');
const editGaugeDesc = ref('');
const editGaugeCurrent = ref(0);
const editGaugeMin = ref(0);
const editGaugeMax = ref(100);
const editGaugeUnit = ref('%');
const editGaugeAiUpdatable = ref(true);
const editGaugeAutoDecrement = ref<number | undefined>(undefined);

function startEditGauge(gauge: import('@/engine/plot/types').PlotGauge): void {
  editGaugeId.value = gauge.id;
  editGaugeName.value = gauge.name;
  editGaugeDesc.value = gauge.description;
  editGaugeCurrent.value = gauge.current;
  editGaugeMin.value = gauge.min;
  editGaugeMax.value = gauge.max;
  editGaugeUnit.value = gauge.unit;
  editGaugeAiUpdatable.value = gauge.aiUpdatable;
  editGaugeAutoDecrement.value = gauge.autoDecrement;
  showEditGauge.value = true;
}

function saveGaugeEdits(): void {
  const arc = displayArc.value;
  if (!arc) return;
  plotStore.updateGauge(arc.id, editGaugeId.value, {
    name: editGaugeName.value,
    description: editGaugeDesc.value,
    current: Math.max(editGaugeMin.value, Math.min(editGaugeMax.value, editGaugeCurrent.value)),
    min: editGaugeMin.value,
    max: editGaugeMax.value,
    unit: editGaugeUnit.value,
    aiUpdatable: editGaugeAiUpdatable.value,
    autoDecrement: editGaugeAutoDecrement.value,
  });
  showEditGauge.value = false;
  persist();
}

function addGauge(): void {
  const arc = displayArc.value;
  if (!arc || !newGaugeName.value.trim()) return;
  plotStore.addGauge(arc.id, {
    name: newGaugeName.value.trim(),
    description: newGaugeDesc.value.trim(),
    min: 0,
    max: newGaugeMax.value,
    current: 0,
    initialValue: 0,
    unit: newGaugeUnit.value,
    showInMainPanel: true,
    aiUpdatable: true,
    maxDeltaPerRound: DEFAULT_GAUGE_MAX_DELTA,
  });
  newGaugeName.value = '';
  newGaugeDesc.value = '';
  newGaugeMax.value = 100;
  newGaugeUnit.value = '%';
  showAddGauge.value = false;
  persist();
}

// ─── Critical node confirmation gate ───
const hasPendingConfirmation = computed(() => plotStore.pendingConfirmation !== null);
const pendingConfirmNode = computed(() => {
  const pc = plotStore.pendingConfirmation;
  if (!pc || !displayArc.value) return null;
  return displayArc.value.nodes.find(n => n.id === pc.nodeId) ?? null;
});

function confirmAdvancement(): void {
  plotStore.confirmNodeAdvancement();
  // Push the `confirmed` flag into the state tree first…
  persist();
  // …then advance the node right away so the player sees it complete + the
  // next node activate immediately, instead of waiting for the next main round.
  // Falls back to the deferred path (pipeline consumes the flag next round) if
  // the evaluation pipeline isn't available (e.g. no active game pack).
  if (plotEvaluation) {
    plotEvaluation.applyConfirmedAdvancement();
    eventBus.emit('engine:request-save');
  }
}

function rejectAdvancement(): void {
  plotStore.rejectNodeAdvancement();
  persist();
}
</script>

<template>
  <div class="plot-panel">
    <template v-if="isLoaded">
      <!-- Header -->
      <header class="panel-header">
        <h2 class="panel-title">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" style="opacity: 0.7">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V15" />
          </svg>
          {{ $t('plot.title') }}
        </h2>
        <div class="header-actions">
          <button
            class="header-btn"
            :title="$t('plot.arc.newArcBtn')"
            @click="showCreateArc = true"
          >+</button>
        </div>
      </header>

      <!-- Active Arc Display -->
      <template v-if="displayArc">
        <!-- Arc switcher: browse/switch between multiple arcs (single-active still enforced) -->
        <nav v-if="plotStore.arcs.length >= 2" class="arc-switcher" :aria-label="$t('plot.arc.switcherLabel')">
          <button
            v-for="arc in plotStore.arcs"
            :key="arc.id"
            type="button"
            :class="['arc-chip', { 'arc-chip--selected': arc.id === displayArc.id }]"
            :title="arc.title || $t('plot.arc.untitled')"
            @click="selectArc(arc.id)"
          >
            <span :class="['arc-chip__dot', `arc-chip__dot--${arc.status}`]" />
            <span class="arc-chip__title">{{ arc.title || $t('plot.arc.untitled') }}</span>
          </button>
        </nav>

        <section class="arc-header">
          <div class="arc-title-row">
            <template v-if="editingArcTitle">
              <input
                v-model="arcTitleDraft"
                type="text"
                class="arc-inline-input arc-inline-input--title"
                autofocus
                @keyup.enter="commitArcTitle"
                @keyup.escape="cancelArcTitle"
                @blur="commitArcTitle"
              />
            </template>
            <template v-else>
              <h3 class="arc-title arc-title--editable" @click="startEditArcTitle" :title="$t('plot.arc.editTitle')">
                {{ displayArc.title }} <span class="arc-edit-icon">✏</span>
              </h3>
            </template>
            <span :class="['arc-status', `arc-status--${displayArc.status}`]">
              {{ displayArc.status }}
            </span>
          </div>
          <template v-if="editingArcSynopsis">
            <textarea
              v-model="arcSynopsisDraft"
              class="arc-inline-input arc-inline-input--synopsis"
              rows="3"
              autofocus
              @keyup.escape="cancelArcSynopsis"
              @blur="commitArcSynopsis"
            />
          </template>
          <p v-else-if="displayArc.synopsis" class="arc-synopsis arc-synopsis--editable" @click="startEditArcSynopsis" :title="$t('plot.arc.editSynopsis')">
            {{ displayArc.synopsis }} <span class="arc-edit-icon">✏</span>
          </p>
          <p v-else class="arc-synopsis arc-synopsis--empty" @click="startEditArcSynopsis" :title="$t('plot.arc.editSynopsis')">
            {{ $t('plot.arc.synopsisPlaceholder') }} <span class="arc-edit-icon">✏</span>
          </p>

          <div class="arc-actions">
            <button
              v-if="(displayArc.status === 'draft' || displayArc.status === 'abandoned') && displayArc.nodes.length > 0"
              class="arc-btn arc-btn--activate"
              @click="activateCurrentArc"
            >{{ displayArc.status === 'abandoned' ? $t('plot.arc.reactivate') : $t('plot.arc.activate') }}</button>
            <button
              v-if="displayArc.status === 'active'"
              class="arc-btn arc-btn--abandon"
              @click="showConfirmAbandon = true"
            >{{ $t('plot.arc.abandon') }}</button>
            <button
              v-if="displayArc.status !== 'active'"
              class="arc-btn arc-btn--delete"
              @click="deleteCurrentArc"
            >{{ $t('plot.arc.delete') }}</button>
          </div>
          <p v-if="decomposing" class="decompose-status">{{ $t('plot.arc.decomposing') }}</p>
          <p v-if="decomposeError" class="decompose-error">{{ decomposeError }}</p>
        </section>

        <!-- Gauges + Management -->
        <section class="gauges-section">
          <div class="gauges-header">
            <span class="gauges-label">{{ $t('plot.gauge.title') }}</span>
            <button class="header-btn" :title="$t('plot.gauge.addTitle')" @click="showAddGauge = true">+</button>
          </div>
          <div
            v-for="gauge in displayArc.gauges"
            :key="gauge.id"
            class="gauge-item"
          >
            <GaugeBar :gauge="gauge" />
            <div class="gauge-item__actions">
              <button class="gauge-action-btn" :title="$t('plot.gauge.editBtn')" @click="startEditGauge(gauge)">&#9998;</button>
              <button class="gauge-action-btn gauge-action-btn--remove" :title="$t('plot.gauge.deleteBtn')" @click="removeGauge(gauge.id)">&times;</button>
            </div>
          </div>
          <p v-if="displayArc.gauges.length === 0" class="empty-hint">{{ $t('plot.gauge.empty') }}</p>
        </section>

        <!-- Node Chain -->
        <section class="nodes-section">
          <PlotNodeList
            :nodes="displayArc.nodes"
            :gauges="displayArc.gauges"
            :current-round="currentRound ?? 0"
            :last-eval-log="latestEvalLog"
            @insert-after="handleInsertAfter"
            @remove="handleRemoveNode"
            @select="handleSelectNode"
          />
        </section>

        <!-- Critical Node Confirmation Gate -->
        <section v-if="hasPendingConfirmation && pendingConfirmNode" class="confirm-gate">
          <div class="confirm-gate__icon">&#10003;</div>
          <div class="confirm-gate__body">
            <p class="confirm-gate__title">
              {{ pendingConfirmNode.title }}
            </p>
            <p class="confirm-gate__evidence">
              {{ plotStore.pendingConfirmation?.evidence }}
            </p>
          </div>
          <div class="confirm-gate__actions">
            <button class="arc-btn arc-btn--activate" @click="confirmAdvancement">
              {{ $t('plot.confirm.title') }}
            </button>
            <button class="arc-btn arc-btn--delete" @click="rejectAdvancement">
              {{ $t('plot.confirm.notYet') }}
            </button>
          </div>
        </section>

        <!-- Eval Log Toggle -->
        <section class="eval-log-section">
          <button class="eval-log-toggle" @click="showEvalLog = !showEvalLog">
            {{ showEvalLog ? '▾' : '▸' }} {{ $t('plot.evalLog.title') }} ({{ plotStore.evaluationLog.length }})
          </button>
          <Transition name="cfg-expand">
            <div v-if="showEvalLog" class="eval-log-list">
              <div v-if="plotStore.evaluationLog.length === 0" class="eval-log-empty">
                {{ $t('plot.evalLog.empty') }}
              </div>
              <div
                v-for="log in [...plotStore.evaluationLog].reverse()"
                :key="`${log.round}-${log.nodeId}`"
                class="eval-log-item"
              >
                <span class="eval-log-round">R{{ log.round }}</span>
                <span class="eval-log-action">{{ log.action }}</span>
                <span v-if="log.evaluation" class="eval-log-conf">
                  {{ log.evaluation.confidence.toFixed(2) }}
                </span>
                <span v-if="log.evaluation?.evidence" class="eval-log-evidence">
                  {{ log.evaluation.evidence }}
                </span>
              </div>
            </div>
          </Transition>
        </section>
      </template>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <p>{{ $t('plot.empty.noArc') }}</p>
        <button class="arc-btn arc-btn--activate" @click="showCreateArc = true">
          {{ $t('plot.empty.createFirst') }}
        </button>
      </div>

      <!-- Create Arc Modal -->
      <Modal v-model="showCreateArc" :title="$t('plot.arc.createTitle')" width="460px">
        <div class="modal-form">
          <label class="form-label">
            {{ $t('plot.arc.arcTitle') }}
            <input v-model="newArcTitle" class="form-input" :placeholder="$t('plot.arc.arcTitlePlaceholder')" />
          </label>
          <label class="form-label">
            {{ $t('plot.arc.synopsis') }}
            <textarea v-model="newArcSynopsis" class="form-textarea" rows="3" :placeholder="$t('plot.arc.synopsisPlaceholder')" />
          </label>
        </div>
        <template #footer>
          <button class="arc-btn arc-btn--activate" :disabled="!newArcTitle.trim()" @click="createArc">
            {{ $t('plot.arc.create') }}
          </button>
        </template>
      </Modal>

      <!-- Add Node Modal -->
      <Modal v-model="showAddNode" :title="$t('plot.node.addTitle')" width="500px">
        <div class="modal-form">
          <label class="form-label">
            {{ $t('plot.node.title') }}
            <input v-model="newNodeTitle" class="form-input" :placeholder="$t('plot.node.titlePlaceholder')" />
          </label>
          <label class="form-label">
            {{ $t('plot.node.narrativeGoal') }}
            <textarea v-model="newNodeGoal" class="form-textarea" rows="2" :placeholder="$t('plot.node.narrativeGoalPlaceholder')" />
          </label>
          <label class="form-label">
            {{ $t('plot.node.directive') }}
            <textarea v-model="newNodeDirective" class="form-textarea" rows="3" :placeholder="$t('plot.node.directivePlaceholder')" />
          </label>
          <label class="form-label">
            {{ $t('plot.node.completionHint') }}
            <input v-model="newNodeHint" class="form-input" :placeholder="$t('plot.node.completionHintPlaceholder')" />
          </label>
        </div>
        <template #footer>
          <button class="arc-btn arc-btn--activate" :disabled="!newNodeTitle.trim()" @click="addNode">
            {{ $t('plot.node.add') }}
          </button>
        </template>
      </Modal>

      <!-- Node Detail Modal -->
      <Modal v-model="showNodeDetail" :title="selectedNode?.title ?? ''" width="560px">
        <div v-if="selectedNode" class="modal-form">
          <div class="detail-meta">
            <span>{{ $t('plot.node.detailStatus', { status: selectedNode.status }) }}</span>
          </div>
          <label class="form-label">
            {{ $t('plot.node.narrativeGoal') }}
            <textarea v-model="editingGoal" class="form-textarea" rows="2" />
          </label>
          <label class="form-label">
            {{ $t('plot.node.directive') }}
            <textarea v-model="editingDirective" class="form-textarea" rows="4" />
          </label>
          <label class="form-label">
            {{ $t('plot.node.completionHint') }}
            <textarea v-model="editingHint" class="form-textarea" rows="2" />
          </label>
          <div class="detail-row">
            <label class="form-label form-label--inline">
              {{ $t('plot.node.importance') }}
              <select v-model="editingImportance" class="form-select">
                <option value="critical">{{ $t('plot.node.importance.critical') }}</option>
                <option value="skippable">{{ $t('plot.node.importance.skippable') }}</option>
              </select>
            </label>
            <label class="form-label form-label--inline">
              {{ $t('plot.node.completionMode') }}
              <select v-model="editingCompletionMode" class="form-select">
                <option value="hint_only">{{ $t('plot.node.completionMode.hintOnly') }}</option>
                <option value="hint_and_gauges">{{ $t('plot.node.completionMode.hintAndGauges') }}</option>
                <option value="gauges_only">{{ $t('plot.node.completionMode.gaugesOnly') }}</option>
              </select>
            </label>
            <label class="form-label form-label--inline">
              {{ $t('plot.node.maxRounds') }}
              <input v-model.number="editingMaxRounds" type="number" class="form-input form-input--narrow" min="1" max="50" inputmode="numeric" />
            </label>
          </div>
        </div>
        <template #footer>
          <button class="arc-btn arc-btn--activate" @click="saveNodeEdits">
            {{ $t('plot.node.save') }}
          </button>
        </template>
      </Modal>

      <!-- Edit Gauge Modal -->
      <Modal v-model="showEditGauge" :title="$t('plot.gauge.editTitle')" width="420px">
        <div class="modal-form">
          <label class="form-label">{{ $t('plot.gauge.name') }}<input v-model="editGaugeName" class="form-input" /></label>
          <label class="form-label">{{ $t('plot.gauge.description') }}<textarea v-model="editGaugeDesc" class="form-textarea" rows="3" /></label>

          <div class="gauge-edit-grid">
            <label class="form-label">{{ $t('plot.gauge.currentValue') }}<input v-model.number="editGaugeCurrent" type="number" class="form-input" inputmode="numeric" /></label>
            <label class="form-label">{{ $t('plot.gauge.maxValue') }}<input v-model.number="editGaugeMax" type="number" class="form-input" min="1" inputmode="numeric" /></label>
            <label class="form-label">{{ $t('plot.gauge.minValue') }}<input v-model.number="editGaugeMin" type="number" class="form-input" inputmode="numeric" /></label>
            <label class="form-label">{{ $t('plot.gauge.unit') }}<input v-model="editGaugeUnit" class="form-input" /></label>
            <label class="form-label">{{ $t('plot.gauge.autoDecrement') }}<input v-model.number="editGaugeAutoDecrement" type="number" class="form-input" min="0" placeholder="0" inputmode="numeric" /></label>
            <div class="gauge-edit-toggle">
              <span class="form-label">{{ $t('plot.gauge.aiUpdatable') }}</span>
              <span
                :class="['gauge-toggle', { 'gauge-toggle--on': editGaugeAiUpdatable }]"
                role="switch"
                tabindex="0"
                :aria-checked="editGaugeAiUpdatable"
                @click="editGaugeAiUpdatable = !editGaugeAiUpdatable"
              />
            </div>
          </div>
        </div>
        <template #footer>
          <button class="arc-btn arc-btn--activate" @click="saveGaugeEdits">{{ $t('plot.gauge.save') }}</button>
        </template>
      </Modal>

      <!-- Add Gauge Modal (GAP-06) -->
      <Modal v-model="showAddGauge" :title="$t('plot.gauge.addTitle')" width="420px">
        <div class="modal-form">
          <label class="form-label">
            {{ $t('plot.gauge.name') }}
            <input v-model="newGaugeName" class="form-input" :placeholder="$t('plot.gauge.namePlaceholder')" />
          </label>
          <label class="form-label">
            {{ $t('plot.gauge.description') }}
            <textarea v-model="newGaugeDesc" class="form-textarea" rows="2" :placeholder="$t('plot.gauge.descriptionPlaceholder')" />
          </label>
          <div class="detail-row">
            <label class="form-label form-label--inline">
              {{ $t('plot.gauge.maxValue') }}
              <input v-model.number="newGaugeMax" type="number" class="form-input form-input--narrow" min="1" inputmode="numeric" />
            </label>
            <label class="form-label form-label--inline">
              {{ $t('plot.gauge.unit') }}
              <input v-model="newGaugeUnit" class="form-input form-input--narrow" placeholder="%" />
            </label>
          </div>
        </div>
        <template #footer>
          <button class="arc-btn arc-btn--activate" :disabled="!newGaugeName.trim()" @click="addGauge">
            {{ $t('plot.gauge.add') }}
          </button>
        </template>
      </Modal>

      <!-- Confirm Abandon -->
      <Modal v-model="showConfirmAbandon" :title="$t('plot.arc.confirmAbandonTitle')" width="380px">
        <p class="confirm-text">
          {{ $t('plot.arc.confirmAbandonText') }}
        </p>
        <template #footer>
          <button class="arc-btn arc-btn--abandon" @click="abandonCurrentArc(); showConfirmAbandon = false">
            {{ $t('plot.arc.confirmAbandonBtn') }}
          </button>
        </template>
      </Modal>
    </template>

    <div v-else class="empty-state">
      <p>{{ $t('plot.notLoaded') }}</p>
    </div>
  </div>
</template>

<style scoped>
.plot-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  height: 100%;
  overflow-y: auto;
  transition: padding-left var(--duration-open, 0.25s) var(--ease-droplet, ease),
              padding-right var(--duration-open, 0.25s) var(--ease-droplet, ease);
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-actions {
  display: flex;
  gap: 6px;
}

.header-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border-subtle, rgba(255,255,255,0.08));
  border-radius: 6px;
  color: var(--color-text, #e0e0e6);
  font-size: 16px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.header-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Arc Switcher — horizontal chip strip for multi-arc navigation */
.arc-switcher {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
}
.arc-switcher::-webkit-scrollbar { height: 4px; }
.arc-switcher::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}
.arc-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  max-width: 160px;
  padding: 4px 10px;
  border: none;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  font-size: 12px;
  font-family: var(--font-serif-cjk, serif);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.arc-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text, #e0e0e6);
}
.arc-chip--selected {
  background: rgba(140, 184, 140, 0.14);
  color: var(--color-text, #e0e0e6);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}
.arc-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-secondary, #8888a0);
}
.arc-chip__dot--draft     { background: rgba(255, 255, 255, 0.35); }
.arc-chip__dot--active    { background: var(--color-sage-400, #8cb88c); box-shadow: 0 0 5px color-mix(in oklch, var(--color-sage-400) 50%, transparent); }
.arc-chip__dot--completed { background: var(--color-amber-400, #f59e0b); }
.arc-chip__dot--abandoned { background: var(--color-danger, #c0392b); }
.arc-chip__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Arc Header */
.arc-header {
  background: var(--glass-bg, rgba(255, 255, 255, 0.04));
  backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
  -webkit-backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
  box-shadow: var(--glass-shadow), var(--lumi-inset-highlight);
  border: none;
  border-radius: 10px;
  padding: 14px;
  position: relative;
}
.arc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.arc-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-serif-cjk, serif);
}
.arc-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.arc-status--draft     { background: rgba(255,255,255,0.06); color: var(--color-text-secondary); }
.arc-status--active    { background: rgba(140,184,140,0.15); color: var(--color-sage-400, #8cb88c); text-shadow: 0 0 4px color-mix(in oklch, var(--color-sage-400) 30%, transparent); }
.arc-status--completed { background: rgba(245,158,11,0.15); color: var(--color-amber-400, #f59e0b); text-shadow: 0 0 4px color-mix(in oklch, var(--color-amber-400) 30%, transparent); }
.arc-status--abandoned { background: rgba(192,57,43,0.15); color: var(--color-danger, #c0392b); text-shadow: 0 0 4px color-mix(in oklch, var(--color-danger) 20%, transparent); }

.arc-synopsis {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.arc-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.arc-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.arc-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.arc-btn--activate { background: var(--color-sage-400, #8cb88c); color: #1a1a1a; }
.arc-btn--abandon  { background: var(--color-danger, #c0392b); color: #fff; }
.arc-btn--delete   { background: rgba(255,255,255,0.06); color: var(--color-text-secondary); }
.arc-btn--activate:hover { opacity: 0.85; }
.arc-btn--abandon:hover  { opacity: 0.85; }
.arc-btn--delete:hover   { background: rgba(255,255,255,0.1); }

/* Gauges */
.gauges-section {
  background: rgba(255, 255, 255, 0.025);
  border: none;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gauges-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.gauges-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
}
.gauge-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out);
}
.gauge-item:hover {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.02), transparent 60%);
}
.gauge-item > :first-child {
  flex: 1;
  min-width: 0;
}
.gauge-item__actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.gauge-item:hover .gauge-item__actions {
  opacity: 1;
}
.gauge-action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}
.gauge-action-btn:hover { color: var(--color-text); }
.gauge-action-btn--remove:hover { color: var(--color-danger, #c0392b); }

.decompose-status {
  font-size: 12px;
  color: var(--color-sage-400, #8cb88c);
  margin: 6px 0 0;
}
.decompose-error {
  font-size: 12px;
  color: var(--color-danger, #c0392b);
  margin: 6px 0 0;
}

.empty-hint {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin: 0;
  text-align: center;
  padding: 4px 0;
}

/* Nodes */
.nodes-section {
  /* Take natural content height and never shrink. The panel itself scrolls
     (.plot-panel: overflow-y: auto), so the node list must not be flex-shrunk
     below its content — otherwise, with many nodes, the list overflows its box
     and visually stacks on top of the .confirm-gate / .eval-log-section that
     follow it in the column. */
  flex-shrink: 0;
}

/* Confirmation Gate */
.confirm-gate {
  background: rgba(140, 184, 140, 0.08);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  box-shadow:
    0 0 16px color-mix(in oklch, var(--color-sage-400) 12%, transparent),
    inset 0 0 8px color-mix(in oklch, var(--color-sage-400) 5%, transparent);
}
.confirm-gate__icon {
  font-size: 18px;
  color: var(--color-sage-400, #8cb88c);
  flex-shrink: 0;
  margin-top: 2px;
}
.confirm-gate__body {
  flex: 1;
  min-width: 0;
}
.confirm-gate__title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  font-family: var(--font-serif-cjk, serif);
}
.confirm-gate__evidence {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.confirm-gate__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* Eval Log */
.eval-log-section {
  border-top: 1px solid var(--color-border-subtle, rgba(255,255,255,0.06));
  padding-top: 8px;
}
.eval-log-toggle {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 0;
}
.eval-log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  max-height: 200px;
  overflow-y: auto;
}
.eval-log-empty {
  font-size: 11px;
  color: var(--color-text-secondary);
  padding: 8px 0;
}
.eval-log-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  padding: 3px 0;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.eval-log-round {
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
  min-width: 30px;
}
.eval-log-action {
  color: var(--color-sage-400, #8cb88c);
  font-family: var(--font-mono, monospace);
  min-width: 80px;
}
.eval-log-conf {
  color: var(--color-amber-400, #f59e0b);
  font-family: var(--font-mono, monospace);
}
.eval-log-evidence {
  color: var(--color-text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

/* Modal Forms */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}
.form-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.form-input,
.form-textarea {
  box-sizing: border-box;
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--color-text, #e0e0e6);
  font-size: 13px;
  font-family: var(--font-serif-cjk, serif);
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.form-input:focus,
.form-textarea:focus {
  border-color: var(--color-sage-400, #8cb88c);
}

.confirm-text {
  color: var(--color-text-secondary);
  font-size: 13px;
  margin: 0;
  line-height: 1.6;
}

.gauge-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
}
.gauge-edit-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 18px;
}
.gauge-toggle {
  display: inline-block;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.gauge-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-text-secondary, #888);
  transition: transform 0.2s, background 0.2s;
}
.gauge-toggle--on {
  background: var(--color-sage-400, #8cb88c);
}
.gauge-toggle--on::after {
  transform: translateX(16px);
  background: #fff;
}

.detail-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.form-label--inline {
  flex: 1;
  min-width: 100px;
}
.form-select {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--color-text, #e0e0e6);
  font-size: 12px;
  width: 100%;
  outline: none;
}
.form-select:focus {
  border-color: var(--color-sage-400, #8cb88c);
}
.form-input--narrow {
  width: 100%;
  max-width: 120px;
}

.detail-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
}

/* Transitions */
.cfg-expand-enter-active { transition: all 0.2s ease; }
.cfg-expand-leave-active { transition: all 0.15s ease; }
.cfg-expand-enter-from,
.cfg-expand-leave-to { opacity: 0; max-height: 0; overflow: hidden; }

/* ── Story 2: Arc inline editing ── */
.arc-title--editable,
.arc-synopsis--editable,
.arc-synopsis--empty {
  cursor: pointer;
  transition: color 0.15s ease;
}
.arc-title--editable:hover,
.arc-synopsis--editable:hover { color: var(--color-sage-300); }
.arc-synopsis--empty {
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.5;
  font-style: italic;
}
.arc-synopsis--empty:hover { opacity: 0.8; }
.arc-edit-icon {
  font-size: 0.7em;
  opacity: 0.3;
  transition: opacity 0.15s ease;
  margin-left: 4px;
}
.arc-title--editable:hover .arc-edit-icon,
.arc-synopsis--editable:hover .arc-edit-icon,
.arc-synopsis--empty:hover .arc-edit-icon { opacity: 0.8; }
.arc-inline-input {
  width: 100%;
  font-size: inherit;
  font-family: inherit;
  color: var(--color-text, #e0e0e6);
  background: var(--color-surface-input, rgba(255,255,255,0.04));
  border: 1px solid var(--color-sage-600);
  border-radius: 6px;
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}
.arc-inline-input--title {
  padding: 4px 10px;
  font-size: 1.05rem;
  font-weight: 700;
}
.arc-inline-input--synopsis {
  padding: 6px 10px;
  font-size: 0.84rem;
  line-height: 1.5;
  resize: vertical;
}

@media (max-width: 767px) {
  .plot-panel { padding-left: var(--space-md); padding-right: var(--space-md); transition: none; }
  /* Story 2: mobile touch targets */
  .btn-primary { min-height: 44px; }
  .btn-secondary { min-height: 44px; }
  .btn-danger { min-height: 44px; }
  .form-input { height: 44px; }
  .form-input--narrow { height: 44px; }
  .form-textarea { min-height: 44px; }
  .node-action-btn { min-height: 44px; }
  .gauge-action-btn { min-height: 44px; }
}

@media (hover: none) and (pointer: coarse) {
  .arc-edit-icon { opacity: 0.5; }
  .arc-edit-icon:active { opacity: 1; }
}
</style>
