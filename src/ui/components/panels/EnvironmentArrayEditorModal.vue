<script setup lang="ts">
/**
 * Environment array editor — quick-action for `世界.环境`.
 *
 * Shows a list of current env tags with delete icons. "添加" button opens
 * an inline form for a new tag (名称/描述/效果). Cap at 3 tags (enforced
 * both in UI and in the builder). On apply, emits the full replacement
 * array.
 *
 * Matches the P2 force-update convention: AssistantPanel fires
 * `set 世界.环境 = [the user's array]`, not push/delete.
 */
import { ref, watch, computed, nextTick } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import {
  buildReplaceEnvironmentAttachment,
  type EnvTag,
} from './assistant-env-attachments';

const props = defineProps<{
  modelValue: boolean;
  /** Current env tag array — seeded on open for incremental editing. */
  current?: EnvTag[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  apply: [tags: EnvTag[]];
}>();

const MAX_TAGS = 3;

const tags = ref<EnvTag[]>([]);
const error = ref('');

// Form state for adding a new tag
const showForm = ref(false);
const newName = ref('');
const newDesc = ref('');
const newEffect = ref('');
const newNameInputRef = ref<HTMLInputElement | null>(null);

function clearError(): void {
  if (error.value) error.value = '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      tags.value = (props.current ?? []).map((t) => ({ ...t }));
      error.value = '';
      showForm.value = false;
      newName.value = '';
      newDesc.value = '';
      newEffect.value = '';
    }
  },
);

const canAdd = computed(() => tags.value.length < MAX_TAGS);

function beginAdd(): void {
  if (!canAdd.value) return;
  showForm.value = true;
  newName.value = '';
  newDesc.value = '';
  newEffect.value = '';
  nextTick(() => newNameInputRef.value?.focus());
}

function confirmAdd(): void {
  const trimmedName = newName.value.trim();
  if (!trimmedName) {
    error.value = '新标签的名称不能为空';
    return;
  }
  if (tags.value.length >= MAX_TAGS) {
    error.value = `最多 ${MAX_TAGS} 条环境标签`;
    return;
  }
  tags.value.push({
    名称: trimmedName,
    描述: newDesc.value.trim(),
    效果: newEffect.value.trim(),
  });
  showForm.value = false;
  error.value = '';
}

function cancelAdd(): void {
  showForm.value = false;
  error.value = '';
}

function removeTag(index: number): void {
  tags.value.splice(index, 1);
  error.value = '';
}

function clearAll(): void {
  tags.value = [];
  error.value = '';
}

function onApply(): void {
  const result = buildReplaceEnvironmentAttachment(tags.value);
  if (!result.ok) {
    error.value = result.reason;
    return;
  }
  emit('apply', result.value);
  emit('update:modelValue', false);
}

function onCancel(): void {
  emit('update:modelValue', false);
}
</script>

<template>
  <Modal
    :model-value="modelValue"
    title="编辑环境标签"
    width="520px"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="env-editor">
      <div class="editor-header">
        <span class="count-label">
          当前 {{ tags.length }}/{{ MAX_TAGS }} 条
        </span>
        <button
          v-if="tags.length > 0"
          type="button"
          class="btn btn-ghost"
          @click="clearAll"
        >
          全部清空
        </button>
      </div>

      <ul v-if="tags.length > 0" class="tag-list">
        <li v-for="(tag, i) in tags" :key="`${i}-${tag.名称}`" class="tag-item">
          <div class="tag-body">
            <div class="tag-name">{{ tag.名称 }}</div>
            <div v-if="tag.描述" class="tag-desc">{{ tag.描述 }}</div>
            <div v-if="tag.效果" class="tag-effect">{{ tag.效果 }}</div>
          </div>
          <button type="button" class="tag-remove" @click="removeTag(i)" aria-label="删除">
            ×
          </button>
        </li>
      </ul>
      <p v-else class="empty-state">（暂无环境标签 · 应用后将清空）</p>

      <div v-if="showForm" class="add-form">
        <input
          ref="newNameInputRef"
          v-model="newName"
          class="form-input"
          placeholder="名称（必填，4 CJK 优选）"
          @input="clearError"
          @keydown.enter="confirmAdd"
        />
        <input
          v-model="newDesc"
          class="form-input"
          placeholder="描述（可空，12-25 字）"
          @keydown.enter="confirmAdd"
        />
        <input
          v-model="newEffect"
          class="form-input"
          placeholder="效果（可空，机械措辞）"
          @keydown.enter="confirmAdd"
        />
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" @click="cancelAdd">取消</button>
          <button type="button" class="btn btn-primary" @click="confirmAdd">添加</button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="btn btn-secondary add-btn"
        :disabled="!canAdd"
        @click="beginAdd"
      >
        + 添加标签 {{ canAdd ? '' : `(已达 ${MAX_TAGS} 条上限)` }}
      </button>

      <p v-if="error" class="editor-error">{{ error }}</p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" @click="onCancel">取消</button>
      <button type="button" class="btn btn-primary" @click="onApply">应用</button>
    </template>
  </Modal>
</template>

<style scoped>
.env-editor {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.count-label {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
}
.tag-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0;
  margin: 0;
  list-style: none;
}
.tag-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  box-shadow: inset 3px 0 0 color-mix(in oklch, var(--color-sage-400) 35%, transparent);
  border-radius: 4px;
  background: var(--color-surface);
}
.tag-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.tag-name {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--color-primary);
}
.tag-desc {
  font-size: 0.75rem;
  opacity: 0.8;
}
.tag-effect {
  font-size: 0.7rem;
  color: rgba(74, 222, 128, 0.85);
  font-style: italic;
}
.tag-remove {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 0.3rem;
  line-height: 1;
}
.tag-remove:hover {
  color: var(--color-danger);
}
.empty-state {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-align: center;
  padding: 0.5rem;
  margin: 0;
}
.add-btn {
  width: 100%;
  padding: 0.5rem;
  border-style: dashed;
}
.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
  background: color-mix(in srgb, var(--color-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  border-radius: 4px;
}
.form-input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 0.82rem;
}
.form-input:focus {
  outline: 1px solid var(--color-primary);
  outline-offset: 1px;
}
.form-actions {
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
}
.editor-error {
  color: var(--color-danger);
  font-size: 0.78rem;
  margin: 0;
}
.btn {
  padding: 0.4rem 0.9rem;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  border: 1px solid var(--color-border);
}
.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  padding: 0.25rem 0.6rem;
}
.btn-secondary {
  background: transparent;
  color: var(--color-text);
}
.btn-primary {
  background: var(--color-primary);
  color: var(--color-sage-100);
  border-color: var(--color-sage-400);
}
.btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
</style>
