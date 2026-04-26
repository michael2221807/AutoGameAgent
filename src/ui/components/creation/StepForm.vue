<script setup lang="ts">
/**
 * StepForm — 创角步骤：通用表单。
 *
 * 根据 step.fields（FormFieldConfig[]）渲染表单字段。
 * 支持 text / number / select / textarea 类型。
 * 验证 required 字段，当用户修改任意字段时通过 select 事件发出完整表单数据。
 */
import { computed, reactive, watch } from 'vue';
import type { CreationStep, FormFieldConfig } from '@/engine/types';

const props = defineProps<{
  step: CreationStep;
  presets: unknown[];
  /** 当前表单数据 — Record<string, unknown> */
  selection: unknown;
  budget: number;
}>();

const emit = defineEmits<{
  select: [value: unknown];
}>();

/** 字段定义列表 */
const fields = computed<FormFieldConfig[]>(() => props.step.fields ?? []);

/** 内部表单数据 */
const formData = reactive<Record<string, unknown>>(buildInitial());

function buildInitial(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const sel = (typeof props.selection === 'object' && props.selection !== null)
    ? props.selection as Record<string, unknown>
    : {};

  for (const field of (props.step.fields ?? [])) {
    if (field.key in sel) {
      data[field.key] = sel[field.key];
    } else if (field.default !== undefined) {
      data[field.key] = field.default;
    } else {
      data[field.key] = field.type === 'number' ? (field.min ?? 0) : '';
    }
  }
  return data;
}

/** selection prop 变更时同步 */
watch(() => props.selection, () => {
  const fresh = buildInitial();
  for (const key of Object.keys(fresh)) {
    formData[key] = fresh[key];
  }
}, { deep: true });

/** 字段变更 — 发出整个表单数据 */
function onFieldChange(): void {
  emit('select', { ...formData });
}

/** 获取字段显示标签 */
function getLabel(field: FormFieldConfig): string {
  return field.label ?? field.key;
}

/** 验证必填字段是否已填 */
const hasValidationErrors = computed<boolean>(() =>
  fields.value.some((f) => {
    if (!f.required) return false;
    const v = formData[f.key];
    if (v === undefined || v === null || v === '') return true;
    return false;
  }),
);

/** 获取单个字段是否有错误 */
function fieldHasError(field: FormFieldConfig): boolean {
  if (!field.required) return false;
  const v = formData[field.key];
  return v === undefined || v === null || v === '';
}

/**
 * 处理 number 字段输入 — 限制 min/max，存为 number 类型
 */
function onNumberInput(field: FormFieldConfig, event: Event): void {
  const target = event.target as HTMLInputElement;
  let val = Number(target.value);
  if (Number.isNaN(val)) val = field.min ?? 0;
  if (field.min !== undefined && val < field.min) val = field.min;
  if (field.max !== undefined && val > field.max) val = field.max;
  formData[field.key] = val;
  onFieldChange();
}

/** 处理文本类字段输入（text / textarea） */
function onTextInput(field: FormFieldConfig, event: Event): void {
  formData[field.key] = (event.target as HTMLInputElement).value;
  onFieldChange();
}

/** 处理 select 字段变更 */
function onSelectChange(field: FormFieldConfig, event: Event): void {
  formData[field.key] = (event.target as HTMLSelectElement).value;
  onFieldChange();
}

/** 安全地将 unknown 转为字符串用于 :value 绑定 */
function asString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return '';
  return String(val);
}

/* 暴露验证状态供父组件使用 */
defineExpose({ hasValidationErrors });
</script>

<template>
  <div class="step-form">
    <h3 class="step-title">{{ step.label }}</h3>

    <form class="form-body" @submit.prevent>
      <div
        v-for="field in fields"
        :key="field.key"
        class="form-group"
        :class="{ 'has-error': fieldHasError(field) }"
      >
        <label :for="`field-${field.key}`" class="form-label">
          {{ getLabel(field) }}
          <span v-if="field.required" class="required-mark">*</span>
        </label>

        <!-- Text -->
        <input
          v-if="field.type === 'text'"
          :id="`field-${field.key}`"
          :value="asString(formData[field.key])"
          type="text"
          class="form-input"
          :required="field.required"
          @input="onTextInput(field, $event)"
        />

        <!-- Number -->
        <input
          v-else-if="field.type === 'number'"
          :id="`field-${field.key}`"
          type="number"
          class="form-input"
          :value="formData[field.key]"
          :min="field.min"
          :max="field.max"
          :required="field.required"
          @input="onNumberInput(field, $event)"
        />

        <!-- Select -->
        <select
          v-else-if="field.type === 'select'"
          :id="`field-${field.key}`"
          :value="asString(formData[field.key])"
          class="form-input form-select"
          :required="field.required"
          @change="onSelectChange(field, $event)"
        >
          <option value="" disabled>请选择…</option>
          <option v-for="opt in (field.options ?? [])" :key="opt" :value="opt">
            {{ opt }}
          </option>
        </select>

        <!-- Textarea -->
        <textarea
          v-else-if="field.type === 'textarea'"
          :id="`field-${field.key}`"
          :value="asString(formData[field.key])"
          class="form-input form-textarea"
          :required="field.required"
          rows="4"
          @input="onTextInput(field, $event)"
        />
      </div>
    </form>

    <p v-if="hasValidationErrors" class="validation-hint">
      请填写所有必填字段
    </p>
  </div>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Form inputs: bg surface-input; focus sage 3px ring + sage micro-wash
     (matches SearchInput / MainGamePanel input language)
   - Textarea: serif font for narrative-style input (matches MainGamePanel)
   - Native `<select>` gains a sanctuary-tinted SVG chevron (per
     project_native_form_styling memory — browser defaults never OK)
   - has-error: danger border + 3px rust ring (echoes focus treatment)
   - validation-hint: sans + tokenized rust color */

.step-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.step-title {
  font-family: var(--font-serif-cjk);
  font-size: 1.2rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-text);
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 640px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-label {
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary);
}

.required-mark {
  color: color-mix(in oklch, var(--color-danger) 90%, var(--color-text));
  margin-left: 3px;
}

.form-input {
  padding: 0.575rem 0.75rem;
  background: var(--color-surface-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: var(--font-serif-cjk);
  font-size: 0.88rem;
  line-height: 1.6;
  letter-spacing: 0.01em;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.form-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-style: italic;
}

.form-input:focus {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 3%, var(--color-surface-input));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 12%, transparent);
}

/* Native select — custom chevron so it never shows the browser default.
   The stroke color `%23a0968c` is a warm umber that reads well on surface-input. */
.form-select {
  appearance: none;
  cursor: pointer;
  font-family: var(--font-sans);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a0968c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

.form-textarea {
  resize: vertical;
  font-family: var(--font-serif-cjk);
  line-height: 1.7;
  min-height: 100px;
}

.form-group.has-error .form-input {
  border-color: color-mix(in oklch, var(--color-danger) 45%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-danger) 10%, transparent);
}

.validation-hint {
  font-family: var(--font-sans);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
  margin-top: 4px;
}
</style>
