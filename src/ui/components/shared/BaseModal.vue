<script setup lang="ts">
/**
 * BaseModal — 通用模态对话框组件。
 *
 * 提供遮罩层 + 居中面板，支持标题、内容插槽和底部操作栏。
 * 点击遮罩或按 Escape 关闭（可通过 persistent 禁用）。
 *
 * 用法:
 *   <BaseModal v-model="open" title="编辑">
 *     <template #default>内容</template>
 *     <template #footer>操作按钮</template>
 *   </BaseModal>
 */
import { watch, onMounted, onBeforeUnmount } from 'vue';

const props = withDefaults(defineProps<{
  /** 控制对话框显示/隐藏（v-model） */
  modelValue: boolean;
  /** 对话框标题 */
  title?: string;
  /** 面板最大宽度 */
  maxWidth?: string;
  /** 持久模式 — 禁用遮罩点击和 Escape 关闭 */
  persistent?: boolean;
}>(), {
  title: '',
  maxWidth: '540px',
  persistent: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

/** 关闭对话框（非 persistent 模式） */
function close(): void {
  if (!props.persistent) {
    emit('update:modelValue', false);
  }
}

/** Escape 键处理 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

watch(() => props.modelValue, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('keydown', onKeydown);
  }
});

onMounted(() => {
  if (props.modelValue) {
    document.addEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="modal-overlay" @click.self="close">
        <div class="modal-panel" :style="{ maxWidth }">
          <!-- 头部 -->
          <header v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <h3 class="modal-title">{{ title }}</h3>
            </slot>
            <button class="modal-close-btn" aria-label="关闭" @click="close">✕</button>
          </header>

          <!-- 内容区 -->
          <div class="modal-body">
            <slot />
          </div>

          <!-- 底部操作栏 -->
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Sanctuary migration 2026-04-21:
   - Matches Phase 3.1 Modal.vue frosted language: backdrop is a 6px warm
     fog, panel itself is the frosted cabin-glass (32px blur + 72% surface
     + inset refraction highlight)
   - Header border / footer border: --color-border → --color-border-subtle
     for quieter hairlines inside the frosted panel
   - Title: sanctuary CJK serif + tracked letter-spacing
   - Body: sanctuary CJK serif with loose line-height for long-form text
   - Close button: square-box look with warm hover wash
   - Motion: 0.2s ease → sanctuary duration + ease-out tokens; panel enter
     tuned to duration-slow for calm settle */

/* 2026-04-21 tuning (see Modal.vue for full rationale): lower overlay
   alpha so page is visibly soft-through-glass, raise panel blur +
   gradient bg + top/bottom inner highlights for true "frosted cabin
   glass at dusk" feel. */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-overlay-bg);
  backdrop-filter: var(--glass-overlay-blur);
  -webkit-backdrop-filter: var(--glass-overlay-blur);
}

.modal-panel {
  width: 90%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: none;
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-title {
  font-family: var(--font-serif-cjk);
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--color-text);
}

.modal-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.modal-close-btn:hover {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-text) 4%, transparent);
}

.modal-body {
  flex: 1;
  min-height: 0;
  padding: 1.25rem;
  overflow-y: auto;
  font-family: var(--font-serif-cjk);
  font-size: 0.9rem;
  line-height: 1.85;
  letter-spacing: 0.01em;
  color: var(--color-text);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.625rem;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid var(--color-border-subtle);
}

/* 进出过渡动画 — sanctuary: slow settle, never bouncy */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.modal-fade-enter-active .modal-panel,
.modal-fade-leave-active .modal-panel {
  transition: transform var(--duration-slow) var(--ease-out);
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .modal-panel {
  transform: scale(0.98) translateY(8px);
}

.modal-fade-leave-to .modal-panel {
  transform: scale(0.98) translateY(8px);
}
</style>
