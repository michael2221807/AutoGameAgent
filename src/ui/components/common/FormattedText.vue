<script setup lang="ts">
/**
 * FormattedText — 叙事文本富格式渲染组件
 *
 * 将 AI 返回的叙事正文按特殊标记解析为带样式的富格式段落：
 * - 【...】  环境描写（斜体、灰色）
 * - `...`   NPC 内心（斜体、弱色）
 * - "..."   对话（高亮）
 * - "..."   中文引号对话（高亮）
 * - 〖类型:结果,判定值:X,难度:Y,...〗  判定卡片（独立卡片组件）
 * - 普通文本  直接显示
 *
 * 判定格式（来自 tianming core.md）：
 *   〖类型:结果,判定值:X,难度:Y,基础:B,幸运:L,环境:E,状态:S〗
 *
 * 移植自 demo FormattedText.vue，保留核心解析逻辑，
 * 去除 i18n/酒馆专属字段，适配正式版字段名（判定值/难度/幸运/基础/环境/状态）。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ImageDisplay from '@/ui/components/image/ImageDisplay.vue';

export interface NpcBrief {
  名称: string;
  性别?: string;
  描述?: string;
  好感度?: number;
  类型?: string;
  '图片档案'?: { '已选头像图片ID'?: string };
}

interface JudgementData {
  type: string;
  result: string;
  finalValue?: string;
  difficulty?: string;
  base?: string;
  lucky?: string;
  environment?: string;
  status?: string;
  details: string[];
}

interface TextPart {
  kind: 'normal' | 'environment' | 'psychology' | 'dialogue' | 'judgement' | 'npc-name';
  text?: string;
  judgement?: JudgementData;
}

const props = defineProps<{
  text: string;
  npcNames?: string[];
  npcData?: NpcBrief[];
}>();

const router = useRouter();
const npcMap = computed(() => {
  const map = new Map<string, NpcBrief>();
  if (props.npcData) {
    for (const npc of props.npcData) {
      if (npc.名称) map.set(npc.名称, npc);
    }
  }
  return map;
});

const hoveredNpc = ref<NpcBrief | null>(null);
const popoverPos = ref({ x: 0, y: 0 });
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function onNpcEnter(name: string, event: MouseEvent): void {
  const npc = npcMap.value.get(name);
  if (!npc) return;
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hoveredNpc.value = npc;
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    popoverPos.value = { x: rect.left + rect.width / 2, y: rect.top };
  }, 400);
}

function onNpcLeave(): void {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  hoveredNpc.value = null;
}

function onNpcClick(name: string): void {
  onNpcLeave();
  router.push({ path: '/game/relationships', query: { npc: name } });
}

// ─── Helpers ──────────────────────────────────────────────────

function isSuccess(result: string): boolean {
  return result.includes('成功') && !result.includes('失败');
}
function isFailure(result: string): boolean {
  return result.includes('失败');
}
function isGreatSuccess(result: string): boolean {
  return result.includes('大成功') || result.includes('完美');
}
function isGreatFailure(result: string): boolean {
  return result.includes('大失败');
}

/** Parse 〖类型:结果,判定值:X,难度:Y,基础:B,幸运:L,环境:E,状态:S〗 */
function parseJudgement(raw: string): JudgementData {
  const normalized = raw.replace(/：/g, ':').replace(/，/g, ',');
  const parts = normalized.split(',').map((p) => p.trim());
  const [typeStr, resultStr] = (parts[0] ?? '').split(':').map((s) => s.trim());
  const data: JudgementData = {
    type: typeStr ?? '判定',
    result: resultStr ?? '',
    details: [],
  };
  for (let i = 1; i < parts.length; i++) {
    const colonIdx = parts[i].indexOf(':');
    if (colonIdx === -1) continue;
    const key = parts[i].slice(0, colonIdx).trim();
    const val = parts[i].slice(colonIdx + 1).trim();
    if (!key || !val) continue;
    if (key === '判定值') data.finalValue = val;
    else if (key === '难度') data.difficulty = val;
    else if (key === '基础') data.base = val;
    else if (key === '幸运') data.lucky = val;
    else if (key === '环境') data.environment = val;
    else if (key === '状态') data.status = val;
    else if (key === '结果') {
      // AI sometimes generates 〖社交:判定,结果:成功,...〗 instead of 〖社交:成功,...〗
      // When the first field has "判定" as a type label, the actual result is here
      if (!data.result || data.result === '判定') data.result = val;
    }
    else data.details.push(`${key}:${val}`);
  }
  return data;
}

// ─── Parser ───────────────────────────────────────────────────
//
// 2026-04-11 重写：改为 two-pass 架构，保证 `〖...〗` 判定块即使被包在对话
// `"..."`/`"..."` 或反引号 `...` 内部也能正确抽出为独立 judgement part。
//
// 之前的单 pass 版本按 "距离最近的 marker 优先" 策略工作，对 `"〖...〗"` 这种
// 形态会首先遇到 `"`（位置更早），把整段当成 dialogue 吞掉，判定卡片永远不
// 渲染。bugfix from user regression testing:
//
//    "当判定 context 置于对话的 \"\" 之中时判定窗口渲染会失效"
//
// 新策略：
//   Pass 1  — 扫描整段文本找出所有 `〖...〗` 区间（非嵌套、原子块）
//   Pass 2  — 对非判定段落运行原有的 marker 解析逻辑（环境/心理/对话）
//   合并     — 按原文顺序交错 judgement parts 和解析出的普通 parts
//
// 这样 judgement 块永远被当成最高优先级的原子单位抽出，对话/代码 marker 仅
// 在剩余文本里工作，quotes 再也无法"吞掉"一个判定块。

/** 判定块预切割结果 */
interface JudgementSlice {
  /** 判定块在原文中的起始位置 */
  start: number;
  /** 判定块在原文中的结束位置（`〗` 之后一位） */
  end: number;
  /** 已解析的 JudgementData */
  judgement: JudgementData;
}

/**
 * Pass 1: 扫描所有 `〖...〗` 区间。
 *
 * 非嵌套假设：判定块里不会再包含 `〖`（prompt 明确规定只用这对字符，且
 * 内部只有 `类型:结果,key:val` 这种纯文本 + 符号，不会出现中文角括号）。
 * 因此简单的"找下一个 〖 → 找下一个 〗"就足够。
 *
 * 未闭合的 `〖`（没有对应 `〗`）被忽略，当作普通文本留给 Pass 2。
 */
function findJudgementSlices(text: string): JudgementSlice[] {
  const slices: JudgementSlice[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const openPos = text.indexOf('〖', cursor);
    if (openPos === -1) break;
    const closePos = text.indexOf('〗', openPos + 1);
    if (closePos === -1) break; // 未闭合 → 放弃后续扫描
    const inner = text.slice(openPos + 1, closePos);
    slices.push({
      start: openPos,
      end: closePos + 1,
      judgement: parseJudgement(inner),
    });
    cursor = closePos + 1;
  }
  return slices;
}

/**
 * Pass 2: 对非判定文本段落按原有的 marker 优先策略解析。
 *
 * 此函数处理**不含任何 `〖...〗`** 的一段普通文本，把它拆成 environment /
 * psychology / dialogue / normal parts，不处理 judgement（Pass 1 已提取）。
 */
function parseNonJudgementSegment(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let idx = 0;

  while (idx < text.length) {
    // 找距离最近的非判定 opening marker
    const markers: Array<{ pos: number; close: string; kind: TextPart['kind'] }> = ([
      { pos: text.indexOf('【', idx), close: '】', kind: 'environment' as const },
      { pos: text.indexOf('`', idx), close: '`', kind: 'psychology' as const },
      { pos: text.indexOf('"', idx), close: '"', kind: 'dialogue' as const },
      { pos: text.indexOf('\u201c', idx), close: '\u201d', kind: 'dialogue' as const }, // " "
    ] as const).filter((m) => m.pos !== -1);

    if (markers.length === 0) {
      const remaining = text.slice(idx);
      if (remaining) parts.push({ kind: 'normal', text: remaining });
      break;
    }

    markers.sort((a, b) => a.pos - b.pos);
    const { pos: openPos, close, kind } = markers[0];

    if (openPos > idx) {
      parts.push({ kind: 'normal', text: text.slice(idx, openPos) });
    }

    const closePos = text.indexOf(close, openPos + 1);
    if (closePos === -1) {
      parts.push({ kind: 'normal', text: text.slice(openPos) });
      break;
    }

    const inner = text.slice(openPos + 1, closePos);
    const displayText = kind === 'environment'
      ? `【${inner}】`
      : kind === 'psychology'
        ? `\`${inner}\``
        : (text[openPos] === '"'
          ? `"${inner}"`
          : `\u201c${inner}\u201d`);
    parts.push({ kind, text: displayText });

    idx = closePos + close.length;
  }

  return parts;
}

function highlightNpcNames(parts: TextPart[], names: string[]): TextPart[] {
  if (names.length === 0) return parts;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

  const result: TextPart[] = [];
  for (const part of parts) {
    if (part.kind !== 'normal' || !part.text) {
      result.push(part);
      continue;
    }
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(part.text)) !== null) {
      if (match.index > lastIdx) {
        result.push({ kind: 'normal', text: part.text.slice(lastIdx, match.index) });
      }
      result.push({ kind: 'npc-name', text: match[0] });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx === 0) {
      result.push(part);
    } else if (lastIdx < part.text.length) {
      result.push({ kind: 'normal', text: part.text.slice(lastIdx) });
    }
  }
  return result;
}

const parsedParts = computed<TextPart[]>(() => {
  const text = (props.text ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  if (!text.trim()) return [{ kind: 'normal', text }];

  // Pass 1：抽出所有 〖...〗 判定块
  const slices = findJudgementSlices(text);

  let parts: TextPart[];

  if (slices.length === 0) {
    parts = parseNonJudgementSegment(text);
  } else {
    parts = [];
    let cursor = 0;
    for (const slice of slices) {
      if (slice.start > cursor) {
        const segment = text.slice(cursor, slice.start);
        parts.push(...parseNonJudgementSegment(segment));
      }
      parts.push({ kind: 'judgement', judgement: slice.judgement });
      cursor = slice.end;
    }
    if (cursor < text.length) {
      parts.push(...parseNonJudgementSegment(text.slice(cursor)));
    }
  }

  const names = props.npcNames;
  if (names && names.length > 0) {
    parts = highlightNpcNames(parts, names);
  }

  return parts;
});
</script>

<template>
  <span class="formatted-text">
    <template v-for="(part, i) in parsedParts" :key="i">
      <!-- Judgement card -->
      <span v-if="part.kind === 'judgement' && part.judgement" class="judgement-card" :class="{
        'judgement-card--success': isSuccess(part.judgement.result) && !isGreatSuccess(part.judgement.result),
        'judgement-card--failure': isFailure(part.judgement.result) && !isGreatFailure(part.judgement.result),
        'judgement-card--great-success': isGreatSuccess(part.judgement.result),
        'judgement-card--great-failure': isGreatFailure(part.judgement.result),
      }">
        <!-- Icon -->
        <span class="jc-icon" aria-hidden="true">
          <svg v-if="isGreatSuccess(part.judgement.result)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <svg v-else-if="isSuccess(part.judgement.result)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <svg v-else-if="isGreatFailure(part.judgement.result)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <svg v-else-if="isFailure(part.judgement.result)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </span>

        <!-- Type + Result -->
        <span class="jc-type">{{ part.judgement.type }}</span>
        <span class="jc-badge">{{ part.judgement.result }}</span>

        <!-- Stats row -->
        <span class="jc-stats">
          <span v-if="part.judgement.finalValue" class="jc-stat">
            <span class="jc-stat-label">判定值</span>
            <span class="jc-stat-value">{{ part.judgement.finalValue }}</span>
          </span>
          <span v-if="part.judgement.difficulty" class="jc-stat">
            <span class="jc-stat-label">难度</span>
            <span class="jc-stat-value">{{ part.judgement.difficulty }}</span>
          </span>
          <span v-if="part.judgement.base" class="jc-stat">
            <span class="jc-stat-label">基础</span>
            <span class="jc-stat-value">{{ part.judgement.base }}</span>
          </span>
          <span v-if="part.judgement.lucky" class="jc-stat" :class="{ 'jc-stat--positive': part.judgement.lucky.startsWith('+'), 'jc-stat--negative': part.judgement.lucky.startsWith('-') }">
            <span class="jc-stat-label">幸运</span>
            <span class="jc-stat-value">{{ part.judgement.lucky }}</span>
          </span>
          <span v-if="part.judgement.environment && part.judgement.environment !== '0'" class="jc-stat">
            <span class="jc-stat-label">环境</span>
            <span class="jc-stat-value">{{ part.judgement.environment }}</span>
          </span>
          <span v-if="part.judgement.status && part.judgement.status !== '0'" class="jc-stat">
            <span class="jc-stat-label">状态</span>
            <span class="jc-stat-value">{{ part.judgement.status }}</span>
          </span>
          <span v-for="(d, di) in part.judgement.details" :key="di" class="jc-stat jc-stat--detail">
            <span class="jc-stat-value">{{ d }}</span>
          </span>
        </span>
      </span>

      <!-- Environment 【】 -->
      <span v-else-if="part.kind === 'environment'" class="ft-environment">{{ part.text }}</span>

      <!-- Psychology `` -->
      <span v-else-if="part.kind === 'psychology'" class="ft-psychology">{{ part.text }}</span>

      <!-- Dialogue "" / "" -->
      <span v-else-if="part.kind === 'dialogue'" class="ft-dialogue">{{ part.text }}</span>

      <!-- NPC name -->
      <span
        v-else-if="part.kind === 'npc-name'"
        class="ft-npc-name"
        @mouseenter="onNpcEnter(part.text!, $event)"
        @mouseleave="onNpcLeave"
        @click.stop="onNpcClick(part.text!)"
      >{{ part.text }}</span>

      <!-- Normal text -->
      <span v-else class="ft-normal">{{ part.text }}</span>
    </template>

    <!-- NPC hover popover -->
    <Teleport to="body">
      <Transition name="npc-pop">
        <div
          v-if="hoveredNpc"
          class="npc-popover"
          :style="{ left: popoverPos.x + 'px', top: popoverPos.y + 'px' }"
        >
          <div class="npc-pop-row">
            <ImageDisplay
              :asset-id="hoveredNpc['图片档案']?.['已选头像图片ID']"
              :fallback-letter="hoveredNpc.名称?.charAt(0) ?? '?'"
              size="sm"
              class="npc-pop-avatar"
            />
            <div class="npc-pop-info">
              <span class="npc-pop-name">{{ hoveredNpc.名称 }}</span>
              <span v-if="hoveredNpc.性别 || hoveredNpc.类型" class="npc-pop-meta">{{ [hoveredNpc.性别, hoveredNpc.类型].filter(Boolean).join(' · ') }}</span>
            </div>
            <span v-if="hoveredNpc.好感度 != null" class="npc-pop-affinity">♡ {{ hoveredNpc.好感度 }}</span>
          </div>
          <p v-if="hoveredNpc.描述" class="npc-pop-desc">{{ hoveredNpc.描述 }}</p>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.formatted-text {
  font-family: var(--font-serif-cjk);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: var(--narrative-line-height, 1.88);
  letter-spacing: var(--narrative-letter-spacing, 0.01em);
}

/* ── Inline text styles (sanctuary migration 2026-04-21) ───────────
   Three distinct spectral "voices" so each marker reads at a glance
   even in a long prose block:

   - Dialogue "..."      → warm amber-kissed bone. Per .impeccable.md:
                           "amber … used sparingly for warmth, confirmation,
                           and narrative emphasis" — dialogue is the
                           canonical warm beacon INSIDE the prose.
   - Environment 【...】  → umber italic. Stage direction / world.
   - Psychology  `...`   → sage-tinged italic. Inner thought / mental
                           state — sage is the "focus / state" accent
                           per the brief. */

.ft-environment {
  color: var(--color-text-umber);
  font-style: italic;
  opacity: 0.92;
}

.ft-psychology {
  color: color-mix(in oklch, var(--color-sage-400) 26%, var(--color-text-secondary));
  font-style: italic;
  opacity: 0.85;
}

.ft-npc-name {
  color: var(--color-sage-300);
  font-weight: 600;
  border-bottom: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent);
  cursor: pointer;
  transition: color var(--duration-fast, 120ms) ease, border-color var(--duration-fast, 120ms) ease;
}
.ft-npc-name:hover {
  color: var(--color-sage-400);
  border-color: var(--color-sage-400);
}

.ft-dialogue {
  /* Direct amber-300 — the warm beacon for narrative emphasis per
     .impeccable.md. A prior 30% color-mix made dialogue look nearly
     identical to body bone in the real theme (user flagged it
     2026-04-21). Direct amber gives clear, readable contrast. */
  color: var(--color-amber-300);
  font-weight: 500;
  letter-spacing: 0.015em;
}

/* ── Judgement card (sanctuary rebuild, 2026-04-21) ────────────────
   ABSOLUTE-BAN `border-left: 3px solid …` has been REMOVED per
   .impeccable.md "Borders: never colored side-stripes (absolute ban)".
   Replaced with a full 1px border tinted by the judgement accent +
   symmetrical 8px corners + tokenized sanctuary washes. Tailwind
   red/green/amber hex literals replaced with sage / amber / rust
   semantic tokens. */

.judgement-card {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 6px 12px;
  margin: 3px 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid color-mix(in oklch,
    var(--jc-accent, var(--color-text-umber)) 30%,
    var(--color-border));
  background: var(--jc-bg, color-mix(in oklch, var(--color-text-umber) 6%, transparent));
  font-size: 0.82rem;
  line-height: 1.4;
  vertical-align: middle;
  transition: box-shadow var(--duration-normal, 240ms) var(--ease-out);
}

.judgement-card--success {
  --jc-accent: var(--color-sage-400);
  --jc-bg: var(--color-judgement-success-bg);
  --jc-badge-bg: color-mix(in oklch, var(--color-sage-400) 22%, transparent);
  --jc-badge-color: var(--color-sage-300);
  --jc-icon-color: var(--color-sage-400);
}

.judgement-card--great-success {
  --jc-accent: var(--color-amber-400);
  --jc-bg: var(--color-judgement-great-success-bg);
  --jc-badge-bg: color-mix(in oklch, var(--color-amber-400) 24%, transparent);
  --jc-badge-color: var(--color-amber-300);
  --jc-icon-color: var(--color-amber-400);
  box-shadow: 0 0 18px color-mix(in oklch, var(--color-amber-400) 14%, transparent);
}

.judgement-card--failure {
  --jc-accent: var(--color-danger);
  --jc-bg: var(--color-judgement-failure-bg);
  --jc-badge-bg: color-mix(in oklch, var(--color-danger) 18%, transparent);
  --jc-badge-color: color-mix(in oklch, var(--color-danger) 90%, var(--color-text));
  --jc-icon-color: var(--color-danger);
}

.judgement-card--great-failure {
  --jc-accent: var(--color-danger);
  --jc-bg: var(--color-judgement-great-failure-bg);
  --jc-badge-bg: color-mix(in oklch, var(--color-danger) 28%, transparent);
  --jc-badge-color: color-mix(in oklch, var(--color-danger) 95%, var(--color-text));
  --jc-icon-color: var(--color-danger);
}

.jc-icon {
  color: var(--jc-icon-color, var(--color-text-umber));
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.jc-type {
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: 0.05em;
}

.jc-badge {
  padding: 2px 10px;
  border-radius: var(--radius-full, 999px);
  background: var(--jc-badge-bg, var(--color-sage-muted));
  color: var(--jc-badge-color, var(--color-sage-300));
  font-weight: 600;
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.jc-stats {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
}

.jc-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 4px);
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.jc-stat-label {
  color: var(--color-text-muted);
  margin-right: 2px;
}

.jc-stat-value {
  color: var(--color-text);
  font-weight: 600;
}

.jc-stat--positive .jc-stat-value { color: var(--color-sage-300); }
.jc-stat--negative .jc-stat-value { color: var(--color-danger-hover); }
.jc-stat--detail { opacity: 0.7; }

/* ── NPC popover ── */
.npc-popover {
  position: fixed;
  transform: translate(-50%, calc(-100% - 8px));
  z-index: 9999;
  min-width: 200px;
  max-width: 280px;
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-surface, #1a1a1a) 96%, transparent);
  backdrop-filter: blur(16px) saturate(1.3);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 20%, var(--color-border));
  box-shadow: 0 8px 24px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2);
  pointer-events: none;
}
.npc-pop-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.npc-pop-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
}
.npc-pop-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.npc-pop-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--color-text-bone);
  font-family: var(--font-serif-cjk);
}
.npc-pop-meta {
  font-size: 0.68rem;
  color: var(--color-text-secondary);
}
.npc-pop-affinity {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-sage-400);
  flex-shrink: 0;
}
.npc-pop-desc {
  margin: 6px 0 0;
  font-size: 0.74rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.npc-pop-enter-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.npc-pop-leave-active { transition: opacity 0.1s ease; }
.npc-pop-enter-from { opacity: 0; transform: translate(-50%, calc(-100% - 2px)); }
.npc-pop-leave-to { opacity: 0; }
</style>
