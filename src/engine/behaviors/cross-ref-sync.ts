/**
 * 跨引用同步模块 — 维护状态树中的双向引用一致性
 *
 * 问题背景：
 * Game Pack 的状态树中存在冗余/双向引用关系，例如：
 * - NPC 对象中有 location 字段标记其当前位置
 * - 地点对象中有 npcs 数组列出该地点的所有 NPC
 * 这两个数据必须保持同步，但 AI 只会修改其中一侧。
 *
 * 解决方案：
 * Game Pack 通过 IntegrityRule[] 声明这些同步规则，
 * 本模块在 afterCommands 钩子中执行所有规则，
 * 检测不一致并自动修复。
 *
 * 目前支持的规则模块：
 * - "bidirectional-ref-sync": 双向引用同步（主体.字段 ↔ 目标.列表）
 *
 * 规则配置示例（IntegrityRule）：
 * {
 *   "id": "npc-location-sync",
 *   "module": "bidirectional-ref-sync",
 *   "config": {
 *     "entityPath": "NPC列表",
 *     "entityRefField": "当前位置",
 *     "targetBasePath": "地点",
 *     "targetListField": "NPC",
 *     "entityIdField": "名称"
 *   }
 * }
 *
 * 对应 STEP-02 §3.10.3。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { ChangeLog, IntegrityRule } from '../types';

/** bidirectional-ref-sync 规则的配置字段 */
interface BidirectionalRefSyncConfig {
  /** 实体集合路径（如 "NPC列表"）— 可以是数组或对象 */
  entityPath: string;
  /** 实体中引用目标的字段名（如 "当前位置"） */
  entityRefField: string;
  /** 目标集合基路径（如 "地点"） */
  targetBasePath: string;
  /** 目标中存放实体引用的数组字段名（如 "NPC"） */
  targetListField: string;
  /** 实体的唯一标识字段名（如 "名称"） */
  entityIdField: string;
}

export class CrossRefSyncModule implements BehaviorModule {
  readonly id = 'cross-ref-sync';

  constructor(private rules: IntegrityRule[]) {}

  /**
   * afterCommands 钩子 — 每次 AI 修改状态后检查并修复引用
   *
   * 对每条规则独立 try/catch，单条规则失败不影响其他规则。
   */
  afterCommands(stateManager: StateManager, _changeLog: ChangeLog): void {
    for (const rule of this.rules) {
      try {
        this.executeRule(stateManager, rule);
      } catch (err) {
        console.error(`[CrossRefSync] Rule "${rule.id}" execution error:`, err);
      }
    }
  }

  /** 根据规则模块类型分派到具体实现 */
  private executeRule(stateManager: StateManager, rule: IntegrityRule): void {
    switch (rule.module) {
      case 'bidirectional-ref-sync':
        this.executeBidirectionalSync(stateManager, rule.config as unknown as BidirectionalRefSyncConfig);
        break;
      default:
        console.warn(`[CrossRefSync] Unknown module type "${rule.module}" in rule "${rule.id}"`);
    }
  }

  /**
   * 双向引用同步 — 核心算法
   *
   * 以 NPC.当前位置 ↔ 地点.NPC列表 为例：
   *
   * 阶段 1（正向同步 — 实体 → 目标）：
   *   遍历所有 NPC，按其 location 字段构建 Map<地点名, NPC名称[]>
   *
   * 阶段 2（写回目标侧列表）：
   *   遍历所有地点，将目标的 NPC 列表替换为 Map 中对应的值
   *   不在 Map 中的地点 → 清空 NPC 列表
   */
  private executeBidirectionalSync(
    stateManager: StateManager,
    config: BidirectionalRefSyncConfig,
  ): void {
    const entities = this.getEntityCollection(stateManager, config.entityPath);
    if (!entities.length) return;

    // 阶段 1: 从实体侧收集 targetRef → entityId[] 映射
    const targetToEntities = new Map<string, string[]>();
    for (const entity of entities) {
      const entityId = String(entity[config.entityIdField] ?? '');
      const targetRef = String(entity[config.entityRefField] ?? '');
      if (!entityId || !targetRef) continue;

      const list = targetToEntities.get(targetRef);
      if (list) {
        list.push(entityId);
      } else {
        targetToEntities.set(targetRef, [entityId]);
      }
    }

    // 阶段 2: 将收集到的映射写回目标侧
    const targetBase = stateManager.get<Record<string, unknown>>(config.targetBasePath);
    if (!targetBase || typeof targetBase !== 'object') return;

    const targetKeys = Object.keys(targetBase);
    for (const key of targetKeys) {
      const targetPath = `${config.targetBasePath}.${key}.${config.targetListField}`;
      const expected = targetToEntities.get(key) ?? [];
      const current = stateManager.get<string[]>(targetPath);

      // 只在列表内容不同时写回，减少无意义的 StateChange
      if (!this.arraysEqual(current ?? [], expected)) {
        stateManager.set(targetPath, expected, 'system');
      }
    }
  }

  /**
   * 获取实体集合 — 兼容数组和对象两种存储形式
   *
   * 状态树中的实体集合可能是：
   * - 数组形式：[{ "名称": "张三", "当前位置": "集市" }, ...]
   * - 对象形式：{ "张三": { "当前位置": "集市" }, ... }
   */
  private getEntityCollection(
    stateManager: StateManager,
    path: string,
  ): Record<string, unknown>[] {
    const raw = stateManager.get<unknown>(path);
    if (Array.isArray(raw)) {
      return raw.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
      );
    }
    if (raw !== null && typeof raw === 'object') {
      return Object.values(raw as Record<string, unknown>).filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
      );
    }
    return [];
  }

  /** 浅比较两个字符串数组内容是否一致（顺序无关） */
  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, i) => val === sortedB[i]);
  }
}
