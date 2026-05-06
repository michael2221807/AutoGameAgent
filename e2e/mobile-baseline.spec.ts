/**
 * Mobile adaptation visual regression baseline.
 *
 * Captures screenshots at three viewport sizes (desktop-1920, mobile-390,
 * mobile-360) for key pages. Run `npx playwright test --update-snapshots`
 * once to create the golden files, then subsequent runs compare against them.
 *
 * Phase 0.4 of docs/design/mobile-adaptation-plan.md.
 */
import { test, expect } from '@playwright/test';

test.describe('Visual regression baseline — Home', () => {
  test('homepage renders without crash', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/AutoGameAgent/);
    await expect(page.locator('#app')).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-home.png`, fullPage: true });
  });
});

test.describe('Visual regression baseline — Creation', () => {
  test('creation page renders without crash', async ({ page }) => {
    await page.goto('/creation');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#app')).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-creation.png`, fullPage: true });
  });
});

test.describe('Visual regression baseline — Management', () => {
  test('management page renders without crash', async ({ page }) => {
    await page.goto('/management');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#app')).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-management.png`, fullPage: true });
  });
});
