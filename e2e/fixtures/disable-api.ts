/**
 * The load-bearing anti-token switch (extracted from game-card-epic.spec.ts).
 *
 * The app auto-injects an ENABLED default OpenAI config ONLY when
 * `aga_api_management.apiConfigs` is empty. Seeding ONE disabled config:
 *   - keeps apiConfigs.length >= 1, so no enabled default is auto-injected, AND
 *   - makes every AIService.getConfigForUsage() return undefined, so LLM generate
 *     throws "no config" (a non-fatal degrade), Embedder falls back to pseudoEmbed,
 *     and Reranker falls back to fallbackSort — all zero-network, deterministic.
 *
 * Reusable independently of seeding a save (e.g. the MCP "verify" workflow).
 */
import type { Page } from '@playwright/test';

/** A single DISABLED noop config — present but never usable. */
export const DISABLED_API_MANAGEMENT = {
  apiConfigs: [{
    id: 'e2e-noop', name: 'noop', apiCategory: 'llm', provider: 'openai',
    url: 'http://127.0.0.1:1', apiKey: '', model: 'noop',
    temperature: 0, maxTokens: 1, enabled: false,
  }],
  apiAssignments: [],
};

/**
 * Registers an init script so the disabled config + zero-retry settings are present
 * BEFORE the app boots on every navigation (initial load and reloads alike).
 * Call before the first `page.goto`.
 */
export async function disableApi(page: Page): Promise<void> {
  await page.addInitScript((cfg) => {
    localStorage.setItem('aga_api_management', JSON.stringify(cfg));
    // Kill exponential-backoff jitter so any accidental generate() fails fast.
    localStorage.setItem('aga_ai_settings', JSON.stringify({ maxRetries: 0 }));
  }, DISABLED_API_MANAGEMENT);
}
