/**
 * Uncaught page-error collector (extracted from smoke.spec.ts).
 * Register on a page, then assert the returned array is empty after the flow.
 */
import type { Page } from '@playwright/test';

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}
