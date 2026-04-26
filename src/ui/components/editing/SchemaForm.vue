<script setup lang="ts">
/**
 * SchemaForm — 通用 JSON Schema 驱动的表单组件。
 *
 * 接收一个 JSON Schema 对象和当前值，为 schema.properties 中的每个字段
 * 渲染一个 SchemaField 子组件。支持嵌套对象和数组。
 *
 * 每个字段在值与 defaultValue 不同时显示 "重置" 按钮。
 */
import { computed, toRaw } from 'vue';
import SchemaField from './SchemaField.vue';

/** Schema 对象的运行时类型契约 */
interface SchemaDef {
  type?: string;
  properties?: Record<string, Record<string, unknown>>;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

const props = withDefaults(defineProps<{
  /** JSON Schema 对象 */
  schema: Record<string, unknown>;
  /** 当前值（整个表单的数据对象） */
  value: unknown;
  /** 默认值（用于 reset 和 modified 检测） */
  defaultValue?: unknown;
}>(), {
  defaultValue: undefined,
});

const emit = defineEmits<{
  /** 值变更 */
  'update:value': [value: unknown];
  /** 全部重置 */
  reset: [];
}>();

/** 类型安全的 schema */
const schemaDef = computed<SchemaDef>(() => props.schema as SchemaDef);

/** 顶层属性列表 */
const properties = computed<Record<string, Record<string, unknown>>>(() =>
  (schemaDef.value.properties ?? {}) as Record<string, Record<string, unknown>>,
);

/** 当前值对象 */
const currentObj = computed<Record<string, unknown>>(() => {
  if (typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value)) {
    return props.value as Record<string, unknown>;
  }
  return {};
});

/** 默认值对象 */
const defaultObj = computed<Record<string, unknown>>(() => {
  if (typeof props.defaultValue === 'object' && props.defaultValue !== null && !Array.isArray(props.defaultValue)) {
    return props.defaultValue as Record<string, unknown>;
  }
  return {};
});

/** 是否有任何字段被修改 */
const hasModifications = computed<boolean>(() =>
  JSON.stringify(props.value) !== JSON.stringify(props.defaultValue),
);

/**
 * 处理子字段的 update 事件。
 * path 格式为 "key" 或 "key.subkey.subsubkey"，
 * 需要在当前值对象中沿路径设置新值。
 *
 * 2026-04-13 fix：之前用 `structuredClone(currentObj.value)` 直接克隆，
 * 但 `currentObj.value` 在某些宿主下是 Vue 的 reactive Proxy（ref/reactive
 * 会给对象挂 `__v_isRef` / `__v_raw` 等内部 Symbol），structuredClone
 * 遇到这些标记会抛 `DOMException: #<Object> could not be cloned`，导致
 * 表单每次按键都静默失败 —— 用户看到「编辑按钮没用」。
 *
 * 改用 `toRaw` 先拿到原始对象再走 JSON 深拷贝，既彻底脱离 Vue 响应式
 * 代理，又保证拷贝结果是纯 plain object（无法拷贝的值在 JSON
 * 序列化时自然被剔除，行为可预测）。
 */
function onFieldUpdate(path: string, newValue: unknown): void {
  const segments = path.split('.');
  const raw = toRaw(currentObj.value);
  const root = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  if (segments.length === 1) {
    root[segments[0]] = newValue;
  } else {
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      if (typeof cursor[seg] !== 'object' || cursor[seg] === null) {
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = newValue;
  }

  emit('update:value', root);
}

/**
 * 重置单个字段到默认值。
 */
function onFieldReset(path: string): void {
  const segments = path.split('.');

  /* 从 defaultObj 中取出对应默认值 */
  let defaultVal: unknown = defaultObj.value;
  for (const seg of segments) {
    if (typeof defaultVal === 'object' && defaultVal !== null) {
      defaultVal = (defaultVal as Record<string, unknown>)[seg];
    } else {
      defaultVal = undefined;
      break;
    }
  }

  onFieldUpdate(path, defaultVal);
}

/** 全部重置 */
function resetAll(): void {
  emit('reset');
}
</script>

<template>
  <div class="schema-form">
    <div v-if="schemaDef.title || hasModifications" class="form-header">
      <h4 v-if="schemaDef.title" class="form-title">{{ schemaDef.title }}</h4>
      <button
        v-if="hasModifications"
        class="reset-all-btn"
        @click="resetAll"
      >
        全部重置
      </button>
    </div>

    <p v-if="schemaDef.description" class="form-desc">{{ schemaDef.description }}</p>

    <div class="fields-container">
      <SchemaField
        v-for="(fieldSchema, fieldKey) in properties"
        :key="fieldKey"
        :field-schema="fieldSchema"
        :field-key="fieldKey"
        :value="currentObj[fieldKey]"
        :default-value="defaultObj[fieldKey]"
        :path="fieldKey"
        @update="onFieldUpdate"
        @reset="onFieldReset"
      />
    </div>
  </div>
</template>

<style scoped>
.schema-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.reset-all-btn {
  padding: 0.3rem 0.65rem;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s;
}

.reset-all-btn:hover {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-text-bone);
}

.form-desc {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}

.fields-container {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
