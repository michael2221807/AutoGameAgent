/**
 * 收藏楼层 (Bookmarked rounds) — critical-journey e2e.
 *
 * Zero real API (inherits the api-guard barrel). Seeds a save with two assistant
 * rounds so the 2nd round renders a RoundDivider (the 1st, opening, has none),
 * then exercises the full bookmark flow in the REAL app:
 *   star a round → count badge → open panel → row + rename + select →
 *   memory-panel section reflects the same bookmark.
 */
import { test, expect, seedSave, enterSeededGame } from './fixtures/base';
import { makeSeedTree } from './fixtures/seed-tree';

// Two full rounds of narrative so round 2 gets a divider with the ★ button.
const twoRoundTree = makeSeedTree({
  元数据: {
    回合序号: 2,
    叙事历史: [
      { role: 'user', content: '我环顾四周。' },
      { role: 'assistant', content: '青云城的喧嚣扑面而来，人流如织。', _metrics: { roundNumber: 1, durationMs: 0, inputTokens: 0, outputTokens: 0, startedAt: 0 } },
      { role: 'user', content: '我走向城中心的酒楼。' },
      { role: 'assistant', content: '你推开酒楼的木门，一股酒香扑面。掌柜抬头看你，眼神里藏着某种试探。', _metrics: { roundNumber: 2, durationMs: 0, inputTokens: 0, outputTokens: 0, startedAt: 0 } },
    ],
  },
});

test('收藏楼层: star a round, manage it in the panel, and see it in the memory tab', async ({ page }) => {
  await seedSave(page, { tree: twoRoundTree });
  await enterSeededGame(page);

  // ── 1. Star the (only) visible round divider ──
  const starBtn = page.getByTestId('round-bookmark-btn').first();
  await expect(starBtn).toBeVisible();
  await expect(starBtn).toHaveAttribute('aria-pressed', 'false');
  await starBtn.click();
  await expect(starBtn).toHaveAttribute('aria-pressed', 'true');

  // ── 2. The status-bar toggle now shows a count ──
  const toggle = page.getByTestId('bookmark-toggle');
  await expect(toggle).toContainText('1');

  // ── 3. Open the bookmark panel — one row present ──
  await toggle.click();
  await expect(page.getByTestId('bookmark-panel')).toBeVisible();
  const row = page.getByTestId('bookmark-row');
  await expect(row).toHaveCount(1);

  // ── 4. Rename the bookmark inline ──
  await row.locator('.bookmark-name').click();
  const nameInput = row.locator('.bookmark-name-input');
  await nameInput.fill('酒楼的试探');
  await nameInput.press('Enter');
  await expect(row.locator('.bookmark-name')).toHaveText('酒楼的试探');

  // ── 5. Select it → the "will inject next round" counter updates ──
  await row.locator('.bookmark-check').check();
  await expect(page.locator('.bookmark-selcount')).toContainText('1');

  // ── 6. The memory panel's 收藏楼层 section reflects the same bookmark ──
  // Navigate within the SPA (no reload — the bookmark lives in the in-memory
  // state tree, persisted to disk only on round completion). On mobile the panel
  // nav is behind the "更多面板" drawer; open it first when the link is off-screen.
  const memLink = page.locator('.sidebar a[href="/game/memory"]').first();
  // The mobile bottom bar exposes a "更多面板" drawer toggle; it does not exist on
  // desktop (persistent sidebar). Open the drawer first so the link is on-screen.
  const moreBtn = page.getByRole('button', { name: '更多面板' });
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
  }
  await memLink.click();
  await page.waitForURL(/\/game\/memory$/);
  const memSection = page.getByTestId('memory-bookmark-section');
  await expect(memSection).toBeVisible();
  await expect(memSection).toContainText('酒楼的试探');

  // ── 7. Jump from the memory section returns to the game and pins that round ──
  // Exercises the module-level useRoundJump path (requestRoundJump → router.push →
  // MainGamePanel.onActivated consumes + pins), the race-free replacement for the
  // old eventBus flow (code review 2026-07-18 #3).
  await memSection.getByRole('button', { name: '跳转' }).click();
  await page.waitForURL(/\/game$/);
  // Scope to the game message stream (the same text also lives in the cached
  // memory bookmark snippet, so an unscoped getByText is ambiguous).
  await expect(
    page.locator('.messages-container').getByText('你推开酒楼的木门', { exact: false }),
  ).toBeVisible();
});
