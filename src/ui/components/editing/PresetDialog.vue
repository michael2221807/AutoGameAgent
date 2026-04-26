<script setup lang="ts">
/**
 * PresetDialog — 预设条目的添加/编辑对话框。
 *
 * 使用 BaseModal 显示模态面板，内嵌 SchemaForm 来编辑预设数据。
 * 支持两种模式:
 *   - 新增模式（existingEntry 未提供）：标题 "添加 {presetType}"
 *   - 编辑模式（existingEntry 已提供）：标题 "编辑 {presetType}"
 *
 * 保存时通过 save 事件发出完整条目数据。
 */
import { ref, computed, watch, toRaw } from 'vue';
import BaseModal from '@/ui/components/shared/BaseModal.vue';
import SchemaForm from './SchemaForm.vue';

/**
 * 2026-04-13 fix：避免 structuredClone 直接克隆 Vue reactive Proxy
 * 导致的 DOMException。先 toRaw 剥掉响应式再 JSON 深拷贝，得到纯
 * plain object（无 __v_isRef / __v_raw 内部 Symbol）。
 */
function safeDeepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}

const props = withDefaults(defineProps<{
  /** 控制对话框显示/隐藏（v-model） */
  modelValue: boolean;
  /** 预设类型标识（如 "worlds", "talents"） */
  presetType: string;
  /** 已有条目（编辑模式） — 未提供则为新增模式 */
  existingEntry?: unknown;
}>(), {
  existingEntry: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 保存条目 */
  save: [entry: unknown];
}>();

/** 是否为编辑模式 */
const isEdit = computed<boolean>(() => props.existingEntry !== undefined);

/** 对话框标题 */
const dialogTitle = computed<string>(() =>
  isEdit.value ? `编辑 ${props.presetType}` : `添加 ${props.presetType}`,
);

/**
 * 内部表单数据。
 * 编辑模式下初始化为 existingEntry 的深拷贝，
 * 新增模式下为空对象。
 */
const formValue = ref<unknown>(initFormValue());

function initFormValue(): unknown {
  if (props.existingEntry !== undefined && props.existingEntry !== null) {
    return safeDeepClone(props.existingEntry);
  }
  return {};
}

/** 当 existingEntry 变更时重新初始化 */
watch(() => props.existingEntry, () => {
  formValue.value = initFormValue();
}, { deep: true });

/** 当对话框打开时重置 */
watch(() => props.modelValue, (open) => {
  if (open) {
    formValue.value = initFormValue();
  }
});

/**
 * 默认 schema — 如果没有外部 schema 传入，使用通用键值编辑。
 * 实际项目中可扩展为按 presetType 查找对应 schema。
 */
const defaultSchema = computed<Record<string, unknown>>(() => ({
  type: 'object',
  title: props.presetType,
  properties: buildPropertiesFromValue(),
}));

/**
 * 从当前值的 key 推断 schema properties。
 * 这是一种退化策略 — 真实场景下应从 Game Pack state schema 派生。
 */
function buildPropertiesFromValue(): Record<string, Record<string, unknown>> {
  const val = typeof formValue.value === 'object' && formValue.value !== null
    ? formValue.value as Record<string, unknown>
    : {};

  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, v] of Object.entries(val)) {
    result[key] = {
      type: inferType(v),
      title: key,
    };
  }

  if (Object.keys(result).length === 0) {
    result['name'] = { type: 'string', title: 'name' };
    result['description'] = { type: 'string', title: 'description' };
  }

  return result;
}

function inferType(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'string';
}

/** SchemaForm 值更新 */
function onFormUpdate(newValue: unknown): void {
  formValue.value = newValue;
}

/** 重置表单 */
function onFormReset(): void {
  formValue.value = initFormValue();
}

/** 关闭对话框 */
function closeDialog(): void {
  emit('update:modelValue', false);
}

/** 保存 */
function saveEntry(): void {
  emit('save', safeDeepClone(formValue.value));
  closeDialog();
}
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="dialogTitle"
    max-width="600px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SchemaForm
      :schema="defaultSchema"
      :value="formValue"
      :default-value="existingEntry"
      @update:value="onFormUpdate"
      @reset="onFormReset"
    />

    <template #footer>
      <button class="btn btn-cancel" @click="closeDialog">取消</button>
      <button class="btn btn-save" @click="saveEntry">保存</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.btn {
  padding: 0.55rem 1.25rem;
  border: none;
  border-radius: 6px;
  font-size: 0.88rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.btn-cancel {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-cancel:hover {
  background: var(--color-border);
}

.btn-save {
  background: var(--color-sage-400);
  color: var(--color-text-bone);
}

.btn-save:hover {
  background: var(--color-sage-500);
}
</style>
