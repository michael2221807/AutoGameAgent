<script setup lang="ts">
/**
 * AttachmentPickerModal — 用户选择 attach path + scope 的对话框
 *
 * UX 流程：
 * 1. 顶部 toggle：仅显示可编辑路径（默认开）
 * 2. StateTreeBrowser 多选模式（v-model:selectedPaths）
 * 3. 已选路径列表显示在底部，每条用户可指定 scope（context / target）
 *    - target 至多 1 个；选中第二个 target 时 toast 提示 + 把第一个降级为 context
 * 4. 确认 → emit 'confirm' (AttachmentSpec[])
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §6.2 + Phase 5b。
 */
import { ref, computed, watch } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import StateTreeBrowser from './StateTreeBrowser.vue';
import { eventBus } from '@/engine/core/event-bus';
import type { AttachmentSpec } from '@/engine/services/assistant/types';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  /** 已经被 outer attached 的 paths（避免重复添加） */
  alreadyAttached?: AttachmentSpec[];
}>(), { alreadyAttached: () => [] });

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirm': [attachments: AttachmentSpec[]];
}>();

// ─── State ─────────────────────────────────────────

const showOnlyEditable = ref(true);
const selectedPaths = ref<string[]>([]);
const targetPath = ref<string | null>(null); // 当前指定为 target 的那条

// 当 modal 打开时重置选择（保留外部的 alreadyAttached 作为已选状态）
watch(() => props.modelValue, (open) => {
  if (open) {
    selectedPaths.value = props.alreadyAttached.map((a) => a.path);
    const existingTarget = props.alreadyAttached.find((a) => a.scope === 'target');
    targetPath.value = existingTarget?.path ?? null;
  }
});

// ─── Actions ───────────────────────────────────────

function close(): void { emit('update:modelValue', false); }

function setAsTarget(path: string): void {
  if (targetPath.value === path) {
    targetPath.value = null;
    return;
  }
  if (targetPath.value && targetPath.value !== path) {
    eventBus.emit('ui:toast', {
      type: 'info',
      message: `「${targetPath.value.split('.').pop()}」已降级为只读参考`,
      duration: 2000,
    });
  }
  targetPath.value = path;
}

function removeFromSelection(path: string): void {
  selectedPaths.value = selectedPaths.value.filter((p) => p !== path);
  if (targetPath.value === path) targetPath.value = null;
}

function confirm(): void {
  if (selectedPaths.value.length === 0) {
    emit('confirm', []);
    close();
    return;
  }
  const result: AttachmentSpec[] = selectedPaths.value.map((path) => ({
    path,
    scope: targetPath.value === path ? 'target' : 'context',
  }));
  emit('confirm', result);
  close();
}

// ─── Helpers ───────────────────────────────────────

const selectedCount = computed(() => selectedPaths.value.length);
const hasTarget = computed(() => targetPath.value !== null);
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="选择附件"
    width="900px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="picker-body">
      <div class="picker-header">
        <label class="filter-toggle">
          <input v-model="showOnlyEditable" type="checkbox" />
          <span>仅显示可编辑路径（推荐）</span>
        </label>
        <p class="hint">
          点击展开节点 · 勾选 checkbox 添加到附件 · 添加后可在底部指定为「目标」（AI 修改对象）
        </p>
      </div>

      <div class="browser-host">
        <StateTreeBrowser
          v-model:selected-paths="selectedPaths"
          selection-mode="multi"
          :show-only-editable="showOnlyEditable"
          :target-path="targetPath"
        />
      </div>

      <div class="picked-list">
        <div class="picked-header">
          <strong>已选 {{ selectedCount }} 项</strong>
          <span v-if="hasTarget" class="target-hint">✏ 含 1 个目标</span>
          <span v-else class="target-hint warn">未指定目标 → 仅作为参考</span>
        </div>
        <div v-if="selectedCount === 0" class="picked-empty">
          未选择任何路径
        </div>
        <div
          v-for="path in selectedPaths"
          :key="path"
          class="picked-row"
          :class="{ 'is-target': targetPath === path }"
        >
          <div class="picked-path">{{ path }}</div>
          <div class="picked-actions">
            <button
              class="scope-btn"
              :class="{ active: targetPath === path }"
              :title="targetPath === path ? '取消目标标记' : '标记为修改目标（AI 会输出 patch）'"
              @click="setAsTarget(path)"
            >
              {{ targetPath === path ? '✓ 目标' : '设为目标' }}
            </button>
            <button class="remove-btn" title="移除" @click="removeFromSelection(path)">×</button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn--secondary" @click="close">取消</button>
      <button class="btn btn--primary" @click="confirm">确认 ({{ selectedCount }})</button>
    </template>
  </Modal>
</template>

<style scoped>
.picker-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 70vh;
  min-height: 400px;
}

.picker-header {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 0.86rem;
}
.filter-toggle input { cursor: pointer; }

.hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}

.browser-host {
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.picked-list {
  flex-shrink: 0;
  max-height: 30%;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px;
}

.picked-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 6px;
  font-size: 0.84rem;
}
.target-hint {
  font-size: 0.78rem;
  color: var(--color-success);
}
.target-hint.warn {
  color: var(--color-text-secondary);
}

.picked-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
}

.picked-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  margin: 2px 0;
}
.picked-row.is-target {
  background: color-mix(in oklch, var(--color-success) 8%, transparent);
  box-shadow: inset 3px 0 0 var(--color-success);
}

.picked-path {
  flex: 1 1 auto;
  font-family: monospace;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picked-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.scope-btn {
  padding: 3px 10px;
  font-size: 0.76rem;
  border: 1px solid var(--color-border);
  background: color-mix(in oklch, var(--color-text-umber) 6%, transparent);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
}
.scope-btn.active {
  background: color-mix(in oklch, var(--color-success) 15%, transparent);
  border-color: var(--color-success);
  color: var(--color-success);
}

.remove-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: color-mix(in oklch, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}
.remove-btn:hover { background: color-mix(in oklch, var(--color-danger) 25%, transparent); }

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
}
.btn--primary { background: var(--color-sage-400); color: var(--color-text-bone); }
.btn--secondary { background: color-mix(in oklch, var(--color-text-umber) 10%, transparent); color: var(--color-text); }
</style>
