<script setup lang="ts">
// App doc: docs/user-guide/pages/game-card-guide.md
/**
 * CardWritingGuidePanel — 写卡攻略页（Story 9 / §4.1.1）
 *
 * 应用内分步创作指南。每个操作步骤带一个「去做 →」跳转按钮，直接跳到既有的
 * 对应工具面板（社交/地图/剧情/图像/关系图谱/存档导出）——**不重建任何编辑器**，
 * 只做导航中枢（PM Q1=A）。
 *
 * 顶部常驻一句模式说明（OD2=a）：写卡模式下解释"游玩控件已隐藏"，避免用户困惑；
 * 游玩模式下提示可切到写卡模式。面板内同时提供 进入/切回 模式按钮，与顶栏开关共用
 * useSessionMode（不重复实现切换逻辑）。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';
import { useSessionMode } from '@/ui/composables/useSessionMode';
import SessionModeBadge from '@/ui/components/shared/SessionModeBadge.vue';

const { t } = useI18n();
const router = useRouter();
const { isWorldBuilding, isPersisting, setMode } = useSessionMode();

/** 游玩 vs 写卡 对比说明 (P-B: 给足引导，让用户一眼看懂区别) */
const compareRows = computed(() => [
  { label: t('cardGuide.compare.row1.label'), play: t('cardGuide.compare.row1.play'), wb: t('cardGuide.compare.row1.wb') },
  { label: t('cardGuide.compare.row2.label'), play: t('cardGuide.compare.row2.play'), wb: t('cardGuide.compare.row2.wb') },
  { label: t('cardGuide.compare.row3.label'), play: t('cardGuide.compare.row3.play'), wb: t('cardGuide.compare.row3.wb') },
  { label: t('cardGuide.compare.row4.label'), play: t('cardGuide.compare.row4.play'), wb: t('cardGuide.compare.row4.wb') },
]);

interface GuideStep {
  n: number;
  title: string;
  body: string;
  bullets?: string[];
  cta?: { label: string; to: RouteLocationRaw };
  warn?: boolean;
}

const steps = computed<GuideStep[]>(() => [
  { n: 1, title: t('cardGuide.step1.title'), body: t('cardGuide.step1.body') },
  {
    n: 2,
    title: t('cardGuide.step2.title'),
    body: t('cardGuide.step2.body'),
    bullets: [
      t('cardGuide.step2.bullet1'),
      t('cardGuide.step2.bullet2'),
      t('cardGuide.step2.bullet3'),
      t('cardGuide.step2.bullet4'),
      t('cardGuide.step2.bullet5'),
    ],
  },
  { n: 3, title: t('cardGuide.step3.title'), body: t('cardGuide.step3.body'), cta: { label: t('cardGuide.step3.cta'), to: '/game/relationships' } },
  { n: 4, title: t('cardGuide.step4.title'), body: t('cardGuide.step4.body'), cta: { label: t('cardGuide.step4.cta'), to: '/game/map' } },
  { n: 5, title: t('cardGuide.step5.title'), body: t('cardGuide.step5.body'), cta: { label: t('cardGuide.step5.cta'), to: '/game/plot' } },
  { n: 6, title: t('cardGuide.step6.title'), body: t('cardGuide.step6.body'), cta: { label: t('cardGuide.step6.cta'), to: '/game/image' } },
  {
    n: 7,
    title: t('cardGuide.step7.title'),
    body: t('cardGuide.step7.body'),
    warn: true,
    bullets: [
      t('cardGuide.step7.bullet1'),
      t('cardGuide.step7.bullet2'),
      t('cardGuide.step7.bullet3'),
      t('cardGuide.step7.bullet4'),
    ],
    cta: { label: t('cardGuide.step7.cta'), to: '/game/relationship-graph' },
  },
  { n: 8, title: t('cardGuide.step8.title'), body: t('cardGuide.step8.body'), cta: { label: t('cardGuide.step8.cta'), to: { path: '/game/save', query: { action: 'export' } } } },
]);

const advancedTips = computed<string[]>(() => [
  t('cardGuide.advanced.saveToCard'),
  t('cardGuide.advanced.aiCommands'),
  t('cardGuide.advanced.testing'),
]);

function goTo(to: RouteLocationRaw): void {
  router.push(to).catch(() => { /* duplicate / guarded nav — ignore */ });
}

async function handleModeButton(): Promise<void> {
  try {
    await setMode(isWorldBuilding.value ? 'play' : 'worldBuilding');
  } catch {
    /* persistence failure toast already emitted by useSessionMode */
  }
}
</script>

<template>
  <div class="card-guide" :aria-label="t('cardGuide.ariaPanel')">
    <div class="card-guide__inner">
      <header class="card-guide__header">
        <h1 class="card-guide__title">{{ t('cardGuide.title') }}</h1>

        <!--
          Mode panel — the card-writing guide is the "home" of writing mode.
          The SAME SessionModeBadge the top bar shows is rendered here, so the
          persistent indicator and the guide read as one system (P-A 联动). The
          compare table teaches the play-vs-writing difference (P-B 给足引导).
        -->
        <div class="mode-panel" :class="{ 'mode-panel--active': isWorldBuilding }">
          <div class="mode-panel__head">
            <SessionModeBadge :mode="isWorldBuilding ? 'worldBuilding' : 'play'" size="md" />
            <button class="mode-panel__btn" type="button" :aria-pressed="isWorldBuilding" :disabled="isPersisting" @click="handleModeButton">
              {{ isWorldBuilding ? t('cardGuide.backToPlay') : t('cardGuide.enterWorldBuilding') }}
            </button>
          </div>
          <p class="mode-panel__hint">{{ isWorldBuilding ? t('cardGuide.modeHint') : t('cardGuide.enterHint') }}</p>
          <p class="mode-panel__link">{{ t('cardGuide.compare.howToSwitch') }}</p>

          <table class="mode-compare">
            <thead>
              <tr>
                <td class="mode-compare__corner"></td>
                <th scope="col">{{ t('cardGuide.compare.colPlay') }}</th>
                <th scope="col" :class="{ 'mode-compare__wb-col': isWorldBuilding }">{{ t('cardGuide.compare.colWB') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in compareRows" :key="row.label">
                <th class="mode-compare__rowlabel" scope="row">{{ row.label }}</th>
                <td>{{ row.play }}</td>
                <td :class="{ 'mode-compare__wb-col': isWorldBuilding }">{{ row.wb }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </header>

      <!-- Section 1: what is a game card -->
      <details class="guide-section" open>
        <summary class="guide-section__summary">{{ t('cardGuide.section.what.title') }}</summary>
        <p class="guide-section__body">{{ t('cardGuide.section.what.body') }}</p>
      </details>

      <!-- Section 2: recommended flow (the 8 steps) -->
      <details class="guide-section" open>
        <summary class="guide-section__summary">{{ t('cardGuide.section.flow.title') }}</summary>
        <ol class="step-list">
          <li v-for="step in steps" :key="step.n" class="step-card" :class="{ 'step-card--warn': step.warn }">
            <div class="step-card__badge" aria-hidden="true">{{ step.n }}</div>
            <div class="step-card__main">
              <div class="step-card__kicker">{{ t('cardGuide.stepLabel', { n: step.n }) }}</div>
              <h3 class="step-card__title">{{ step.title }}</h3>
              <p class="step-card__body">{{ step.body }}</p>
              <ul v-if="step.bullets" class="step-card__bullets">
                <li v-for="b in step.bullets" :key="b">{{ b }}</li>
              </ul>
              <button
                v-if="step.cta"
                class="step-card__cta"
                type="button"
                @click="goTo(step.cta.to)"
              >
                {{ step.cta.label }}
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                  <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </li>
        </ol>
      </details>

      <!-- Section 3: advanced tips -->
      <details class="guide-section">
        <summary class="guide-section__summary">{{ t('cardGuide.section.advanced.title') }}</summary>
        <ul class="tip-list">
          <li v-for="tip in advancedTips" :key="tip" class="tip-item">{{ tip }}</li>
        </ul>
      </details>
    </div>
  </div>
</template>

<style scoped>
/*
 * Card-writing guide — sanctuary aesthetic: warm, breathable, serif headings,
 * sage beacons, amber only for the mandatory-step warning. Follows the
 * sidebar-reserve dynamic-padding pattern so content clears the floating
 * sidebars (project_sidebar_reserve_pattern).
 */
.card-guide {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 32px var(--sidebar-right-reserve, 40px) 64px var(--sidebar-left-reserve, 40px);
  color: var(--color-text);
  transition: padding var(--duration-normal, 0.24s) var(--ease-out, ease);
}

.card-guide__inner {
  max-width: 760px;
  margin: 0 auto;
}

.card-guide__header {
  margin-bottom: 28px;
}

.card-guide__title {
  margin: 0 0 16px;
  font-family: var(--font-serif-cjk);
  font-size: 1.5rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-text);
}

/* ── Mode panel (writing mode's home: status badge + enter/exit + explainer) ── */
.mode-panel {
  padding: 16px;
  border-radius: 14px;
  background: var(--color-surface-elevated);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 8%, transparent);
}
.mode-panel--active {
  background: color-mix(in oklch, var(--color-sage-400) 8%, var(--color-surface-elevated));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-sage-400) 28%, transparent);
}
.mode-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.mode-panel__btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--color-bg);
  background: var(--color-sage-400);
  cursor: pointer;
  transition: background var(--duration-normal, 0.24s) var(--ease-out, ease);
}
@media (hover: hover) {
  .mode-panel__btn:hover:not(:disabled) { background: var(--color-sage-300); }
}
.mode-panel__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mode-panel__btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}
.mode-panel__hint {
  margin: 12px 0 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
}
.mode-panel__link {
  margin: 6px 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

/* ── 游玩 vs 写卡 compare table (teaches the difference) ── */
.mode-compare {
  width: 100%;
  margin-top: 14px;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.mode-compare th,
.mode-compare td {
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  line-height: 1.5;
  color: var(--color-text-secondary);
  border-top: 1px solid var(--color-border-subtle);
  /* keep content within the panel (outer .card-guide clips overflow-x) on narrow phones */
  overflow-wrap: break-word;
}
.mode-compare thead th {
  border-top: none;
  font-weight: 600;
  color: var(--color-text);
}
.mode-compare__corner { border-top: none; }
.mode-compare__rowlabel {
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  width: 1%;
}
.mode-compare__wb-col { color: var(--color-sage-300); }
@media (max-width: 520px) {
  .mode-compare { font-size: 0.76rem; }
  .mode-compare th,
  .mode-compare td { padding: 6px 6px; }
  /* let the row label wrap too so the table never exceeds the clipped panel */
  .mode-compare__rowlabel { white-space: normal; }
}

/* ── Collapsible sections ── */
.guide-section {
  margin-bottom: 18px;
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 6%, transparent);
  overflow: hidden;
}
.guide-section__summary {
  list-style: none;
  cursor: pointer;
  padding: 16px 20px;
  font-family: var(--font-serif-cjk);
  font-size: 1.08rem;
  font-weight: 500;
  color: var(--color-text);
  user-select: none;
  position: relative;
  transition: color var(--duration-normal, 0.24s) var(--ease-out, ease);
}
.guide-section__summary::-webkit-details-marker { display: none; }
.guide-section__summary::after {
  content: '';
  position: absolute;
  right: 20px;
  top: 50%;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--color-text-muted);
  border-bottom: 2px solid var(--color-text-muted);
  transform: translateY(-65%) rotate(45deg);
  transition: transform var(--duration-normal, 0.24s) var(--ease-out, ease);
}
.guide-section[open] .guide-section__summary::after {
  transform: translateY(-35%) rotate(225deg);
}
@media (hover: hover) {
  .guide-section__summary:hover { color: var(--color-sage-300); }
}
.guide-section__body {
  margin: 0;
  padding: 0 20px 20px;
  font-size: 0.92rem;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

/* ── Step cards ── */
.step-list {
  list-style: none;
  margin: 0;
  padding: 4px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.step-card {
  display: flex;
  gap: 14px;
  padding: 16px;
  border-radius: 12px;
  background: var(--color-surface-elevated);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-text) 6%, transparent);
}
.step-card--warn {
  background: color-mix(in oklch, var(--color-amber-400) 8%, var(--color-surface-elevated));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-amber-400) 30%, transparent);
}
.step-card__badge {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-family: var(--font-serif-cjk);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 14%, transparent);
}
.step-card--warn .step-card__badge {
  color: var(--color-amber-400);
  background: color-mix(in oklch, var(--color-amber-400) 16%, transparent);
}
.step-card__main { flex: 1; min-width: 0; }
.step-card__kicker {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 2px;
}
.step-card__title {
  margin: 0 0 6px;
  font-family: var(--font-serif-cjk);
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text);
}
.step-card__body {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
.step-card__bullets {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.step-card__bullets li {
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.step-card__cta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 12px;
  padding: 7px 13px;
  border: none;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: var(--font-sans);
  color: var(--color-sage-400);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  cursor: pointer;
  transition: background var(--duration-normal, 0.24s) var(--ease-out, ease),
              color var(--duration-normal, 0.24s) var(--ease-out, ease);
}
@media (hover: hover) {
  .step-card__cta:hover {
    color: var(--color-sage-300);
    background: color-mix(in oklch, var(--color-sage-400) 16%, transparent);
  }
}
.step-card__cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-sage-400) 30%, transparent);
}
.step-card__cta svg { transition: transform var(--duration-normal, 0.24s) var(--ease-out, ease); }
@media (hover: hover) {
  .step-card__cta:hover svg { transform: translateX(2px); }
}

/* ── Advanced tips ── */
.tip-list {
  list-style: none;
  margin: 0;
  padding: 4px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tip-item {
  position: relative;
  padding-left: 18px;
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
.tip-item::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0.66em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-sage-400);
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .card-guide,
  .guide-section__summary::after,
  .step-card__cta,
  .step-card__cta svg,
  .mode-panel__btn { transition: none; }
}
</style>
