<script setup lang="ts">
/**
 * CustomPresetModal — 用户自定义创角预设的填写表单
 *
 * 使用场景（2026-04-14 Phase 2）：
 * - StepSelectOne / StepSelectMany 的"+ 自定义"按钮触发新增
 * - 现有 user 项的"编辑 ✏"按钮触发编辑（带 initialData）
 *
 * 字段定义来自 creation-flow.json 中 step.customSchema.fields，
 * 每个字段渲染对应原生输入框（text / textarea / number），
 * 提交前校验 required + number 的 min/max。
 *
 * 校验失败时显示错误列表，不关闭 modal。
 * 校验通过 → emit `submit` 把 fields 对象传给父组件 → 父组件调
 * useCreationFlow.addCustomPreset / updateCustomPreset 落盘。
 */
import { ref, computed, watch } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import type { CustomPresetSchema } from '@/engine/types';

const props = withDefaults(defineProps<{
  /** 控制显示（v-model:modelValue） */
  modelValue: boolean;
  /** 标题，区分新增 vs 编辑 */
  title: string;
  /** 字段 schema —— 决定渲染哪些输入 */
  schema: CustomPresetSchema;
  /** 编辑模式：传入已有 entry 的字段值；新增模式留空 */
  initialData?: Record<string, unknown>;
  /** 保存按钮 loading 态（外部决定，例如等 IDB 写入或 AI 生成中） */
  saving?: boolean;
}>(), {
  initialData: undefined,
  saving: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 校验通过后提交字段对象（不含 id/source/createdAt —— 由 store 补） */
  submit: [fields: Record<string, unknown>];
}>();

// ─── Form state ────────────────────────────────────────────

const formData = ref<Record<string, unknown>>({});
const errors = ref<string[]>([]);

/** 打开 / initialData 变化时重置表单 */
watch(
  () => [props.modelValue, props.initialData] as const,
  ([open, init]) => {
    if (!open) return;
    formData.value = buildInitialFormData(init);
    errors.value = [];
  },
  { immediate: true },
);

/**
 * 初始化表单值
 * - 编辑模式：从 initialData 中按 schema 字段 key 取值
 * - 新增模式：每个字段填默认值（number = 0 或 default，其他 = ''）
 */
function buildInitialFormData(init: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of props.schema.fields) {
    if (init && f.key in init) {
      out[f.key] = init[f.key];
    } else if (f.default !== undefined) {
      out[f.key] = f.default;
    } else if (f.type === 'number') {
      out[f.key] = 0;
    } else {
      out[f.key] = '';
    }
  }
  return out;
}

// ─── Validation ────────────────────────────────────────────

function validate(): boolean {
  const errs: string[] = [];
  for (const f of props.schema.fields) {
    const v = formData.value[f.key];
    // required check
    if (f.required) {
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        errs.push(`${f.label} 不能为空`);
        continue;
      }
    }
    // number range check
    if (f.type === 'number') {
      const n = Number(v);
      if (v !== '' && v !== null && Number.isFinite(n)) {
        if (typeof f.min === 'number' && n < f.min) {
          errs.push(`${f.label} 不能小于 ${f.min}`);
        }
        if (typeof f.max === 'number' && n > f.max) {
          errs.push(`${f.label} 不能大于 ${f.max}`);
        }
      } else if (f.required) {
        errs.push(`${f.label} 必须是数字`);
      }
    }
  }
  errors.value = errs;
  return errs.length === 0;
}

// ─── Actions ───────────────────────────────────────────────

function close(): void {
  emit('update:modelValue', false);
}

function submit(): void {
  if (!validate()) return;
  // 数字字段强制转 number 类型再提交
  const out: Record<string, unknown> = { ...formData.value };
  for (const f of props.schema.fields) {
    if (f.type === 'number' && out[f.key] !== '' && out[f.key] !== null) {
      out[f.key] = Number(out[f.key]);
    }
  }
  emit('submit', out);
}

// ─── Computed ──────────────────────────────────────────────

const submitDisabled = computed(() => props.saving);

/**
 * v-model 类型适配 —— 把 unknown 包装成 string，避免 vue-tsc 抱怨
 * formData[key] 是 unknown（schema-driven 字段无静态类型）
 */
function getVal(key: string): string {
  const v = formData.value[key];
  return v === null || v === undefined ? '' : String(v);
}
function setVal(key: string, v: string): void {
  formData.value[key] = v;
}
</script>

<template>
  <Modal :model-value="modelValue" :title="title" width="500px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="custom-preset-form">
      <div v-for="field in schema.fields" :key="field.key" class="form-row">
        <label :for="`fld-${field.key}`" class="form-label">
          {{ field.label }}
          <span v-if="field.required" class="required-mark">*</span>
        </label>

        <input
          v-if="field.type === 'text'"
          :id="`fld-${field.key}`"
          :value="getVal(field.key)"
          type="text"
          :placeholder="field.placeholder"
          class="form-input"
          @input="setVal(field.key, ($event.target as HTMLInputElement).value)"
        />

        <textarea
          v-else-if="field.type === 'textarea'"
          :id="`fld-${field.key}`"
          :value="getVal(field.key)"
          :placeholder="field.placeholder"
          :rows="field.rows ?? 4"
          class="form-textarea"
          @input="setVal(field.key, ($event.target as HTMLTextAreaElement).value)"
        />

        <input
          v-else-if="field.type === 'number'"
          :id="`fld-${field.key}`"
          :value="getVal(field.key)"
          type="number"
          :placeholder="field.placeholder"
          :min="field.min"
          :max="field.max"
          class="form-input form-input--number"
          @input="setVal(field.key, ($event.target as HTMLInputElement).value)"
        />
      </div>

      <ul v-if="errors.length" class="form-errors">
        <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
      </ul>
    </div>

    <template #footer>
      <button class="btn btn--secondary" :disabled="saving" @click="close">取消</button>
      <button class="btn btn--primary" :disabled="submitDisabled" @click="submit">
        <span v-if="saving" class="btn-spinner" />
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Hardcoded rgba input bg (`rgba(255,255,255,0.04)`) → tokenized surface-input
   - Focus: raw indigo border → sage 3px ring + sage 3% wash (matches StepForm)
   - form-errors: Tailwind rgba rust + `#fca5a5` → tokenized color-mix
   - Footer buttons: `#fff` on primary + `rgba(255,255,255,...)` secondary →
     sage-muted beacon + neutral outline (matches AgaButton language)
   - btn-spinner: `#fff` → currentColor (works against any button bg) */

.custom-preset-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
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

.form-input,
.form-textarea {
  padding: 9px 12px;
  background: var(--color-surface-input);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-serif-cjk);
  font-size: 0.86rem;
  line-height: 1.6;
  letter-spacing: 0.01em;
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.form-input::placeholder,
.form-textarea::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
  font-style: italic;
}
.form-input:focus,
.form-textarea:focus {
  border-color: color-mix(in oklch, var(--color-sage-400) 45%, transparent);
  background: color-mix(in oklch, var(--color-sage-400) 3%, var(--color-surface-input));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 12%, transparent);
}
.form-textarea {
  resize: vertical;
  min-height: 90px;
}
.form-input--number {
  max-width: 140px;
  font-family: var(--font-mono);
}

.form-errors {
  margin: 6px 0 0;
  padding: 10px 14px 10px 30px;
  border-radius: var(--radius-md);
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-danger) 30%, transparent);
  color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
  font-family: var(--font-sans);
  font-size: 0.76rem;
  line-height: 1.7;
  letter-spacing: 0.02em;
  list-style: '• ';
}
.form-errors li { padding-left: 4px; }

/* ── Footer buttons — sanctuary AgaButton language ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 18px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 0.82rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--primary {
  background: var(--color-sage-muted);
  color: var(--color-sage-100);
  border-color: color-mix(in oklch, var(--color-sage-400) 35%, transparent);
}
.btn--primary:not(:disabled):hover {
  background: color-mix(in oklch, var(--color-sage-400) 22%, transparent);
  border-color: var(--color-sage-400);
  box-shadow: 0 0 14px color-mix(in oklch, var(--color-sage-400) 28%, transparent);
}

.btn--secondary {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}
.btn--secondary:not(:disabled):hover {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-text) 4%, transparent);
}

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in oklch, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: cpm-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes cpm-spin {
  to { transform: rotate(360deg); }
}
</style>
