/**
 * 全量备份与恢复服务 — 跨模块数据导出/导入
 *
 * 将引擎中所有持久化数据（角色档案、存档、向量、配置、prompt、引擎设置）
 * 打包为单一 JSON Blob，用于备份导出和恢复导入。
 *
 * 设计决策：
 * - 使用 JSON 序列化（而非二进制格式），便于调试和手动修复
 * - 导入采用"尽力恢复"策略：某模块失败不中断其他模块的导入
 * - 引擎设置从 localStorage 中以 `aga_` / `aga-` 前缀筛选，避免采集无关数据
 * - 使用 structuredClone 深拷贝，切断响应式 proxy 和原始数据的引用
 * - 单档案导出 exportProfile 仅包含该角色相关数据（不含全局配置/prompt）
 *
 * 对应 STEP-03B M5 全量备份/恢复。
 */
import { idbAdapter } from './idb-adapter';
import type { ProfileManager } from './profile-manager';
import type { SaveManager } from './save-manager';
import type { ConfigStore } from '../core/config-system';
import type { PromptStorage } from '../prompt/prompt-storage';
import type { VectorStore } from '../memory/engram/vector-store';
import type { CustomPresetStore, CustomPresetEntry } from './custom-preset-store';
import type { ImageAssetCache } from '../image/asset-cache';
import type { ImageAsset } from '../image/types';
import type { ProfileMeta } from '../types';

// ─── 常量 ───

/** 备份文件的格式版本 — 导入时用于兼容性校验和未来的格式迁移 */
const BACKUP_FORMAT_VERSION = 1;

/**
 * 引擎版本 — 标记导出时的引擎代码版本
 * 导入时可据此判断是否需要对备份数据做迁移变换
 */
const ENGINE_VERSION = '0.1.0';

/**
 * localStorage 中引擎相关 key 的前缀集合
 *
 * 正式版混用 `aga_`（下划线，如 `aga_api_management`）与历史 `aga-`（横杠）；
 * 备份须同时采集，否则恢复后 API / 设置 / Action Queue 会丢失。
 * 对应 STEP-03B M5.2 engineSettings。
 */
const LS_KEY_PREFIXES = ['aga_', 'aga-'] as const;

// ─── 类型 ───

/**
 * 备份数据包 — 包含引擎所有可恢复数据
 *
 * 各字段使用 `Record<string, unknown>` 而非强类型，
 * 因为备份包需要跨版本兼容：导入端的类型可能已发生变化，
 * 实际类型校验由各子模块在 importAll 时自行处理。
 */
export interface BackupBundle {
  /** 备份格式版本号 — 用于兼容性校验 */
  version: number;
  /** 导出时间（ISO 8601 字符串） */
  exportedAt: string;
  /** 导出时的引擎代码版本 */
  engineVersion: string;
  /**
   * 备份类型标记（v1.1 新增，optional）
   * - 'full' — 完整备份：所有 profiles + configs + prompts + engineSettings
   * - 'profile' — 单角色备份：仅该 profile 的数据，不含全局设置
   * 旧 v1 备份无此字段，由 isFullBackup() 通过其他字段推断
   */
  bundleType?: 'full' | 'profile';
  /**
   * StorageRoot.activeProfile 根指针（v1.1 新增，optional）
   * 完整备份时包含，单角色备份时为 null
   * 导入时用于恢复"当前活跃游戏"的指针，使用户刷新后能直接继续
   */
  activeProfile?: { profileId: string; slotId: string } | null;
  /** 角色档案元数据 — key = profileId */
  profiles: Record<string, unknown>;
  /** 存档状态树 — key = "profileId/slotId" */
  saves: Record<string, unknown>;
  /** 向量存储数据 — key = "profileId/slotId" */
  vectors: Record<string, unknown>;
  /** 配置覆盖数据 — { overlays: ConfigOverlay[] } */
  configs: Record<string, unknown>;
  /** Prompt 用户覆盖 — { entries: { key, value }[] } */
  prompts: Record<string, unknown>;
  /** localStorage：`aga_*` / `aga-*`（见 collectLocalStorageSettings） */
  engineSettings: Record<string, string | null>;
  /**
   * 2026-04-14 新增：用户自定义创角预设
   *
   * 结构：`{ packId: { presetType: CustomPresetEntry[] } }`
   * 例：`{ "tianming": { "worlds": [...], "origins": [...] } }`
   *
   * 全量备份时收集所有 pack 的 user 数据；导入时逐 pack 调
   * `customPresetStore.replaceAll`。Optional —— 旧 bundle 不含此字段时
   * 不影响导入，导入后用户预设保持空（与"新装机用户"等效）。
   */
  customPresets?: Record<string, Record<string, CustomPresetEntry[]>>;
  /**
   * 2026-04-25 新增：图片资产（base64 编码）
   *
   * 默认仅导出"已选用"的图片（头像、立绘、壁纸、香闺秘档），
   * 可选导出全部生图历史。
   * Optional —— 旧 bundle 不含此字段时不影响导入。
   */
  imageAssets?: Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }>;
}

/**
 * 导入结果报告 — 逐模块记录恢复状态（仅单角色合并流程使用）
 *
 * 布尔字段标记对应模块是否导入成功，
 * errors 收集所有失败模块的错误消息。
 */
interface ImportReport {
  profiles: boolean;
  saves: boolean;
  vectors: boolean;
  configs: boolean;
  prompts: boolean;
  engineSettings: boolean;
  errors: string[];
}

/**
 * 导入前状态快照 —— 用于全替换流程失败时回滚
 *
 * 包含：
 * - idb: idbAdapter 全部 key → 值（主 IDB store 完整镜像）
 * - ls: 所有 aga_* / aga-* localStorage 键值
 * - configOverlays: ConfigStore 独立存储中的全部 overlays
 * - promptEntries: PromptStorage 独立存储中的全部 entries
 */
interface PreImportSnapshot {
  idb: Record<string, unknown>;
  ls: Record<string, string | null>;
  configOverlays: unknown;
  promptEntries: unknown;
  /**
   * 2026-04-14 新增：用户自定义预设按 packId 索引
   * 结构：{ packId: { presetType: CustomPresetEntry[] } }
   * 失败回滚时整组写回；为 null 表示快照阶段未取到（视为空）。
   */
  customPresets: Record<string, Record<string, CustomPresetEntry[]>> | null;
}

/**
 * 派生类型 — 从 ConfigStore.importAll 参数中提取配置覆盖数组类型
 *
 * 通过 Parameters 工具类型从已导入的 ConfigStore 推导，
 * 避免单独导入 ConfigOverlay 而产生跨模块的脆弱依赖。
 */
type ConfigImportData = Parameters<ConfigStore['importAll']>[0];

/**
 * 派生类型 — 从 PromptStorage.importAll 参数中提取 prompt 条目数组类型
 */
type PromptImportData = Parameters<PromptStorage['importAll']>[0];

/**
 * 派生类型 — 从 VectorStore.save 的第三个参数中提取向量数据类型
 */
type VectorSaveData = Parameters<VectorStore['save']>[2];

// ─── 服务实现 ───

export class BackupService {
  constructor(
    private profileManager: ProfileManager,
    private saveManager: SaveManager,
    private configStore: ConfigStore,
    private promptStorage: PromptStorage,
    private vectorStore: VectorStore,
    /**
     * 2026-04-14 新增：用户自定义创角预设仓库（按 packId 隔离）。
     * Optional —— 旧测试或最小集成不传时，customPresets 字段在 bundle 中始终为空。
     */
    private customPresetStore?: CustomPresetStore,
    private imageAssetCache?: ImageAssetCache,
  ) {}

  // ─── 公开 API ───

  /**
   * 全量导出 — 将所有持久化数据打包为 JSON Blob
   *
   * 导出流程：
   * 1. 读取所有角色档案元数据（ProfileManager）
   * 2. 遍历每个档案的每个存档槽，加载存档数据（SaveManager）
   * 3. 加载每个存档槽对应的向量数据（VectorStore）
   * 4. 导出全局配置覆盖（ConfigStore）
   * 5. 导出全局 Prompt 覆盖（PromptStorage）
   * 6. 收集 localStorage 中的引擎设置
   * 7. 组装为 BackupBundle 并序列化为 Blob
   *
   * 所有数据使用 structuredClone 深拷贝，确保：
   * - 导出数据与运行时状态完全解耦
   * - 切断 Vue reactive proxy，避免序列化异常
   *
   * @returns 包含 JSON 数据的 Blob（MIME: application/json）
   */
  async exportAll(): Promise<Blob> {
    const root = this.profileManager.getRoot();

    /* ── 1. 角色档案元数据 ── */
    const profiles: Record<string, unknown> = structuredClone(root.profiles);

    /* ── 2 & 3. 存档数据 + 向量数据 ── */
    const saves: Record<string, unknown> = {};
    const vectors: Record<string, unknown> = {};

    for (const profile of Object.values(root.profiles)) {
      for (const slotId of Object.keys(profile.slots)) {
        const compositeKey = compositeSlotKey(profile.profileId, slotId);

        const saveData = await this.saveManager.loadGame(
          profile.profileId,
          slotId,
        );
        if (saveData !== undefined) {
          saves[compositeKey] = structuredClone(saveData);
        }

        const vectorData = await this.vectorStore.load(
          profile.profileId,
          slotId,
        );
        if (hasVectorContent(vectorData)) {
          vectors[compositeKey] = structuredClone(vectorData);
        }
      }
    }

    /* ── 4. 配置覆盖 ── */
    const configExport = await this.configStore.exportAll();
    const configs: Record<string, unknown> = {
      overlays: structuredClone(configExport),
    };

    /* ── 5. Prompt 覆盖 ── */
    const promptExport = await this.promptStorage.exportAll();
    const prompts: Record<string, unknown> = {
      entries: structuredClone(promptExport),
    };

    /* ── 6. localStorage 引擎设置 ── */
    const engineSettings = collectLocalStorageSettings();

    /* ── 7. 用户自定义创角预设（按 packId 索引） ── */
    // 2026-04-14：遍历所有有 user 数据的 pack，导出每个的全量 customPresets
    const customPresets = await this.collectCustomPresets();

    /* ── 8. 图片资产（已选用的头像/立绘/壁纸/秘档） ── */
    const imageAssets = await this.collectSelectedImageAssets(saves);

    /* ── 组装备份包 ── */
    const bundle: BackupBundle = {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      bundleType: 'full',
      activeProfile: root.activeProfile
        ? { ...root.activeProfile }
        : null,
      profiles,
      saves,
      vectors,
      configs,
      prompts,
      engineSettings,
      customPresets,
      imageAssets,
    };

    return new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
  }

  /**
   * 全量导入 — 从 JSON Blob 恢复所有持久化数据
   *
   * 2026-04-13 重构：根据 bundleType 区分两种流程：
   *
   * **全量备份（bundleType='full'）或含全局设置的 v1 备份：**
   * - 采用"**全替换**"语义，满足"一模一样"规格
   * - 导入前捕获全部 IDB + localStorage 快照到内存
   * - 擦除本地全部数据（idbAdapter.clear() + 清除所有 aga_* localStorage 键）
   * - 逐模块恢复备份内容
   * - 任何一步失败 → 从内存快照完整回滚
   * - 最后设置 ProfileManager.activeProfile 根指针
   *
   * **单角色备份（bundleType='profile'）或空 configs 的 v1 备份：**
   * - 采用"**合并**"语义，仅新增/覆盖该角色数据
   * - 不擦除其他 profile、不触碰全局设置
   * - 失败时不回滚（影响范围小）
   *
   * 导入校验：
   * - 检查备份包基本结构（必要字段存在性和类型）
   * - 检查版本号：高于当前支持版本则拒绝导入
   *
   * @param blob 由 exportAll() 或 exportProfile() 生成的 JSON Blob
   * @throws 备份包无效、版本不兼容、或导入失败时抛出
   */
  async importAll(blob: Blob): Promise<void> {
    const text = await blob.text();
    const raw: unknown = JSON.parse(text);

    /* ── 结构校验 ── */
    if (!isValidBundleShape(raw)) {
      throw new Error(
        '备份文件格式无效：缺少必需字段或结构不正确',
      );
    }

    const bundle = raw as BackupBundle;

    /* ── 版本兼容性检查 ── */
    if (bundle.version > BACKUP_FORMAT_VERSION) {
      throw new Error(
        `备份版本 ${bundle.version} 高于当前支持的版本 ` +
          `${BACKUP_FORMAT_VERSION}，请先升级引擎再导入`,
      );
    }

    /* ── 判断备份类型 ── */
    // bundleType 显式标记优先，否则根据 configs/prompts/engineSettings 是否为空推断
    const isFull =
      bundle.bundleType === 'full' ||
      (bundle.bundleType === undefined && this.hasGlobalData(bundle));

    if (isFull) {
      await this.importFullReplace(bundle);
    } else {
      await this.importProfileMerge(bundle);
    }
  }

  /**
   * 判断 bundle 是否包含全局数据（configs/prompts/engineSettings 非空）
   * 用于旧 v1 备份无 bundleType 字段时的类型推断
   */
  private hasGlobalData(bundle: BackupBundle): boolean {
    const configsNonEmpty =
      bundle.configs &&
      Object.keys(bundle.configs).length > 0 &&
      Array.isArray((bundle.configs as { overlays?: unknown }).overlays) &&
      ((bundle.configs as { overlays: unknown[] }).overlays.length > 0);
    const promptsNonEmpty =
      bundle.prompts &&
      Object.keys(bundle.prompts).length > 0 &&
      Array.isArray((bundle.prompts as { entries?: unknown }).entries) &&
      ((bundle.prompts as { entries: unknown[] }).entries.length > 0);
    const settingsNonEmpty =
      bundle.engineSettings &&
      Object.keys(bundle.engineSettings).length > 0;
    return !!(configsNonEmpty || promptsNonEmpty || settingsNonEmpty);
  }

  /**
   * 全替换导入 —— 擦除本地所有数据并以 bundle 替换
   *
   * 原子性保证：
   * 1. 先捕获当前状态到内存快照
   * 2. 擦除本地数据
   * 3. 恢复 bundle 内容
   * 4. 任一步失败 → 从快照回滚
   * 5. 成功则更新 ProfileManager.activeProfile
   */
  private async importFullReplace(bundle: BackupBundle): Promise<void> {
    /* ── 1. 捕获当前状态快照，供失败时回滚 ── */
    const snapshot = await this.captureCurrentState();

    try {
      /* ── 2. 擦除本地数据 ── */
      await this.wipeAll();

      /* ── 3. 恢复各模块 ── */
      await this.restoreProfiles(bundle.profiles);
      await this.restoreSaves(bundle.saves);
      await this.restoreVectors(bundle.vectors);
      await this.restoreConfigs(bundle.configs);
      await this.restorePrompts(bundle.prompts);
      restoreLocalStorageSettings(bundle.engineSettings);

      /* ── 4. 恢复用户自定义创角预设（2026-04-14 新增） ── */
      await this.restoreCustomPresets(bundle.customPresets);

      /* ── 4b. 恢复图片资产 ── */
      await this.restoreImageAssets(bundle.imageAssets);

      /* ── 5. 恢复 activeProfile 根指针 ── */
      if (bundle.activeProfile) {
        const { profileId, slotId } = bundle.activeProfile;
        const exists = this.profileManager.getRoot().profiles[profileId];
        if (exists) {
          await this.profileManager.setActiveProfile(profileId, slotId);
        }
      }
    } catch (err) {
      /* ── 失败 → 从快照回滚 ── */
      try {
        await this.restoreFromSnapshot(snapshot);
      } catch (rollbackErr) {
        throw new Error(
          `导入失败且回滚失败：${extractErrorMessage(err)} | ` +
            `回滚错误：${extractErrorMessage(rollbackErr)}`,
        );
      }
      throw new Error(`导入失败，本地数据已回滚：${extractErrorMessage(err)}`);
    }
  }

  /**
   * 单角色合并导入 —— 仅新增/覆盖 bundle 中的 profile 数据
   *
   * 不擦除其他 profile、不触碰全局配置。
   * 失败时不回滚（影响局部）。
   */
  private async importProfileMerge(bundle: BackupBundle): Promise<void> {
    const report: ImportReport = {
      profiles: false,
      saves: false,
      vectors: false,
      configs: false,
      prompts: false,
      engineSettings: false,
      errors: [],
    };

    try {
      await this.restoreProfiles(bundle.profiles);
      report.profiles = true;
    } catch (err) {
      report.errors.push(`Profiles: ${extractErrorMessage(err)}`);
    }

    try {
      await this.restoreSaves(bundle.saves);
      report.saves = true;
    } catch (err) {
      report.errors.push(`Saves: ${extractErrorMessage(err)}`);
    }

    try {
      await this.restoreVectors(bundle.vectors);
      report.vectors = true;
    } catch (err) {
      report.errors.push(`Vectors: ${extractErrorMessage(err)}`);
    }

    if (report.errors.length > 0) {
      throw new Error(
        `单角色导入完成但有 ${report.errors.length} 个错误：\n` +
          report.errors.map((e) => `  - ${e}`).join('\n'),
      );
    }
  }

  // ─── 快照 / 擦除 / 回滚 ───

  /**
   * 捕获当前完整持久化状态到内存对象，供失败回滚使用
   */
  private async captureCurrentState(): Promise<PreImportSnapshot> {
    const idbKeys = await idbAdapter.keys();
    const idb: Record<string, unknown> = {};
    for (const key of idbKeys) {
      const value = await idbAdapter.get(key);
      if (value !== undefined) {
        idb[key] = structuredClone(value);
      }
    }

    const ls: Record<string, string | null> = collectLocalStorageSettings();

    // ConfigStore 和 PromptStorage 可能使用独立 IDB store，
    // 通过各自的 exportAll 接口抓取当前完整状态
    let configOverlays: unknown = null;
    let promptEntries: unknown = null;
    try {
      configOverlays = await this.configStore.exportAll();
    } catch {
      /* 如果 configStore 未初始化或读取失败，快照仍可用 idb 兜底 */
    }
    try {
      promptEntries = await this.promptStorage.exportAll();
    } catch {
      /* 同上 */
    }

    // 2026-04-14：用户自定义预设
    // 注：customPresets 实际存在主 IDB store，已经被上面的 idb 全 key dump 覆盖。
    // 这里再独立 capture 一份，方便回滚时有结构化数据可走 customPresetStore.replaceAll
    // 路径（避免依赖 idbAdapter.set 时数据格式微妙变化）。
    const customPresets = await this.collectCustomPresets();

    return { idb, ls, configOverlays, promptEntries, customPresets };
  }

  /**
   * 收集所有 pack 的用户自定义预设（按 packId 索引）
   *
   * 调用方：exportAll、captureCurrentState
   * 失败时返回 null（保留与 PreImportSnapshot.customPresets 类型一致）
   */
  private async collectCustomPresets(): Promise<
    Record<string, Record<string, CustomPresetEntry[]>>
  > {
    const result: Record<string, Record<string, CustomPresetEntry[]>> = {};
    if (!this.customPresetStore) return result;
    try {
      const packIds = await this.customPresetStore.listPackIds();
      for (const pid of packIds) {
        const data = await this.customPresetStore.load(pid);
        if (data && Object.keys(data.presets ?? {}).length > 0) {
          result[pid] = structuredClone(data.presets);
        }
      }
    } catch (err) {
      console.warn('[BackupService] collectCustomPresets failed:', err);
    }
    return result;
  }

  /**
   * 恢复用户自定义预设到 IDB（按 packId）
   *
   * 调用方：importFullReplace、importProfileMerge
   * Optional —— bundle 可能不带 customPresets（旧 backup），此时静默跳过。
   */
  private async restoreCustomPresets(
    data: BackupBundle['customPresets'],
  ): Promise<void> {
    if (!this.customPresetStore || !data) return;
    for (const [packId, presetsByType] of Object.entries(data)) {
      try {
        await this.customPresetStore.replaceAll(packId, presetsByType);
      } catch (err) {
        console.warn(`[BackupService] restoreCustomPresets failed for "${packId}":`, err);
      }
    }
  }

  /**
   * 从所有存档的状态树中收集"已选用"的图片 asset ID，
   * 然后从 ImageAssetCache 导出对应的 blob。
   *
   * 已选用的定义：
   * - 玩家/NPC 的 已选头像图片ID、已选立绘图片ID、已选背景图片ID
   * - 香闺秘档中各 part 的 assetId
   * - 场景壁纸 当前壁纸图片ID
   */
  private async collectSelectedImageAssets(
    saves: Record<string, unknown>,
  ): Promise<Array<{ id: string; metadata: ImageAsset; base64: string; mimeType: string }>> {
    if (!this.imageAssetCache) return [];
    const assetIds = new Set<string>();

    for (const saveData of Object.values(saves)) {
      if (!saveData || typeof saveData !== 'object') continue;
      collectAssetIdsFromTree(saveData as Record<string, unknown>, assetIds);
    }

    if (assetIds.size === 0) return [];
    try {
      return await this.imageAssetCache.exportByIds(assetIds);
    } catch (err) {
      console.warn('[BackupService] collectSelectedImageAssets failed:', err);
      return [];
    }
  }

  /** 恢复图片资产到 ImageAssetCache */
  private async restoreImageAssets(
    data: BackupBundle['imageAssets'],
  ): Promise<void> {
    if (!this.imageAssetCache || !data || data.length === 0) return;
    try {
      await this.imageAssetCache.importEntries(data);
    } catch (err) {
      console.warn('[BackupService] restoreImageAssets failed:', err);
    }
  }

  /**
   * 擦除本地所有数据（IDB 全部 key + 所有 aga_* localStorage 键）
   *
   * configs/prompts 使用独立 IDB DB（aga-config / aga-prompts），
   * 通过各自的 clear() 接口清空存储区。
   */
  private async wipeAll(): Promise<void> {
    // 1. 清空主 IDB store（profiles + saves + vectors）
    await idbAdapter.clear();

    // 2. 清空 localStorage 中的 aga_* / aga- 键
    wipeLocalStorageSettings();

    // 3. 清空 configs / prompts 各自独立的 IDB DB
    await this.configStore.clear();
    await this.promptStorage.clear();

    // 4. 清空图片缓存
    if (this.imageAssetCache) {
      try { await this.imageAssetCache.clear(); } catch { /* best effort */ }
    }

    // 5. 重置 ProfileManager 内存缓存（防止后续 getRoot 返回 stale 数据）
    await this.profileManager.initialize();
  }

  /**
   * 从内存快照完整恢复状态
   *
   * 回滚顺序：先擦除当前（可能已部分写入的）数据，再回写快照
   */
  private async restoreFromSnapshot(
    snapshot: PreImportSnapshot,
  ): Promise<void> {
    // 1. 清空当前（可能已污染的）状态
    await idbAdapter.clear();
    wipeLocalStorageSettings();
    try {
      await this.configStore.clear();
    } catch { /* ignore */ }
    try {
      await this.promptStorage.clear();
    } catch { /* ignore */ }

    // 2. 回写 IDB
    for (const [key, value] of Object.entries(snapshot.idb)) {
      await idbAdapter.set(key, value);
    }

    // 3. 回写 localStorage
    for (const [key, value] of Object.entries(snapshot.ls)) {
      if (!LS_KEY_PREFIXES.some((p) => key.startsWith(p))) continue;
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }

    // 4. 回写 configs / prompts
    if (Array.isArray(snapshot.configOverlays)) {
      try {
        await this.configStore.importAll(
          snapshot.configOverlays as ConfigImportData,
        );
      } catch {
        /* 快照中的数据格式可能已损坏，尽力恢复 */
      }
    }
    if (Array.isArray(snapshot.promptEntries)) {
      try {
        await this.promptStorage.importAll(
          snapshot.promptEntries as PromptImportData,
        );
      } catch {
        /* 同上 */
      }
    }

    // 4b. 回写 user 自定义预设（2026-04-14）
    // idbAdapter 全 key dump 已经包含 custom_presets_*，但走 customPresetStore
    // 的 replaceAll 路径能保证字段被规范化（id 前缀、source、createdAt 缺省补齐）。
    if (snapshot.customPresets) {
      await this.restoreCustomPresets(snapshot.customPresets);
    }

    // 5. 重置 ProfileManager 缓存
    await this.profileManager.initialize();
  }

  /**
   * 单档案导出 — 仅导出指定角色的档案、存档和向量数据
   *
   * 不包含全局配置 / Prompt / 引擎设置（这些是跨档案共享的），
   * 对应字段设为空对象。适用于分享单个角色或部分备份场景。
   *
   * @param profileId 要导出的角色档案 ID
   * @returns 仅包含该角色数据的 JSON Blob
   * @throws 角色不存在时抛出
   */
  async exportProfile(profileId: string): Promise<Blob> {
    const profile = this.profileManager.getRoot().profiles[profileId];
    if (!profile) {
      throw new Error(`Profile "${profileId}" does not exist`);
    }

    const profiles: Record<string, unknown> = {
      [profileId]: structuredClone(profile),
    };

    const saves: Record<string, unknown> = {};
    const vectors: Record<string, unknown> = {};

    for (const slotId of Object.keys(profile.slots)) {
      const compositeKey = compositeSlotKey(profileId, slotId);

      const saveData = await this.saveManager.loadGame(profileId, slotId);
      if (saveData !== undefined) {
        saves[compositeKey] = structuredClone(saveData);
      }

      const vectorData = await this.vectorStore.load(profileId, slotId);
      if (hasVectorContent(vectorData)) {
        vectors[compositeKey] = structuredClone(vectorData);
      }
    }

    const bundle: BackupBundle = {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      bundleType: 'profile',
      // 单角色备份不指定 activeProfile —— 导入时仅合并该角色
      activeProfile: null,
      profiles,
      saves,
      vectors,
      configs: {},
      prompts: {},
      engineSettings: {},
    };

    return new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
  }

  // ─── 内部恢复方法 ───

  /**
   * 恢复角色档案 — 将备份中的每个角色写入 ProfileManager
   *
   * 调用 createProfile 逐条写入，已存在的同 ID 档案会被覆盖。
   * 确保 profileId 字段与 key 一致，防止序列化中 key 被篡改。
   */
  private async restoreProfiles(
    profilesData: Record<string, unknown>,
  ): Promise<void> {
    for (const [profileId, rawMeta] of Object.entries(profilesData)) {
      const meta = structuredClone(rawMeta) as ProfileMeta;
      meta.profileId = profileId;
      await this.profileManager.createProfile(meta);
    }
  }

  /**
   * 恢复存档数据 — 通过 idbAdapter 直接写入 IndexedDB
   *
   * 使用 idbAdapter 而非 SaveManager.saveGame 的原因：
   * - 避免触发 engine:save-complete 事件（这不是真正的游戏保存操作）
   * - 避免重复更新元数据（元数据已在 restoreProfiles 中恢复）
   * - 保持导出时的原始数据不被修改（saveGame 会写入当前时间戳）
   *
   * compositeKey 格式: "profileId/slotId" → IDB key: "save_profileId_slotId"
   */
  private async restoreSaves(
    savesData: Record<string, unknown>,
  ): Promise<void> {
    for (const [compositeKey, data] of Object.entries(savesData)) {
      const { profileId, slotId } = parseCompositeKey(compositeKey);
      const idbKey = `save_${profileId}_${slotId}`;
      await idbAdapter.set(idbKey, structuredClone(data));
    }
  }

  /**
   * 恢复向量数据 — 通过 VectorStore.save 写入
   *
   * compositeKey 格式同存档: "profileId/slotId"
   * 数据结构需与 VectorStoreData 兼容（eventVectors, entityVectors, model, dim）
   */
  private async restoreVectors(
    vectorsData: Record<string, unknown>,
  ): Promise<void> {
    for (const [compositeKey, data] of Object.entries(vectorsData)) {
      const { profileId, slotId } = parseCompositeKey(compositeKey);
      await this.vectorStore.save(
        profileId,
        slotId,
        structuredClone(data) as VectorSaveData,
      );
    }
  }

  /**
   * 恢复配置覆盖 — 调用 ConfigStore.importAll
   *
   * 备份中 configs.overlays 是 ConfigOverlay[] 的序列化形式。
   * 若 overlays 不存在或不是数组则跳过（兼容单档案导出的空 configs）。
   */
  private async restoreConfigs(
    configsData: Record<string, unknown>,
  ): Promise<void> {
    const overlays = configsData['overlays'];
    if (!Array.isArray(overlays)) return;
    await this.configStore.importAll(overlays as ConfigImportData);
  }

  /**
   * 恢复 Prompt 覆盖 — 调用 PromptStorage.importAll
   *
   * 备份中 prompts.entries 是 { key, value }[] 的序列化形式。
   * 若 entries 不存在或不是数组则跳过。
   */
  private async restorePrompts(
    promptsData: Record<string, unknown>,
  ): Promise<void> {
    const entries = promptsData['entries'];
    if (!Array.isArray(entries)) return;
    await this.promptStorage.importAll(entries as PromptImportData);
  }
}

// ─── 模块级工具函数 ───

/**
 * 生成存档/向量数据的复合 key
 *
 * 使用 "/" 分隔而非 "_"，与 idbAdapter 中的 save key 格式区分：
 * - 备份包内: "profileId/slotId"（人类可读、方便 JSON 查看）
 * - IndexedDB: "save_profileId_slotId"（兼容旧格式、无特殊字符歧义）
 */
function compositeSlotKey(profileId: string, slotId: string): string {
  return `${profileId}/${slotId}`;
}

/**
 * 解析复合 key — 从 "profileId/slotId" 中提取两段标识
 *
 * @throws key 格式不合法时抛出
 */
function parseCompositeKey(key: string): {
  profileId: string;
  slotId: string;
} {
  const separatorIndex = key.indexOf('/');
  if (separatorIndex === -1 || separatorIndex === 0 || separatorIndex === key.length - 1) {
    throw new Error(
      `Invalid composite key format: "${key}" (expected "profileId/slotId")`,
    );
  }
  return {
    profileId: key.slice(0, separatorIndex),
    slotId: key.slice(separatorIndex + 1),
  };
}

/**
 * 检查向量数据是否包含实际内容（非空向量）
 *
 * 空向量存储（新存档、从未使用 Engram）不值得写入备份包，
 * 跳过它们可减小备份文件体积。
 */
function hasVectorContent(data: {
  eventVectors: Record<string, number[]>;
  entityVectors: Record<string, number[]>;
}): boolean {
  return (
    Object.keys(data.eventVectors).length > 0 ||
    Object.keys(data.entityVectors).length > 0
  );
}

/**
 * 校验备份包的基本结构 — 纯形状检查
 *
 * 只验证顶层字段的存在性和基本类型，不深入校验子结构。
 * 子结构的校验由各 restore 方法在实际使用时处理。
 */
function isValidBundleShape(data: unknown): data is BackupBundle {
  if (typeof data !== 'object' || data === null) return false;

  const obj = data as Record<string, unknown>;
  return (
    typeof obj['version'] === 'number' &&
    typeof obj['exportedAt'] === 'string' &&
    typeof obj['engineVersion'] === 'string' &&
    typeof obj['profiles'] === 'object' &&
    obj['profiles'] !== null &&
    typeof obj['saves'] === 'object' &&
    obj['saves'] !== null &&
    typeof obj['vectors'] === 'object' &&
    obj['vectors'] !== null &&
    typeof obj['configs'] === 'object' &&
    obj['configs'] !== null &&
    typeof obj['prompts'] === 'object' &&
    obj['prompts'] !== null &&
    typeof obj['engineSettings'] === 'object' &&
    obj['engineSettings'] !== null
  );
}

/**
 * 从 localStorage 收集引擎设置
 *
 * 收集以 `aga_` 或 `aga-` 开头的 key，
 * 避免采集其他库或应用的无关数据。
 */
function collectLocalStorageSettings(): Record<string, string | null> {
  const settings: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (LS_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      settings[key] = localStorage.getItem(key);
    }
  }
  return settings;
}

/**
 * 擦除 localStorage 中所有 aga_* / aga-* 键
 *
 * 用于全替换导入前的清理阶段，确保备份中不存在的设置在本地也被移除。
 * 必须先收集再删除，避免边遍历边删除导致索引错位。
 */
function wipeLocalStorageSettings(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (LS_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

/**
 * 恢复 localStorage 引擎设置
 *
 * 处理 null 值的语义：
 * - null → 删除该 key（localStorage.removeItem）
 * - string → 写入该值（localStorage.setItem）
 *
 * 安全限制：只允许写入 `aga_` / `aga-` 前缀的 key，防止恶意备份覆盖无关数据。
 */
function restoreLocalStorageSettings(
  settings: Record<string, string | null>,
): void {
  for (const [key, value] of Object.entries(settings)) {
    if (!LS_KEY_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }
}

/**
 * 从 unknown 错误中安全提取消息字符串
 *
 * catch 块捕获的是 unknown 类型（strict TS 要求），
 * 此函数统一处理 Error 实例和非 Error 抛出值。
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 从 GameStateTree 中提取所有"已选用"的图片 asset ID。
 *
 * 扫描路径：
 * - 角色.图片档案.已选头像图片ID / 已选立绘图片ID / 已选背景图片ID
 * - 社交.关系[].图片档案.已选头像图片ID / 已选立绘图片ID / 已选背景图片ID
 * - 社交.关系[].图片档案.香闺秘档.{胸部|小穴|屁穴}.assetId
 * - 系统.扩展.image.sceneArchive.当前壁纸图片ID
 */
function collectAssetIdsFromTree(tree: Record<string, unknown>, ids: Set<string>): void {
  const addIfValid = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) ids.add(val.trim());
  };

  const SELECTION_FIELDS = ['已选头像图片ID', '已选立绘图片ID', '已选背景图片ID'];

  const extractFromArchive = (archive: unknown) => {
    if (!archive || typeof archive !== 'object' || Array.isArray(archive)) return;
    const a = archive as Record<string, unknown>;
    for (const f of SELECTION_FIELDS) addIfValid(a[f]);
    // 香闺秘档
    const secret = a['香闺秘档'];
    if (secret && typeof secret === 'object') {
      for (const part of Object.values(secret as Record<string, unknown>)) {
        if (part && typeof part === 'object') addIfValid((part as Record<string, unknown>).assetId);
      }
    }
  };

  // Player archive
  const player = tree['角色'] as Record<string, unknown> | undefined;
  if (player) extractFromArchive(player['图片档案']);

  // NPC archives
  const social = tree['社交'] as Record<string, unknown> | undefined;
  const relationships = social?.['关系'];
  if (Array.isArray(relationships)) {
    for (const npc of relationships) {
      if (npc && typeof npc === 'object') extractFromArchive((npc as Record<string, unknown>)['图片档案']);
    }
  }

  // Scene wallpaper
  const system = tree['系统'] as Record<string, unknown> | undefined;
  const ext = system?.['扩展'] as Record<string, unknown> | undefined;
  const image = ext?.['image'] as Record<string, unknown> | undefined;
  const sceneArchive = image?.['sceneArchive'] as Record<string, unknown> | undefined;
  if (sceneArchive) addIfValid(sceneArchive['当前壁纸图片ID']);
}

/**
 * 测试用导出 —— 公开模块内部的纯函数供单元测试使用
 *
 * 不是公共 API，仅供 `backup-service.test.ts` 导入。
 * 生产代码不应依赖此导出。
 */
export const _testExports = {
  isValidBundleShape,
  collectLocalStorageSettings,
  wipeLocalStorageSettings,
  compositeSlotKey,
  parseCompositeKey,
  hasVectorContent,
  collectAssetIdsFromTree,
  BACKUP_FORMAT_VERSION,
  LS_KEY_PREFIXES,
};
