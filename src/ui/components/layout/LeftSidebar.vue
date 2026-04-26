<script setup lang="ts">
/**
 * LeftSidebar — navigation + realtime clock + exit dialog.
 *
 * Additions over base:
 * - Header realtime clock (HH:MM:SS, 1s setInterval)
 * - Exit button at bottom → Modal (保存并退出 / 不保存退出 / 取消)
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { loadEngramConfig } from '@/engine/memory/engram/engram-config';
import { eventBus } from '@/engine/core/event-bus';

const route = useRoute();
const isCollapsed = ref(false);

// ─── Engram 调试面板可见性（受 config.debug 控制）────────────────
const engramDebugVisible = ref(loadEngramConfig().debug);
let offEngramConfigChanged: (() => void) | null = null;

// ─── Collapse ─────────────────────────────────────────────────

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

function isActive(path: string): boolean {
  return route.path === path;
}

const isSubPanel = computed(() => route.path !== '/game' && route.path.startsWith('/game/'));

// ─── Realtime clock ───────────────────────────────────────────

const clockTime = ref('');
let clockTimer: ReturnType<typeof setInterval> | null = null;

function updateClock(): void {
  const now = new Date();
  clockTime.value = now.toLocaleTimeString('zh-CN', { hour12: false });
}

onMounted(() => {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
  offEngramConfigChanged = eventBus.on('engram:config-changed', (payload: unknown) => {
    engramDebugVisible.value = (payload as { debug?: boolean })?.debug === true;
  });
});

onUnmounted(() => {
  if (clockTimer !== null) clearInterval(clockTimer);
  if (offEngramConfigChanged) offEngramConfigChanged();
  document.documentElement.style.removeProperty('--sidebar-left-reserve');
});

/*
 * Post-migration (2026-04-20 Phase 2.3): sidebar is now a floating droplet
 * absolutely positioned over the canvas. To keep narrative prose from
 * running under the sidebar, the GameLayout canvas reads
 * `--sidebar-left-reserve` and pads itself accordingly. This watcher is the
 * ONLY producer of that var; when the droplet opens we reserve ~264px, when
 * it collapses to a capsule we release almost all of it.
 *
 * Observational only — does NOT mutate `isCollapsed` or any existing logic.
 */
watch(isCollapsed, (collapsed) => {
  document.documentElement.style.setProperty(
    '--sidebar-left-reserve',
    collapsed ? '40px' : '264px',
  );
}, { immediate: true });

// ─── Panel groups ─────────────────────────────────────────────

interface PanelItem {
  route: string;
  label: string;
  icon: string;
}

interface PanelGroup {
  label: string;
  items: PanelItem[];
}

const icons = {
  main:         '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clip-rule="evenodd"/></svg>',
  character:    '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>',
  inventory:    '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z"/><path fill-rule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>',
  relationships:'<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>',
  map:          '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z" clip-rule="evenodd"/></svg>',
  memory:       '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>',
  events:       '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>',
  heartbeat:    '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd"/></svg>',
  variables:    '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>',
  prompts:      '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>',
  api:          '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"/></svg>',
  settings:     '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>',
  save:         '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M5.5 2A1.5 1.5 0 004 3.5v13A1.5 1.5 0 005.5 18h9a1.5 1.5 0 001.5-1.5V6.621a1.5 1.5 0 00-.44-1.06l-3.12-3.122A1.5 1.5 0 0011.378 2H5.5zM10 12a2 2 0 100-4 2 2 0 000 4z"/></svg>',
  assembly:     '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z"/></svg>',
  engram:       '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1zm10-5a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zm-2 5a1 1 0 011-1h4a1 1 0 110 2h-4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>',
  image:        '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/></svg>',
  exit:         '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd" /></svg>',
  assistant:    '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>',
  plot:         '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V15"/></svg>',
} as const;

const BASE_SYSTEM_ITEMS: PanelItem[] = [
  { route: '/game/variables',       label: '变量',        icon: icons.variables },
  { route: '/game/assistant',       label: 'AI 助手',     icon: icons.assistant },
  { route: '/game/prompts',          label: 'Prompt',      icon: icons.prompts },
  { route: '/game/api',              label: 'API',         icon: icons.api },
  { route: '/game/settings',         label: '设置',        icon: icons.settings },
  { route: '/game/save',             label: '存档',        icon: icons.save },
  { route: '/game/prompt-assembly',  label: 'Prompt 组装', icon: icons.assembly },
  { route: '/game/image',            label: '图像生成',    icon: icons.image },
  { route: '/game/engram-debug',     label: 'Engram 调试', icon: icons.engram },
];

const panelGroups = computed<PanelGroup[]>(() => [
  {
    label: '游戏',
    items: [
      { route: '/game',              label: '主面板',   icon: icons.main },
      { route: '/game/character',    label: '角色详情', icon: icons.character },
      { route: '/game/inventory',    label: '背包',     icon: icons.inventory },
      { route: '/game/relationships',label: '社交关系', icon: icons.relationships },
      { route: '/game/map',          label: '地图',     icon: icons.map },
      { route: '/game/plot',         label: '剧情',     icon: icons.plot },
    ],
  },
  {
    label: '记忆',
    items: [
      { route: '/game/memory',    label: '记忆', icon: icons.memory },
      { route: '/game/events',    label: '事件', icon: icons.events },
      { route: '/game/heartbeat', label: '心跳', icon: icons.heartbeat },
    ],
  },
  {
    label: '系统',
    items: BASE_SYSTEM_ITEMS.filter(
      (item) => item.route !== '/game/engram-debug' || engramDebugVisible.value,
    ),
  },
]);
</script>

<template>
  <!--
    Left navigation sidebar for the game view.
    Groups panels into three categories: 游戏, 记忆, 系统.
    Collapsible via a toggle button — collapsed state shows icons only.
    Header shows realtime HH:MM:SS clock; footer has exit button.
  -->
  <nav
    :class="['sidebar', { 'sidebar--collapsed': isCollapsed }]"
    role="navigation"
    aria-label="游戏导航"
  >
    <!-- Header: back-to-main + clock -->
    <div class="sidebar__header">
      <router-link
        v-if="isSubPanel"
        to="/game"
        class="sidebar__back-main"
        aria-label="返回主面板"
        :title="isCollapsed ? '返回主面板' : undefined"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        <span v-if="!isCollapsed" class="sidebar__back-main-label">主面板</span>
      </router-link>
      <span v-if="!isCollapsed" class="sidebar__clock" aria-label="当前时间">{{ clockTime }}</span>
    </div>

    <!-- Panel groups -->
    <div class="sidebar__groups">
      <div
        v-for="group in panelGroups"
        :key="group.label"
        class="sidebar__group"
      >
        <!-- Group label — hidden when collapsed -->
        <span v-if="!isCollapsed" class="sidebar__group-label">{{ group.label }}</span>

        <router-link
          v-for="item in group.items"
          :key="item.route"
          :to="item.route"
          :class="['sidebar__item', { 'sidebar__item--active': isActive(item.route) }]"
          :aria-label="item.label"
          :title="item.label"
          :aria-current="isActive(item.route) ? 'page' : undefined"
        >
          <span class="sidebar__item-icon" aria-hidden="true" v-html="item.icon" />
          <span v-if="!isCollapsed" class="sidebar__item-label">{{ item.label }}</span>
        </router-link>
      </div>
    </div>

    <!-- Footer: collapse/expand toggle -->
    <div class="sidebar__footer">
      <button
        class="sidebar__collapse-btn"
        :aria-label="isCollapsed ? '展开侧栏' : '收起侧栏'"
        :title="isCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="toggleCollapse"
      >
        <svg
          :class="['sidebar__toggle-icon', { 'sidebar__toggle-icon--flipped': isCollapsed }]"
          viewBox="0 0 20 20"
          fill="currentColor"
          width="16"
          height="16"
        >
          <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
        <span v-if="!isCollapsed" class="sidebar__item-label">收起</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/*
 * LeftSidebar — sanctuary migration (Phase 2.3, 2026-04-20).
 *
 * Structural change: sidebar is now a FLOATING DROPLET panel — iPadOS
 * Stage Manager style. Absolute-positioned inside the GameLayout body
 * with 12px margin from edges, rounded corners, frosted-glass background.
 * Collapsed state becomes a 14px thin capsule with sage chevron indicator
 * (`.sidebar--collapsed` class, unchanged toggle handler from script).
 *
 * Absolute-ban violation REMOVED: the old 3px indigo border-left stripe
 * on the active item (`.sidebar__item--active::before`) is gone per
 * .impeccable.md absolute ban on side-stripe borders >1px. Active state
 * now uses sage background tint + inner ring.
 *
 * Template + <script setup> UNTOUCHED. Every class, router-link, icon,
 * toggle handler, realtime-clock interval, Engram-debug listener, and
 * panelGroups computed preserved byte-for-byte.
 */

/* ─── Floating droplet container ─── */
.sidebar {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 12px;
  width: 240px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: none;
  border-radius: 16px;
  box-shadow: var(--glass-shadow);
  transition:
    width var(--duration-open) var(--ease-droplet),
    top var(--duration-open) var(--ease-droplet),
    bottom var(--duration-open) var(--ease-droplet),
    left var(--duration-open) var(--ease-droplet),
    border-radius var(--duration-open) var(--ease-droplet),
    border-color var(--duration-open) var(--ease-droplet),
    background var(--duration-open) var(--ease-droplet),
    box-shadow var(--duration-open) var(--ease-droplet);
}

/* Gradient border — light refraction on top-left edge */
.sidebar::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: var(--glass-edge-gradient);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  z-index: 1;
}
.sidebar--collapsed::before {
  display: none;
}

/* Collapsed → thin edge rail flush with the left border,
   spanning from round-divider height to input-area top. */
.sidebar--collapsed {
  top: 40px;
  bottom: 90px;
  left: 0;
  width: 10px;
  border-radius: 0 6px 6px 0;
  border-color: transparent;
  border-left: none;
  box-shadow: none;
  background: color-mix(in oklch, var(--color-text-umber) 10%, transparent);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition-duration: var(--duration-close);
  cursor: pointer;
}
.sidebar--collapsed:hover {
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  box-shadow: inset -1px 0 0 color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

/*
 * All content inside fades out when collapsed so the capsule reads clean.
 * The toggle button (`.sidebar__collapse-btn`) is the only thing with a
 * special expand mode — it stretches to cover the whole capsule, so
 * clicking anywhere on the thin bar re-expands it.
 */
.sidebar--collapsed > *:not(.sidebar__footer) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms var(--ease-out);
}
.sidebar--collapsed .sidebar__footer {
  position: absolute;
  inset: 0;
  border: none;
  background: transparent;
}
.sidebar--collapsed .sidebar__collapse-btn {
  width: 100%;
  height: 100%;
  padding: 0;
  justify-content: center;
}
.sidebar--collapsed .sidebar__collapse-btn .sidebar__item-label {
  display: none;
}

/* ─── Header (back-main + clock) ─── */
.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

/* Back-to-main chip */
.sidebar__back-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 7px;
  text-decoration: none;
  color: var(--color-sage-400);
  background: var(--color-sage-muted);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 22%, transparent);
  font-size: 0.76rem;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1;
  transition: background var(--duration-normal) var(--ease-out),
              color var(--duration-normal) var(--ease-out);
}

.sidebar__back-main:hover {
  background: var(--color-sage-500);
  color: var(--color-bg);
}

.sidebar__back-main:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 28%, transparent);
}

.sidebar__back-main-label {
  white-space: nowrap;
}

/* Realtime clock readout — warm sage mono, the only "glow" in the header */
.sidebar__clock {
  font-size: 0.74rem;
  font-family: var(--font-mono);
  color: var(--color-sage-400);
  letter-spacing: 0.04em;
  white-space: nowrap;
  opacity: 0.78;
}

.sidebar__toggle-icon {
  transition: transform var(--duration-normal) var(--ease-out);
}
.sidebar__toggle-icon--flipped {
  transform: rotate(180deg);
}

/* ─── Nav groups ─── */
.sidebar__groups {
  flex: 1;
  min-height: 0;
  padding: 10px 0;
  overflow-y: auto;
}

.sidebar__group {
  margin-bottom: 6px;
}

.sidebar__group-label {
  display: block;
  padding: 8px 16px 4px;
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--color-text-muted);
  user-select: none;
}

/* ─── Nav items (active state: sage wash + inner ring, NO side stripe) ─── */
.sidebar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  margin: 1px 8px;
  padding: 0 12px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--color-text-secondary);
  font-size: 0.84rem;
  transition: color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
  position: relative;
}

.sidebar__item:hover {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
}

.sidebar__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
}

.sidebar__item--active {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-sage-400) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 22%, transparent);
}
/*
 * ABSOLUTE-BAN REMOVAL: the old 3px indigo border-left stripe
 * (`.sidebar__item--active::before`) was removed per .impeccable.md
 * <absolute_bans> BAN 1. The sage background + inset ring above
 * communicates the active state without any colored side-stripe.
 */

/* ─── Icon ─── */
.sidebar__item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  opacity: 0.82;
}

/* ─── Label ─── */
.sidebar__item-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Footer / Collapse-Expand ─── */
.sidebar__footer {
  flex-shrink: 0;
  padding: 6px 0;
  border-top: 1px solid var(--color-border-subtle);
}

.sidebar__collapse-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 14px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  font-family: var(--font-sans);
  cursor: pointer;
  text-align: left;
  transition: color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}

.sidebar__collapse-btn:hover {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-sage-400) 5%, transparent);
}
.sidebar__collapse-btn:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
}

/* ─── Responsive ─── */
@media (max-width: 860px) {
  .sidebar:not(.sidebar--collapsed) {
    width: 200px;
  }
}
</style>
