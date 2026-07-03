import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

// Overridable because "port 5173 is listening" does NOT mean "our dev server is
// up" — reuseExistingServer only probes the port, and unrelated software can
// squat on it (seen 2026-07-02: Oculus OVRServer_x64 on 5173 → every spec died
// with ERR_CONNECTION_RESET). Set AGA_E2E_PORT to sidestep such a squatter.
const PORT = Number(process.env.AGA_E2E_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  snapshotDir: './e2e/snapshots',
  // Each test gets its own BrowserContext → isolated IndexedDB (all specs seed the same
  // 'aga-saves' DB name but in separate partitions), so parallel execution is safe.
  fullyParallel: true,
  // Cap workers so the single Vite dev server isn't overwhelmed by cold-route compiles
  // (combined with the route-warmup globalSetup below).
  workers: isCI ? 2 : 4,
  // Warm the lazy route chunks once before the parallel tests hit them.
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Pin locale + timezone so zh-CN selectors and formatted time/dates are
    // machine-stable and intentional (the suite asserts on Chinese display text).
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // No service worker can serve requests invisibly to the apiGuard's route().
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    // Cheap in CI (only the retry), full trace locally for first-failure debugging.
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
  },
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'desktop-1920',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-360',
      use: {
        viewport: { width: 360, height: 667 },
        userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/100 Mobile Safari/537.36',
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // --strictPort: if the port is taken, fail loudly instead of letting Vite
    // auto-increment to a port nobody is watching.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    // Reuse a running dev server locally; always start a fresh one in CI.
    reuseExistingServer: !isCI,
    // Generous for a cold Vite + TS start on an underpowered CI runner.
    timeout: 60_000,
  },
});
