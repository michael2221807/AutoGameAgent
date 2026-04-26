<script setup lang="ts">
/**
 * 根组件 — 全局出口 + 挂载跨路由 UI（Toast）。
 *
 * Toast 监听 `eventBus` 的 `ui:toast`（如 GameVariablePanel 保存后提示），
 * 必须在此常驻挂载，否则子路由切换后无容器接收通知。
 * 对应 `implementation-standards`：错误/提示不吞、需对用户可见。
 */
import Toast from '@/ui/components/common/Toast.vue';
</script>

<template>
  <router-view />
  <Toast />
</template>

<style>
/*
 * Global reset + body defaults.
 * Design tokens (colors, spacing, radii, etc.) live in src/ui/styles/tokens.css
 * (imported in main.ts). This block only holds structural resets.
 */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-sans);
  background-color: var(--color-bg);
  color: var(--color-text);
  line-height: var(--line-height-normal);
  -webkit-font-smoothing: antialiased;
}
</style>
