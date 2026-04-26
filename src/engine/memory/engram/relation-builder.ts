/**
 * 关系边构建器 — 双源构建实体间的关系（2026-04-14 重构）
 *
 * **双源设计**：
 * 1. **事件共现**：同一 event 的 roles 两两互连为 `co_occurs_with`；
 *    role → location 建 `appears_at`；role → event concept 建 `involved_in`。
 * 2. **社交关系**：`社交.关系` 数组中每个非普通 NPC → 玩家建 `rel_{与玩家关系}` 边。
 *
 * 旧版本只看 event.subject + event.object（平铺字段），而 events 在旧版
 * EventBuilder 里这两个字段全为空，导致 relations 永远为空。
 *
 * 对应 STEP-03B M3.6 Engram 数据流（RelationBuilder 阶段）。
 */
import type { EngramEventNode, EngramStateReader } from './event-builder';
import type { EngramEntity } from './entity-builder';

// ─── 类型定义 ───

/** 关系边 — 知识图谱中连接两个实体的有向边 */
export interface EngramRelation {
  /** 关系起点实体名 */
  fromName: string;
  /** 关系终点实体名 */
  toName: string;
  /** 关系类型标识 */
  type: string;
  /** 人类可读的关系描述 */
  label: string;
  /** 关系强度（0-1） */
  weight: number;
  /** 最近更新的时间戳（用于新鲜度衰减和去重） */
  lastUpdated: number;
  /** 关系来源事件 ID（可选，便于溯源） */
  sourceEventId?: string;
}

/** 关系聚合键 */
type RelationKey = string;

/** RelationBuilder 从 state 读取时使用的路径集合 */
export interface RelationBuilderPaths {
  /** 玩家名 */
  playerName: string;
  /** 社交关系数组 */
  relationships: string;
}

/** 动作到关系类型的映射 */
interface ActionRelationMapping {
  pattern: RegExp;
  type: string;
}

/**
 * NPC 关系数组条目
 */
interface NpcRelationshipEntry {
  名称: string;
  类型?: string;
  与玩家关系?: string;
  [key: string]: unknown;
}

const relationKey = (fromName: string, toName: string, type: string): RelationKey =>
  `${fromName}->${toName}:${type}`;

// ─── RelationBuilder ───

export class RelationBuilder {
  /**
   * 动作词到关系类型的映射
   */
  private static readonly ACTION_MAPPINGS: ActionRelationMapping[] = [
    { pattern: /攻击|战斗|击败|杀|伤害/, type: 'enemy' },
    { pattern: /帮助|治疗|保护|救|支援/, type: 'ally' },
    { pattern: /交谈|对话|询问|告知|说/, type: 'dialogue' },
    { pattern: /交易|购买|出售|买|卖/, type: 'trade' },
    { pattern: /移动|前往|到达|进入|离开/, type: 'at_location' },
    { pattern: /给予|赠送|接收|获得/, type: 'transfer' },
    { pattern: /观察|查看|检查|调查/, type: 'observed' },
  ];

  /**
   * 构建关系边（双源）
   *
   * @param events 全部事件（含历史）
   * @param entities 已构建的实体列表（用于 role name 校验）
   * @param stateManager 状态树（读社交关系）
   * @param paths 路径配置
   */
  build(
    events: EngramEventNode[],
    entities: EngramEntity[],
    stateManager: EngramStateReader,
    paths: RelationBuilderPaths,
  ): EngramRelation[] {
    const relationMap = new Map<RelationKey, EngramRelation>();
    const entityNames = new Set(entities.map((e) => e.name));
    const playerName = stateManager.get<string>(paths.playerName) || '玩家';

    // ── 1. 事件层面的共现关系 ──
    for (const event of events) {
      const kv = event.structured_kv;
      const roles = kv && Array.isArray(kv.role)
        ? kv.role.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((s) => s.trim())
        : [];
      const locations = kv && Array.isArray(kv.location)
        ? kv.location.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((s) => s.trim())
        : [];
      const conceptName = kv?.event?.trim();

      // role ↔ role: 共现 + 行动推断
      // 从事件文本推断额外的行动关系类型（参照 ming 的行动推断逻辑）
      const eventText = event.summary || event.text || '';
      const actionType = this.inferActionFromText(eventText);

      for (let i = 0; i < roles.length; i++) {
        for (let j = i + 1; j < roles.length; j++) {
          // 基础共现关系
          this.upsertRelation(relationMap, {
            fromName: roles[i],
            toName: roles[j],
            type: 'co_occurs_with',
            label: `${roles[i]} 与 ${roles[j]} 同场`,
            baseWeight: 0.3,
            sourceEventId: event.id,
          });
          this.upsertRelation(relationMap, {
            fromName: roles[j],
            toName: roles[i],
            type: 'co_occurs_with',
            label: `${roles[j]} 与 ${roles[i]} 同场`,
            baseWeight: 0.3,
            sourceEventId: event.id,
          });

          // 行动推断关系（如果事件文本匹配到行动模式）
          if (actionType) {
            this.upsertRelation(relationMap, {
              fromName: roles[i],
              toName: roles[j],
              type: actionType,
              label: `${roles[i]} 与 ${roles[j]} 的${actionType}关系`,
              baseWeight: 0.45,
              sourceEventId: event.id,
            });
          }
        }
      }

      // role → location: appears_at
      for (const role of roles) {
        for (const loc of locations) {
          this.upsertRelation(relationMap, {
            fromName: role,
            toName: loc,
            type: 'appears_at',
            label: `${role} 出现在 ${loc}`,
            baseWeight: 0.45,
            sourceEventId: event.id,
          });
        }
        // role → event concept: involved_in
        if (conceptName && entityNames.has(conceptName)) {
          this.upsertRelation(relationMap, {
            fromName: role,
            toName: conceptName,
            type: 'involved_in',
            label: `${role} 参与 ${conceptName}`,
            baseWeight: 0.4,
            sourceEventId: event.id,
          });
        }
      }

      // ── 兼容旧字段：subject + object 有平铺关系也提取 ──
      if (event.subject && event.object) {
        const type = this.inferRelationType(event);
        this.upsertRelation(relationMap, {
          fromName: event.subject,
          toName: event.object,
          type,
          label: `${event.subject} ${event.action} ${event.object}`,
          baseWeight: 0.3,
          sourceEventId: event.id,
        });
      }
    }

    // ── 2. 社交关系：NPC → 玩家 ──
    const relationships = stateManager.get<NpcRelationshipEntry[]>(paths.relationships);
    if (Array.isArray(relationships)) {
      for (const npc of relationships) {
        if (!npc || typeof npc !== 'object') continue;
        const npcName = typeof npc.名称 === 'string' ? npc.名称.trim() : '';
        if (!npcName) continue;
        if (npc.类型 === '普通') continue;
        const rel = typeof npc.与玩家关系 === 'string' && npc.与玩家关系.trim().length > 0
          ? npc.与玩家关系.trim()
          : 'related_to';
        this.upsertRelation(relationMap, {
          fromName: npcName,
          toName: playerName,
          type: `rel_${rel}`,
          label: `${npcName} 与玩家关系：${rel}`,
          baseWeight: 0.8,
        });
      }
    }

    return Array.from(relationMap.values());
  }

  /**
   * Upsert 关系 —— 同 key 存在则 log 衰减增权，不存在则新建
   */
  private upsertRelation(
    map: Map<RelationKey, EngramRelation>,
    data: {
      fromName: string;
      toName: string;
      type: string;
      label: string;
      baseWeight: number;
      sourceEventId?: string;
    },
  ): void {
    if (!data.fromName || !data.toName || data.fromName === data.toName || !data.type) return;
    const key = relationKey(data.fromName, data.toName, data.type);
    const existing = map.get(key);
    if (existing) {
      existing.weight = Math.min(1.0, existing.weight + 0.1 / Math.log2(existing.weight * 10 + 2));
      existing.lastUpdated = Date.now();
      existing.label = data.label;
      if (data.sourceEventId) existing.sourceEventId = data.sourceEventId;
      return;
    }
    map.set(key, {
      fromName: data.fromName,
      toName: data.toName,
      type: data.type,
      label: data.label,
      weight: Math.max(0, Math.min(1, data.baseWeight)),
      lastUpdated: Date.now(),
      sourceEventId: data.sourceEventId,
    });
  }

  /** 从事件文本推断行动关系类型（用于 role 共现增强） */
  private inferActionFromText(text: string): string | null {
    if (!text) return null;
    for (const mapping of RelationBuilder.ACTION_MAPPINGS) {
      if (mapping.pattern.test(text)) return mapping.type;
    }
    return null;
  }

  /** 从事件中推断关系类型（用于 subject/object 兼容路径） */
  private inferRelationType(event: EngramEventNode): string {
    for (const tag of event.tags) {
      const normalized = tag.toLowerCase();
      if (['enemy', 'ally', 'friend', 'trade', 'dialogue'].includes(normalized)) {
        return normalized;
      }
    }
    for (const mapping of RelationBuilder.ACTION_MAPPINGS) {
      if (mapping.pattern.test(event.action)) return mapping.type;
    }
    return 'interaction';
  }
}
