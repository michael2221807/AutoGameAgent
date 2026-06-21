/** CardExportFlow page object — the export wizard (coverage gate → meta → export). */
import type { Page, Locator } from '@playwright/test';

export class CardExportPage {
  constructor(private readonly page: Page) {}

  /** Shown when the D18 coverage gate passes and the form unlocks. */
  get gatePass(): Locator { return this.page.locator('.cef-gate--pass'); }

  async fillTitle(title: string): Promise<void> {
    await this.page.getByTestId('card-export-title').fill(title);
  }

  /** The primary "导出 .aga-card" button. */
  get exportButton(): Locator {
    return this.page.getByTestId('card-export-submit');
  }
}
