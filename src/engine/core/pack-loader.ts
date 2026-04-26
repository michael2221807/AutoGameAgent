/**
 * Game Pack 加载器 — 从 public/packs/{packId}/ 加载资源
 *
 * 加载流程：
 * 1. fetch manifest.json → 解析 GamePackManifest
 * 2. 根据 manifest 声明并行加载所有 JSON/Markdown 资源
 * 3. 组装为完整的 GamePack 对象
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

  constructor(basePath: string = '/packs') {
    this.basePath = basePath;
  }

  /** 加载指定 Game Pack — 返回完整的运行时 GamePack 对象 */
  async load(packId: string): Promise<GamePack> {
    const manifestUrl = `${this.basePath}/${packId}/manifest.json`;
    const manifest = await this.fetchJson<GamePackManifest>(manifestUrl);
    const packBase = `${this.basePath}/${packId}`;

    // 并行加载所有资源类型，最大化加载速度
    const [stateSchema, creationFlow, presets, prompts, promptFlows, rules, theme, displaySettings] =
      await Promise.all([
        this.fetchJson<Record<string, unknown>>(this.resolve(packBase, manifest.entrySchema)),
        this.fetchJson<GamePack['creationFlow']>(this.resolve(packBase, manifest.creationFlow)),
        this.loadPresets(packBase, manifest.presets),
        this.loadPrompts(packBase, manifest.prompts),
        this.loadPromptFlows(packBase, manifest.promptFlows),
        this.loadRules(packBase, manifest.rules),
        this.fetchJsonOptional<Record<string, unknown>>(this.resolve(packBase, 'ui/theme.json')),
        this.fetchJsonOptional<Record<string, unknown>>(this.resolve(packBase, 'ui/display-settings.json')),
      ]);

    return {
      manifest,
      stateSchema,
      creationFlow,
      presets,
      prompts,
      promptFlows,
      rules,
      theme: theme ?? undefined,
      displaySettings: displaySettings ?? undefined,
    };
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
