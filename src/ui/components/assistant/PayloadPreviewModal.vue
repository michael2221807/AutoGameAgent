<script setup lang="ts">
/**
 * PayloadPreviewModal — Patch 包预览 + 编辑 + 注入对话框
 *
 * 三栏布局：
 * - 左：AI 原文（只读）
 * - 中：patches 列表，每条带 status badge，可点击展开 JSON 编辑
 * - 右：当前选中 patch 的 diff 预览（before / after）
 *
 * 用户决策：硬约束 —— 任一 error 时禁用注入；用户必须修复全部 error 或丢弃。
 *
 * 编辑：
 * - 简单字段（set-field 单值）→ inline input
 * - 复杂对象 → JsonEditor（JSON 文本，失焦时校验）
 * - 编辑后实时 re-validate
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §6.3 + Phase 5b。
 */
import { ref, computed, watch, inject } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import JsonEditor from '@/ui/components/editing/JsonEditor.vue';
import type {
  AssistantMessage,
  PayloadDraft,
  ValidatedPatch,
} from '@/engine/services/assistant/types';
import { PayloadValidator } from '@/engine/services/assistant/payload-validator';
import { useGameState } from '@/ui/composables/useGameState';
import type { StateManager } from '@/engine/core/state-manager';
import type { GamePack } from '@/engine/types';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  /** 整条 assistant message —— 含 raw content + payloadDraft */
  message: AssistantMessage | null;
  /** 注入前是否需要二次确认 */
  confirmBeforeInject?: boolean;
}>(), { confirmBeforeInject: true });

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 用户点"注入"后触发；外部 useAssistant 调 service.applyPayload */
  'inject': [messageId: string, draft: PayloadDraft];
  /** 用户点"丢弃"；外部把 draft.status='discarded' 并刷新 conversation */
  'discard': [messageId: string];
}>();

// ─── Validator instance for re-validation after edits ───

const stateManager = inject<StateManager>('stateManager');
const gamePack = inject<GamePack | null>('gamePack', null);
const { tree, get } = useGameState();
void tree;
// Note: stateManager 通过 inject；fallback to a minimal mock that uses useGameState for `get`
const validator = computed(() => new PayloadValidator({
  stateManager: stateManager ?? ({ get } as unknown as StateManager),
  gamePack,
}));

// ─── Local working copy of validated patches (for editing) ─

const workingPatches = ref<ValidatedPatch[]>([]);
const selectedPatchIdx = ref<number>(0);
const showInjectConfirm = ref(false);

watch(() => props.message, (msg) => {
  if (msg?.payloadDraft) {
    workingPatches.value = msg.payloadDraft.validated.map((p) => ({ ...p }));
    selectedPatchIdx.value = 0;
  } else {
    workingPatches.value = [];
  }
}, { immediate: true });

const selectedPatch = computed<ValidatedPatch | null>(() =>
  workingPatches.value[selectedPatchIdx.value] ?? null,
);

// ─── Edit mode ─────────────────────────────────────

const isEditingJson = ref(false);
const editJsonText = ref('');
const editJsonError = ref('');

function startEditPatch(): void {
  if (!selectedPatch.value) return;
  isEditingJson.value = true;
  editJsonText.value = JSON.stringify(selectedPatch.value, null, 2);
  editJsonError.value = '';
}

function saveEditedPatch(): void {
  try {
    const parsed = JSON.parse(editJsonText.value);
    if (!parsed || typeof parsed !== 'object') throw new Error('必须是对象');
    // re-validate this patch
    const revalidated = validator.value.validateOne(parsed);
    workingPatches.value[selectedPatchIdx.value] = revalidated;
    isEditingJson.value = false;
    editJsonError.value = '';
  } catch (err) {
    editJsonError.value = err instanceof Error ? err.message : String(err);
  }
}

function cancelEditPatch(): void {
  isEditingJson.value = false;
  editJsonError.value = '';
}

// ─── Diff 预览 ─────────────────────────────────────

const diffPreview = computed<{ before: string; after: string } | null>(() => {
  const p = selectedPatch.value;
  if (!p) return null;
  const target = p.target.replace(/^\$\./, '');
  const beforeVal = get(target);
  let afterVal: unknown = beforeVal;

  switch (p.op) {
    case 'set-field':
      afterVal = p.value;
      break;
    case 'append-item':
      afterVal = Array.isArray(beforeVal) ? [...beforeVal, p.value] : [p.value];
      break;
    case 'insert-item': {
      const arr = Array.isArray(beforeVal) ? [...beforeVal] : [];
      const pos = p.position;
      let idx = arr.length;
      if (pos) {
        if ('at' in pos) {
          idx = pos.at === 'start' ? 0 : arr.length;
        } else {
          const matchSpec = 'before' in pos ? pos.before : pos.after;
          const matchedIdx = arr.findIndex((it) =>
            it && typeof it === 'object'
            && (it as Record<string, unknown>)[matchSpec.by] === matchSpec.value,
          );
          idx = matchedIdx === -1 ? arr.length
              : ('before' in pos ? matchedIdx : matchedIdx + 1);
        }
      }
      arr.splice(idx, 0, p.value);
      afterVal = arr;
      break;
    }
    case 'replace-item': {
      if (!Array.isArray(beforeVal) || !p.match) break;
      afterVal = beforeVal.map((it) => {
        if (it && typeof it === 'object' && (it as Record<string, unknown>)[p.match!.by] === p.match!.value) {
          return p.value;
        }
        return it;
      });
      break;
    }
    case 'remove-item': {
      if (!Array.isArray(beforeVal) || !p.match) break;
      afterVal = beforeVal.filter((it) => {
        if (it && typeof it === 'object') {
          return (it as Record<string, unknown>)[p.match!.by] !== p.match!.value;
        }
        return true;
      });
      break;
    }
    case 'replace-array':
      afterVal = p.value;
      break;
  }

  return {
    before: JSON.stringify(beforeVal, null, 2) ?? 'undefined',
    after: JSON.stringify(afterVal, null, 2) ?? 'undefined',
  };
});

// ─── Aggregate state ──────────────────────────────

const errorCount = computed(() => workingPatches.value.filter((p) => p.status === 'error').length);
const warnCount = computed(() => workingPatches.value.filter((p) => p.status === 'warn').length);
const okCount = computed(() => workingPatches.value.filter((p) => p.status === 'ok').length);
const canInject = computed(() => errorCount.value === 0 && workingPatches.value.length > 0);

const aiRawText = computed(() => props.message?.content ?? '');

// ─── Actions ──────────────────────────────────────

function close(): void { emit('update:modelValue', false); }

function discard(): void {
  if (!props.message) return;
  emit('discard', props.message.id);
  close();
}

function tryInject(): void {
  if (!canInject.value || !props.message) return;
  if (props.confirmBeforeInject) {
    showInjectConfirm.value = true;
    return;
  }
  doInject();
}

function doInject(): void {
  if (!props.message?.payloadDraft) return;
  // 用 working copy 替换 draft 的 validated 列表
  const finalDraft: PayloadDraft = {
    ...props.message.payloadDraft,
    validated: workingPatches.value.map((p) => ({ ...p })),
    editedTimes: (props.message.payloadDraft.editedTimes ?? 0) + (workingPatches.value.some((p, i) => JSON.stringify(p) !== JSON.stringify(props.message?.payloadDraft?.validated[i])) ? 1 : 0),
  };
  emit('inject', props.message.id, finalDraft);
  showInjectConfirm.value = false;
  close();
}

function statusColor(status: ValidatedPatch['status']): string {
  return status === 'error' ? 'var(--color-danger)' : status === 'warn' ? 'var(--color-amber-400)' : 'var(--color-success)';
}

function statusLabel(status: ValidatedPatch['status']): string {
  return status === 'error' ? '✗ 错误' : status === 'warn' ? '⚠ 警告' : '✓ 通过';
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="📦 注入包预览"
    width="1200px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="preview-body">
      <div class="three-col">
        <!-- LEFT: AI 原文 -->
        <section class="col col-left">
          <h3 class="col-title">AI 原文</h3>
          <div class="raw-text">{{ aiRawText }}</div>
        </section>

        <!-- MIDDLE: patches 列表 -->
        <section class="col col-middle">
          <h3 class="col-title">
            Patches（{{ workingPatches.length }}）
            <span class="status-summary">
              <span class="dot ok" />{{ okCount }}
              <span class="dot warn" />{{ warnCount }}
              <span class="dot err" />{{ errorCount }}
            </span>
          </h3>
          <div class="patches-list">
            <div
              v-for="(p, i) in workingPatches"
              :key="i"
              class="patch-row"
              :class="{ selected: selectedPatchIdx === i, 'is-error': p.status === 'error' }"
              @click="selectedPatchIdx = i"
            >
              <span class="status-badge" :style="{ color: statusColor(p.status) }">
                {{ statusLabel(p.status) }}
              </span>
              <span class="patch-op">{{ p.op }}</span>
              <span class="patch-target">{{ p.target }}</span>
              <p v-if="p.rationale" class="patch-rationale">{{ p.rationale }}</p>
              <ul v-if="p.issues.length > 0" class="patch-issues">
                <li v-for="(issue, j) in p.issues" :key="j">{{ issue }}</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- RIGHT: diff -->
        <section class="col col-right">
          <h3 class="col-title">
            Diff 预览
            <button v-if="selectedPatch" class="edit-btn" @click="startEditPatch">✏ 编辑</button>
          </h3>
          <div v-if="!selectedPatch" class="diff-empty">点击中栏的 patch 查看 diff</div>
          <template v-else>
            <div v-if="!isEditingJson" class="diff-content">
              <div class="diff-section">
                <div class="diff-label">当前值（before）</div>
                <pre class="diff-pre before">{{ diffPreview?.before }}</pre>
              </div>
              <div class="diff-section">
                <div class="diff-label">注入后（after）</div>
                <pre class="diff-pre after">{{ diffPreview?.after }}</pre>
              </div>
            </div>
            <div v-else class="json-edit">
              <div class="edit-hint">
                直接编辑此 patch 的 JSON。失焦后会重新校验。
              </div>
              <JsonEditor v-model="editJsonText" />
              <div v-if="editJsonError" class="edit-error">{{ editJsonError }}</div>
              <div class="edit-actions">
                <button class="btn btn--secondary" @click="cancelEditPatch">取消</button>
                <button class="btn btn--primary" @click="saveEditedPatch">保存并校验</button>
              </div>
            </div>
          </template>
        </section>
      </div>

      <div v-if="errorCount > 0" class="bottom-warn">
        ⚠ 存在 {{ errorCount }} 个 error 级 patch —— 注入按钮已禁用。请编辑修复或丢弃整个注入包。
      </div>
    </div>

    <template #footer>
      <button class="btn btn--danger" @click="discard">丢弃</button>
      <button class="btn btn--primary" :disabled="!canInject" @click="tryInject">
        {{ canInject ? '✓ 全部注入' : '存在错误，无法注入' }}
      </button>
    </template>

    <!-- 二次确认子 modal -->
    <Modal
      :model-value="showInjectConfirm"
      title="确认注入"
      width="450px"
      @update:model-value="(v: boolean) => { if (!v) showInjectConfirm = false; }"
    >
      <p>此操作会将 <strong>{{ workingPatches.length }} 个 patch</strong> 应用到游戏数据。</p>
      <p class="confirm-hint">注入前会自动创建快照，可在事后点 [↶ 撤销] 回退。</p>
      <template #footer>
        <button class="btn btn--secondary" @click="showInjectConfirm = false">取消</button>
        <button class="btn btn--primary" @click="doInject">确认注入</button>
      </template>
    </Modal>
  </Modal>
</template>

<style scoped>
.preview-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 70vh;
  min-height: 500px;
}

.three-col {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 1fr 1.2fr 1.3fr;
  gap: 12px;
  min-height: 0;
}

.col {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  min-height: 0;
}

.col-title {
  margin: 0;
  padding: 8px 12px;
  font-size: 0.86rem;
  font-weight: 600;
  background: color-mix(in oklch, var(--color-text-umber) 6%, transparent);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 400;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 2px;
}
.dot.ok { background: var(--color-success); }
.dot.warn { background: var(--color-amber-400); }
.dot.err { background: var(--color-danger); }

.raw-text, .patches-list, .diff-content, .json-edit {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 10px 12px;
}

.raw-text {
  white-space: pre-wrap;
  font-size: 0.82rem;
  color: var(--color-text);
  line-height: 1.5;
}

.patch-row {
  padding: 8px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.1s;
}
.patch-row:hover { background: color-mix(in oklch, var(--color-sage-400) 6%, transparent); }
.patch-row.selected { background: color-mix(in oklch, var(--color-sage-400) 12%, transparent); border-color: var(--color-sage-400); }
.patch-row.is-error { box-shadow: inset 3px 0 0 var(--color-danger); }

.status-badge {
  font-size: 0.74rem;
  font-weight: 600;
  margin-right: 8px;
}
.patch-op {
  display: inline-block;
  padding: 2px 6px;
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  border-radius: 3px;
  font-size: 0.72rem;
  font-family: monospace;
  color: var(--color-sage-400);
  margin-right: 6px;
}
.patch-target {
  font-family: monospace;
  font-size: 0.78rem;
}
.patch-rationale {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.patch-issues {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 0.74rem;
  color: var(--color-danger);
}

.diff-empty {
  padding: 20px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.84rem;
}

.diff-section {
  margin-bottom: 12px;
}
.diff-label {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}
.diff-pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.78rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
}
.diff-pre.before { background: color-mix(in oklch, var(--color-danger) 6%, transparent); border: 1px solid color-mix(in oklch, var(--color-danger) 18%, transparent); }
.diff-pre.after { background: color-mix(in oklch, var(--color-success) 6%, transparent); border: 1px solid color-mix(in oklch, var(--color-success) 18%, transparent); }

.edit-btn {
  padding: 3px 10px;
  font-size: 0.74rem;
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  color: var(--color-sage-400);
  border: 1px solid var(--color-sage-400);
  border-radius: 4px;
  cursor: pointer;
}

.json-edit { display: flex; flex-direction: column; gap: 8px; }
.edit-hint { font-size: 0.78rem; color: var(--color-text-secondary); }
.edit-error {
  padding: 6px 10px;
  background: color-mix(in oklch, var(--color-danger) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 25%, transparent);
  border-radius: 4px;
  color: var(--color-danger);
  font-size: 0.78rem;
}
.edit-actions { display: flex; justify-content: flex-end; gap: 6px; }

.bottom-warn {
  flex-shrink: 0;
  padding: 8px 12px;
  background: color-mix(in oklch, var(--color-danger) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 25%, transparent);
  border-radius: 4px;
  color: var(--color-danger);
  font-size: 0.82rem;
}

.confirm-hint {
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn--primary { background: var(--color-sage-400); color: var(--color-text-bone); }
.btn--secondary { background: color-mix(in oklch, var(--color-text-umber) 10%, transparent); color: var(--color-text); }
.btn--danger { background: color-mix(in oklch, var(--color-danger) 12%, transparent); color: var(--color-danger); border: 1px solid color-mix(in oklch, var(--color-danger) 30%, transparent); }
</style>
