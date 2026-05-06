<script setup lang="ts">
// App doc: docs/user-guide/pages/game-events.md
/**
 * EventPanel — displays world events + heartbeat history.
 * Also provides a collapsible event-config section for tuning event intervals,
 * type toggles, custom templates, and manual re-roll.
 *
 * Config writes go to `世界.状态.事件配置.*` via useGameState().setValue(),
 * then an `engine:request-save` is emitted so the change is persisted.
 */
import { ref, computed } from 'vue';
import Modal from '@/ui/components/common/Modal.vue';
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';

const { isLoaded, useValue, get, setValue } = useGameState();

// ─── Event timeline ───────────────────────────────────────────

/** Event entry shape (normalized from potentially varying game pack formats) */
interface WorldEvent {
  id: string;
  title: string;
  description: string;
  timestamp?: string;
  type?: string;
  round?: number;
  [key: string]: unknown;
}

const heartbeatHistory = useValue<unknown[]>(DEFAULT_ENGINE_PATHS.heartbeatHistory);
const worldEvents = useValue<unknown[]>(DEFAULT_ENGINE_PATHS.worldEvents);

/**
 * Normalize a raw event object into the display format.
 * Handles both heartbeat history entries and general event entries.
 */
function normalizeEvent(raw: unknown, idx: number, source: string): WorldEvent {
  if (typeof raw === 'string') {
    return { id: `${source}_${idx}`, title: raw, description: raw, type: source };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      id: String(obj['事件ID'] ?? obj['id'] ?? `${source}_${idx}`),
      title: String(obj['事件名称'] ?? obj['标题'] ?? obj['title'] ?? obj['事件'] ?? `事件 #${idx + 1}`),
      description: String(obj['事件描述'] ?? obj['描述'] ?? obj['description'] ?? obj['内容'] ?? ''),
      timestamp: (() => { const ts = obj['发生时间'] ?? obj['时间'] ?? obj['timestamp']; return typeof ts === 'string' ? ts : undefined; })(),
      type: String(obj['事件类型'] ?? obj['类型'] ?? obj['type'] ?? source),
      round: typeof obj['回合'] === 'number' ? obj['回合'] : undefined,
    };
  }
  return { id: `${source}_${idx}`, title: `事件 #${idx + 1}`, description: String(raw), type: source };
}

/** Merged + sorted event timeline */
const timeline = computed<WorldEvent[]>(() => {
  const events: WorldEvent[] = [];

  if (Array.isArray(heartbeatHistory.value)) {
    heartbeatHistory.value.forEach((entry, idx) => {
      events.push(normalizeEvent(entry, idx, '心跳'));
    });
  }

  if (Array.isArray(worldEvents.value)) {
    worldEvents.value.forEach((entry, idx) => {
      events.push(normalizeEvent(entry, idx, '世界'));
    });
  }

  return events.reverse();
});

// ─── Expanded event ───────────────────────────────────────────

const expandedId = ref<string | null>(null);

function toggleExpand(id: string): void {
  expandedId.value = expandedId.value === id ? null : id;
}

/** Type badge color */
function typeColor(type: string | undefined): string {
  switch (type) {
    case '心跳': return 'var(--color-success, #22c55e)';
    case '世界': return 'var(--color-primary, #6366f1)';
    case '战斗': return 'var(--color-danger, #ef4444)';
    case '剧情': return 'var(--color-sage-400, #8cb88c)';
    default: return 'var(--color-text-secondary, #8888a0)';
  }
}

// ─── Config section ───────────────────────────────────────────

const configOpen = ref(false);

const CONFIG_BASE = '世界.状态.事件配置';

/** Read a number from the config path, with a fallback default */
function cfgNum(sub: string, def: number): number {
  const v = get<number>(`${CONFIG_BASE}.${sub}`);
  return typeof v === 'number' ? v : def;
}

/** Read a boolean from the config path, default true */
function cfgBool(sub: string): boolean {
  const v = get<boolean>(`${CONFIG_BASE}.${sub}`);
  return v === false ? false : true;
}

// Interval
const minYear = computed(() => cfgNum('间隔.最小年', 1));
const maxYear = computed(() => cfgNum('间隔.最大年', 5));

function setMinYear(v: number): void {
  const clamped = Math.max(1, Math.min(v, maxYear.value));
  setValue(`${CONFIG_BASE}.间隔.最小年`, clamped);
  persist();
}
function setMaxYear(v: number): void {
  const clamped = Math.max(minYear.value, Math.min(v, 100));
  setValue(`${CONFIG_BASE}.间隔.最大年`, clamped);
  persist();
}

// Type toggles
const EVENT_TYPES = ['势力冲突', '局势变化', '重大发现', '人物风波', '特殊NPC'] as const;
type EventTypeName = typeof EVENT_TYPES[number];

function typeEnabled(name: EventTypeName): boolean {
  return cfgBool(`类型开关.${name}`);
}
function toggleType(name: EventTypeName): void {
  setValue(`${CONFIG_BASE}.类型开关.${name}`, !typeEnabled(name));
  persist();
}

// Custom templates
interface CustomEventTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  impact: '低' | '中' | '高';
}

const customTemplates = computed<CustomEventTemplate[]>(() => {
  const raw = get<CustomEventTemplate[]>(`${CONFIG_BASE}.自定义模板`);
  return Array.isArray(raw) ? raw : [];
});

// Add template form
const addFormOpen = ref(false);
const newTemplate = ref<Omit<CustomEventTemplate, 'id'>>({
  name: '',
  type: '世界',
  description: '',
  impact: '中',
});
const newTemplateError = ref('');

function openAddForm(): void {
  newTemplate.value = { name: '', type: '世界', description: '', impact: '中' };
  newTemplateError.value = '';
  addFormOpen.value = true;
}

function submitAddTemplate(): void {
  const { name, type, description } = newTemplate.value;
  if (!name.trim() || !type.trim() || !description.trim()) {
    newTemplateError.value = '名称、类型、描述均为必填项';
    return;
  }
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setValue(`${CONFIG_BASE}.自定义模板`, [...customTemplates.value, { id, ...newTemplate.value }]);
  persist();
  addFormOpen.value = false;
}

// Delete template
const deleteTargetId = ref<string | null>(null);

/** v-model 代理：Modal 关闭时清空 deleteTargetId */
const showDeleteModal = computed({
  get: () => deleteTargetId.value !== null,
  set: (v: boolean) => { if (!v) deleteTargetId.value = null; },
});

function confirmDelete(id: string): void {
  deleteTargetId.value = id;
}
function doDelete(): void {
  if (!deleteTargetId.value) return;
  setValue(`${CONFIG_BASE}.自定义模板`, customTemplates.value.filter((t) => t.id !== deleteTargetId.value));
  persist();
  deleteTargetId.value = null;
}

// Manual re-roll
const currentRound = computed(() => {
  const v = get<number>(DEFAULT_ENGINE_PATHS.roundNumber);
  return typeof v === 'number' ? v : 0;
});

function rerollNextEvent(): void {
  const min = minYear.value;
  const max = maxYear.value;
  const offset = Math.floor(Math.random() * (max - min + 1)) + min;
  setValue(`${CONFIG_BASE}.下次事件回合`, currentRound.value + offset);
  persist();
}

/** Emit save request so config change survives between sessions */
function persist(): void {
  eventBus.emit('engine:request-save');
}
</script>

<template>
  <div class="event-panel">
    <template v-if="isLoaded">
      <header class="panel-header">
        <h2 class="panel-title">
          事件日志
          <span v-if="timeline.length" class="badge">{{ timeline.length }}</span>
        </h2>
        <button class="config-toggle" :class="{ 'config-toggle--active': configOpen }" @click="configOpen = !configOpen" title="事件配置">
          <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
          </svg>
        </button>
      </header>

      <!-- ── Config section ── -->
      <Transition name="cfg-expand">
        <section v-if="configOpen" class="config-section">

          <!-- Interval -->
          <div class="cfg-group">
            <p class="cfg-group-title">事件间隔（年）</p>
            <div class="cfg-row">
              <label class="cfg-label" for="evt-min">最小年</label>
              <input
                id="evt-min"
                class="cfg-input"
                type="number"
                :value="minYear"
                min="1"
                max="99"
                @change="setMinYear(Number(($event.target as HTMLInputElement).value))"
              />
              <label class="cfg-label" for="evt-max">最大年</label>
              <input
                id="evt-max"
                class="cfg-input"
                type="number"
                :value="maxYear"
                :min="minYear"
                max="100"
                @change="setMaxYear(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>

          <!-- Type toggles -->
          <div class="cfg-group">
            <p class="cfg-group-title">事件类型开关</p>
            <div class="cfg-toggles">
              <button
                v-for="typeName in EVENT_TYPES"
                :key="typeName"
                :class="['type-toggle', { 'type-toggle--on': typeEnabled(typeName) }]"
                @click="toggleType(typeName)"
              >{{ typeName }}</button>
            </div>
          </div>

          <!-- Re-roll -->
          <div class="cfg-group cfg-group--inline">
            <p class="cfg-group-title">手动重抽下次事件</p>
            <button class="btn btn--secondary btn--sm" @click="rerollNextEvent">重抽</button>
          </div>

          <!-- Custom templates -->
          <div class="cfg-group">
            <div class="cfg-group-header">
              <p class="cfg-group-title">自定义事件模板 <span class="cfg-count">{{ customTemplates.length }}</span></p>
              <button class="btn btn--primary btn--sm" @click="openAddForm">+ 新增</button>
            </div>

            <div v-if="customTemplates.length" class="template-list">
              <div v-for="tpl in customTemplates" :key="tpl.id" class="template-row">
                <div class="template-info">
                  <span class="template-name">{{ tpl.name }}</span>
                  <span class="template-type">{{ tpl.type }}</span>
                  <span :class="['template-impact', `template-impact--${tpl.impact}`]">{{ tpl.impact }}</span>
                </div>
                <button class="btn-icon btn-icon--danger" title="删除" @click="confirmDelete(tpl.id)">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <p v-else class="cfg-empty">暂无自定义模板</p>
          </div>
        </section>
      </Transition>

      <!-- ── Timeline ── -->
      <div v-if="timeline.length" class="timeline">
        <div
          v-for="event in timeline"
          :key="event.id"
          :class="['timeline-item', { 'timeline-item--expanded': expandedId === event.id }]"
          @click="toggleExpand(event.id)"
        >
          <!-- Timeline indicator -->
          <div class="timeline-dot" :style="{ background: typeColor(event.type) }" />
          <div class="timeline-line" />

          <div class="event-content">
            <div class="event-header">
              <span class="event-title">{{ event.title }}</span>
              <div class="event-meta">
                <span v-if="event.type" class="event-type" :style="{ color: typeColor(event.type) }">
                  {{ event.type }}
                </span>
                <span v-if="event.round != null" class="event-round">R{{ event.round }}</span>
                <span v-if="event.timestamp" class="event-time">{{ event.timestamp }}</span>
              </div>
            </div>

            <Transition name="desc-expand">
              <div v-if="expandedId === event.id && event.description" class="event-description">
                {{ event.description }}
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>暂无事件记录</p>
      </div>
    </template>

    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>
  </div>

  <!-- ── Add template modal ── -->
  <Modal v-model="addFormOpen" title="新增自定义事件模板" width="400px">
    <div class="form-field">
      <label class="form-label">名称 <span class="req">*</span></label>
      <input v-model="newTemplate.name" class="form-input" placeholder="模板名称" maxlength="40" />
    </div>
    <div class="form-field">
      <label class="form-label">类型 <span class="req">*</span></label>
      <input v-model="newTemplate.type" class="form-input" placeholder="如：世界、战斗" maxlength="20" />
    </div>
    <div class="form-field">
      <label class="form-label">描述模板 <span class="req">*</span></label>
      <textarea v-model="newTemplate.description" class="form-textarea" placeholder="事件描述模板" rows="3" />
    </div>
    <div class="form-field">
      <label class="form-label">影响等级</label>
      <div class="impact-options">
        <label v-for="opt in ['低', '中', '高']" :key="opt" class="impact-option">
          <input type="radio" :value="opt" v-model="newTemplate.impact" />
          {{ opt }}
        </label>
      </div>
    </div>
    <p v-if="newTemplateError" class="form-error">{{ newTemplateError }}</p>
    <template #footer>
      <button class="btn btn--secondary" @click="addFormOpen = false">取消</button>
      <button class="btn btn--primary" @click="submitAddTemplate">确认添加</button>
    </template>
  </Modal>

  <!-- ── Delete confirm modal ── -->
  <Modal v-model="showDeleteModal" title="确认删除" width="360px">
    <p>确定要删除这个自定义事件模板吗？此操作无法撤销。</p>
    <template #footer>
      <button class="btn btn--secondary" @click="deleteTargetId = null">取消</button>
      <button class="btn btn--danger" @click="doDelete">删除</button>
    </template>
  </Modal>
</template>

<style scoped>
.event-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-text-bone);
  background: var(--color-primary, #6366f1);
  border-radius: 10px;
}

/* ── Config toggle button ── */
.config-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 7px;
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.config-toggle:hover,
.config-toggle--active {
  color: var(--color-primary, #6366f1);
  border-color: var(--color-primary, #6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 8%, transparent);
}

/* ── Config section ── */
.config-section {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.cfg-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cfg-group--inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.cfg-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cfg-group-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cfg-count {
  font-size: 0.68rem;
  padding: 1px 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  font-weight: 700;
  color: var(--color-text-secondary, #8888a0);
  text-transform: none;
  letter-spacing: 0;
}

.cfg-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cfg-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #8888a0);
  flex-shrink: 0;
}

.cfg-input {
  width: 64px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  color: var(--color-text, #e0e0e6);
  font-size: 0.82rem;
  text-align: center;
}
.cfg-input:focus {
  outline: none;
  border-color: var(--color-primary, #6366f1);
}

.cfg-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.type-toggle {
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 20px;
  border: 1px solid var(--color-border, #2a2a3a);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.15s;
}
.type-toggle--on {
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  border-color: var(--color-primary, #6366f1);
  color: var(--color-primary, #6366f1);
}
.type-toggle:hover {
  border-color: var(--color-primary, #6366f1);
  color: var(--color-primary, #6366f1);
}

.cfg-empty {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  font-style: italic;
}

/* ── Template list ── */
.template-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 7px;
  border: 1px solid var(--color-border, #2a2a3a);
}

.template-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.template-name {
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-type {
  font-size: 0.7rem;
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  color: var(--color-text-secondary, #8888a0);
  flex-shrink: 0;
}

.template-impact {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}
.template-impact--低 { background: color-mix(in oklch, var(--color-success) 12%, transparent); color: var(--color-success); }
.template-impact--中 { background: color-mix(in oklch, var(--color-amber-400) 12%, transparent); color: var(--color-amber-400); }
.template-impact--高 { background: color-mix(in oklch, var(--color-danger) 12%, transparent); color: var(--color-danger); }

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.btn--primary { background: var(--color-primary, #6366f1); color: var(--color-text-bone); }
.btn--primary:hover { opacity: 0.88; }
.btn--secondary { background: rgba(255,255,255,0.07); color: var(--color-text, #e0e0e6); }
.btn--secondary:hover { background: rgba(255,255,255,0.12); }
.btn--danger { background: var(--color-danger, #ef4444); color: var(--color-text-bone); }
.btn--danger:hover { opacity: 0.88; }
.btn--sm { padding: 4px 10px; font-size: 0.76rem; border-radius: 6px; }

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.btn-icon--danger { color: var(--color-text-secondary, #8888a0); }
.btn-icon--danger:hover { background: color-mix(in oklch, var(--color-danger) 15%, transparent); color: var(--color-danger); }

/* ── Modal form fields ── */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}
.form-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
}
.req { color: var(--color-danger, #ef4444); }
.form-input,
.form-textarea {
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 7px;
  color: var(--color-text, #e0e0e6);
  font-size: 0.84rem;
  font-family: inherit;
  resize: vertical;
}
.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-primary, #6366f1);
}
.form-error {
  margin: 0 0 8px;
  font-size: 0.78rem;
  color: var(--color-danger, #ef4444);
}

.impact-options {
  display: flex;
  gap: 14px;
}
.impact-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  cursor: pointer;
}

/* ── Config open/close transition ── */
.cfg-expand-enter-active { transition: all 0.2s ease; }
.cfg-expand-leave-active { transition: all 0.15s ease; }
.cfg-expand-enter-from,
.cfg-expand-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.cfg-expand-enter-to,
.cfg-expand-leave-from { opacity: 1; max-height: 800px; }

/* ── Timeline ── */
.timeline {
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  position: relative;
  cursor: pointer;
  transition: background 0.15s ease;
}
.timeline-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
}

.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
  z-index: 1;
}

.timeline-line {
  position: absolute;
  left: 4px;
  top: 20px;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.06);
}

.timeline-item:last-child .timeline-line {
  display: none;
}

.event-content {
  flex: 1;
  min-width: 0;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.event-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
  flex: 1;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.event-type {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.event-round {
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text-secondary, #8888a0);
}

.event-time {
  font-size: 0.7rem;
  color: var(--color-text-secondary, #8888a0);
}

.event-description {
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--color-text, #e0e0e6);
  opacity: 0.8;
  line-height: 1.55;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  box-shadow: inset 3px 0 0 color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* ── Transitions ── */
.desc-expand-enter-active { transition: all 0.2s ease; }
.desc-expand-leave-active { transition: all 0.15s ease; }
.desc-expand-enter-from,
.desc-expand-leave-to { opacity: 0; max-height: 0; margin-top: 0; }

/* ── Empty ── */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.88rem;
}

/* ── Scrollbar ── */
.event-panel::-webkit-scrollbar { width: 5px; }
.event-panel::-webkit-scrollbar-track { background: transparent; }
.event-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }

@media (max-width: 767px) {
  .event-panel { padding-left: var(--space-md); padding-right: var(--space-md); transition: none; }
}
</style>
