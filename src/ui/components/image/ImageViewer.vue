<script setup lang="ts">
/**
 * ImageViewer — fullscreen image viewer modal.
 *
 * Usage: <ImageViewer v-if="viewerOpen" :src="imageUrl" @close="viewerOpen = false" />
 * Click overlay or press Escape to close.
 */
import { onMounted, onUnmounted } from 'vue';

defineProps<{
  src: string;
  alt?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="image-viewer-overlay" @click.self="emit('close')">
      <button class="image-viewer-close" @click="emit('close')" aria-label="关闭">&times;</button>
      <img :src="src" :alt="alt ?? ''" class="image-viewer-img" />
    </div>
  </Teleport>
</template>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.92);
  cursor: zoom-out;
}

.image-viewer-close {
  position: absolute;
  top: var(--space-lg);
  right: var(--space-lg);
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 2rem;
  cursor: pointer;
  z-index: 201;
  transition: color var(--duration-fast);
}
.image-viewer-close:hover { color: var(--color-text-bone); }

.image-viewer-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-md);
  cursor: default;
}
</style>
