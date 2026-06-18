/**
 * Game Card Epic — integration test (MOCK DATA ONLY, ZERO real API).
 *
 * Covers the epic's core product line without spending a single API token:
 *   1. Story 9 写卡模式: toggle hides the composer, opens the guide, and the
 *      sessionType survives a reload + re-entry (SC-7).
 *   2. Story 5+6 导出→导入 roundtrip: export the seeded save to a real .aga-card
 *      (pure serialization, zero AI), then import THAT file back (world data
 *      survives; the opening generation degrades gracefully with no API).
 *
 * Why this is AI-free:
 *   - No API is ever configured, so AIService has zero usable configs.
 *   - Export reads existing state + Engram → no generation.
 *   - Import injects the card world deterministically; the opening step throws
 *     "no config" BEFORE any fetch → openingDegraded=true, import still succeeds.
 *   - Embedding falls back to pseudoEmbed (FNV-1a, no network).
 * A hard network guard records any hit to a real LLM/embedding/image endpoint and
 * asserts the list is empty at the end of every test.
 *
 * The save is seeded directly into IndexedDB (DB `aga-saves`, store `data`) to skip
 * the heavy Story-0 opening pipeline. The seed tree is shaped so the export coverage
 * gate (D18) passes: every NPC/location has a matching Engram entity by name.
 *
 * Runs on desktop-1920 only (seed + modal flows are desktop-oriented).
 * Run: npx playwright test game-card-epic
 */
import { test, expect, type Page } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920', 'integration spec runs on desktop-1920 only');
});

// ─── Zero-real-API network guard ──────────────────────────────────────────────
// Records + aborts any request to a real LLM / embedding / image-gen endpoint.
// With no API configured nothing should be requested → `hits` must stay empty.
const BLOCKED_PATTERNS: string[] = [
  '**/v1/chat/completions',      // OpenAI / DeepSeek / custom LLM
  '**/v1/messages',              // Claude
  '**/v1beta/**',                // Gemini generateContent / streamGenerateContent
  '**/v1/embeddings',            // embeddings (OpenAI-shape)
  '**/v1/embed',                 // embeddings (Cohere-shape)
  '**/v1/rerank',                // rerank
  '**/v1/images/generations',    // OpenAI images
  '**/generate-image',           // NovelAI
  '**/sdapi/v1/**',              // SD WebUI
  'https://image.novelai.net/**',
  'https://api.openai.com/**',
  'https://orchestration.civitai.com/**',
  'http://localhost:8188/**', 'http://127.0.0.1:8188/**',   // ComfyUI
  'http://localhost:7860/**', 'http://127.0.0.1:7860/**',   // SD WebUI
];

async function installApiGuard(page: Page): Promise<string[]> {
  const hits: string[] = [];
  for (const pattern of BLOCKED_PATTERNS) {
    await page.route(pattern, (route) => {
      hits.push(route.request().url());
      return route.abort();
    });
  }
  return hits;
}

// ─── Seed fixture ─────────────────────────────────────────────────────────────
const PROFILE_ID = 'profile_e2e';
const SLOT_ID = 'auto';
const LOCATION_NAME = '青云城';
const NPC_NAME = '林婉儿';
const PROTAGONIST = '叶尘';

/** A minimal but UI-renderable + export-valid state tree (coverage gate passes). */
function makeSeedTree(): Record<string, unknown> {
  return {
    元数据: {
      游戏包名称: '天命',
      回合序号: 3,
      叙事历史: [
        { role: 'user', content: '我环顾四周。' },
        { role: 'assistant', content: '青云城的喧嚣扑面而来……' },
      ],
      推理历史: [],
      剧情规划: '',
      女主规划: { stageProgression: [], heroineEntries: [], interactionEvents: [], scenePlans: [] },
      当前行动选项: [],
    },
    角色: {
      基础信息: { 姓名: PROTAGONIST, 当前位置: LOCATION_NAME, 年龄: 20, 性别: '男', 特质: { 名称: '坚毅', 描述: '' } },
      身份: { 出身: { 名称: '寒门', 描述: '' }, 天赋档次: '甲', 天赋: [{ 名称: '剑心', 描述: '' }], 种族: '人族', 先天六维: { 体质: 6, 直觉: 5, 悟性: 7, 气运: 5, 魅力: 5, 心性: 6 } },
      属性: { 体质: 8, 直觉: 6, 悟性: 9, 气运: 5, 魅力: 6, 心性: 7 },
      可变属性: { 地位: { 名称: '散修', 描述: '' }, 声望: 120, 体力: { 当前: 80, 上限: 100 }, 精力: { 当前: 70, 上限: 90 } },
      效果: [],
      背包: { 金钱: { 现金: 0, 铜: 50, 银: 2, 金: 0 }, 物品: {} },
      身体: {},
      图片档案: { 生图历史: [], 已选头像图片ID: '', 已选立绘图片ID: '', 最近生图结果: '' },
    },
    世界: {
      描述: '一个剑修横行的大陆。',
      天气: '晴',
      节日: { 名称: '平日', 描述: '', 效果: '' },
      环境: [],
      时间: { 年: 1, 月: 3, 日: 15, 小时: 10, 分钟: 30 },
      地点信息: [
        { 名称: LOCATION_NAME, 描述: '繁华的修真城市。', 连接: [], NPC: [NPC_NAME], 坐标: { x: 0, y: 0 }, 类型: '城市', 上级: '' },
      ],
      状态: { 心跳: { 配置: { enabled: false, period: 5 }, 上次心跳回合序号: 0, 历史: [], 上次执行时间: '' } },
    },
    社交: {
      关系: [
        { 名称: NPC_NAME, 类型: '友人', 好感度: 40, 位置: LOCATION_NAME, 描述: '青云宗的内门弟子。', 性别: '女', 年龄: 18, 记忆: [], 私聊历史: [] },
      ],
      事件: { 事件记录: [] },
    },
    记忆: { 短期: [], 中期: [], 长期: [], 隐式中期: [] },
    系统: {
      扩展: {
        engramMemory: {
          events: [],
          entities: [
            { name: NPC_NAME, type: 'npc', summary: '青云宗内门弟子。', attributes: {}, firstSeen: 1, lastSeen: 3, mentionCount: 2, is_embedded: false, source: 'opening' },
            { name: LOCATION_NAME, type: 'location', summary: '繁华修真城市。', attributes: {}, firstSeen: 1, lastSeen: 3, mentionCount: 2, is_embedded: false, source: 'opening' },
          ],
          relations: [],
          v2Edges: [
            { id: 'seed-edge-1', sourceEntity: PROTAGONIST, targetEntity: NPC_NAME, fact: `${PROTAGONIST}在${LOCATION_NAME}结识了${NPC_NAME}。`, episodes: [], is_embedded: false, createdAtRound: 1, lastSeenRound: 3, core: true, source: 'opening' },
          ],
          meta: { lastUpdated: 0, eventCount: 0, embeddedEventCount: 0, embeddedEntityCount: 0, schemaVersion: 5, v2PendingReview: null },
        },
        语义记忆: { triples: [], meta: { lastUpdated: 0, tripleCount: 0 } },
        image: { enabled: false, config: {}, sceneArchive: { 生图历史: [], 当前壁纸图片ID: '' }, tasks: [], persistentWallpaper: '' },
      },
      nsfwMode: false,
      nsfwGenderFilter: 'female',
      设置: { prompt: { perspective: '第二人称', wordCountRequirement: 650, storyStyle: 'general' }, cot: { enabled: false }, social: { presenceEnabled: false }, bodyPolish: false },
    },
  };
}

/** Boot the app once, clear IDB, write the seeded save + profile root, reload. */
async function seedSave(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ profileId, slotId, characterName, location, tree }) => {
    // Neutralize the app's auto-seeded default API config (api.openai.com, enabled).
    // A single DISABLED config means apiConfigs.length≥1 (no default is seeded) AND
    // getConfigForUsage() returns undefined → the import opening throws "no config"
    // (→ openingDegraded, non-fatal) and the embedder falls back to pseudoEmbed.
    // Net: the whole epic runs with ZERO outbound API attempts.
    localStorage.setItem('aga_api_management', JSON.stringify({
      apiConfigs: [{ id: 'e2e-noop', name: 'noop', apiCategory: 'llm', provider: 'openai', url: 'http://127.0.0.1:1', apiKey: '', model: 'noop', temperature: 0, maxTokens: 1, enabled: false }],
      apiAssignments: [],
    }));
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('aga-saves', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('data')) r.result.createObjectStore('data'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = (mode: IDBTransactionMode) => db.transaction('data', mode).objectStore('data');
    await new Promise<void>((res, rej) => { const req = tx('readwrite').clear(); req.onsuccess = () => res(); req.onerror = () => rej(req.error); });
    const put = (key: string, val: unknown) => new Promise<void>((res, rej) => {
      const t = db.transaction('data', 'readwrite');
      t.objectStore('data').put(val, key);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
    const now = new Date().toISOString();
    const slotMeta = { slotId, slotName: '存档1', lastSavedAt: now, characterName, currentLocation: location, packId: 'tianming', packVersion: '1.0.0', sessionType: 'play' };
    const profile = { profileId, createdAt: now, packId: 'tianming', characterName, slots: { [slotId]: slotMeta }, activeSlotId: slotId };
    await put('storage_root', { activeProfile: { profileId, slotId }, profiles: { [profileId]: profile } });
    await put(`save_${profileId}_${slotId}`, tree);
  }, { profileId: PROFILE_ID, slotId: SLOT_ID, characterName: PROTAGONIST, location: LOCATION_NAME, tree: makeSeedTree() });
  await page.reload();
}

/** From HomeView, click 继续游戏 and land in a rendered game. */
async function enterSeededGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: '继续游戏' }).click();
  await page.waitForURL(/\/game(\/|$)/);
  // The mode toggle is present on every /game/* route once a slot is active.
  await expect(page.getByRole('button', { name: '切换游玩 / 写卡模式' })).toBeVisible({ timeout: 15_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
test.describe('Game Card Epic — integration (mock data, zero real API)', () => {
  test('Story 9 写卡模式: toggle auto-opens guide + in-panel notice + persists across reload', async ({ page }) => {
    const hits = await installApiGuard(page);
    await seedSave(page);
    await enterSeededGame(page);

    const toggle = page.getByRole('button', { name: '切换游玩 / 写卡模式' });
    await expect(toggle).toContainText('游玩模式');
    await expect(page.locator('textarea.message-input')).toBeVisible();   // play-mode composer

    // Toggle → writing mode auto-opens the card-writing guide (SESSION-1 fix:
    // entering worldBuilding surfaces the guide, here on a live transition).
    await toggle.click();
    await expect(toggle).toContainText('写卡模式');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/game\/card-guide$/);
    await expect(page.locator('.card-guide__title')).toHaveText('游戏卡创作指南');

    // Safety-net (JOURNEY-2): navigate back to the main panel while still in
    // writing mode → the composer is hidden and the in-panel notice replaces it.
    await page.locator('.sidebar a[href="/game"]').first().click();
    await page.waitForURL(/\/game$/);
    await expect(page.locator('textarea.message-input')).toHaveCount(0);
    await expect(page.locator('.wb-composer-notice')).toBeVisible();
    await page.locator('a.wb-composer-notice__btn').click();   // notice → guide
    await expect(page).toHaveURL(/\/game\/card-guide$/);

    // Persistence: sessionType is per-slot; re-enter the same save after a reload →
    // still writing mode, and the guide auto-opens again on resume (SESSION-1 immediate).
    await page.reload();
    await enterSeededGame(page);
    await expect(page.getByRole('button', { name: '切换游玩 / 写卡模式' })).toContainText('写卡模式');
    await expect(page).toHaveURL(/\/game\/card-guide$/);

    expect(hits, `unexpected real-API egress: ${hits.join(', ')}`).toEqual([]);
  });

  test('Story 5+6 导出→导入 roundtrip: zero AI, bundle valid, world survives', async ({ page }, testInfo) => {
    const hits = await installApiGuard(page);
    await seedSave(page);
    await enterSeededGame(page);

    // ── Export (Story 5) — navigate in-SPA to the Save panel, open the export modal.
    await page.locator('.sidebar a[href="/game/save"]').click();
    await page.waitForURL(/\/game\/save$/);
    await page.locator('.card-export-cta__btn').click();

    // Seed guarantees the D18 coverage gate passes → the form unlocks.
    await expect(page.locator('.cef-gate--pass')).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('给你的游戏卡起个名字…').fill('集成测试卡');

    const exportBtn = page.locator('.btn-modal--primary').filter({ hasText: '导出 .aga-card' });
    await expect(exportBtn).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportBtn.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^card-.+-\d{8}\.aga-card$/);

    // ── Validate the exported bundle (gzip envelope → JSON).
    const cardPath = testInfo.outputPath('roundtrip.aga-card');
    await download.saveAs(cardPath);
    const envelope = JSON.parse(gunzipSync(readFileSync(cardPath)).toString('utf-8'));
    expect(envelope.format).toBe('aga-card');
    expect(envelope.bundle.bundleType).toBe('card');
    expect(envelope.bundle.cardMeta.title).toBe('集成测试卡');
    expect(envelope.bundle.cardMeta.packId).toBe('tianming');
    // World preserved, gameplay history stripped, no secrets leaked.
    const bundleJson = JSON.stringify(envelope.bundle);
    expect(bundleJson).toContain(LOCATION_NAME);
    expect(bundleJson).toContain(NPC_NAME);
    expect(envelope.bundle.engram.entities.length).toBeGreaterThanOrEqual(2);
    expect(bundleJson).not.toMatch(/sk-[A-Z]/);              // no API-key markers
    expect(envelope.bundle.stateTree?.元数据?.叙事历史 ?? []).toEqual([]);  // play history stripped

    // ── Import (Story 6) — back to HomeView, import the file we just exported.
    await page.goto('/');
    await page.getByRole('button', { name: '导入游戏卡' }).click();
    await page.locator('input.cif-file').setInputFiles(cardPath);

    // Preview proves the world survived export→decode.
    await expect(page.getByRole('heading', { name: '这张卡里有什么' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cif-stage')).toContainText('1 处地点');
    await expect(page.locator('.cif-stage')).toContainText('1 位人物');

    // preview → protagonist → global → import (SFW + fixed protagonist: no NSFW gate).
    await page.locator('.btn-modal--primary').filter({ hasText: '继续' }).click();   // → protagonist
    await page.locator('.btn-modal--primary').filter({ hasText: '继续' }).click();   // → global
    await page.locator('.btn-modal--primary').filter({ hasText: '导入' }).click();   // doImport

    // Import succeeds even though the opening degrades (no API): success screen appears.
    await expect(page.getByRole('heading', { name: '导入完成' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '进入游戏' }).click();
    await page.waitForURL(/\/game(\/|$)/);

    expect(hits, `unexpected real-API egress: ${hits.join(', ')}`).toEqual([]);
  });
});
