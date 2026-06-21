/**
 * Character creation — first-time wizard → enter game (ZERO real API).
 *
 * Walks the tianming 8-step creation wizard deterministically (no conditional logic):
 * select-one ×4 → skip optional talents → balance attributes → fill the name → turn OFF
 * enhanced opening (so finalize takes the low-load path) → start. With no API config the
 * opening generation degrades gracefully (try/caught → null) and the pipeline still routes
 * to /game. disableApi prevents any outbound attempt; the apiGuard asserts zero egress.
 *
 * Runs on desktop-1920 only.
 * Run: npx playwright test creation
 */
import { test, expect } from './fixtures/base';
import { disableApi } from './fixtures/disable-api';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920', 'creation spec runs on desktop-1920 only');
});

test.describe('Character creation — first-time wizard → game (offline)', () => {
  test('walk the tianming 8-step wizard and start the game (opening degrades, zero API)',
    { tag: ['@regression', '@creation', '@story-0'] },
    async ({ page, home, creation }) => {
      await disableApi(page);
      await page.goto('/');
      // Kill animations so the wizard's <Transition mode="out-in"> step-slide is instant —
      // otherwise a select click can land on a leaving step's card mid-transition.
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      // Enter creation by in-SPA nav (a direct goto('/creation') reloads and races the
      // async pack bootstrap → the router guard would redirect to home).
      await home.newCharacter();
      await expect(creation.progressBar).toBeVisible({ timeout: 15_000 });

      // Steps 0-3 — select-one (world / talentTier / origin / trait): pick the first option.
      await creation.selectFirstPreset(); await creation.next();
      await creation.selectFirstPreset(); await creation.next();
      await creation.selectFirstPreset(); await creation.next();
      await creation.selectFirstPreset(); await creation.next();

      // Step 4 — talents (select-many, optional): skip.
      await creation.next();

      // Step 5 — attributes: distribute evenly (one click fills the budget), then next.
      await creation.balanceAttributes(); await creation.next();

      // Step 6 — identity form: the name is the only required field.
      await creation.fillName('天命'); await creation.next();

      // Step 7 — confirm: turn OFF enhanced opening (low-load degraded path offline) → start.
      await creation.toggleEnhancedOpening();
      await creation.start();

      // The character-init pipeline degrades gracefully with no API and routes to /game.
      await page.waitForURL(/\/game(\/|$)/, { timeout: 30_000 });
      await expect(page.getByTestId('mode-toggle')).toBeVisible({ timeout: 15_000 });
      // apiGuard auto-fixture asserts zero egress in teardown.
    });
});
