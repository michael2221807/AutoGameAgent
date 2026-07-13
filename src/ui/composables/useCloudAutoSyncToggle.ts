// Design doc: docs/design/github-auto-sync-design.md
// App doc: docs/user-guide/pages/game-save.md §2.2 (自动上传开关), docs/user-guide/pages/home.md §1.3.3
/**
 * Shared wiring for the "auto-upload to cloud" toggle, used by both SavePanel and
 * the HomeView cloud modal so the two surfaces can't drift. The toggle is only the
 * switch + last-synced readout; the actual auto-upload engine runs app-wide in
 * CloudSyncManager.vue.
 *
 * Keeps its local view consistent across surfaces (and with CloudSyncManager's
 * conflict auto-pause) via the `ui:cloud-autosync-changed` event.
 *
 * Must be called synchronously in a component's setup (it uses useLocale + onUnmounted).
 */
import { ref, onUnmounted } from 'vue';
import { useLocale } from '@/ui/composables/useLocale';
import { eventBus } from '@/engine/core/event-bus';
import type { GitHubSyncService } from '@/engine/sync/github-sync';

export function useCloudAutoSyncToggle(githubSync: GitHubSyncService | undefined) {
  const { formatDateTime } = useLocale();

  const autoSyncOn = ref(githubSync?.getAutoSyncEnabled() ?? false);
  const lastSynced = ref('');

  function refreshLastSync(): void {
    const baseline = githubSync?.getSyncBaseline() ?? '';
    if (!baseline) { lastSynced.value = ''; return; }
    try { lastSynced.value = formatDateTime(baseline); } catch { lastSynced.value = baseline; }
  }
  refreshLastSync();

  function toggle(v: boolean): void {
    if (!githubSync) return;
    githubSync.setAutoSyncEnabled(v);
    autoSyncOn.value = v;
    eventBus.emit('ui:cloud-autosync-changed', { enabled: v });
  }

  // Stay consistent when another surface (or CloudSyncManager's conflict auto-pause)
  // flips the toggle, and refresh the last-synced time as the baseline moves.
  const off = eventBus.on<{ enabled: boolean }>('ui:cloud-autosync-changed', (p) => {
    if (p) autoSyncOn.value = p.enabled;
    refreshLastSync();
  });
  onUnmounted(() => off());

  return { autoSyncOn, lastSynced, toggle, refreshLastSync };
}
