import { chromium, type FullConfig } from '@playwright/test';

/**
 * Route warmup — visits each top-level route once so Vite compiles/caches the lazy
 * route chunks BEFORE the parallel tests run. Without this, the first test to hit a
 * cold route pays the full dev-server compile cost, which under fullyParallel can push
 * a seeded-game navigation past the assertion timeout (a flaky-under-load failure).
 * Best-effort: a warmup miss never blocks the suite.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const path of ['/', '/creation', '/management', '/game']) {
    try {
      await page.goto(baseURL + path, { waitUntil: 'networkidle', timeout: 60_000 });
    } catch {
      /* best-effort warmup — ignore a miss */
    }
  }
  await browser.close();
}

export default globalSetup;
