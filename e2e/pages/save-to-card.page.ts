/**
 * SaveToCardFlow page object — the 转卡 wizard's edge-classification panel.
 * The wizard reuses CardExportFlow for title/export, so a spec composes this with
 * the CardExportPage object. Locators only; assertions stay in the spec.
 */
import type { Page, Locator } from '@playwright/test';

export class SaveToCardPage {
  constructor(private readonly page: Page) {}

  /** Manual "全选" — select all edges WITHOUT running the AI classification. */
  get selectAllEdges(): Locator { return this.page.getByTestId('edge-select-all'); }
}
