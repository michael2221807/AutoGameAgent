/**
 * Engram 管理器 — 语义记忆子系统的编排中心（2026-04-14 重构）
 *
 * Engram 将 AI 生成的叙事转化为结构化的知识图谱 + 向量索引：
 * - 事件节点（每回合 1 个，含 time_anchor + role + location + burned summary）
 * - 实体节点（玩家 + 非普通 NPC + 事件 role/location，含 description + is_embedded）
 * - 关系边（事件共现 + 社交关系 rel_xxx）
 * - 向量表示（events 嵌入 summary，entities 嵌入 name+description）
 *
 * 编排流程（每回合 PostProcessStage 触发）：
 * 1. 检查是否启用
 * 2. **Legacy migration**: 检测旧格式 events（缺 summary/structured_kv）→ 清空 engramMemory + vectors
 * 3. EventBuilder(response, stateManager, round, paths) → 1 新事件
 * 4. EntityBuilder(allEvents, stateManager, paths) → 含玩家 + NPC + 事件实体
 * 5. RelationBuilder(allEvents, entities, stateManager, paths) → 共现 + 社交关系
 * 6. 修剪（重点 NPC 过滤 + trim strategy）
 * 7. 写入状态树 `系统.扩展.engramMemory`
 * 8. **异步向量化**（events + entities 合批），成功后把 `is_embedded=true` 写回状态树
 *
 * 对应 STEP-03B M3.6。
 */
import type { StateManager } from '../../core/state-manager';
import type { AIService } from '../../ai/ai-service';
import type { AIResponse } from '../../ai/types';
import { EventBuilder } from './event-builder';
import type { EngramEventNode } from './event-builder';
import { EntityBuilder } from './entity-builder';
import type { EngramEntity } from './entity-builder';
import { RelationBuilder } from './relation-builder';
import type { EngramRelation } from './relation-builder';
import { VectorStore } from './vector-store';
import { Embedder } from './embedder';
import { loadEngramConfig } from './engram-config';
// CR-8: 类型定义已迁移到 engram-types.ts
export type {
  EngramRetrievalMode,
  EngramEmbeddingConfig,
  EngramRerankConfig,
  EngramTrimConfig,
  EngramConfig,
} from './engram-types';
export { DEFAULT_ENGRAM_CONFIG } from './engram-types';
import type {
  EngramConfig,
  EngramTrimConfig,
} from './engram-types';

/**
 * Engram 状态数据结构
 * 存储在状态树 "系统.扩展.engramMemory" 路径下。
 */
interface EngramStateData {
  events: EngramEventNode[];
  entities: EngramEntity[];
  relations: EngramRelation[];
  meta: {
    lastUpdated: number;
    eventCount: number;
    /** 向量化统计（供调试面板直接显示，避免每次重新计算） */
    embeddedEventCount: number;
    embeddedEntityCount: number;
    /** 数据格式版本 —— 用于 legacy migration 判断 */
    schemaVersion: number;
  };
}

/** 修剪后的数据集 */
interface PrunedData {
  events: EngramEventNode[];
  entities: EngramEntity[];
  relations: EngramRelation[];
}

/**
 * NPC 关系数组条目
 */
interface NpcRelationshipEntry {
  名称: string;
  类型?: string;
  [key: string]: unknown;
}

/** 当前 engramMemory schema 版本 —— 字段契约变化时递增 */
const CURRENT_SCHEMA_VERSION = 2;

export class EngramManager {
  private eventBuilder = new EventBuilder();
  private entityBuilder = new EntityBuilder();
  private relationBuilder = new RelationBuilder();
  private vectorStore: VectorStore;
  private embedder: Embedder;

  /** Engram 数据在状态树中的路径 */
  private readonly engramPath: string;
  /** 回合序号在状态树中的路径 */
  private readonly roundNumberPath: string;
  /** 社交关系在状态树中的路径 */
  private readonly relationshipsPath: string;
  /** 玩家名在状态树中的路径（2026-04-14 新增） */
  private readonly playerNamePath: string;
  /** 玩家当前位置路径（2026-04-14 新增） */
  private readonly playerLocationPath: string;
  /** 游戏时间对象路径（2026-04-14 新增） */
  private readonly gameTimePath: string;

  /**
   * 获取当前活跃存档的 profileId + slotId
   */
  private getActiveSlot: () => { profileId: string; slotId: string } | null;
  /** R-02: 当前飞行中的 vectorizeAsync */
  private _vectorizeAbort: AbortController | null = null;

  constructor(
    aiService: AIService,
    pathOverrides?: {
      engramMemory?: string;
      roundNumber?: string;
      relationships?: string;
      playerName?: string;
      playerLocation?: string;
      gameTime?: string;
    },
    getActiveSlot?: () => { profileId: string; slotId: string } | null,
  ) {
    this.engramPath = pathOverrides?.engramMemory ?? '系统.扩展.engramMemory';
    this.roundNumberPath = pathOverrides?.roundNumber ?? '元数据.回合序号';
    this.relationshipsPath = pathOverrides?.relationships ?? '社交.关系';
    this.playerNamePath = pathOverrides?.playerName ?? '角色.基础信息.姓名';
    this.playerLocationPath = pathOverrides?.playerLocation ?? '角色.基础信息.当前位置';
    this.gameTimePath = pathOverrides?.gameTime ?? '世界.时间';
    this.vectorStore = new VectorStore();
    this.embedder = new Embedder(aiService);
    this.getActiveSlot = getActiveSlot ?? (() => null);
  }

  isEnabled(): boolean {
    return loadEngramConfig().enabled;
  }

  getConfig(): EngramConfig {
    return loadEngramConfig();
  }

  /**
   * 将 IDB 向量数据同步到当前状态树中的 Engram 元数据
   * 用于 rollback 场景
   */
  async syncVectorsToState(stateManager: StateManager): Promise<void> {
    this._vectorizeAbort?.abort();
    this._vectorizeAbort = null;

    const slot = this.getActiveSlot();
    if (!slot?.profileId || !slot?.slotId) return;

    const engram = this.loadEngram(stateManager);
    const keptEventIds = new Set(engram.events.map((e) => e.id));
    const keptEntityNames = new Set(engram.entities.map((e) => e.name));

    await this.vectorStore.trimToMatchEvents(
      keptEventIds,
      keptEntityNames,
      slot.profileId,
      slot.slotId,
    );
  }

  /**
   * 处理 AI 响应 — Engram 的主入口
   */
  async processResponse(response: AIResponse, stateManager: StateManager): Promise<void> {
    const config = loadEngramConfig();
    if (!config.enabled) return;

    const currentRound = stateManager.get<number>(this.roundNumberPath) ?? 0;

    // ── Step 0: Legacy migration ──
    // 检测旧格式 events（缺 summary 或 structured_kv）→ 一次性清空
    const existing = this.loadEngram(stateManager);
    const isLegacy = this.isLegacyData(existing);
    const engram = isLegacy ? this.migrateLegacy(stateManager) : existing;

    // ── Step 1: 事件提取 ──
    const eventPaths = {
      playerName: this.playerNamePath,
      playerLocation: this.playerLocationPath,
      gameTime: this.gameTimePath,
    };
    const newEvents = this.eventBuilder.build(response, stateManager, currentRound, eventPaths);
    const allEvents: EngramEventNode[] = [...engram.events, ...newEvents];

    // ── Step 2: 实体构建（双源） ──
    const entityPaths = {
      playerName: this.playerNamePath,
      relationships: this.relationshipsPath,
    };
    const entities = this.entityBuilder.build(allEvents, stateManager, entityPaths);

    // ── Step 3: 关系构建（双源） ──
    const relationPaths = {
      playerName: this.playerNamePath,
      relationships: this.relationshipsPath,
    };
    const relations = this.relationBuilder.build(allEvents, entities, stateManager, relationPaths);

    // ── Step 4: 修剪（重点 NPC 过滤） ──
    const data: PrunedData = config.pruneToImportantNpcs
      ? this.pruneToImportant(allEvents, entities, relations, stateManager)
      : { events: allEvents, entities, relations };

    // ── Step 5: trim 策略 ──
    const trimmedEvents = this.trimEvents(data.events, config.trim);
    const trimmedEntities = data.entities.slice(-config.maxEntities);

    // 保留已有向量化状态（通过 name / id 合并）
    const preserveEmbedFlags = this.preserveEmbeddingFlags(
      trimmedEvents,
      trimmedEntities,
      engram,
    );

    const updatedEngram: EngramStateData = {
      events: preserveEmbedFlags.events,
      entities: preserveEmbedFlags.entities,
      relations: data.relations,
      meta: {
        lastUpdated: Date.now(),
        eventCount: preserveEmbedFlags.events.length,
        embeddedEventCount: preserveEmbedFlags.events.filter((e) => e.is_embedded).length,
        embeddedEntityCount: preserveEmbedFlags.entities.filter((e) => e.is_embedded).length,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
    };
    stateManager.set(this.engramPath, updatedEngram, 'system');

    // ── Step 6: 向量 trim 同步 ──
    const keptEventIds = new Set(preserveEmbedFlags.events.map((e) => e.id));
    const keptEntityNames = new Set(preserveEmbedFlags.entities.map((e) => e.name));
    const slot = this.getActiveSlot();
    if (slot?.profileId && slot?.slotId) {
      this.vectorStore
        .trimToMatchEvents(keptEventIds, keptEntityNames, slot.profileId, slot.slotId)
        .catch((err) => console.warn('[Engram] trimToMatchEvents failed (non-blocking):', err));
    }

    // ── Step 7: 异步向量化（events + entities 合批） ──
    // 触发条件：
    // - 有新事件
    // - OR 有未向量化的实体（例如刚从社交.关系新建的 NPC）
    const unembeddedEntities = preserveEmbedFlags.entities.filter((e) => !e.is_embedded);
    if (newEvents.length > 0 || unembeddedEntities.length > 0) {
      this.vectorizeAsync(newEvents, unembeddedEntities, stateManager).catch((err) =>
        console.warn('[Engram] Vectorization failed (non-blocking):', err),
      );
    }
  }

  // ─── Legacy migration（A8） ───

  /**
   * 检测旧版本 events —— 缺 `summary` 字段或 `structured_kv` 对象
   * 返回 true 表示需要清空 engramMemory 并重新开始（clean state）
   */
  private isLegacyData(engram: EngramStateData): boolean {
    if (!engram.events || engram.events.length === 0) return false;
    // 任意一条 event 缺 summary 或 structured_kv → 视为旧版本
    return engram.events.some(
      (e) => typeof (e as { summary?: unknown }).summary !== 'string'
        || typeof (e as { structured_kv?: unknown }).structured_kv !== 'object',
    );
  }

  /**
   * 清空 engramMemory + 对应的 IDB 向量数据，返回干净的空结构
   *
   * 用户确认过：可以直接清空老的 events 重置为 clean state（无需保留）。
   */
  private migrateLegacy(stateManager: StateManager): EngramStateData {
    console.info(
      '[Engram] Legacy data detected (events lack summary/structured_kv). ' +
      'Clearing engramMemory and vectors to clean state (2026-04-14 migration).',
    );
    const empty = this.createEmpty();
    stateManager.set(this.engramPath, empty, 'system');

    // 异步清空 IDB 向量（fire-and-forget，不阻塞 migration）
    const slot = this.getActiveSlot();
    if (slot?.profileId && slot?.slotId) {
      this.vectorStore
        .deleteForSlot(slot.profileId, slot.slotId)
        .catch((err) =>
          console.warn('[Engram] Failed to clear legacy vectors (non-blocking):', err),
        );
    }

    return empty;
  }

  /**
   * 保留已有事件/实体的 is_embedded 标记
   *
   * trim 后生成的新事件列表中，已存在于 prevEngram 且原本已向量化的，
   * 保持 is_embedded=true；新生成的事件/实体一律 false。
   */
  private preserveEmbeddingFlags(
    events: EngramEventNode[],
    entities: EngramEntity[],
    prev: EngramStateData,
  ): { events: EngramEventNode[]; entities: EngramEntity[] } {
    const prevEventMap = new Map(prev.events.map((e) => [e.id, e.is_embedded]));
    const prevEntityMap = new Map(prev.entities.map((e) => [e.name, e.is_embedded]));
    return {
      events: events.map((e) => ({ ...e, is_embedded: prevEventMap.get(e.id) ?? e.is_embedded })),
      entities: entities.map((e) => ({ ...e, is_embedded: prevEntityMap.get(e.name) ?? e.is_embedded })),
    };
  }

  /**
   * 完整 Trim 策略
   */
  private trimEvents(events: EngramEventNode[], config: EngramTrimConfig): EngramEventNode[] {
    const { trigger, tokenLimit, countLimit, keepRecent } = config;

    const recent = events.slice(-keepRecent);
    const older = events.slice(0, -keepRecent);

    if (trigger === 'count') {
      const budget = Math.max(0, countLimit - recent.length);
      return [...(budget > 0 ? older.slice(-budget) : []), ...recent];
    }

    const recentTokens = recent.reduce((sum, e) => sum + Math.ceil(e.text.length / 4), 0);
    let remaining = tokenLimit - recentTokens;

    const selected: EngramEventNode[] = [];
    for (let i = older.length - 1; i >= 0 && remaining > 0; i--) {
      const cost = Math.ceil(older[i].text.length / 4);
      if (cost <= remaining) {
        selected.unshift(older[i]);
        remaining -= cost;
      }
    }
    return [...selected, ...recent];
  }

  private loadEngram(stateManager: StateManager): EngramStateData {
    const raw = stateManager.get<Partial<EngramStateData>>(this.engramPath);
    if (raw && Array.isArray(raw.events)) {
      // 向后兼容：补齐 meta 字段（避免旧存档无 embeddedEventCount/embeddedEntityCount）
      return {
        events: raw.events,
        entities: Array.isArray(raw.entities) ? raw.entities : [],
        relations: Array.isArray(raw.relations) ? raw.relations : [],
        meta: {
          lastUpdated: raw.meta?.lastUpdated ?? 0,
          eventCount: raw.meta?.eventCount ?? raw.events.length,
          embeddedEventCount: raw.meta?.embeddedEventCount ?? 0,
          embeddedEntityCount: raw.meta?.embeddedEntityCount ?? 0,
          schemaVersion: raw.meta?.schemaVersion ?? 1,
        },
      };
    }
    return this.createEmpty();
  }

  /**
   * 异步向量化 events + entities（2026-04-14 重构：双路合批）
   *
   * 流程：
   * 1. 构造嵌入输入：
   *    - event: summary（burned 格式，含元数据）
   *    - entity: name + description
   * 2. 单次 embed() 调用（批量，利用缓存）
   * 3. 切片分发到 mergeEventVectors + mergeEntityVectors
   * 4. 回写状态树：把 events[i].is_embedded / entities[i].is_embedded 置 true
   * 5. abort signal 检查：rollback 场景下放弃回写
   */
  private async vectorizeAsync(
    newEvents: EngramEventNode[],
    unembeddedEntities: EngramEntity[],
    stateManager: StateManager,
  ): Promise<void> {
    const slot = this.getActiveSlot();
    if (!slot?.profileId || !slot?.slotId) return;
    const { profileId, slotId } = slot;

    this._vectorizeAbort?.abort();
    const ac = new AbortController();
    this._vectorizeAbort = ac;

    // 构造嵌入输入
    const eventInputs = newEvents.map((e) => {
      const summary = typeof e.summary === 'string' ? e.summary.trim() : '';
      return summary || e.text || JSON.stringify(e.structured_kv ?? {});
    });
    const entityInputs = unembeddedEntities.map((e) => {
      const name = e.name.trim();
      const desc = (e.description ?? '').trim();
      return desc ? `${name} ${desc}` : name;
    });

    // 合批调用
    const allInputs = [...eventInputs, ...entityInputs];
    if (allInputs.length === 0) {
      this._vectorizeAbort = null;
      return;
    }
    const vectors = await this.embedder.embed(allInputs);
    if (ac.signal.aborted) return;

    const model = loadEngramConfig().embeddingModel ?? 'unknown';
    const eventVectors = vectors.slice(0, eventInputs.length);
    const entityVectors = vectors.slice(eventInputs.length);

    // 持久化到 IDB
    if (newEvents.length > 0) {
      await this.vectorStore.mergeEventVectors(
        newEvents.map((e) => ({ id: e.id })),
        eventVectors,
        model,
        { profileId, slotId },
      );
    }
    if (unembeddedEntities.length > 0) {
      await this.vectorStore.mergeEntityVectors(
        unembeddedEntities.map((e) => ({ name: e.name })),
        entityVectors,
        model,
        { profileId, slotId },
      );
    }

    if (ac.signal.aborted) return;

    // ── 回写 is_embedded 标记到状态树 ──
    // 只标记有非空向量的条目
    const embeddedEventIds = new Set<string>();
    for (let i = 0; i < newEvents.length; i++) {
      if (eventVectors[i] && eventVectors[i].length > 0) {
        embeddedEventIds.add(newEvents[i].id);
      }
    }
    const embeddedEntityNames = new Set<string>();
    for (let i = 0; i < unembeddedEntities.length; i++) {
      if (entityVectors[i] && entityVectors[i].length > 0) {
        embeddedEntityNames.add(unembeddedEntities[i].name);
      }
    }

    // 读当前状态树的 engram，更新标记并回写（避免覆盖其他并发变更）
    const current = this.loadEngram(stateManager);
    let changed = false;
    const updatedEvents = current.events.map((e) => {
      if (embeddedEventIds.has(e.id) && !e.is_embedded) {
        changed = true;
        return { ...e, is_embedded: true };
      }
      return e;
    });
    const updatedEntities = current.entities.map((e) => {
      if (embeddedEntityNames.has(e.name) && !e.is_embedded) {
        changed = true;
        return { ...e, is_embedded: true };
      }
      return e;
    });
    if (changed) {
      const updated: EngramStateData = {
        ...current,
        events: updatedEvents,
        entities: updatedEntities,
        meta: {
          ...current.meta,
          embeddedEventCount: updatedEvents.filter((e) => e.is_embedded).length,
          embeddedEntityCount: updatedEntities.filter((e) => e.is_embedded).length,
          lastUpdated: Date.now(),
        },
      };
      stateManager.set(this.engramPath, updated, 'system');
    }

    this._vectorizeAbort = null;
  }

  /**
   * 修剪到重点 NPC 相关数据
   */
  private pruneToImportant(
    events: EngramEventNode[],
    entities: EngramEntity[],
    relations: EngramRelation[],
    stateManager: StateManager,
  ): PrunedData {
    const relationships = stateManager.get<NpcRelationshipEntry[]>(this.relationshipsPath) ?? [];
    const importantNames = new Set<string>();

    for (const npc of relationships) {
      const name = npc.名称;
      if (typeof name !== 'string' || !name) continue;
      if (npc.类型 === '重点' || !npc.类型) {
        importantNames.add(name);
      }
    }

    const playerName = stateManager.get<string>(this.playerNamePath) || '玩家';
    const isRelevant = (name: string): boolean =>
      importantNames.has(name) || name === playerName || name === '玩家' || name === 'player';

    return {
      events: events.filter((e) => {
        const kv = e.structured_kv;
        const rolesRelevant = kv && Array.isArray(kv.role)
          ? kv.role.some((r) => typeof r === 'string' && isRelevant(r))
          : false;
        return (
          !e.subject
          || isRelevant(e.subject)
          || (e.object !== undefined && isRelevant(e.object))
          || rolesRelevant
        );
      }),
      entities: entities.filter((e) => isRelevant(e.name) || e.type === 'location'),
      relations: relations.filter((r) => isRelevant(r.fromName) || isRelevant(r.toName)),
    };
  }

  private createEmpty(): EngramStateData {
    return {
      events: [],
      entities: [],
      relations: [],
      meta: {
        lastUpdated: 0,
        eventCount: 0,
        embeddedEventCount: 0,
        embeddedEntityCount: 0,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
    };
  }
}
