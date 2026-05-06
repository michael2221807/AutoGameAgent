<template>
  <!--
    Reusable modal dialog with focus trap, backdrop click-to-close,
    Escape key support, and a fade + scale entrance animation.

    Polanyi principle: the modal draws focal awareness to its content
    while the backdrop dims everything else to subsidiary awareness.
  -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="modal-backdrop"
        role="dialog"
        :aria-modal="true"
        :aria-label="title"
        @click.self="handleBackdropClick"
        @keydown="handleKeydown"
      >
        <div
          ref="modalContentRef"
          class="modal-content"
          :style="{ maxWidth: width }"
          tabindex="-1"
        >
          <!-- Header -->
          <header v-if="title || closable" class="modal-header">
            <h2 class="modal-title">{{ title }}</h2>
            <button
              v-if="closable"
              class="modal-close"
              aria-label="关闭对话框"
              @click="close"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </header>

          <!-- Body — default slot -->
          <div class="modal-body">
            <slot />
          </div>

          <!-- Footer — optional slot -->
          <footer v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';

interface ModalProps {
  modelValue: boolean;
  title?: string;
  width?: string;
  closable?: boolean;
}

const props = withDefaults(defineProps<ModalProps>(), {
  title: '',
  width: '480px',
  closable: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const modalContentRef = ref<HTMLElement | null>(null);

/**
 * Element that held focus before the modal opened.
 * We restore focus here when the modal closes to maintain
 * a natural keyboard navigation flow.
 */
let previouslyFocusedElement: HTMLElement | null = null;

function close(): void {
  emit('update:modelValue', false);
}

function handleBackdropClick(): void {
  if (props.closable) close();
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closable) {
    e.stopPropagation();
    close();
    return;
  }

  /* Focus trap: Tab and Shift+Tab cycle within the modal */
  if (e.key === 'Tab') {
    trapFocus(e);
  }
}

/**
 * Trap Tab/Shift+Tab within the modal's focusable elements.
 * This prevents keyboard users from accidentally tabbing out
 * into the obscured background content.
 */
function trapFocus(e: KeyboardEvent): void {
  const modal = modalContentRef.value;
  if (!modal) return;

  const focusable = modal.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/** Lock body scroll while modal is open to prevent background scrolling */
function lockBodyScroll(): void {
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll(): void {
  document.body.style.overflow = '';
}

watch(() => props.modelValue, async (isOpen) => {
  if (isOpen) {
    previouslyFocusedElement = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    await nextTick();
    /* Focus the modal container so keyboard events are captured */
    modalContentRef.value?.focus();
  } else {
    unlockBodyScroll();
    /* Restore focus to the element that triggered the modal */
    previouslyFocusedElement?.focus();
    previouslyFocusedElement = null;
  }
});

onUnmounted(() => {
  unlockBodyScroll();
});
</script>

<style scoped>
/*
 * Modal — sanctuary frosted-glass migration (Phase 3.1, 2026-04-20).
 *
 * Design decisions (from memory project_modal_and_list_design.md):
 *   — The BACKDROP is just a light dark-wash with a touch of blur. It dims
 *     the room, nothing more.
 *   — The MODAL CONTENT is the actual frosted pane: semi-transparent
 *     surface + strong backdrop-filter + 1px edge-refraction inset highlight.
 *     This matches the "frosted cabin glass at dusk" metaphor from
 *     .impeccable.md rather than "opaque window pasted on blur".
 *
 * Migration scope: scoped-style ONLY. Template and script are untouched.
 * Every class name, emit, prop, focus-trap keybinding, aria attribute
 * preserved byte-for-byte from the original.
 */

/* ── Backdrop — 2026-04-21 tuning: user flagged "no frosted feel".
   Previous 55% bg wash was so opaque it killed the page content behind,
   leaving the modal-content's backdrop-filter with nothing to blur.
   Dropped to 28% + stronger blur(10px) so page content is visibly soft
   but still clearly present through the glass. ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--glass-overlay-bg);
  backdrop-filter: var(--glass-overlay-blur);
  -webkit-backdrop-filter: var(--glass-overlay-blur);
}

/* ── Content panel — THE frosted pane ──
   2026-04-21 tuning:
   - Surface opacity 72% → vertical gradient 58% → 68% so the pane itself
     has depth even against uniform backdrops (feels like 3D glass not
     flat plastic sheet)
   - Blur 32px → 40px + saturate 1.15 → 1.25 for stronger frosted wetness
   - Top + bottom inset highlights for "cabin-glass edge refraction"
   - Border α bumped 55% → 70% to read as a distinct edge */
.modal-content {
  position: relative;
  width: 100%;
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: none;
  border-radius: 14px;
  box-shadow: var(--glass-shadow);
  outline: none;
  overflow: hidden;
}

/* ── Header ── */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.modal-title {
  margin: 0;
  font-family: var(--font-serif-cjk);
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1.3;
  letter-spacing: 0.01em;
}

.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}
@media (hover: hover) {
  .modal-close:hover {
    color: var(--color-amber-400);
    background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  }
}
@media (hover: none) and (pointer: coarse) {
  .modal-close:active {
    color: var(--color-amber-400);
    background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  }
}
.modal-close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

/* ── Body ── */
.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  /*
   * `min-height: 0` is critical for correctly sizing flex-children that
   * declare `height: 100%` (e.g. SettingsPanel's `.settings-panel`).
   * Without this, a flex item's default min-content size causes
   * percentage-height children to fall through and expand with content,
   * making the modal-body's own scroll pick up the entire panel (nav +
   * content scroll together). With this, the inner panel correctly
   * constrains its own height and its internal `.settings-content`
   * becomes the sole scrollable ancestor for scrollIntoView() calls.
   * See bugfix 2026-04-20 (SettingsPanel sub-nav scroll issue).
   */
  min-height: 0;
  color: var(--color-text);
  font-size: 0.9rem;
  line-height: 1.6;
}

/* ── Footer ── */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

/* ── Fade + scale transition ── */
.modal-fade-enter-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.modal-fade-enter-active .modal-content {
  transition: transform var(--duration-normal) var(--ease-out),
              opacity var(--duration-normal) var(--ease-out);
}
.modal-fade-leave-active {
  transition: opacity var(--duration-leave) var(--ease-out);
}
.modal-fade-leave-active .modal-content {
  transition: transform var(--duration-leave) var(--ease-out),
              opacity var(--duration-leave) var(--ease-out);
}
.modal-fade-enter-from {
  opacity: 0;
}
.modal-fade-enter-from .modal-content {
  opacity: 0;
  transform: scale(0.96) translateY(6px);
}
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-leave-to .modal-content {
  opacity: 0;
  transform: scale(0.98) translateY(3px);
}

/* ── Responsive ── */
@media (max-width: 520px) {
  .modal-backdrop {
    padding: 12px;
  }
  .modal-content {
    border-radius: 10px;
    /* !important overrides inline :style maxWidth prop binding */
    max-width: calc(100vw - 24px) !important;
    /* 100dvh for Safari dynamic address bar; fallback for older */
    max-height: calc(100dvh - 40px);
  }
  .modal-header {
    padding: 12px 16px;
  }
  .modal-body {
    padding: 16px;
  }
  .modal-close {
    width: 44px;
    height: 44px;
  }
  .modal-footer {
    padding: 12px 16px;
    flex-wrap: wrap;
    gap: var(--space-sm);
  }
  .modal-footer .btn {
    flex: 1 1 auto;
    min-width: 0;
  }
}
</style>
