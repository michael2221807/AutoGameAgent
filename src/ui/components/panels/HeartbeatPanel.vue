<script setup lang="ts">
// App doc: docs/user-guide/pages/game-heartbeat.md
/**
 * HeartbeatPanel — heartbeat configuration and execution history.
 *
 * Displays heartbeat enable/disable toggle, period setting,
 * and recent heartbeat execution logs from the state tree.
 */
import { ref, computed, watch } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { eventBus } from '@/engine/core/event-bus';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

const { isLoaded, useValue, setValue } = useGameState();

// ─── Heartbeat configuration ───

const heartbeatEnabled = useValue<boolean>(DEFAULT_ENGINE_PATHS.heartbeatEnabled);
const heartbeatPeriod = useValue<number>(DEFAULT_ENGINE_PATHS.heartbeatPeriod);
const heartbeatHistory = useValue<unknown[]>(DEFAULT_ENGINE_PATHS.heartbeatHistory);
const lastHeartbeatTime = useValue<string>(DEFAULT_ENGINE_PATHS.heartbeatLastRun);

/**
 * Period input mirrors the state value for two-way editing.
 * We sync from state on load, and write back on commit.
 */
const periodInput = ref<number>(5);

watch(heartbeatPeriod, (val) => {
  if (typeof val === 'number') periodInput.value = val;
}, { immediate: true });

// ─── Actions ───

function saveHeartbeatToLocalStorage(enabled: boolean, period: number): void {
  try {
    localStorage.setItem('aga_heartbeat_settings', JSON.stringify({ enabled, period }));
  } catch { /* no-op */ }
}

function toggleHeartbeat(): void {
  const current = heartbeatEnabled.value ?? false;
  const next = !current;
  setValue(DEFAULT_ENGINE_PATHS.heartbeatEnabled, next);
  saveHeartbeatToLocalStorage(next, heartbeatPeriod.value ?? 5);
  eventBus.emit('ui:toast', {
    type: current ? 'warning' : 'success',
    message: current ? '心跳已禁用' : '心跳已启用',
    duration: 1500,
  });
}

function updatePeriod(): void {
  const val = Math.max(1, Math.round(periodInput.value));
  setValue(DEFAULT_ENGINE_PATHS.heartbeatPeriod, val);
  saveHeartbeatToLocalStorage(heartbeatEnabled.value ?? false, val);
  eventBus.emit('ui:toast', { type: 'info', message: `心跳周期已设为 ${val} 回合`, duration: 1500 });
}

// ─── History display ───

interface HeartbeatEntry {
  id: string;
  time: string;
  round: number | undefined;
  result: string;
  success: boolean;
}

const historyEntries = computed<HeartbeatEntry[]>(() => {
  const raw = heartbeatHistory.value;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, idx) => {
    if (typeof entry === 'string') {
      return { id: `hb_${idx}`, time: '', round: undefined, result: entry, success: true };
    }
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      return {
        id: String(obj['id'] ?? `hb_${idx}`),
        time: String(obj['时间'] ?? obj['timestamp'] ?? ''),
        round: typeof obj['回合'] === 'number' ? obj['回合'] : undefined,
        result: String(obj['结果'] ?? obj['result'] ?? obj['描述'] ?? ''),
        success: obj['成功'] !== false,
      };
    }
    return { id: `hb_${idx}`, time: '', round: undefined, result: String(entry), success: true };
  }).reverse();
});

const expandedEntry = ref<string | null>(null);

function toggleEntry(id: string): void {
  expandedEntry.value = expandedEntry.value === id ? null : id;
}
</script>

<template>
  <div class="heartbeat-panel">
    <template v-if="isLoaded">
      <header class="panel-header">
        <h2 class="panel-title">心跳系统</h2>
      </header>

      <!-- ─── Configuration card ─── -->
      <section class="config-card">
        <h3 class="card-title">心跳配置</h3>

        <!-- Enable/disable toggle -->
        <div class="config-row">
          <span class="config-label">启用心跳</span>
          <button
            :class="['toggle-btn', { 'toggle-btn--active': heartbeatEnabled }]"
            @click="toggleHeartbeat"
            :aria-pressed="!!heartbeatEnabled"
          >
            <span class="toggle-track">
              <span class="toggle-thumb" />
            </span>
            <span class="toggle-text">{{ heartbeatEnabled ? '已启用' : '已禁用' }}</span>
          </button>
        </div>

        <!-- Period setting -->
        <div class="config-row">
          <span class="config-label">执行周期</span>
          <div class="period-input-group">
            <input
              v-model.number="periodInput"
              type="number"
              min="1"
              max="100"
              class="period-input"
            />
            <span class="period-unit">回合/次</span>
            <button class="btn-sm" @click="updatePeriod">应用</button>
          </div>
        </div>

        <!-- Last execution info -->
        <div class="config-row">
          <span class="config-label">上次执行</span>
          <span class="config-value">{{ lastHeartbeatTime ?? '尚未执行' }}</span>
        </div>

        <!-- Status indicator -->
        <div class="status-indicator">
          <span
            :class="['status-dot', heartbeatEnabled ? 'status-dot--active' : 'status-dot--inactive']"
          />
          <span class="status-text">
            {{ heartbeatEnabled ? '心跳正在运行' : '心跳已暂停' }}
          </span>
        </div>
      </section>

      <!-- ─── History ─── -->
      <section class="history-card">
        <h3 class="card-title">
          执行历史
          <span v-if="historyEntries.length" class="badge">{{ historyEntries.length }}</span>
        </h3>

        <div v-if="historyEntries.length" class="history-list">
          <div
            v-for="entry in historyEntries"
            :key="entry.id"
            :class="['history-item', { 'history-item--expanded': expandedEntry === entry.id }]"
            @click="toggleEntry(entry.id)"
          >
            <div class="history-header">
              <span
                :class="['history-status', entry.success ? 'history-status--ok' : 'history-status--fail']"
              >
                {{ entry.success ? '✓' : '✕' }}
              </span>
              <div class="history-info">
                <span v-if="entry.round != null" class="history-round">R{{ entry.round }}</span>
                <span v-if="entry.time" class="history-time">{{ entry.time }}</span>
              </div>
            </div>
            <div v-if="expandedEntry === entry.id" class="history-result">
              {{ entry.result }}
            </div>
          </div>
        </div>
        <p v-else class="empty-hint">暂无执行记录</p>
      </section>
    </template>

    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>
  </div>
</template>

<style scoped>
.heartbeat-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
}

/* ── Cards ── */
.config-card,
.history-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Config rows ── */
.config-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
}
.config-row + .config-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.config-label {
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
}

.config-value {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Toggle button ── */
.toggle-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary, #8888a0);
}

.toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  transition: background 0.2s ease;
}

.toggle-btn--active .toggle-track {
  background: var(--color-primary, #6366f1);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--color-text-bone);
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.toggle-btn--active .toggle-thumb {
  transform: translateX(16px);
}

.toggle-text {
  font-size: 0.78rem;
  font-weight: 500;
}
.toggle-btn--active .toggle-text {
  color: var(--color-primary, #6366f1);
}

/* ── Period input ── */
.period-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.period-input {
  width: 60px;
  height: 30px;
  padding: 0 8px;
  font-size: 0.85rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  outline: none;
  text-align: center;
}
.period-input:focus {
  border-color: var(--color-primary, #6366f1);
}

.period-unit {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-primary, #6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 25%, transparent);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover {
  background: var(--color-primary, #6366f1);
  color: var(--color-text-bone);
}

/* ── Status indicator ── */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot--active {
  background: var(--color-success, #22c55e);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
  animation: pulse 2s infinite;
}
.status-dot--inactive {
  background: var(--color-text-secondary, #8888a0);
  opacity: 0.5;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.status-text {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
}

/* ── History ── */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.history-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.history-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-status {
  font-size: 0.75rem;
  font-weight: 700;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.history-status--ok {
  color: var(--color-success, #22c55e);
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
}
.history-status--fail {
  color: var(--color-danger, #ef4444);
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
}

.history-info {
  display: flex;
  gap: 8px;
  align-items: center;
}

.history-round {
  font-size: 0.78rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text, #e0e0e6);
  font-weight: 600;
}

.history-time {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
}

.history-result {
  margin-top: 6px;
  padding: 6px 8px;
  font-size: 0.78rem;
  color: var(--color-text, #e0e0e6);
  opacity: 0.85;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  box-shadow: inset 3px 0 0 color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* ── Badge ── */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-primary, #6366f1);
  border-radius: 9px;
}

/* ── Empty ── */
.empty-hint {
  font-size: 0.82rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
  text-align: center;
  margin: 0;
  padding: 12px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.88rem;
}

/* ── Scrollbar ── */
.heartbeat-panel::-webkit-scrollbar { width: 5px; }
.heartbeat-panel::-webkit-scrollbar-track { background: transparent; }
.heartbeat-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }

@media (max-width: 767px) {
  .heartbeat-panel { padding-left: var(--space-md); padding-right: var(--space-md); transition: none; }
}
</style>
