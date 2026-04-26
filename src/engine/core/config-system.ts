/**
 * 配置系统 — 三组件架构：Registry + Store + Resolver
 *
 * - ConfigRegistry: 注册表，记录所有配置域的 schema 和默认值来源
 * - ConfigStore: IndexedDB 持久化层，存储用户的 overlay（只存 diff）
 * - ConfigResolver: 合并引擎，将 Game Pack 默认值和用户修改合并为运行时配置
 *
 * 对应 STEP-02 §3.7、STEP-03 M1.5。
 * 参照 demo: promptStorage.ts 的 IndexedDB 模式（但泛化为通用配置）。
 */
import { mergeWith, cloneDeep } from 'lodash-es';
import type { ConfigDomain, ConfigDomainId, ConfigOverlay, ResolvedConfig } from '../types';

// ─── Config Registry ───

/** 配置域注册表 — 记录引擎支持的所有配置域 */
export class ConfigRegistry {
  private domains = new Map<ConfigDomainId, ConfigDomain>();

  /** 注册一个配置域 */
  register(domain: ConfigDomain): void {
    this.domains.set(domain.id, domain);
  }

  /** 按 ID 获取配置域定义 */
  get(id: ConfigDomainId): ConfigDomain | undefined {
    return this.domains.get(id);
  }

  /** 获取所有已注册的配置域 */
  getAll(): ConfigDomain[] {
    return Array.from(this.domains.values());
  }

  /** 检查配置域是否已注册 */
  has(id: ConfigDomainId): boolean {
    return this.domains.has(id);
  }
}

// ─── Config Store (IndexedDB 持久化) ───

/**
 * 配置持久化层 — 将用户修改的 overlay 存入 IndexedDB
 *
 * 每个 overlay 的 key 格式为 "{packId}:{domainId}"，
 * 不同游戏包的配置互不干扰。
 *
 * DB 连接使用懒初始化 + 单例缓存，避免重复 openDB。
 */
export class ConfigStore {
  private dbPromise: Promise<import('idb').IDBPDatabase> | null = null;

  constructor(private dbName: string = 'aga-config') {}

  /** 懒初始化 IndexedDB 连接 */
  private getDB(): Promise<import('idb').IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = import('idb').then(({ openDB }) =>
        openDB(this.dbName, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains('overlays')) {
              db.createObjectStore('overlays');
            }
          },
        }),
      );
    }
    return this.dbPromise;
  }

  /** 保存用户修改 */
  async saveOverlay(overlay: ConfigOverlay): Promise<void> {
    const db = await this.getDB();
    await db.put('overlays', overlay, `${overlay.packId}:${overlay.domainId}`);
  }

  /** 加载用户修改 */
  async loadOverlay(packId: string, domainId: ConfigDomainId): Promise<ConfigOverlay | undefined> {
    const db = await this.getDB();
    return db.get('overlays', `${packId}:${domainId}`);
  }

  /** 删除用户修改（reset to default） */
  async deleteOverlay(packId: string, domainId: ConfigDomainId): Promise<void> {
    const db = await this.getDB();
    await db.delete('overlays', `${packId}:${domainId}`);
  }

  /** 列出指定游戏包的所有用户修改 */
  async listOverlays(packId: string): Promise<ConfigOverlay[]> {
    const db = await this.getDB();
    const all: ConfigOverlay[] = await db.getAll('overlays');
    return all.filter((o) => o.packId === packId);
  }

  /** 导出所有配置（备份用） */
  async exportAll(): Promise<ConfigOverlay[]> {
    const db = await this.getDB();
    return db.getAll('overlays');
  }

  /** 导入配置（恢复备份用） */
  async importAll(overlays: ConfigOverlay[]): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction('overlays', 'readwrite');
    for (const o of overlays) {
      await tx.store.put(o, `${o.packId}:${o.domainId}`);
    }
    await tx.done;
  }

  /**
   * 清空所有配置覆盖（全量备份恢复前使用）
   *
   * 删除整个 overlays store 的所有条目，不删除数据库本身。
   * 之后调用 importAll 即可得到与备份完全一致的配置状态。
   */
  async clear(): Promise<void> {
    const db = await this.getDB();
    await db.clear('overlays');
  }
}

// ─── Config Resolver ───

/**
 * 配置合并器 — 将 Game Pack 默认值与用户修改合并为运行时配置
 *
 * 合并策略：lodash merge（深度合并）
 * 重置操作：删除 overlay 即恢复默认
 */
export class ConfigResolver {
  constructor(
    private registry: ConfigRegistry,
    private store: ConfigStore,
  ) {}

  /**
   * 解析配置 — 合并 default + user overlay
   * @param packId 游戏包 ID
   * @param domainId 配置域 ID
   * @param defaultData Game Pack 中的默认配置数据
   */
  async resolve(
    packId: string,
    domainId: ConfigDomainId,
    defaultData: Record<string, unknown>,
  ): Promise<ResolvedConfig> {
    const overlay = await this.store.loadOverlay(packId, domainId);

    // 无用户修改 → 直接返回默认值
    if (!overlay || Object.keys(overlay.patches).length === 0) {
      return { domainId, data: cloneDeep(defaultData), isModified: false };
    }

    // 深度合并：默认值 + 用户修改
    // 使用 mergeWith 并对数组采用"替换"而非"按索引合并"策略
    // 避免 lodash.merge 对数组的 by-index 合并导致意外结果
    const merged = mergeWith(
      cloneDeep(defaultData),
      cloneDeep(overlay.patches),
      (_objValue: unknown, srcValue: unknown) => {
        if (Array.isArray(srcValue)) return srcValue;
        return undefined; // 其他类型使用默认深度合并
      },
    );
    return { domainId, data: merged, isModified: true };
  }

  /**
   * 保存用户修改
   * @param patches 只包含修改过的字段（diff）
   */
  async saveUserPatch(
    packId: string,
    domainId: ConfigDomainId,
    patches: Record<string, unknown>,
  ): Promise<void> {
    const overlay: ConfigOverlay = {
      domainId,
      packId,
      patches,
      version: this.registry.get(domainId)?.version ?? 1,
      updatedAt: Date.now(),
    };
    await this.store.saveOverlay(overlay);
  }

  /** 重置某域到 Game Pack 默认 — 删除 user overlay */
  async resetDomain(packId: string, domainId: ConfigDomainId): Promise<void> {
    await this.store.deleteOverlay(packId, domainId);
  }
}
