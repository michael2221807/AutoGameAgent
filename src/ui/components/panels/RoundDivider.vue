<script setup lang="ts">
/**
 * RoundDivider — a visual break between rounds in the MainGamePanel message
 * stream. Shows a horizontal rule with a centered "第 N 回合" badge, and an
 * optional token/duration stats pill below.
 *
 * Phase 2 (2026-04-19): basic badge + metrics pill.
 * Phase 3 will populate the `actions-left` / `actions-right` slots with
 * satellite buttons (thinking / commands / raw-view).
 *
 * Layout reference: MRJH TurnItem's outer wrapper
 * (h:/MoRanJiangHu/MoRanJiangHu/components/features/Chat/TurnItem.tsx:277-386).
 * AGA port uses its own design tokens — no Tailwind.
 *
 * Data contract: `metrics` maps to `narrativeHistory[i]._metrics` on the
 * assistant entry. `_metrics` is UI-private; it never reaches the AI prompt
 * (see src/engine/pipeline/stages/context-assembly.ts `wrap()` and
 * src/engine/memory/snapshot-sanitizer.ts `PROMPT_ALWAYS_STRIP_PATHS`).
 */
import {
  formatDuration,
  formatTokens,
  type DisplayMetrics,
} from './round-divider-helpers';

interface Props {
  /** Which round this divider precedes. */
  roundNumber: number;
  /**
   * Display-ready metrics (either Phase 1 `_metrics` or a legacy-synthesized
   * subset with `'unknown'` placeholders for un-recoverable fields).
   * Caller uses `deriveDisplayMetrics()` to normalize both cases.
   */
  metrics?: DisplayMetrics;
  /**
   * Whether this divider sits above the latest assistant message.
   * Controls satellite-button visibility asymmetry (MRJH convention):
   *   - Commands button: shown iff `isCurrent && hasCommands`
   *   - Thinking / Raw buttons: always shown when their data is present
   */
  isCurrent?: boolean;
  /** Show the 🌐 thinking button (left cluster). */
  hasThinking?: boolean;
  /** Show the ☰ commands button (right cluster, current-round only). */
  hasCommands?: boolean;
  /** Show the ⮂ raw-response button (right cluster). */
  hasRaw?: boolean;
  /** Show the 🧠 Engram button (right cluster). */
  hasEngram?: boolean;
  /**
   * Polish state for this round (Phase 4, 2026-04-19).
   * `applied === true` means the round was polished — badge becomes clickable
   * and shows the 已自动优化 / 已手动优化 subtitle. Toggle state lives in
   * MainGamePanel (see `showingOriginalForRound`).
   */
  polish?: {
    applied: boolean;
    manual?: boolean;
    model?: string;
  };
  /** True when parent is currently showing the pre-polish original text. */
  showingOriginal?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isCurrent: false,
  hasThinking: false,
  hasCommands: false,
  hasRaw: false,
  hasEngram: false,
  showingOriginal: false,
});

const emit = defineEmits<{
  /** Left cluster — 🌐: open CoT viewer for this round */
  'view-thinking': [];
  /** Right cluster — ☰: open commands + delta viewer (current round only) */
  'view-commands': [];
  /** Right cluster — ⮂: open raw-response viewer */
  'view-raw': [];
  /** Right cluster — 🧠: open Engram round viewer */
  'view-engram': [];
  /** Center badge click — request parent to flip the 优化/原文 view for this round. */
  'toggle-original': [];
}>();

function onBadgeClick(): void {
  if (props.polish?.applied) emit('toggle-original');
}
</script>

<template>
  <div class="round-divider" :class="{ 'round-divider--current': props.isCurrent }">
    <!-- Top row: horizontal rule + left cluster + centered badge + right cluster + horizontal rule -->
    <div class="round-divider__top">
      <span class="round-divider__line" aria-hidden="true" />

      <div class="round-divider__actions round-divider__actions--left">
        <!-- 🌐 Thinking button — shown whenever this round has CoT data (both current + past rounds). -->
        <button
          v-if="props.hasThinking"
          type="button"
          class="round-divider__icon-btn"
          title="查看 AI 思考"
          aria-label="查看本回合 AI 思考"
          @click="$emit('view-thinking')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A8.959 8.959 0 0 1 3 12c0-.778.099-1.533.284-2.253" />
          </svg>
        </button>
      </div>

      <component
        :is="props.polish?.applied ? 'button' : 'div'"
        class="round-divider__badge"
        :class="{ 'round-divider__badge--clickable': props.polish?.applied }"
        :type="props.polish?.applied ? 'button' : undefined"
        :title="props.polish?.applied ? `点击切换到${props.showingOriginal ? '优化' : '原文'}视图` : undefined"
        :aria-pressed="props.polish?.applied ? props.showingOriginal : undefined"
        @click="onBadgeClick"
      >
        <span class="round-divider__badge-main">第 {{ props.roundNumber }} 回合</span>
        <span v-if="props.polish?.applied" class="round-divider__badge-sub">
          {{ props.polish.manual ? '已手动优化' : '已自动优化' }}
          ·
          {{ props.showingOriginal ? '原文' : '优化' }}
        </span>
      </component>

      <div class="round-divider__actions round-divider__actions--right">
        <!-- ☰ Commands button — current round only (MRJH TurnItem.tsx:337 convention). -->
        <button
          v-if="props.isCurrent && props.hasCommands"
          type="button"
          class="round-divider__icon-btn round-divider__icon-btn--commands"
          title="查看本回合命令 / 变更"
          aria-label="查看本回合命令与生效变更"
          @click="$emit('view-commands')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5m-16.5 6.75h16.5m-16.5 6.75h16.5" />
          </svg>
        </button>
        <!-- ⮂ Raw-response button — shown whenever this round has raw text (both current + past rounds). -->
        <button
          v-if="props.hasRaw"
          type="button"
          class="round-divider__icon-btn"
          title="查看原始响应"
          aria-label="查看本回合原始 AI 响应"
          @click="$emit('view-raw')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
          </svg>
        </button>
        <!-- 🧠 Engram button — shown when this round has Engram write/read data. -->
        <button
          v-if="props.hasEngram"
          type="button"
          class="round-divider__icon-btn round-divider__icon-btn--engram"
          title="查看 Engram 记忆流程"
          aria-label="查看本回合 Engram 写入与召回详情"
          @click="$emit('view-engram')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>

      <span class="round-divider__line" aria-hidden="true" />
    </div>

    <!-- Token / duration pill, only when metrics available -->
    <div v-if="props.metrics" class="round-divider__pill" :title="`本回合元信息 · round ${props.metrics.roundNumber}`">
      <span class="round-divider__stat round-divider__stat--input" aria-label="输入 tokens">
        <span class="round-divider__stat-icon">↑</span>
        <span class="round-divider__stat-value">{{ formatTokens(props.metrics.inputTokens) }}</span>
      </span>
      <span class="round-divider__sep" aria-hidden="true" />
      <span class="round-divider__stat round-divider__stat--duration" aria-label="耗时">
        <span class="round-divider__stat-icon">◷</span>
        <span class="round-divider__stat-value">{{ formatDuration(props.metrics.durationMs) }}</span>
      </span>
      <span class="round-divider__sep" aria-hidden="true" />
      <span class="round-divider__stat round-divider__stat--output" aria-label="输出 tokens">
        <span class="round-divider__stat-icon">↓</span>
        <span class="round-divider__stat-value">{{ formatTokens(props.metrics.outputTokens) }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/*
 * RoundDivider — sanctuary migration (Phase 2.5, 2026-04-20).
 * Scoped style only; template + script untouched.
 *
 * Current round: sage inner-ring glow on the center badge (not indigo).
 * Polish badge: amber subtitle (not Tailwind amber-400/0.5).
 * Satellite buttons: sage hover for thinking/raw, amber hover for
 * commands (signals "state change" semantic with the warm beacon).
 * Metrics pill: sage/amber/sage for ↑ input / ◷ duration / ↓ output —
 * replaces the violet/cyan/yellow Tailwind trio.
 */
.round-divider {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: var(--space-xl) 0 var(--space-lg);
  gap: var(--space-xs);
}

.round-divider__top {
  display: flex;
  align-items: center;
  width: 100%;
  gap: var(--space-sm);
}

/* Horizontal rules — soft gradient fade, warm-tinted */
.round-divider__line {
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--color-border), transparent);
  opacity: 0.6;
}

.round-divider__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.round-divider__actions:empty {
  display: none;
}

/* Satellite icon buttons (🌐 thinking / ☰ commands / ⮂ raw) */
.round-divider__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  color: var(--color-text-umber);
  cursor: pointer;
  transition:
    color var(--duration-normal) var(--ease-out),
    border-color var(--duration-normal) var(--ease-out),
    background var(--duration-normal) var(--ease-out);
}

.round-divider__icon-btn:hover {
  color: var(--color-sage-400);
  border-color: color-mix(in oklch, var(--color-sage-400) 35%, var(--color-border));
  background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
}

.round-divider__icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 25%, transparent);
}

/* Engram button: teal-ish hover (knowledge-graph semantic, distinct from sage/amber) */
.round-divider__icon-btn--engram:hover {
  color: #5ba8a0;
  border-color: color-mix(in oklch, #5ba8a0 35%, var(--color-border));
  background: color-mix(in oklch, #5ba8a0 6%, transparent);
}

/*
 * Commands button gets AMBER hover — "state change" is a warm beacon
 * per the sanctuary brief (sage = everyday state, amber = confirmation
 * / narrative emphasis / "something settled"). Replaces the old green.
 */
.round-divider__icon-btn--commands:hover {
  color: var(--color-amber-400);
  border-color: color-mix(in oklch, var(--color-amber-400) 35%, var(--color-border));
  background: color-mix(in oklch, var(--color-amber-400) 6%, transparent);
}

/*
 * Center badge — serif pill, warm translucent bg (not cold black).
 * The subtle backdrop-filter helps it sit against either sidebar canvas
 * or narrative prose without a hard edge.
 */
.round-divider__badge {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding: var(--space-xs) var(--space-lg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: color-mix(in oklch, var(--color-surface-elevated) 60%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: var(--color-text-umber);
  font-family: var(--font-serif-cjk);
  font-size: var(--font-size-xs);
  font-weight: 500;
  letter-spacing: 0.2em;
  line-height: 1.2;
  white-space: nowrap;
}

/* Clickable variant — toggles 优化/原文 when polish applied */
.round-divider__badge--clickable {
  cursor: pointer;
  border-style: dashed;
  transition: border-color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
  font: inherit;
  font-family: var(--font-serif-cjk);
}
.round-divider__badge--clickable:hover {
  border-color: var(--color-amber-400);
  background: var(--color-amber-muted);
}
.round-divider__badge--clickable:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-amber-400) 25%, transparent);
}

.round-divider__badge-sub {
  margin-top: 2px;
  font-family: var(--font-sans);
  font-size: 0.6rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-amber-400);
  opacity: 0.72;
}

/* Current round: sage inner ring + faint glow */
.round-divider--current .round-divider__badge {
  border-color: color-mix(in oklch, var(--color-sage-400) 40%, var(--color-border));
  color: var(--color-text);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 15%, transparent),
    0 0 14px color-mix(in oklch, var(--color-sage-400) 22%, transparent);
}

/* Token / duration pill below the badge — warm, translucent */
.round-divider__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 3px var(--space-md);
  border-radius: var(--radius-full);
  background: color-mix(in oklch, var(--color-surface-elevated) 45%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid var(--color-border-subtle);
  font-family: var(--font-mono);
  font-size: 10px;
  opacity: 0.72;
  transition: opacity var(--duration-normal) var(--ease-out);
}

.round-divider__pill:hover {
  opacity: 1;
}

.round-divider__stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/*
 * Metric colors stay on the sage/amber axis — no cold violet or cyan.
 * Input tokens = sage-300 (lighter, "knowledge in"),
 * Duration     = amber-400 (warm timer),
 * Output       = sage-500 (darker, "story flowing out").
 */
.round-divider__stat--input    { color: var(--color-sage-300); }
.round-divider__stat--duration { color: var(--color-amber-400); }
.round-divider__stat--output   { color: var(--color-sage-500); }

.round-divider__stat-icon {
  font-size: 11px;
  line-height: 1;
  opacity: 0.82;
}

.round-divider__stat-value {
  font-weight: 600;
}

/* Thin vertical separator between stat segments — warm umber */
.round-divider__sep {
  width: 1px;
  height: 10px;
  background: color-mix(in oklch, var(--color-text-umber) 30%, transparent);
}

/* Mobile: shrink the pill slightly */
@media (max-width: 640px) {
  .round-divider__pill {
    font-size: 9px;
    gap: var(--space-xs);
    padding: 2px var(--space-sm);
  }
}
</style>
