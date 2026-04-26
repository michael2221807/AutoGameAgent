/**
 * 实体节点构建器 — 双源聚合实体信息（2026-04-14 重构）
 *
 * **双源设计**：实体不只从 events 抽取，还要从状态树 `社交.关系` 读：
 * - 玩家（`角色.基础信息.姓名`）始终是第一个实体
 * - `社交.关系` 数组中每个非"普通"类型的 NPC 建为 char 实体
 * - events 的 `structured_kv.role` / `location` 继续扫描补充
 *
 * 旧版本只看 events，而 events 在 EventBuilder 旧版本里是碎片
 * （subject/object/location 全空），导致 entities 永远为空。新版本
 * 即使 events 空，也能从状态树直接建玩家 + NPC 实体。
 *
 * 新增字段：
 * - `description`：从 NPC 的"当前外貌状态"/"当前内心想法"读，供 embedding 输入
 * - `is_embedded`：向量化成功后置 true，供调试面板统计
 *
 * 对应 STEP-03B M3.6 Engram 数据流（EntityBuilder 阶段）。
 */
import type { EngramEventNode, EngramStateReader } from './event-builder';

// ─── 类型定义 ───

/** 实体节点 — 知识图谱中的"对象"单元 */
export interface EngramEntity {
  /** 实体名称（也是主键，用于合并同名实体） */
  name: string;
  /** 实体类型 */
  type: 'player' | 'npc' | 'location' | 'item' | 'other';
  /** 实体属性（从事件上下文中累积的信息） */
  attributes: Record<string, unknown>;
  /** 首次出现的回合序号 */
  firstSeen: number;
  /** 最近出现的回合序号 */
  lastSeen: number;
  /** 累计出现次数（重要性指标） */
  mentionCount: number;
  /**
   * 实体描述文本 —— 供 Embedding 输入
   * 对于 NPC 是"当前外貌状态"/"当前内心想法"的组合；对于玩家填空字符串。
   * 2026-04-14 新增。
   */
  description: string;
  /**
   * 是否已完成向量化。engram-manager 向量化成功后置 true。
   * 2026-04-14 新增。
   */
  is_embedded: boolean;
}

/** EntityBuilder 从 state 读取时使用的路径集合 */
export interface EntityBuilderPaths {
  /** 玩家名 —— 默认 "角色.基础信息.姓名" */
  playerName: string;
  /** 社交关系数组 —— 默认 "社交.关系"，结构为 NpcRelationshipEntry[] */
  relationships: string;
}

/**
 * NPC 关系数组条目（Production schema：社交.关系 是数组）
 */
interface NpcRelationshipEntry {
  /** NPC 姓名（数组元素的主键） */
  名称: string;
  /** NPC 类型：'重点' | '普通' | undefined（未标记视为重点） */
  类型?: string;
  /** 与玩家关系（供 RelationBuilder 使用） */
  与玩家关系?: string;
  /** 当前外貌状态（供 description 使用） */
  当前外貌状态?: string;
  /** 当前内心想法（供 description 使用） */
  当前内心想法?: string;
  /** 外貌描述（备用描述源） */
  外貌描述?: string;
  /** 位置 */
  位置?: string;
  [key: string]: unknown;
}

type EntityMap = Map<string, EngramEntity>;

export class EntityBuilder {
  /**
   * 构建实体节点列表（双源）
   *
   * 顺序：
   * 1. 从 state tree 读玩家名 → 玩家实体（type=player）
   * 2. 遍历 `社交.关系`，非"普通"类型的 NPC → char 实体（type=npc）
   * 3. 遍历 events，补充出现在 structured_kv.role / location 中但还未建的实体
   *
   * @param events 当前所有事件（含历史）
   * @param stateManager 状态管理器（读玩家名 + 社交关系）
   * @param paths 状态路径配置
   */
  build(
    events: EngramEventNode[],
    stateManager: EngramStateReader,
    paths: EntityBuilderPaths,
  ): EngramEntity[] {
    const entityMap: EntityMap = new Map();

    // ── 1. 玩家 ──
    const playerName = stateManager.get<string>(paths.playerName) || '玩家';
    this.upsertEntity(entityMap, playerName, 'player', 0, '玩家角色');

    // ── 2. 社交关系中的 NPC ──
    const relationships = stateManager.get<NpcRelationshipEntry[]>(paths.relationships);
    if (Array.isArray(relationships)) {
      for (const npc of relationships) {
        if (!npc || typeof npc !== 'object') continue;
        const name = typeof npc.名称 === 'string' ? npc.名称.trim() : '';
        if (!name) continue;
        // 跳过"普通"类型（demo 对齐）
        if (npc.类型 === '普通') continue;
        const description = this.buildNpcDescription(npc);
        this.upsertEntity(entityMap, name, 'npc', 0, description, {
          relationToPlayer: npc.与玩家关系,
          location: npc.位置,
          source: 'relationship',
        });
      }
    }

    // ── 3. 从 events 补充 role / location 实体 ──
    for (const event of events) {
      const round = event.roundNumber ?? 0;
      const kv = event.structured_kv;

      // role → char（"玩家" 字面量合并到实际玩家名，避免重复 player 实体）
      if (kv && Array.isArray(kv.role)) {
        for (const role of kv.role) {
          if (typeof role !== 'string' || !role.trim()) continue;
          const trimmedName = role.trim();
          // "玩家"/"player" 字面量 → 合并到真实玩家名
          const isPlayerAlias = trimmedName === '玩家' || trimmedName === 'player';
          const resolvedName = (isPlayerAlias || trimmedName === playerName) ? playerName : trimmedName;
          const type = (isPlayerAlias || resolvedName === playerName) ? 'player' : this.inferType(resolvedName);
          this.upsertEntity(entityMap, resolvedName, type, round, '', {
            source: 'event_role',
            lastEventId: event.id,
          });
        }
      }

      // location → location
      if (kv && Array.isArray(kv.location)) {
        for (const loc of kv.location) {
          if (typeof loc !== 'string' || !loc.trim()) continue;
          this.upsertEntity(entityMap, loc.trim(), 'location', round, '', {
            source: 'event_location',
            lastEventId: event.id,
          });
        }
      }

      // 兼容旧字段：event.subject / event.object / event.location（平铺字段）
      if (event.subject) {
        const subj = event.subject === '玩家' || event.subject === 'player' ? playerName : event.subject;
        const subjType = subj === playerName ? 'player' : this.inferType(subj);
        this.upsertEntity(entityMap, subj, subjType, round, '');
      }
      if (event.object) {
        const obj = event.object === '玩家' || event.object === 'player' ? playerName : event.object;
        this.upsertEntity(entityMap, obj, this.inferType(obj), round, '');
      }
      if (event.location) {
        this.upsertEntity(entityMap, event.location, 'location', round, '');
      }
    }

    return Array.from(entityMap.values());
  }

  /**
   * 拼接 NPC 描述字符串（供 Embedding 使用）
   * 组合所有可用描述信息：外貌 + 内心想法 + 外貌描述（参照 ming 的多源实体描述）
   */
  private buildNpcDescription(npc: NpcRelationshipEntry): string {
    const parts: string[] = [];
    const appearance = typeof npc.当前外貌状态 === 'string' ? npc.当前外貌状态.trim() : '';
    if (appearance) parts.push(appearance);
    const thought = typeof npc.当前内心想法 === 'string' ? npc.当前内心想法.trim() : '';
    if (thought) parts.push(thought);
    const desc = typeof npc.外貌描述 === 'string' ? npc.外貌描述.trim() : '';
    if (desc && !appearance) parts.push(desc);
    return parts.join('；');
  }

  /**
   * Upsert 实体 —— 已存在则更新 lastSeen/mentionCount/description/attributes
   *
   * 类型在首次创建时确定，后续不改。
   * description: 每次有非空新值就更新（持续从 NPC 的当前状态刷新，参照 ming）。
   * 空描述不会覆盖已有的非空描述。
   */
  private upsertEntity(
    map: EntityMap,
    name: string,
    type: EngramEntity['type'],
    round: number,
    description: string,
    extraAttrs: Record<string, unknown> = {},
  ): void {
    const existing = map.get(name);
    if (existing) {
      existing.lastSeen = Math.max(existing.lastSeen, round);
      existing.firstSeen = Math.min(existing.firstSeen, round);
      existing.mentionCount += 1;
      // 持续更新描述：新的非空描述覆盖旧的（NPC 外貌/状态会变化）
      if (description) {
        existing.description = description;
        // 描述变化 → 标记需要重新向量化
        if (existing.is_embedded && existing.description !== description) {
          existing.is_embedded = false;
        }
      }
      existing.attributes = { ...existing.attributes, ...extraAttrs };
      return;
    }
    map.set(name, {
      name,
      type,
      attributes: { ...extraAttrs },
      firstSeen: round,
      lastSeen: round,
      mentionCount: 1,
      description,
      is_embedded: false,
    });
  }

  /**
   * 根据名字推断类型
   * - "玩家"/"player" → player
   * - 含地点词 → location
   * - 其余 → npc
   */
  private inferType(name: string): EngramEntity['type'] {
    if (name === '玩家' || name === 'player') return 'player';
    if (/[村镇城池山林洞窟街道广场酒馆教堂寺庙道观宫殿]/.test(name)) return 'location';
    return 'npc';
  }
}
