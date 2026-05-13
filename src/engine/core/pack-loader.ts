/**
 * Game Pack 加载器 — 从 public/packs/{packId}/ 加载资源
 *
 * 加载流程：
 * 1. fetch manifest.json → 解析 GamePackManifest
 * 2. 根据 manifest 声明并行加载所有 JSON/Markdown 资源
 * 3. 组装为完整的 GamePack 对象
 * 4. (可选) 加载 locale-specific prompt 覆盖 + i18n JSON + 标签替换
 *
 * 所有资源通过 HTTP fetch 从 Vite dev server（或生产 static server）获取。
 * Game Pack 是纯数据（JSON + Markdown），不含可执行代码。
 *
 * 对应 STEP-02 §4、STEP-03 M1.7。
 */
import type { GamePack, GamePackManifest, PromptFlowConfig } from '../types';

export class GamePackLoader {
  /** 包的基础路径（相对于站点根目录） */
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? `${import.meta.env.BASE_URL}packs`.replace(/\/\//g, '/');
  }

  /** 加载指定 Game Pack — 返回完整的运行时 GamePack 对象 */
  async load(packId: string, locale?: string): Promise<GamePack> {
    const manifestUrl = `${this.basePath}/${packId}/manifest.json`;
    const manifest = await this.fetchJson<GamePackManifest>(manifestUrl);
    const packBase = `${this.basePath}/${packId}`;

    const [stateSchema, creationFlow, presets, prompts, promptFlows, rules, theme, displaySettings, engineFragments, transformerDefaults] =
      await Promise.all([
        this.fetchJson<Record<string, unknown>>(this.resolve(packBase, manifest.entrySchema)),
        this.fetchJson<GamePack['creationFlow']>(this.resolve(packBase, manifest.creationFlow)),
        this.loadPresets(packBase, manifest.presets),
        this.loadPrompts(packBase, manifest.prompts),
        this.loadPromptFlows(packBase, manifest.promptFlows),
        this.loadRules(packBase, manifest.rules),
        this.fetchJsonOptional<Record<string, unknown>>(this.resolve(packBase, 'ui/theme.json')),
        this.fetchJsonOptional<Record<string, unknown>>(this.resolve(packBase, 'ui/display-settings.json')),
        this.fetchJsonOptional<Record<string, string>>(this.resolve(packBase, 'prompts/engine-fragments.json')),
        this.fetchJsonOptional<Record<string, unknown>>(this.resolve(packBase, 'prompts/transformer-defaults.json')),
      ]);

    const pack: GamePack = {
      manifest,
      stateSchema,
      creationFlow,
      presets,
      prompts,
      promptFlows,
      rules,
      theme: theme ?? undefined,
      displaySettings: displaySettings ?? undefined,
      engineFragments: engineFragments ?? undefined,
      transformerDefaults: transformerDefaults ?? undefined,
    };

    if (locale) {
      await this.applyLocale(pack, packBase, locale);
    }

    return pack;
  }

  /**
   * Apply locale-specific overlays:
   * 1. Load i18n JSON → populate pack.i18n
   * 2. Overlay locale-specific prompt files (404 → keep default)
   * 3. Patch creation flow labels/placeholders from i18n data
   */
  private async applyLocale(pack: GamePack, packBase: string, locale: string): Promise<void> {
    const i18nData = await this.loadPackI18n(pack, packBase, locale);

    const promptDir = pack.manifest.promptLocales?.[locale];
    if (promptDir) {
      await this.overlayPrompts(pack, packBase, promptDir);
      const [localeFragments, localeTransformerDefaults] = await Promise.all([
        this.fetchJsonOptional<Record<string, string>>(
          this.resolve(packBase, `${promptDir}/engine-fragments.json`),
        ),
        this.fetchJsonOptional<Record<string, unknown>>(
          this.resolve(packBase, `${promptDir}/transformer-defaults.json`),
        ),
      ]);
      if (localeFragments) {
        pack.engineFragments = localeFragments;
      }
      if (localeTransformerDefaults) {
        pack.transformerDefaults = localeTransformerDefaults;
      }
    }

    if (i18nData) {
      this.patchPackLabels(pack, i18nData);
    }
  }

  /** Load pack-level i18n JSON and populate pack.i18n[locale] */
  private async loadPackI18n(
    pack: GamePack,
    packBase: string,
    locale: string,
  ): Promise<Record<string, string> | null> {
    const i18nPath = pack.manifest.i18nFiles?.[locale];
    if (!i18nPath) return null;

    const data = await this.fetchJsonOptional<Record<string, string>>(
      this.resolve(packBase, i18nPath),
    );
    if (data) {
      if (!pack.i18n) pack.i18n = {};
      pack.i18n[locale] = data;
    }
    return data;
  }

  /** Overlay prompts from a locale-specific directory (404 → keep default) */
  private async overlayPrompts(
    pack: GamePack,
    packBase: string,
    promptDir: string,
  ): Promise<void> {
    const ids = Object.keys(pack.prompts);
    const results = await Promise.all(
      ids.map(id =>
        this.fetchText(this.resolve(packBase, `${promptDir}/${id}.md`))
          .catch(() => null),
      ),
    );
    ids.forEach((id, i) => {
      if (results[i] !== null) {
        pack.prompts[id] = results[i]!;
      }
    });
  }

  /**
   * Patch creation flow labels, field labels, and placeholders from i18n data.
   * Only patches values that have corresponding keys in the i18n data.
   */
  private patchPackLabels(pack: GamePack, i18nData: Record<string, string>): void {
    if (!pack.creationFlow?.steps) return;

    for (const step of pack.creationFlow.steps) {
      const labelKey = `creation.step.${step.id}.label`;
      if (i18nData[labelKey]) step.label = i18nData[labelKey];

      if (step.customSchema?.fields) {
        this.patchFields(step.customSchema.fields, `creation.step.${step.id}`, i18nData);
      }

      if (step.fields) {
        this.patchFields(step.fields, `creation.step.${step.id}`, i18nData);
      }

      if (step.attributeDescriptions) {
        for (const attr of Object.keys(step.attributeDescriptions)) {
          const descKey = `creation.step.${step.id}.attrDesc.${attr}`;
          if (i18nData[descKey]) step.attributeDescriptions[attr] = i18nData[descKey];
        }
      }
    }
  }

  private patchFields(
    fields: Array<{ key?: string; label?: string; placeholder?: string }>,
    stepPrefix: string,
    i18nData: Record<string, string>,
  ): void {
    for (const field of fields) {
      const fieldKey = field.key ?? field.label ?? '';
      const labelKey = `${stepPrefix}.field.${fieldKey}.label`;
      if (i18nData[labelKey]) field.label = i18nData[labelKey];
      const placeholderKey = `${stepPrefix}.field.${fieldKey}.placeholder`;
      if (field.placeholder && i18nData[placeholderKey]) field.placeholder = i18nData[placeholderKey];
    }
  }

  /** 加载所有预设数据文件 — key 与 manifest.presets 的 key 一一对应 */
  private async loadPresets(
    packBase: string,
    presetPaths: Record<string, string>,
  ): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    const entries = Object.entries(presetPaths);
    const loaded = await Promise.all(
      entries.map(([, path]) => this.fetchJson<unknown[]>(this.resolve(packBase, path))),
    );
    entries.forEach(([key], i) => { result[key] = loaded[i]; });
    return result;
  }

  /**
   * 加载所有 prompt Markdown 文件
   * manifest.prompts 列出所有 prompt ID，对应 prompts/{id}.md
   */
  private async loadPrompts(
    packBase: string,
    promptIds: string[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const loaded = await Promise.all(
      promptIds.map((id) =>
        this.fetchText(this.resolve(packBase, `prompts/${id}.md`)).catch((err) => {
          console.warn(`[GamePackLoader] Failed to load prompt "${id}":`, err);
          return '';
        }),
      ),
    );
    promptIds.forEach((id, i) => { if (loaded[i]) result[id] = loaded[i]; });
    return result;
  }

  /** 加载所有 prompt flow 配置文件 */
  private async loadPromptFlows(
    packBase: string,
    flowPaths: Record<string, string>,
  ): Promise<Record<string, PromptFlowConfig>> {
    const result: Record<string, PromptFlowConfig> = {};
    const entries = Object.entries(flowPaths);
    const loaded = await Promise.all(
      entries.map(([, path]) => this.fetchJson<PromptFlowConfig>(this.resolve(packBase, path))),
    );
    entries.forEach(([key], i) => { result[key] = loaded[i]; });
    return result;
  }

  /** 加载所有规则配置文件 */
  private async loadRules(
    packBase: string,
    rulePaths: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(rulePaths);
    const loaded = await Promise.all(
      entries.map(([, path]) => this.fetchJson(this.resolve(packBase, path))),
    );
    entries.forEach(([key], i) => { result[key] = loaded[i]; });
    return result;
  }

  /** 拼接完整 URL */
  private resolve(base: string, relativePath: string): string {
    return `${base}/${relativePath}`;
  }

  /** fetch JSON 并自动解析 — 失败时抛出带 URL 的错误 */
  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /** fetch 纯文本 */
  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.text();
  }

  /** fetch JSON 但不抛错 — 用于可选资源（theme, display-settings 等） */
  private async fetchJsonOptional<T>(url: string): Promise<T | null> {
    try {
      return await this.fetchJson<T>(url);
    } catch {
      return null;
    }
  }
}
