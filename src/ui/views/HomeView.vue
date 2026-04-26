<script setup lang="ts">
/**
 * HomeView — Application entry screen.
 *
 * Responsibilities:
 * 1. Display the AutoGameAgent brand and the active Game Pack information
 * 2. Offer three primary actions: New Character, Continue Game, Manage Saves
 * 3. List recently played profiles (sourced from ProfileManager) so the
 *    user can jump back into a previous session with one click
 *
 * "Continue Game" loads the most recent save (by lastSavedAt) and navigates
 * to /game. Clicking a specific profile entry loads that profile's active
 * save slot and navigates similarly.
 *
 * Dependencies injected via Vue provide/inject:
 *   - 'profileManager' → ProfileManager (persistence layer)
 *   - 'saveManager'     → SaveManager    (state tree persistence)
 *   - 'gamePack'        → GamePack       (active game pack metadata)
 *
 * The engine state store is used to push the loaded state tree into the
 * reactive layer before navigating to the game view.
 */
import { ref, computed, onMounted, inject } from 'vue';
import { useRouter } from 'vue-router';
import type { ProfileManager } from '@/engine/persistence/profile-manager';
import type { SaveManager } from '@/engine/persistence/save-manager';
import type { GamePack, GamePackManifest } from '@/engine/types/game-pack';
import type { ProfileMeta, SaveSlotMeta } from '@/engine/types/persistence';
import { useEngineStateStore } from '@/engine/stores/engine-state';
import Modal from '@/ui/components/common/Modal.vue';
import APIPanel from '@/ui/components/panels/APIPanel.vue';
import SettingsPanel from '@/ui/components/panels/SettingsPanel.vue';

const router = useRouter();
const engineState = useEngineStateStore();

const profileManager = inject<ProfileManager>('profileManager');
const saveManager = inject<SaveManager>('saveManager');
const gamePack = inject<GamePack>('gamePack');

// ─── Reactive data ────────────────────────────────────────────

/** All profiles fetched from the persistence layer */
const profiles = ref<ProfileMeta[]>([]);

/** Loading state for async save operations (prevents double-clicks) */
const isLoading = ref(false);

/** Error message surfaced to the user when a load operation fails */
const loadError = ref<string | null>(null);

/**
 * 2026-04-11：HomeView 内嵌 API/设置 modal 开关
 *
 * 玩家在游戏启动前还没有办法进入 /game/api 或 /game/settings（这些路由都在
 * GameView 下），但玩家又必须先配置 API 才能开局。所以在 HomeView 直接以
 * modal 形式打开 APIPanel / SettingsPanel —— 两个组件本身不强依赖 engine
 * 状态树（APIPanel 纯 localStorage；SettingsPanel 的状态树相关 section 已用
 * `v-if="isLoaded"` 自行隐藏，模态里只显示外观/数据管理等 localStorage 部分）。
 */
const showApiModal = ref(false);
const showSettingsModal = ref(false);

// ─── Computed helpers ─────────────────────────────────────────

/** Pack display info — falls back to sensible defaults when no pack is loaded */
const packInfo = computed(() => {
  if (!gamePack?.manifest) {
    return { name: 'AutoGameAgent', version: '', description: 'AI Game Engine' };
  }
  const m: GamePackManifest = gamePack.manifest;
  return {
    name: m.name ?? m.id ?? 'AutoGameAgent',
    version: m.version ?? '',
    description: m.description ?? 'AI Game Engine',
  };
});

/**
 * Profiles sorted by most-recently-played first.
 * "Most recent" is determined by the latest lastSavedAt across all slots.
 */
const sortedProfiles = computed(() => {
  return [...profiles.value].sort((a, b) => {
    const latestA = getLatestSaveTime(a);
    const latestB = getLatestSaveTime(b);
    return latestB - latestA;
  });
});

/** Whether there's at least one profile with a saved game to continue */
const canContinue = computed(() => {
  return sortedProfiles.value.some((p) => {
    return Object.values(p.slots).some((s) => s.lastSavedAt !== null);
  });
});

// ─── Helpers ──────────────────────────────────────────────────

/** Extract the most recent save timestamp (as epoch ms) from a profile */
function getLatestSaveTime(profile: ProfileMeta): number {
  let latest = 0;
  for (const slot of Object.values(profile.slots)) {
    if (slot.lastSavedAt) {
      const ts = new Date(slot.lastSavedAt).getTime();
      if (ts > latest) latest = ts;
    }
  }
  return latest;
}

/** Find the save slot with the most recent lastSavedAt */
function getMostRecentSlot(profile: ProfileMeta): SaveSlotMeta | null {
  let best: SaveSlotMeta | null = null;
  let bestTs = 0;
  for (const slot of Object.values(profile.slots)) {
    if (slot.lastSavedAt) {
      const ts = new Date(slot.lastSavedAt).getTime();
      if (ts > bestTs) {
        bestTs = ts;
        best = slot;
      }
    }
  }
  return best;
}

/** Format an ISO date string to a user-friendly relative/absolute display */
function formatDate(iso: string | null): string {
  if (!iso) return '从未保存';
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ─── Actions ──────────────────────────────────────────────────

function goToCreation(): void {
  router.push('/creation');
}

function goToManagement(): void {
  router.push('/management');
}

/**
 * "Continue Game" — loads the most recent save across all profiles
 * and navigates to the game view. If no saves exist, this is a no-op
 * (the button is disabled via canContinue).
 */
async function continueGame(): Promise<void> {
  if (!profileManager || !saveManager) return;
  if (isLoading.value) return;

  const allProfiles = sortedProfiles.value;
  for (const profile of allProfiles) {
    const slot = getMostRecentSlot(profile);
    if (slot) {
      await loadProfileSlot(profile, slot);
      return;
    }
  }
}

/**
 * Load a specific profile's save slot into the engine state store,
 * then navigate to the game view.
 */
async function loadProfileSlot(
  profile: ProfileMeta,
  slot: SaveSlotMeta,
): Promise<void> {
  if (!saveManager || !profileManager) return;
  if (isLoading.value) return;

  isLoading.value = true;
  loadError.value = null;

  try {
    const stateTree = await saveManager.loadGame(profile.profileId, slot.slotId);
    if (!stateTree) {
      loadError.value = '存档数据不存在或已损坏';
      return;
    }

    await profileManager.setActiveProfile(profile.profileId, slot.slotId);
    engineState.loadGame(stateTree, profile.packId, profile.profileId, slot.slotId);
    router.push('/game');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    loadError.value = `加载存档失败: ${msg}`;
    console.error('[HomeView] Failed to load save:', err);
  } finally {
    isLoading.value = false;
  }
}

/**
 * Click handler for a profile card — loads the profile's active slot
 * (or most recent slot as fallback).
 */
async function onProfileClick(profile: ProfileMeta): Promise<void> {
  const slotId = profile.activeSlotId;
  const slot = slotId
    ? profile.slots[slotId]
    : getMostRecentSlot(profile);

  if (!slot) {
    loadError.value = '该角色没有可用的存档';
    return;
  }

  await loadProfileSlot(profile, slot);
}

// ─── Lifecycle ────────────────────────────────────────────────

/**
 * 全量备份导入后的自动恢复钩子
 *
 * 用户点"恢复完整备份"成功后，SavePanel.executeImport 会设置
 * sessionStorage['aga_post_import_resume']='1' 并 reload 页面。
 * 刷新后路由会回到 HomeView（因为引擎状态未加载），此处检测到标志：
 *   1. 读取 ProfileManager 刚刚从 IDB 加载的 activeProfile 根指针
 *   2. 查找对应 profile + slot 对象
 *   3. 模拟用户点击"继续游戏"，直接加载该 slot 并跳转到 /game
 *   4. 清除 sessionStorage 标志（防止下次无关刷新又触发）
 *
 * 若备份不含 activeProfile 或对应 slot 已失效 → 静默回退到正常 Home 页面
 */
async function tryAutoResumeAfterImport(): Promise<void> {
  if (sessionStorage.getItem('aga_post_import_resume') !== '1') return;
  sessionStorage.removeItem('aga_post_import_resume');

  if (!profileManager) return;
  const root = profileManager.getRoot();
  const activeRef = root.activeProfile;
  if (!activeRef) return;

  const profile = profileManager.getProfile(activeRef.profileId);
  if (!profile) return;
  const slot = profile.slots[activeRef.slotId];
  if (!slot) return;

  await loadProfileSlot(profile, slot);
}

onMounted(async () => {
  if (profileManager) {
    profiles.value = profileManager.listProfiles();
  }
  // 若刚完成全量导入 → 自动继续到活跃游戏
  await tryAutoResumeAfterImport();
});
</script>

<template>
  <div class="home-view">
    <!-- Brand header -->
    <header class="home-header">
      <h1 class="brand-title">AutoGameAgent</h1>
      <p class="brand-subtitle">{{ packInfo.description }}</p>
      <div v-if="packInfo.version" class="pack-badge">
        <span class="pack-name">{{ packInfo.name }}</span>
        <span class="pack-version">v{{ packInfo.version }}</span>
      </div>
    </header>

    <!-- Primary action buttons -->
    <nav class="actions" aria-label="主操作">
      <button class="btn btn-primary" @click="goToCreation" :disabled="isLoading">
        新建角色
      </button>
      <button
        class="btn btn-accent"
        :disabled="!canContinue || isLoading"
        @click="continueGame"
      >
        继续游戏
      </button>
      <button class="btn btn-secondary" @click="goToManagement" :disabled="isLoading">
        管理存档
      </button>
    </nav>

    <!--
      2026-04-11：开局前配置入口 —— 首次使用时玩家必须先配置 API 才能开局，
      所以在 HomeView 提供直接入口。二级操作行，视觉上从属于主操作但常驻可见。
    -->
    <nav class="actions actions--secondary" aria-label="配置操作">
      <button class="btn btn-ghost" @click="showApiModal = true" :disabled="isLoading">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
        API 配置
      </button>
      <button class="btn btn-ghost" @click="showSettingsModal = true" :disabled="isLoading">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
        设置
      </button>
    </nav>

    <!-- Error banner -->
    <Transition name="fade">
      <div v-if="loadError" class="error-banner" role="alert">
        <span class="error-text">{{ loadError }}</span>
        <button class="error-dismiss" @click="loadError = null" aria-label="关闭">
          &times;
        </button>
      </div>
    </Transition>

    <!-- Loading overlay for save operations -->
    <div v-if="isLoading" class="inline-loading" role="status" aria-label="加载中">
      <div class="spinner" aria-hidden="true" />
      <span>加载存档中…</span>
    </div>

    <!-- Recent profiles list -->
    <section v-if="sortedProfiles.length > 0" class="profiles-section">
      <h2 class="section-title">最近的角色</h2>
      <ul class="profile-list">
        <li
          v-for="profile in sortedProfiles"
          :key="profile.profileId"
          class="profile-card"
          tabindex="0"
          role="button"
          :aria-label="`加载角色 ${profile.characterName}`"
          @click="onProfileClick(profile)"
          @keydown.enter="onProfileClick(profile)"
        >
          <!-- Avatar initial -->
          <div class="profile-avatar">
            {{ profile.characterName?.charAt(0) ?? '?' }}
          </div>

          <!-- Profile info -->
          <div class="profile-info">
            <span class="profile-name">{{ profile.characterName }}</span>
            <span class="profile-pack">{{ profile.packId }}</span>
          </div>

          <!-- Save meta (most recent slot) -->
          <div class="profile-meta">
            <span class="profile-time">
              {{ formatDate(getMostRecentSlot(profile)?.lastSavedAt ?? null) }}
            </span>
            <span
              v-if="getMostRecentSlot(profile)?.currentLocation"
              class="profile-location"
            >
              {{ getMostRecentSlot(profile)?.currentLocation }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <!-- Empty state when no profiles exist -->
    <section v-else class="empty-state">
      <p class="empty-text">还没有角色，点击「新建角色」开始你的冒险</p>
    </section>

    <!--
      开局前配置 modal：API / 设置
      APIPanel 完全不依赖 engine 状态树（只读 localStorage + aiService），可以无游戏加载。
      SettingsPanel 的状态树依赖 section 已用 `v-if="isLoaded"` 自行隐藏，无游戏时只显示
      外观/数据管理等 localStorage-only 的部分。两者都能在 HomeView 正确渲染。
    -->
    <!--
      两个内嵌面板本身都带 panel-header + 标题，所以这里不给 Modal 传 title
      避免视觉上双重标题。Modal 仍有右上角关闭按钮（closable 默认 true）。
    -->
    <Modal v-model="showApiModal" width="760px">
      <APIPanel />
    </Modal>
    <Modal v-model="showSettingsModal" width="760px">
      <SettingsPanel />
    </Modal>
  </div>
</template>

<style scoped>
/*
 * HomeView layout — sanctuary entry (migrated 2026-04-20 Phase 4.1).
 *
 * Design brief:  .impeccable.md (sanctuary · first exhale).
 * Approved demo: docs/demo/home-view.html.
 * Changelog:     docs/status/ui-migration-changelog.md.
 *
 * Migration scope: scoped-style ONLY. Template and <script setup> are
 * untouched. Every template class name is preserved; every ref / computed
 * / handler / emit / v-if condition is intact. This is a value-swap +
 * literal-replace + additive-animation change — zero logic mutation.
 */
.home-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 2rem 1.5rem;
  gap: 1.5rem;
  background: var(--color-bg);
  overflow-y: auto;
  /* Exhale on arrival — the first frame feels like the cabin door closing. */
  animation: home-exhale var(--duration-slow) var(--ease-out);
}

@keyframes home-exhale {
  from { opacity: 0; transform: scale(0.988); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── Header / branding ── */

.home-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

/*
 * Brand title — solid serif. The old gradient-fill-text (indigo → #a78bfa)
 * was the signature AI-slop violation in .impeccable.md §absolute_bans;
 * removed entirely. Solid warm-bone + literary serif carries the identity.
 */
.brand-title {
  font-family: var(--font-serif-cjk);
  font-size: clamp(2.2rem, 4vw, 2.8rem);
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-text);
}

.brand-subtitle {
  color: var(--color-text-secondary);
  font-size: 1rem;
}

.pack-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.8rem;
  background: var(--color-surface);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 25%, var(--color-border));
  border-radius: 999px;
  font-size: 0.8rem;
}

.pack-name {
  color: var(--color-text);
  font-family: var(--font-serif-cjk);
  font-weight: 500;
}

.pack-version {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

/* ── Action buttons ── */

.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
}

/* 次级操作行（API 配置 / 设置） — 视觉上从属于主操作但常驻可见 */
.actions--secondary {
  gap: 0.5rem;
  margin-top: -0.5rem;
}

.btn {
  padding: 0.65rem 1.8rem;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 0.92rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--duration-normal) var(--ease-out),
              border-color var(--duration-normal) var(--ease-out),
              color var(--duration-normal) var(--ease-out),
              opacity var(--duration-normal) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}

.btn:active:not(:disabled) {
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}

/* Primary — sage "new character": the main action. */
.btn-primary {
  background: var(--color-sage-400);
  color: var(--color-bg);
  font-weight: 600;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-sage-300);
}

/* Accent — amber "continue game": warm "come back in". */
.btn-accent {
  background: var(--color-amber-400);
  color: var(--color-bg);
  font-weight: 600;
}
.btn-accent:hover:not(:disabled) {
  background: var(--color-amber-300);
}

.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface-elevated);
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
}

/* Ghost — tertiary, transparent + tinted border on hover */
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 1.1rem;
  font-size: 0.82rem;
  font-weight: 500;
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.btn-ghost:hover:not(:disabled) {
  color: var(--color-text);
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent);
}
.btn-ghost svg {
  opacity: 0.75;
}

/* ── Error banner — warm rust wash ── */

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  background: var(--color-danger-muted);
  border: 1px solid color-mix(in oklch, var(--color-danger) 35%, var(--color-border));
  border-radius: 10px;
  width: 100%;
  max-width: 480px;
}

.error-text {
  flex: 1;
  font-size: 0.85rem;
  color: oklch(0.82 0.09 30); /* brighter rust for readability on the muted bg */
}

.error-dismiss {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 1.3rem;
  cursor: pointer;
  line-height: 1;
  padding: 0 0.25rem;
  transition: color var(--duration-normal) var(--ease-out);
}
.error-dismiss:hover {
  color: var(--color-text);
}

/* ── Inline loading — single breathing sage arc ── */

.inline-loading {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-top-color: var(--color-sage-400);
  border-radius: 50%;
  animation: home-spin 1.6s linear infinite;
}

@keyframes home-spin {
  to { transform: rotate(360deg); }
}

/* ── Profiles section ── */

.profiles-section {
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  padding-left: 0.15rem;
}

.profile-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/*
 * Profile card — horizontal row with avatar, name/pack, save meta.
 * Hover/focus: sage tint + sage-muted border. No indigo anywhere.
 */
.profile-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color var(--duration-normal) var(--ease-out),
              background-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.profile-card:hover,
.profile-card:focus-visible {
  border-color: color-mix(in oklch, var(--color-sage-400) 30%, var(--color-border));
  background: color-mix(in oklch, var(--color-sage-400) 4%, var(--color-surface));
  outline: none;
}
.profile-card:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 20%, transparent);
}

/*
 * Avatar — identity, not state. Warm surface + bone text, not sage/indigo.
 * The sage/amber beacons are reserved for actionable / warm-state surfaces.
 */
.profile-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-family: var(--font-serif-cjk);
  font-weight: 500;
  font-size: 1.1rem;
  border-radius: 999px;
}

.profile-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.profile-name {
  font-size: 0.95rem;
  font-weight: 500;
  font-family: var(--font-serif-cjk);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-pack {
  font-size: 0.74rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.profile-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  flex-shrink: 0;
}

.profile-time {
  font-size: 0.76rem;
  color: var(--color-text-secondary);
}

.profile-location {
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

/* ── Empty state ── */

.empty-state {
  text-align: center;
  padding: 2rem;
}

.empty-text {
  font-size: 0.92rem;
  color: var(--color-text-secondary);
  font-family: var(--font-serif-cjk);
  line-height: 1.6;
}

/* ── Transitions (Vue <Transition name="fade">) ── */

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── Responsive ── */

@media (max-width: 480px) {
  .brand-title {
    font-size: 1.9rem;
  }

  .actions {
    flex-direction: column;
    width: 100%;
    max-width: 320px;
  }

  .btn {
    width: 100%;
    text-align: center;
  }
}
</style>
