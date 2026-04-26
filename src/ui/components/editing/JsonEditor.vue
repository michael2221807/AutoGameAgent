<script setup lang="ts">
/**
 * JsonEditor — 原始 JSON 编辑器（Layer 3 高级用户）。
 *
 * 提供等宽字体的 textarea 用于直接编辑 JSON 文本。
 * 功能:
 *   - 失焦时进行 JSON 语法校验
 *   - 无效 JSON 时显示错误指示
 *   - 格式化 (pretty print) / 压缩 (minify) 按钮
 *   - 只读模式
 */
import { ref, computed, watch } from 'vue';

const props = withDefaults(defineProps<{
  /** 当前 JSON 文本（v-model） */
  modelValue: string;
  /** 只读模式 */
  readonly?: boolean;
}>(), {
  readonly: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

/** 内部文本状态 — 允许用户自由编辑，不实时校验 */
const internalText = ref(props.modelValue);

/** 校验错误信息（为空表示合法） */
const errorMessage = ref('');

/** 是否 JSON 合法 */
const isValid = computed<boolean>(() => errorMessage.value === '');

/** 行数（用于显示行号区域高度提示） */
const lineCount = computed<number>(() =>
  internalText.value.split('\n').length,
);

/** 行号文本 */
const lineNumbers = computed<string>(() =>
  Array.from({ length: lineCount.value }, (_, i) => i + 1).join('\n'),
);

/** 当 prop 从外部变更时同步 */
watch(() => props.modelValue, (newVal) => {
  if (newVal !== internalText.value) {
    internalText.value = newVal;
    validateJson(newVal);
  }
});

/** 输入事件 — 仅更新内部状态 */
function onInput(e: Event): void {
  internalText.value = (e.target as HTMLTextAreaElement).value;
}

/** 失焦时校验并发出更新 */
function onBlur(): void {
  validateJson(internalText.value);
  if (isValid.value) {
    emit('update:modelValue', internalText.value);
  }
}

/** JSON 校验 */
function validateJson(text: string): void {
  if (text.trim() === '') {
    errorMessage.value = '';
    return;
  }
  try {
    JSON.parse(text);
    errorMessage.value = '';
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      errorMessage.value = err.message;
    } else {
      errorMessage.value = '无效 JSON';
    }
  }
}

/** 格式化 JSON（美化） */
function formatJson(): void {
  try {
    const parsed: unknown = JSON.parse(internalText.value);
    const formatted = JSON.stringify(parsed, null, 2);
    internalText.value = formatted;
    errorMessage.value = '';
    emit('update:modelValue', formatted);
  } catch {
    validateJson(internalText.value);
  }
}

/** 压缩 JSON（单行） */
function minifyJson(): void {
  try {
    const parsed: unknown = JSON.parse(internalText.value);
    const minified = JSON.stringify(parsed);
    internalText.value = minified;
    errorMessage.value = '';
    emit('update:modelValue', minified);
  } catch {
    validateJson(internalText.value);
  }
}
</script>

<template>
  <div class="json-editor" :class="{ 'has-error': !isValid, 'is-readonly': readonly }">
    <!-- 工具栏 -->
    <div class="editor-toolbar">
      <span class="toolbar-label">JSON 编辑器</span>
      <div class="toolbar-actions">
        <button
          class="toolbar-btn"
          title="格式化"
          :disabled="readonly"
          @click="formatJson"
        >
          格式化
        </button>
        <button
          class="toolbar-btn"
          title="压缩"
          :disabled="readonly"
          @click="minifyJson"
        >
          压缩
        </button>
      </div>
    </div>

    <!-- 编辑区域 -->
    <div class="editor-body">
      <!-- 行号 -->
      <pre class="line-numbers" aria-hidden="true">{{ lineNumbers }}</pre>

      <!-- 文本编辑区 -->
      <textarea
        class="editor-textarea"
        :value="internalText"
        :readonly="readonly"
        spellcheck="false"
        wrap="off"
        @input="onInput"
        @blur="onBlur"
      />
    </div>

    <!-- 状态栏 -->
    <div class="editor-status">
      <span v-if="!isValid" class="status-error">{{ errorMessage }}</span>
      <span v-else class="status-ok">JSON 有效</span>
      <span class="status-lines">{{ lineCount }} 行</span>
    </div>
  </div>
</template>

<style scoped>
.json-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-bg);
}

.json-editor.has-error {
  border-color: var(--color-danger);
}

/* 工具栏 */
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.toolbar-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.toolbar-actions {
  display: flex;
  gap: 0.4rem;
}

.toolbar-btn {
  padding: 0.2rem 0.55rem;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.15s;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 编辑区域 — 行号 + 文本区并排 */
.editor-body {
  display: flex;
  min-height: 200px;
  max-height: 500px;
  overflow: auto;
}

.line-numbers {
  padding: 0.65rem 0.5rem;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.55;
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--color-border);
  min-width: 36px;
  flex-shrink: 0;
}

.editor-textarea {
  flex: 1;
  padding: 0.65rem 0.75rem;
  background: transparent;
  border: none;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.55;
  resize: none;
  outline: none;
  tab-size: 2;
  white-space: pre;
}

.is-readonly .editor-textarea {
  opacity: 0.7;
  cursor: default;
}

/* 状态栏 */
.editor-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 0.75rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.status-error {
  font-size: 0.72rem;
  color: var(--color-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80%;
}

.status-ok {
  font-size: 0.72rem;
  color: var(--color-success);
}

.status-lines {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
}
</style>
