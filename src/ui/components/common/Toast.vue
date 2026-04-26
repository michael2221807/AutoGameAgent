<template>
  <!--
    Global toast notification container.
    Listens to eventBus 'ui:toast' events and displays stacking toasts
    with slide-in animation from the top-right corner.

    Polanyi principle: toasts operate as subsidiary awareness —
    they inform without demanding focal attention, then dissolve naturally.
  -->
  <Teleport to="body">
    <div
      class="toast-container"
      role="log"
      aria-live="polite"
      aria-label="通知消息"
    >
      <TransitionGroup name="toast-slide" tag="div" class="toast-stack">
        <div
          v-for="toast in visibleToasts"
          :key="toast.id"
          :class="['toast', `toast--${toast.type}`]"
          role="status"
          :aria-label="`${toastTypeLabel(toast.type)}: ${toast.message}`"
          @mouseenter="pauseDismiss(toast.id)"
          @mouseleave="resumeDismiss(toast.id)"
        >
          <!-- Type icon — SVG inline for each variant -->
          <span class="toast__icon" aria-hidden="true">
            <svg v-if="toast.type === 'success'" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
            <svg v-else-if="toast.type === 'error'" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
            <svg v-else-if="toast.type === 'warning'" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <svg v-else viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
            </svg>
          </span>

          <span class="toast__message">{{ toast.message }}</span>

          <!-- Dismiss button -->
          <button
            class="toast__close"
            aria-label="关闭通知"
            @click="dismiss(toast.id)"
          >
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>

          <!-- Auto-dismiss progress bar — subtle visual countdown -->
          <div
            v-if="toast.duration > 0"
            class="toast__progress"
            :style="{ animationDuration: `${toast.duration}ms` }"
            :class="{ 'toast__progress--paused': toast.paused }"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { eventBus } from '@/engine/core/event-bus';
import type { ToastPayload } from '@/engine/types';

/**
 * Internal toast entry with tracking metadata.
 * The `remaining` field tracks how much time is left when paused.
 */
interface ToastEntry {
  id: number;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  duration: number;
  paused: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  remaining: number;
  pausedAt: number | null;
}

const MAX_VISIBLE_TOASTS = 5;
const DEFAULT_DURATION = 5500;
const MIN_DURATION = 2500;

let nextId = 0;
const visibleToasts = ref<ToastEntry[]>([]);

/** Maps toast type to a human-readable label for screen readers */
function toastTypeLabel(type: ToastEntry['type']): string {
  const labels: Record<ToastEntry['type'], string> = {
    info: '提示',
    success: '成功',
    warning: '警告',
    error: '错误',
  };
  return labels[type];
}

/** Schedule auto-dismiss for a toast */
function scheduleDismiss(toast: ToastEntry): void {
  if (toast.duration <= 0) return;
  toast.timerId = setTimeout(() => dismiss(toast.id), toast.remaining);
}

/** Pause auto-dismiss while the user hovers over a toast */
function pauseDismiss(id: number): void {
  const toast = visibleToasts.value.find(t => t.id === id);
  if (!toast || toast.duration <= 0 || toast.paused) return;

  toast.paused = true;
  toast.pausedAt = Date.now();
  if (toast.timerId !== null) {
    clearTimeout(toast.timerId);
    toast.timerId = null;
  }
}

/** Resume auto-dismiss when the user leaves a toast */
function resumeDismiss(id: number): void {
  const toast = visibleToasts.value.find(t => t.id === id);
  if (!toast || toast.duration <= 0 || !toast.paused) return;

  /* Reduce remaining time by however long the user hovered */
  if (toast.pausedAt !== null) {
    toast.remaining -= (Date.now() - toast.pausedAt);
    if (toast.remaining <= 0) toast.remaining = 300;
  }
  toast.paused = false;
  toast.pausedAt = null;
  scheduleDismiss(toast);
}

/** Remove a toast from the visible list */
function dismiss(id: number): void {
  const idx = visibleToasts.value.findIndex(t => t.id === id);
  if (idx === -1) return;
  const toast = visibleToasts.value[idx];
  if (toast.timerId !== null) clearTimeout(toast.timerId);
  visibleToasts.value.splice(idx, 1);
}

/** Handle incoming toast events from the engine event bus */
function handleToastEvent(payload: unknown): void {
  const p = payload as ToastPayload;
  if (!p || !p.message) return;

  const rawDuration = p.duration ?? DEFAULT_DURATION;
  const duration = rawDuration > 0 ? Math.max(rawDuration, MIN_DURATION) : 0;
  const toast: ToastEntry = {
    id: nextId++,
    type: p.type ?? 'info',
    message: p.message,
    duration,
    paused: false,
    timerId: null,
    remaining: duration,
    pausedAt: null,
  };

  visibleToasts.value.push(toast);

  /* Cap visible toasts — remove oldest when exceeding max */
  while (visibleToasts.value.length > MAX_VISIBLE_TOASTS) {
    const oldest = visibleToasts.value[0];
    if (oldest.timerId !== null) clearTimeout(oldest.timerId);
    visibleToasts.value.shift();
  }

  scheduleDismiss(toast);
}

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = eventBus.on('ui:toast', handleToastEvent);
});

onUnmounted(() => {
  unsubscribe?.();
  /* Clean up any remaining timers */
  for (const toast of visibleToasts.value) {
    if (toast.timerId !== null) clearTimeout(toast.timerId);
  }
  visibleToasts.value = [];
});
</script>

<style scoped>
/* Sanctuary migration 2026-04-21 — ABSOLUTE-BAN FIX:
   - `.toast--* { border-left: 3px solid … }` REMOVED per brief
     "Borders: never colored side-stripes (absolute ban)". Replaced with a
     leading 4px circular accent dot via `::before` + full 1px border
     tinted by the type's accent color.
   - All four type colors retokenized: info sage (was #6366f1 indigo) /
     success sage-green / warning amber (was #f59e0b) / error warm-rust.
   - Background: solid surface → frosted cabin-glass (82% surface-elevated
     + 18px blur + saturate + inset refraction highlight). Matches other
     floating sanctuary surfaces.
   - Shadow: `rgba(0,0,0,0.35)` → tokenized shadow-md + inset highlight
   - Close hover bg: `rgba(255,255,255,0.08)` → tokenized color-mix
   - Focus ring: indigo → sage
   - Slide-in transition tokenized */

.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10000;
  pointer-events: none;
  max-width: 400px;
  width: 100%;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px 12px 20px;
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: none;
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 0.86rem;
  line-height: 1.55;
  letter-spacing: 0.01em;
  box-shadow: var(--glass-shadow);
  pointer-events: auto;
  overflow: hidden;
}

/* Leading accent dot — replaces the 3px border-left stripe. */
.toast::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 50%;
  width: 4px;
  height: 4px;
  margin-top: -2px;
  border-radius: 50%;
  background: var(--toast-accent, var(--color-text-umber));
  box-shadow: 0 0 6px color-mix(in oklch, var(--toast-accent, var(--color-text-umber)) 50%, transparent);
}

/* Type accents — tokenized sanctuary palette, never raw hex. */
.toast--info    { --toast-accent: var(--color-sage-400); }
.toast--success { --toast-accent: var(--color-success); }
.toast--warning { --toast-accent: var(--color-amber-400); }
.toast--error   { --toast-accent: var(--color-danger); }

/* ── Icon ── */
.toast__icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--toast-accent, var(--color-text-umber));
}

.toast__icon svg {
  width: 100%;
  height: 100%;
}

/* ── Message text ── */
.toast__message {
  flex: 1;
  word-break: break-word;
}

/* ── Close button ── */
.toast__close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  margin-top: 1px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}
.toast__close:hover {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-text) 6%, transparent);
}
.toast__close:focus-visible {
  outline: 2px solid var(--color-sage-400);
  outline-offset: 1px;
}
.toast__close svg {
  width: 100%;
  height: 100%;
}

/* ── Auto-dismiss progress bar ── */
.toast__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--toast-accent, var(--color-text-umber));
  opacity: 0.35;
  animation: toast-progress-shrink linear forwards;
}

.toast__progress--paused {
  animation-play-state: paused;
}

@keyframes toast-progress-shrink {
  from { width: 100%; }
  to   { width: 0%; }
}

/* ── Slide-in / slide-out transitions — sanctuary ease-out ── */
.toast-slide-enter-active {
  transition: opacity var(--duration-slow) var(--ease-out),
              transform var(--duration-slow) var(--ease-out);
}
.toast-slide-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out),
              transform var(--duration-normal) var(--ease-out);
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(60px) scale(0.98);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(60px) scale(0.98);
}
.toast-slide-move {
  transition: transform var(--duration-normal) var(--ease-out);
}

/* ── Responsive ── */
@media (max-width: 480px) {
  .toast-container {
    right: 8px;
    left: 8px;
    max-width: unset;
  }
}
</style>
