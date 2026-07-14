<script setup lang="ts">
// Design doc: docs/design/github-auto-sync-design.md
// App doc: docs/user-guide/pages/game-save.md §7.6 (自动云同步), docs/user-guide/cloud-sync.md
/**
 * CloudSyncManager — 应用级 GitHub 自动云同步引擎（无常驻可视 UI，仅 toast + 冲突弹窗）。
 *
 * 挂载于 App.vue，因此**不依赖任何面板打开**即可运行（区别于存档面板里那套只在面板
 * 打开时才跑的"时间点本地存档"）。存档面板 / 首页只负责那个开关；真正的自动上传逻辑
 * 全在这里。
 *
 * 触发模型（用户 2026-07-12 决策 D1）：在**下一回合开始时**（`pipeline:user-input`）上传
 * 上一回合的存档——此刻玩家已用行动确认上一回合内容 OK；被回退掉的回合天然不会上传。
 *
 * 保留的防丢失护栏（不绕过）：
 * - D2 退化存档：`DegradedUploadError` → 跳过 + 提醒，**绝不** force 覆盖；本会话软暂停避免刷屏。
 * - D3 多设备冲突：上传前 `detectConflict()`，云端比本机上次同步新 → 弹窗（覆盖/下载/取消暂停）。
 * - upload() 自身的并发锁 + 上传原子性由引擎保证。
 * - D4 成功也给一个轻 toast。
 */
import { ref, onMounted, onBeforeUnmount, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale } from '@/ui/composables/useLocale';
import Modal from '@/ui/components/common/Modal.vue';
import AgaButton from '@/ui/components/shared/AgaButton.vue';
import { eventBus } from '@/engine/core/event-bus';
import {
  DegradedUploadError,
  SyncInProgressError,
  type GitHubSyncService,
} from '@/engine/sync/github-sync';
import { shouldAttemptAutoUpload } from './cloud-autosync';

const { t } = useI18n();
const { formatDateTime } = useLocale();
const githubSync = inject<GitHubSyncService>('githubSync');

// ─── Local session state ──────────────────────────────────────

/**
 * In-memory monotonic counter of local saves this session, bumped on
 * engine:save-complete. Captured before an upload starts so the success handler can
 * tell whether a NEWER save landed while the upload was in flight (if so it must not
 * clear the pending flag). "Is there anything to upload at all?" lives in the
 * PERSISTED flag githubSync.hasPendingSync() — persisted so a tail-flush that failed
 * on close retries next launch, and a session that left data unsynced still uploads.
 */
let saveEpoch = 0;
/** Guards the async window between "start check" and "upload lock acquired". */
const busy = ref(false);
/** Soft-suspend auto-upload for this session after a degraded skip, so a persistently
 *  image-evicted cache doesn't re-run exportForSync + re-toast every round. Cleared on
 *  a successful upload or a page reload. (D2 = skip+warn, NOT flip the toggle off.) */
const degradedActive = ref(false);

const ERROR_TOAST_COOLDOWN = 60_000;
let lastErrorAt = 0;

// ─── Conflict modal state (D3) ────────────────────────────────

const conflictOpen = ref(false);
const conflictDetail = ref<{ cloudUpdatedAt?: string; cloudSizeKB?: number }>({});

function baselineDisplay(): string {
  const b = githubSync?.getSyncBaseline() ?? '';
  if (!b) return t('save.autoSyncCloud.conflict.neverSynced');
  try { return formatDateTime(b); } catch { return b; }
}
function cloudTimeDisplay(): string {
  const at = conflictDetail.value.cloudUpdatedAt;
  if (!at) return t('common.fallback.unknown');
  try { return formatDateTime(at); } catch { return at; }
}

// ─── Toast helper ─────────────────────────────────────────────

function toast(type: 'success' | 'warning' | 'error' | 'info', message: string, duration: number): void {
  // Shared dedup id: a newer auto-sync toast replaces the previous one instead of stacking.
  eventBus.emit('ui:toast', { type, message, duration, id: 'cloud-autosync' });
}

// ─── Core ─────────────────────────────────────────────────────

/**
 * Attempt an auto-upload if all guards pass. Called ONLY on next-round-start
 * (pipeline:user-input); it no-ops unless the previous round is still unuploaded
 * (pending flag). Never throws.
 */
async function maybeAutoUpload(): Promise<void> {
  const gh = githubSync;
  if (!gh) return;
  // Single safety gate (unit-tested in cloud-autosync.test.ts): the auto path must
  // never touch the network unless EVERY condition holds.
  if (!shouldAttemptAutoUpload({
    enabled: gh.getAutoSyncEnabled(),
    configured: gh.isConfigured(),
    syncing: gh.isSyncing(),
    busy: busy.value,
    conflictOpen: conflictOpen.value,
    degradedActive: degradedActive.value,
    dirty: gh.hasPendingSync(),
  })) return;

  busy.value = true;
  try {
    let check: Awaited<ReturnType<GitHubSyncService['detectConflict']>>;
    try {
      check = await gh.detectConflict();
    } catch (err) {
      // Conflict pre-check failed (offline / API). Skip quietly, retry next round —
      // do NOT upload blind (that could clobber a cloud we couldn't inspect).
      console.warn('[CloudSync] conflict pre-check failed:', err);
      return;
    }
    if (check.conflict) {
      // D3: cloud moved on since our last sync — never auto-overwrite. Ask the user.
      conflictDetail.value = { cloudUpdatedAt: check.cloud.updatedAt, cloudSizeKB: check.cloud.sizeKB };
      conflictOpen.value = true;
      return;
    }
    // Capture the save epoch NOW; the upload runs async and a new round may save
    // meanwhile — doUpload only clears the pending flag if the epoch is unchanged.
    await doUpload(false, saveEpoch);
  } finally {
    busy.value = false;
  }
}

/**
 * Run the actual upload and route the outcome. Never throws.
 * @param epochAtStart the saveEpoch captured before the upload began — the pending
 *   flag is cleared only if no newer save landed since, so a mid-upload save is not
 *   lost.
 */
async function doUpload(force: boolean, epochAtStart: number): Promise<void> {
  const gh = githubSync;
  if (!gh) return;
  try {
    await gh.upload(undefined, { force });
    // Clear "pending" ONLY if nothing newer saved while we were uploading; otherwise
    // leave it so the next trigger re-uploads the newer state.
    if (saveEpoch === epochAtStart) gh.setPendingSync(false);
    degradedActive.value = false;
    toast('success', t('save.autoSyncCloud.toast.uploaded'), 1800);
  } catch (err) {
    if (err instanceof DegradedUploadError) {
      // D2: skip + warn, NEVER auto-force. Soft-suspend to avoid per-round spam.
      degradedActive.value = true;
      toast(
        'warning',
        t('save.autoSyncCloud.toast.degradedSkipped', {
          referenced: err.detail.referencedAssets,
          missing: err.detail.missingAssets,
        }),
        6000,
      );
      return;
    }
    if (err instanceof SyncInProgressError) return; // another sync won the lock — benign
    const now = Date.now();
    if (now - lastErrorAt > ERROR_TOAST_COOLDOWN) {
      lastErrorAt = now;
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
      toast('error', t('save.autoSyncCloud.toast.uploadFailed', { error: msg }), 4000);
    }
    console.warn('[CloudSync] auto-upload failed:', err);
  }
}

// ─── Conflict modal actions (D3) ──────────────────────────────

async function onConflictOverwrite(): Promise<void> {
  conflictOpen.value = false;
  // User chose to overwrite the cloud with this device's save. The image-loss guard
  // still applies (force stays false) — overwriting a version conflict must not also
  // bypass the degraded protection.
  await doUpload(false, saveEpoch);
}

async function onConflictDownload(): Promise<void> {
  conflictOpen.value = false;
  const gh = githubSync;
  if (!gh) return;
  try {
    await gh.download();
    // Full local replace → resume active game + reload (same contract as manual download).
    sessionStorage.setItem('aga_post_import_resume', '1');
    toast('success', t('save.autoSyncCloud.toast.downloaded'), 2000);
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    if (err instanceof SyncInProgressError) return;
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
    toast('error', t('save.autoSyncCloud.toast.downloadFailed', { error: msg }), 4000);
  }
}

function onConflictCancelPause(): void {
  conflictOpen.value = false;
  // D3: cancelling keeps the cloud intact AND pauses auto-upload so we stop
  // interrupting every round. The user re-enables it from the save panel once resolved.
  githubSync?.setAutoSyncEnabled(false);
  eventBus.emit('ui:cloud-autosync-changed', { enabled: false });
  toast('info', t('save.autoSyncCloud.toast.pausedConflict'), 3500);
}

// ─── Wiring ───────────────────────────────────────────────────

let offInput: (() => void) | null = null;
let offSave: (() => void) | null = null;
let offToggle: (() => void) | null = null;

onMounted(() => {
  // SINGLE trigger: the start of a new round. maybeAutoUpload uploads only if the
  // previous round has not been uploaded yet (the pending flag) — i.e. "before each
  // round, if the last round wasn't uploaded, upload it".
  //
  // Deliberately NO visibilitychange / pagehide triggers. Those fired on every
  // tab-switch / minimize ("upload on the slightest move", user report 2026-07-14)
  // and, combined with per-round uploads + the old fire-and-forget cleanup, produced
  // a storm of chunk generations + a 409 flood. The LAST round of a session is still
  // covered without a tail-flush: the pending flag is PERSISTED (localStorage), so
  // the next launch's first round-start uploads it. Local data is never at risk
  // either way (uploads only READ local state).
  offInput = eventBus.on('pipeline:user-input', () => { void maybeAutoUpload(); });
  offSave = eventBus.on('engine:save-complete', () => {
    githubSync?.setPendingSync(true); // persisted: the last round uploads on the next launch's first round-start
    saveEpoch++;
  });
  // Re-enabling the toggle from ANY surface clears a degraded soft-suspend, so the
  // user can retry auto-upload without a full page reload.
  offToggle = eventBus.on<{ enabled: boolean }>('ui:cloud-autosync-changed', (p) => {
    if (p?.enabled) degradedActive.value = false;
  });
});

onBeforeUnmount(() => {
  offInput?.();
  offSave?.();
  offToggle?.();
});
</script>

<template>
  <!-- D3 conflict resolution. Not closable via backdrop/Esc: it is a data-loss
       decision and must be resolved by an explicit choice. -->
  <Modal
    :model-value="conflictOpen"
    :title="$t('save.autoSyncCloud.conflict.title')"
    :closable="false"
    width="460px"
  >
    <p class="cloud-conflict__lead">{{ $t('save.autoSyncCloud.conflict.explain') }}</p>

    <div class="cloud-conflict__state">
      <div class="cloud-conflict__row">
        <span class="cloud-conflict__k">{{ $t('save.autoSyncCloud.conflict.cloudLabel') }}</span>
        <span class="cloud-conflict__v">
          {{ cloudTimeDisplay() }}
          <span v-if="conflictDetail.cloudSizeKB != null" class="cloud-conflict__size">· {{ conflictDetail.cloudSizeKB }} KB</span>
        </span>
      </div>
      <div class="cloud-conflict__row">
        <span class="cloud-conflict__k">{{ $t('save.autoSyncCloud.conflict.lastSyncLabel') }}</span>
        <span class="cloud-conflict__v">{{ baselineDisplay() }}</span>
      </div>
    </div>

    <ul class="cloud-conflict__choices">
      <li><strong>{{ $t('save.autoSyncCloud.conflict.btnOverwrite') }}</strong>{{ $t('save.autoSyncCloud.conflict.optOverwrite') }}</li>
      <li><strong>{{ $t('save.autoSyncCloud.conflict.btnDownload') }}</strong>{{ $t('save.autoSyncCloud.conflict.optDownload') }}</li>
      <li><strong>{{ $t('save.autoSyncCloud.conflict.btnCancel') }}</strong>{{ $t('save.autoSyncCloud.conflict.optCancel') }}</li>
    </ul>

    <template #footer>
      <AgaButton variant="ghost" size="sm" @click="onConflictCancelPause">{{ $t('save.autoSyncCloud.conflict.btnCancel') }}</AgaButton>
      <AgaButton variant="secondary" size="sm" @click="onConflictDownload">{{ $t('save.autoSyncCloud.conflict.btnDownload') }}</AgaButton>
      <AgaButton variant="primary" size="sm" @click="onConflictOverwrite">{{ $t('save.autoSyncCloud.conflict.btnOverwrite') }}</AgaButton>
    </template>
  </Modal>
</template>

<style scoped>
.cloud-conflict__lead {
  margin: 0 0 14px;
  color: var(--color-text);
  line-height: 1.6;
}

.cloud-conflict__state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}
.cloud-conflict__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.cloud-conflict__k {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.cloud-conflict__v {
  font-size: 0.85rem;
  color: var(--color-text);
  text-align: right;
}
.cloud-conflict__size {
  color: var(--color-text-secondary);
  margin-left: 4px;
}

.cloud-conflict__choices {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cloud-conflict__choices li {
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.cloud-conflict__choices strong {
  color: var(--color-text);
  font-weight: 600;
  margin-right: 4px;
}
</style>
