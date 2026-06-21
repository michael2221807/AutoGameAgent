/** CardImportFlow page object — the import wizard (preview → protagonist → global → import). */
import type { Page, Locator } from '@playwright/test';

export class CardImportPage {
  constructor(private readonly page: Page) {}

  /** Select the .aga-card file to import. */
  async pickFile(path: string): Promise<void> {
    await this.page.getByTestId('card-import-file').setInputFiles(path);
  }

  /** The "这张卡里有什么" preview heading. */
  previewHeading(): Locator { return this.page.getByRole('heading', { name: '这张卡里有什么' }); }

  /** The preview stage container (location / NPC counts). */
  get stage(): Locator { return this.page.locator('.cif-stage'); }

  /** Advance one wizard step (the primary "继续" button). */
  async next(): Promise<void> {
    await this.page.getByTestId('card-import-next').click();
  }

  /** Execute the import (the primary "导入" button). */
  async doImport(): Promise<void> {
    await this.page.getByTestId('card-import-submit').click();
  }

  /** The "导入完成" success heading. */
  doneHeading(): Locator { return this.page.getByRole('heading', { name: '导入完成' }); }

  /** Enter the freshly-imported game. */
  async enterGame(): Promise<void> { await this.page.getByTestId('card-import-enter').click(); }
}
