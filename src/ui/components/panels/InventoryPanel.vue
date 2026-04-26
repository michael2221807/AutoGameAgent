<script setup lang="ts">
/**
 * InventoryPanel — 背包物品与货币展示。
 *
 * 三系统审计结论（2026-04-08）：
 * - 角色.背包.物品 ← Record<id, Item>（set 添加，delete 删除）——非数组
 * - 角色.背包.金钱 ← 容器对象，子键 .现金/.铜/.银/.金 各为 number——非单个数字
 * - 物品 quality 字段：{ quality: "普通|优良|稀有|史诗|传说|神话", grade: 0-10 }
 *
 * 原 P0 Bug（已修复）：
 * 1. items 类型错误为 InventoryItem[]，导致 Array.isArray 永远失败 → 背包永远空
 * 2. currency 类型错误为 number，读取容器对象 → 显示 0
 */
import { ref, computed } from 'vue';
import { useGameState } from '@/ui/composables/useGameState';
import { useActionQueueStore } from '@/engine/stores/engine-action-queue';
import { eventBus } from '@/engine/core/event-bus';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

const { isLoaded, useValue } = useGameState();
const actionQueue = useActionQueueStore();

/** 品质子对象 */
interface ItemQuality {
  quality?: string;
  grade?: number;
}

/** 背包物品结构（Record 的值类型） */
interface InventoryItem {
  名称: string;
  描述?: string;
  数量?: number;
  类型?: string;
  可装备?: boolean;
  已装备?: boolean;
  品质?: ItemQuality | string;
  [key: string]: unknown;
}

/** 展示用：带 Record key 的物品 */
interface DisplayItem extends InventoryItem {
  _id: string;
}

// ─── State reads (correct types after audit) ───

/** Record<id, Item> — 不是数组 */
const items = useValue<Record<string, InventoryItem>>(DEFAULT_ENGINE_PATHS.inventoryItems);

/** 容器对象 { 现金: number, 铜: number, ... } — 不是单个 number */
const currencyMap = useValue<Record<string, number>>(DEFAULT_ENGINE_PATHS.inventoryCurrency);

// ─── Derived display items ───

/** 将 Record 展开为带 _id 的数组 */
const allItems = computed<DisplayItem[]>(() => {
  const raw = items.value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([id, item]) => ({ ...item, _id: id }));
});

// ─── Filtering & search ───

const searchQuery = ref('');
const filterType = ref('all');

const itemTypes = computed<string[]>(() => {
  const types = new Set<string>();
  for (const item of allItems.value) {
    if (item.类型) types.add(item.类型);
  }
  return Array.from(types).sort();
});

const filteredItems = computed<DisplayItem[]>(() => {
  let list = allItems.value;
  if (filterType.value !== 'all') {
    list = list.filter((i) => i.类型 === filterType.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(
      (i) => i.名称.toLowerCase().includes(q) || (i.描述 ?? '').toLowerCase().includes(q),
    );
  }
  return list;
});

// ─── Currency display ───

const CURRENCY_ICONS: Record<string, string> = {
  现金: '💴',
  金: '🪙',
  银: '⚪',
  铜: '🟤',
};

const currencyEntries = computed<{ name: string; icon: string; amount: number }[]>(() => {
  const raw = currencyMap.value;
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([name, amount]) => ({
      name,
      icon: CURRENCY_ICONS[name] ?? '💰',
      amount: amount as number,
    }));
});

// ─── Quality badge ───

const QUALITY_COLORS: Record<string, string> = {
  普通: 'var(--color-text-muted)',
  优良: 'var(--color-sage-300)',
  稀有: 'var(--color-sage-400)',
  史诗: 'var(--color-amber-300)',
  传说: 'var(--color-amber-400)',
  神话: 'var(--color-danger)',
};

function getQualityLabel(item: InventoryItem): string | null {
  const q = item.品质;
  if (!q) return null;
  if (typeof q === 'string') return q;
  if (typeof q === 'object' && q.quality) return q.quality;
  return null;
}

function getQualityColor(label: string): string {
  return QUALITY_COLORS[label] ?? 'var(--color-text-muted)';
}

// ─── Item detail ───

const selectedItem = ref<DisplayItem | null>(null);

function selectItem(item: DisplayItem): void {
  selectedItem.value = selectedItem.value?._id === item._id ? null : item;
}

// ─── Actions → action queue ───

function generateActionId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function handleUse(item: DisplayItem): void {
  actionQueue.addAction({
    id: generateActionId(),
    type: 'use_item',
    description: `使用物品「${item.名称}」`,
    data: { itemName: item.名称, itemId: item._id },
    createdAt: Date.now(),
  });
  eventBus.emit('ui:toast', { type: 'info', message: `已将「使用 ${item.名称}」加入操作队列`, duration: 2000 });
}

function handleEquip(item: DisplayItem): void {
  const action = item.已装备 ? '卸下' : '装备';
  actionQueue.addAction({
    id: generateActionId(),
    type: item.已装备 ? 'unequip_item' : 'equip_item',
    description: `${action}物品「${item.名称}」`,
    data: { itemName: item.名称, itemId: item._id },
    createdAt: Date.now(),
  });
  eventBus.emit('ui:toast', { type: 'info', message: `已将「${action} ${item.名称}」加入操作队列`, duration: 2000 });
}

function handleDrop(item: DisplayItem): void {
  actionQueue.addAction({
    id: generateActionId(),
    type: 'drop_item',
    description: `丢弃物品「${item.名称}」`,
    data: { itemName: item.名称, itemId: item._id },
    createdAt: Date.now(),
  });
  eventBus.emit('ui:toast', { type: 'warning', message: `已将「丢弃 ${item.名称}」加入操作队列`, duration: 2000 });
}

/** Icon character based on item type */
function itemTypeIcon(type: string | undefined): string {
  const icons: Record<string, string> = {
    武器: '⚔',
    防具: '🛡',
    消耗品: '🧪',
    材料: '📦',
    任务: '📜',
    饰品: '💍',
  };
  return icons[type ?? ''] ?? '🔹';
}
</script>

<template>
  <div class="inventory-panel">
    <template v-if="isLoaded">
      <!-- ─── Header with currency ─── -->
      <header class="panel-header">
        <h2 class="panel-title">背包</h2>
        <div class="currency-bar">
          <template v-if="currencyEntries.length > 0">
            <div
              v-for="c in currencyEntries"
              :key="c.name"
              class="currency-chip"
            >
              <span class="currency-icon">{{ c.icon }}</span>
              <span class="currency-name">{{ c.name }}</span>
              <span class="currency-amount">{{ c.amount }}</span>
            </div>
          </template>
          <span v-else class="currency-empty">无货币</span>
        </div>
      </header>

      <!-- ─── Search and filter bar ─── -->
      <div class="toolbar">
        <input
          v-model="searchQuery"
          type="text"
          class="search-field"
          placeholder="搜索物品…"
        />
        <select v-model="filterType" class="filter-select">
          <option value="all">全部</option>
          <option v-for="t in itemTypes" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <!-- ─── Item count ─── -->
      <div class="item-summary">
        <span class="item-count">共 {{ filteredItems.length }} 件物品</span>
        <span v-if="allItems.length !== filteredItems.length" class="filter-hint">
          （全部 {{ allItems.length }} 件）
        </span>
      </div>

      <!-- ─── Item list ─── -->
      <div v-if="filteredItems.length" class="item-list">
        <div
          v-for="item in filteredItems"
          :key="item._id"
          :class="['item-card', { 'item-card--selected': selectedItem?._id === item._id, 'item-card--equipped': item.已装备 }]"
          @click="selectItem(item)"
        >
          <div class="item-icon">{{ itemTypeIcon(item.类型) }}</div>
          <div class="item-info">
            <div class="item-name-row">
              <span class="item-name">{{ item.名称 }}</span>
              <span v-if="item.已装备" class="equipped-badge">已装备</span>
              <span
                v-if="getQualityLabel(item)"
                class="quality-badge"
                :style="{ color: getQualityColor(getQualityLabel(item)!), borderColor: getQualityColor(getQualityLabel(item)!) }"
              >
                {{ getQualityLabel(item) }}
              </span>
            </div>
            <span v-if="item.描述" class="item-desc">{{ item.描述 }}</span>
            <div class="item-meta">
              <span v-if="item.类型" class="item-type">{{ item.类型 }}</span>
              <span v-if="item.数量 != null && item.数量 > 1" class="item-qty">×{{ item.数量 }}</span>
            </div>
          </div>

          <!-- Expanded actions on selection -->
          <Transition name="actions-slide">
            <div v-if="selectedItem?._id === item._id" class="item-actions" @click.stop>
              <button class="action-btn action-btn--use" @click="handleUse(item)">使用</button>
              <button
                v-if="item.可装备"
                class="action-btn action-btn--equip"
                @click="handleEquip(item)"
              >
                {{ item.已装备 ? '卸下' : '装备' }}
              </button>
              <button class="action-btn action-btn--drop" @click="handleDrop(item)">丢弃</button>
            </div>
          </Transition>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>{{ searchQuery || filterType !== 'all' ? '没有匹配的物品' : '背包为空' }}</p>
      </div>
    </template>

    <div v-else class="empty-state">
      <p>尚未加载游戏数据</p>
    </div>
  </div>
</template>

<style scoped>
.inventory-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  height: 100%;
  overflow-y: auto;
  transition: padding-left var(--duration-open) var(--ease-droplet),
              padding-right var(--duration-open) var(--ease-droplet);
}

/* ── Header ── */
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
  flex-shrink: 0;
}

/* ── Currency bar ── */
.currency-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.currency-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px 3px 6px;
  background: color-mix(in oklch, var(--color-amber-400) 8%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-amber-400) 20%, transparent);
  border-radius: 20px;
}

.currency-icon {
  font-size: 0.9rem;
  line-height: 1;
}

.currency-name {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
}

.currency-amount {
  font-size: 0.82rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-amber-400);
}

.currency-empty {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.5;
}

/* ── Toolbar ── */
.toolbar {
  display: flex;
  gap: 8px;
}

.search-field {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s ease;
}
.search-field:focus {
  border-color: var(--color-primary, #6366f1);
}
.search-field::placeholder {
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.6;
}

.filter-select {
  height: 36px;
  padding: 0 10px;
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  outline: none;
  cursor: pointer;
}

/* ── Item summary ── */
.item-summary {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #8888a0);
  display: flex;
  gap: 6px;
}

.filter-hint {
  opacity: 0.6;
}

/* ── Item list ── */
.item-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-wrap: wrap;
}
.item-card:hover {
  background: color-mix(in oklch, var(--color-sage-400) 4%, transparent);
  border-color: color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}
.item-card--selected {
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  border-color: var(--color-sage-600);
}
.item-card--equipped {
  box-shadow: inset 3px 0 0 var(--color-success);
}

.item-icon {
  font-size: 1.3rem;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.item-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
}

.equipped-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 6px;
  color: var(--color-success);
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border-radius: 8px;
}

.quality-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 8px;
  opacity: 0.9;
}

.item-desc {
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}

.item-type {
  font-size: 0.7rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.7;
}

.item-qty {
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-text-secondary, #8888a0);
}

/* ── Item actions ── */
.item-actions {
  display: flex;
  gap: 6px;
  width: 100%;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.action-btn {
  padding: 4px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  transition: all 0.15s ease;
}
.action-btn:hover {
  color: var(--color-text, #e0e0e6);
}

.action-btn--use:hover {
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-color: var(--color-sage-600);
  color: var(--color-sage-400);
}

.action-btn--equip:hover {
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  border-color: var(--color-success);
  color: var(--color-success);
}

.action-btn--drop:hover {
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
  border-color: var(--color-danger);
  color: var(--color-danger);
}

/* ── Transition ── */
.actions-slide-enter-active {
  transition: all 0.2s ease;
}
.actions-slide-leave-active {
  transition: all 0.15s ease;
}
.actions-slide-enter-from,
.actions-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
}

/* ── Empty state ── */
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
.inventory-panel::-webkit-scrollbar {
  width: 5px;
}
.inventory-panel::-webkit-scrollbar-track {
  background: transparent;
}
.inventory-panel::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--color-text-umber) 35%, transparent);
  border-radius: 3px;
}
</style>
