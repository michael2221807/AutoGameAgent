/**
 * CreationView page object — the character-creation wizard.
 * Locators + actions only; the step-walking order lives in the spec (deterministic).
 * Name field testid is tianming-pack-specific (角色.基础信息.姓名), matching the seed.
 */
import type { Page, Locator } from '@playwright/test';

export class CreationPage {
  constructor(private readonly page: Page) {}

  get progressBar(): Locator { return this.page.locator('.progress-bar'); }
  get nextButton(): Locator { return this.page.getByTestId('creation-next'); }
  get startButton(): Locator { return this.page.getByTestId('creation-start'); }

  /** Select the first preset card on a select-one step. */
  async selectFirstPreset(): Promise<void> { await this.page.locator('.preset-card').first().click(); }

  async next(): Promise<void> { await this.nextButton.click(); }

  /** Evenly distribute attribute points — one click fills the whole budget. */
  async balanceAttributes(): Promise<void> { await this.page.getByTestId('creation-attr-balance').click(); }

  /** Fill the tianming character-name field (the only required identity field). */
  async fillName(name: string): Promise<void> {
    await this.page.getByTestId('creation-field-角色.基础信息.姓名').fill(name);
  }

  /** Toggle the enhanced-opening switch (default ON → one click turns it OFF). */
  async toggleEnhancedOpening(): Promise<void> { await this.page.getByTestId('creation-enhanced-toggle').click(); }

  async start(): Promise<void> { await this.startButton.click(); }
}
