/**
 * Plot Direction — multi-arc navigation (MOCK DATA, ZERO real API).
 *
 * Regression for: "跑完第一条弧线后无法新增/查看第二条弧线". Root cause was that
 * PlotPanel's `displayArc` only ever returned the active arc or arcs[0], so a 2nd
 * arc created after the first completed was invisible and unreachable — and the AI
 * decompose results landed on an arc the panel never showed.
 *
 * This spec seeds a COMPLETED first arc (no active arc), creates a second arc with
 * NO synopsis (so the AI decompose path is skipped — keeps the run offline), and
 * asserts the panel switches to the new arc + the arc switcher lets you browse back.
 *
 * Runs on desktop-1920 only. Run: npx playwright test plot-multi-arc
 */
import { test, expect, seedSave, enterSeededGame } from './fixtures/base';
import { makeSeedTree } from './fixtures/seed-tree';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920', 'plot multi-arc spec runs on desktop-1920 only');
});

/** A state tree whose first plot arc is already completed (activeArcIndex = null). */
function treeWithCompletedArc(): Record<string, unknown> {
  return makeSeedTree({
    元数据: {
      剧情导向: {
        activeArcIndex: null,
        arcs: [
          {
            id: 'arc_seed_done',
            title: '第一弧线',
            synopsis: '一条已经跑完的弧线',
            status: 'completed',
            gauges: [],
            nodes: [
              {
                id: 'node_seed_done',
                arcId: 'arc_seed_done',
                title: '收官节点',
                narrativeGoal: '',
                directive: '',
                completionHint: '',
                completionConditions: [],
                completionMode: 'hint_only',
                activationConditions: [],
                importance: 'critical',
                opportunityTiers: [],
                status: 'completed',
                consecutiveReachedCount: 0,
                completedAtRound: 2,
              },
            ],
          },
        ],
      },
    },
  });
}

test.describe('Plot Direction — multi-arc navigation (offline)', () => {
  test('add a 2nd arc after the 1st completes: panel switches + switcher browses both',
    { tag: ['@regression', '@plot'] },
    async ({ page, gameShell }) => {
      await seedSave(page, { tree: treeWithCompletedArc() });
      await enterSeededGame(page);
      await gameShell.goTab('plot');

      // The seeded completed arc is the only one → it is displayed, no switcher yet.
      await expect(page.locator('.arc-title')).toContainText('第一弧线');
      await expect(page.locator('.arc-switcher')).toHaveCount(0);

      // ── Create a 2nd arc (no synopsis → AI decompose path is skipped, stays offline).
      await page.locator('.panel-header .header-btn').click();
      await page.getByPlaceholder('如：高考冲刺篇').fill('第二弧线');
      await page.getByRole('button', { name: '创建' }).click();

      // FIX: the panel now switches to the freshly created arc (previously it stayed
      // stuck on arcs[0] and the new arc was invisible).
      await expect(page.locator('.arc-title')).toContainText('第二弧线');

      // The switcher now lists BOTH arcs, with the new one selected.
      const switcher = page.locator('.arc-switcher');
      await expect(switcher).toBeVisible();
      await expect(switcher.locator('.arc-chip')).toHaveCount(2);
      await expect(switcher.locator('.arc-chip--selected .arc-chip__title')).toHaveText('第二弧线');

      // ── Browse back to the first arc via the switcher.
      await switcher.locator('.arc-chip', { hasText: '第一弧线' }).click();
      await expect(page.locator('.arc-title')).toContainText('第一弧线');
      await expect(switcher.locator('.arc-chip--selected .arc-chip__title')).toHaveText('第一弧线');
      // apiGuard auto-fixture asserts zero egress in teardown.
    });
});
