<script setup lang="ts">
/**
 * SchemaField — JSON Schema 驱动的单字段渲染器。
 *
 * 根据 fieldSchema.type 渲染对应的表单控件：
 *   string → text input
 *   number / integer → number input
 *   boolean → toggle switch
 *   enum (string + enum) → select dropdown
 *   array → 可增删的列表
 *   object → 递归渲染 SchemaForm
 *
 * 当值与 defaultValue 不同时显示 "已修改" 指示器和重置按钮。
 */
import { computed } from 'vue';

/** Schema 属性的运行时类型契约 */
interface FieldSchemaDef {
  type?: string;
  enum?: string[];
  title?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, Record<string, unknown>>;
  items?: Record<string, unknown>;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

const props = defineProps<{
  /** 该字段的 JSON Schema 定义 */
  fieldSchema: Record<string, unknown>;
  /** 字段 key */
  fieldKey: string;
  /** 当前值 */
  value: unknown;
  /** 默认值（用于 modified 检测） */
  defaultValue: unknown;
  /** 字段路径（如 "character.name"），用于嵌套更新 */
  path: string;
}>();

const emit = defineEmits<{
  /** 值变更 — 携带完整路径和新值 */
  update: [path: string, value: unknown];
  /** 重置字段到默认值 */
  reset: [path: string];
}>();

/** 类型安全的 schema 访问 */
const schema = computed<FieldSchemaDef>(() => props.fieldSchema as FieldSchemaDef);

/** 字段显示标签 */
const label = computed<string>(() =>
  schema.value.title ?? props.fieldKey,
);

/** 字段描述 */
const description = computed<string | undefined>(() =>
  typeof schema.value.description === 'string' ? schema.value.description : undefined,
);

/** 推断的字段类型 */
const fieldType = computed<string>(() => {
  if (schema.value.enum) return 'enum';
  return schema.value.type ?? 'string';
});

/** 是否已修改（与默认值不同） */
const isModified = computed<boolean>(() =>
  JSON.stringify(props.value) !== JSON.stringify(props.defaultValue),
);

/** 当前数组值（array 类型专用） */
const arrayValue = computed<unknown[]>(() =>
  Array.isArray(props.value) ? props.value : [],
);

/** object 子属性 — 用于递归渲染 */
const objectProperties = computed<Record<string, Record<string, unknown>>>(() =>
  (schema.value.properties ?? {}) as Record<string, Record<string, unknown>>,
);

/** 当前 object 值 */
const objectValue = computed<Record<string, unknown>>(() => {
  if (typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value)) {
    return props.value as Record<string, unknown>;
  }
  return {};
});

/** 默认 object 值 */
const objectDefault = computed<Record<string, unknown>>(() => {
  if (typeof props.defaultValue === 'object' && props.defaultValue !== null && !Array.isArray(props.defaultValue)) {
    return props.defaultValue as Record<string, unknown>;
  }
  return {};
});

// ─── 事件处理 ───

function onStringInput(e: Event): void {
  emit('update', props.path, (e.target as HTMLInputElement).value);
}

function onNumberInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  let num = Number(raw);
  if (Number.isNaN(num)) num = 0;
  if (schema.value.minimum !== undefined && num < schema.value.minimum) num = schema.value.minimum;
  if (schema.value.maximum !== undefined && num > schema.value.maximum) num = schema.value.maximum;
  emit('update', props.path, num);
}

function onBooleanToggle(): void {
  emit('update', props.path, !props.value);
}

function onEnumSelect(e: Event): void {
  emit('update', props.path, (e.target as HTMLSelectElement).value);
}

function onResetClick(): void {
  emit('reset', props.path);
}

// ─── 数组操作 ───

function addArrayItem(): void {
  const itemSchema = schema.value.items;
  const newItem = itemSchema && typeof itemSchema === 'object' && 'default' in itemSchema
    ? itemSchema.default
    : '';
  emit('update', props.path, [...arrayValue.value, newItem]);
}

function removeArrayItem(index: number): void {
  const next = arrayValue.value.filter((_, i) => i !== index);
  emit('update', props.path, next);
}

function updateArrayItem(index: number, val: unknown): void {
  const next = [...arrayValue.value];
  next[index] = val;
  emit('update', props.path, next);
}

// ─── 嵌套 object 子字段事件代理 ───

function onChildUpdate(childPath: string, childValue: unknown): void {
  emit('update', childPath, childValue);
}

function onChildReset(childPath: string): void {
  emit('reset', childPath);
}
</script>

<template>
  <div class="schema-field" :class="{ modified: isModified }">
    <div class="field-header">
      <label class="field-label">
        {{ label }}
        <span v-if="isModified" class="modified-dot" title="已修改" />
      </label>
      <button
        v-if="isModified"
        class="reset-btn"
        title="重置为默认值"
        @click="onResetClick"
      >
        重置
      </button>
    </div>

    <p v-if="description" class="field-desc">{{ description }}</p>

    <!-- String -->
    <input
      v-if="fieldType === 'string'"
      type="text"
      class="field-input"
      :value="typeof value === 'string' ? value : ''"
      @input="onStringInput"
    />

    <!-- Number / Integer -->
    <input
      v-else-if="fieldType === 'number' || fieldType === 'integer'"
      type="number"
      class="field-input"
      :value="typeof value === 'number' ? value : 0"
      :min="schema.minimum"
      :max="schema.maximum"
      @input="onNumberInput"
    />

    <!-- Boolean toggle -->
    <button
      v-else-if="fieldType === 'boolean'"
      class="toggle-btn"
      :class="{ active: !!value }"
      @click="onBooleanToggle"
    >
      <span class="toggle-track">
        <span class="toggle-thumb" />
      </span>
      <span class="toggle-label">{{ value ? '启用' : '禁用' }}</span>
    </button>

    <!-- Enum (select) -->
    <select
      v-else-if="fieldType === 'enum'"
      class="field-input field-select"
      :value="typeof value === 'string' ? value : ''"
      @change="onEnumSelect"
    >
      <option
        v-for="opt in (schema.enum ?? [])"
        :key="opt"
        :value="opt"
      >
        {{ opt }}
      </option>
    </select>

    <!-- Array -->
    <div v-else-if="fieldType === 'array'" class="array-field">
      <div
        v-for="(item, idx) in arrayValue"
        :key="idx"
        class="array-item"
      >
        <input
          type="text"
          class="field-input array-input"
          :value="typeof item === 'string' ? item : JSON.stringify(item)"
          @input="updateArrayItem(idx, ($event.target as HTMLInputElement).value)"
        />
        <button class="array-remove-btn" title="移除" @click="removeArrayItem(idx)">✕</button>
      </div>
      <button class="array-add-btn" @click="addArrayItem">+ 添加项</button>
    </div>

    <!-- Object — 递归渲染 -->
    <div v-else-if="fieldType === 'object'" class="object-field">
      <SchemaField
        v-for="(childSchema, childKey) in objectProperties"
        :key="childKey"
        :field-schema="childSchema"
        :field-key="childKey"
        :value="objectValue[childKey]"
        :default-value="objectDefault[childKey]"
        :path="`${path}.${childKey}`"
        @update="onChildUpdate"
        @reset="onChildReset"
      />
    </div>
  </div>
</template>

<style scoped>
.schema-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.modified-dot {
  width: 6px;
  height: 6px;
  background: var(--color-sage-400);
  border-radius: 50%;
  flex-shrink: 0;
}

.reset-btn {
  padding: 0.15rem 0.5rem;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.15s;
}

.reset-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.field-desc {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  opacity: 0.7;
}

.field-input {
  padding: 0.5rem 0.65rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.2s;
}

.field-input:focus {
  border-color: var(--color-sage-400);
}

.field-select {
  appearance: none;
  cursor: pointer;
}

/* Boolean toggle */
.toggle-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem 0;
}

.toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--color-border);
  border-radius: 10px;
  transition: background-color 0.2s;
}

.toggle-btn.active .toggle-track {
  background: var(--color-sage-400);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--color-text-bone);
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-btn.active .toggle-thumb {
  transform: translateX(16px);
}

.toggle-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Array field */
.array-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.array-item {
  display: flex;
  gap: 0.35rem;
}

.array-input {
  flex: 1;
}

.array-remove-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-danger);
  font-size: 0.75rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s;
}

.array-remove-btn:hover {
  background: var(--color-danger);
  color: var(--color-text-bone);
  border-color: var(--color-danger);
}

.array-add-btn {
  padding: 0.35rem 0.75rem;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}

.array-add-btn:hover {
  border-color: var(--color-sage-400);
  color: var(--color-sage-400);
}

/* Nested object */
.object-field {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  box-shadow: inset 3px 0 0 var(--color-border);
  margin-left: 0.25rem;
}
</style>
