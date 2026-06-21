/**
 * HomeView page object — locators + actions only (assertions stay in specs).
 * Methods are added as specs consume them (the seeded-game resume path is handled
 * by navigation.enterSeededGame, so it is intentionally not duplicated here yet).
 */
import type { Page, Locator } from '@playwright/test';

export class HomePage {
  constructor(private readonly page: Page) {}

  get importCardButton(): Locator { return this.page.getByRole('button', { name: '导入游戏卡' }); }
  get newCharacterButton(): Locator { return this.page.getByRole('button', { name: '新建角色' }); }

  /** Open the game-card import wizard. */
  async importCard(): Promise<void> { await this.importCardButton.click(); }

  /** Enter the creation wizard via in-SPA nav (the pack is already loaded → guard passes). */
  async newCharacter(): Promise<void> { await this.newCharacterButton.click(); }
}
