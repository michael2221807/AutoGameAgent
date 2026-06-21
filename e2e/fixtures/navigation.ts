/**
 * In-SPA navigation helpers (extracted from game-card-epic.spec.ts).
 * These are ready-gates / actions only — assertions stay in the spec.
 */
import type { Page } from '@playwright/test';

/** From HomeView, click 继续游戏 and wait until the rendered game is ready. */
export async function enterSeededGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: '继续游戏' }).click();
  await page.waitForURL(/\/game(\/|$)/);
  // The mode toggle is present on every /game/* route once a slot is active —
  // the canonical "app rendered + slot active" ready-signal.
  await page.getByTestId('mode-toggle').waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Click a left-sidebar tab link and wait for its URL.
 * Pass '' for the main panel (/game), or a tab name like 'save' (/game/save).
 */
export async function goToGameTab(page: Page, tab: string): Promise<void> {
  const href = tab ? `/game/${tab}` : '/game';
  await page.locator(`.sidebar a[href="${href}"]`).first().click();
  await page.waitForURL(tab ? new RegExp(`/game/${tab}$`) : /\/game$/);
}
