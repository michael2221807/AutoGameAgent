/**
 * TripleBuilder — 语义三元组的提取、验证、去重与合并
 *
 * 三元组 (subject, predicate, object) 是知识图谱的基本单元，
 * 由 AI 在每回合 response 的 semantic_memory.triples 字段中产出。
 *
 * 参照 ming: services/gameStateIndexer.ts → mergeInto扩展()
 *
 * 职责：
 * 1. 从 AI response 中提取 triples 数组
 * 2. 验证每条 triple 的结构完整性（subject/predicate/object 必须是非空字符串）
 * 3. 自动填充缺失的 timestamp（从游戏时间或系统时间）
 * 4. 去重：相同 (subject, predicate, object) 只保留最新的
 * 5. 追加到现有 triples 列表（APPEND 语义，不覆盖）
 * 6. 上限裁剪（超过 maxTriples 时删除最旧的）
 */
import type { StateManager } from '../../core/state-manager';

/** 语义三元组数据结构（状态树持久化格式） */
export interface SemanticTriple {
  /** 主语 — 例如 "李明阳" */
  subject: string;
  /** 谓语 — 例如 "是...的弟子" */
  predicate: string;
  /** 宾语 — 例如 "天剑门" */
  object: string;
  /** 时间戳 — 游戏内时间或 ISO 字符串 */
  timestamp?: string;
  /** 重要性 1-10, 默认 5 */
  importance?: number;
  /** 分类 — 关系/行动/地点/物品/状态 */
  category?: string;
}

/** 语义记忆容器结构（存储在 系统.扩展.语义记忆） */
export interface SemanticMemoryStore {
  triples: SemanticTriple[];
  meta?: {
    lastUpdated: number;
    tripleCount: number;
  };
}

/** 三元组存储路径 */
export const SEMANTIC_MEMORY_PATH = '系统.扩展.语义记忆';

/** 最大三元组数量（超过时 FIFO 淘汰最旧的） */
const DEFAULT_MAX_TRIPLES = 200;

export class TripleBuilder {
  /**
   * 从 AI response 的 semanticMemory 字段提取并合并三元组到状态树
   *
   * @param semanticMemory AI response 中的 semantic_memory 字段（可能含 triples）
   * @param stateManager 状态管理器
   * @param gameTimePath 游戏时间在状态树中的路径（用于自动填充 timestamp）
   * @param maxTriples 三元组上限
   * @returns 新增的三元组数量
   */
  merge(
    semanticMemory: Record<string, unknown> | undefined,
    stateManager: StateManager,
    gameTimePath: string,
    maxTriples = DEFAULT_MAX_TRIPLES,
  ): number {
    if (!semanticMemory) return 0;

    // 提取 triples 数组
    const rawTriples = semanticMemory.triples;
    if (!Array.isArray(rawTriples) || rawTriples.length === 0) return 0;

    // 验证并规范化
    const gameTime = this.formatGameTime(stateManager, gameTimePath);
    const validated = rawTriples
      .filter((t): t is Record<string, unknown> => t != null && typeof t === 'object')
      .map((t) => this.validateTriple(t, gameTime))
      .filter((t): t is SemanticTriple => t !== null);

    if (validated.length === 0) return 0;

    // 读取现有三元组
    const store = stateManager.get<SemanticMemoryStore>(SEMANTIC_MEMORY_PATH) ?? { triples: [] };
    const existing = Array.isArray(store.triples) ? store.triples : [];

    // 去重合并：以 (subject, predicate, object) 为 key，新的覆盖旧的
    const merged = this.deduplicateAndAppend(existing, validated);

    // 上限裁剪
    const trimmed = merged.length > maxTriples
      ? merged.slice(merged.length - maxTriples)
      : merged;

    // 写回状态树
    const updated: SemanticMemoryStore = {
      triples: trimmed,
      meta: {
        lastUpdated: Date.now(),
        tripleCount: trimmed.length,
      },
    };
    stateManager.set(SEMANTIC_MEMORY_PATH, updated, 'system');

    return validated.length;
  }

  /**
   * 验证并规范化单条三元组
   * subject/predicate/object 必须是非空字符串，否则返回 null
   */
  private validateTriple(raw: Record<string, unknown>, fallbackTime: string): SemanticTriple | null {
    const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
    const predicate = typeof raw.predicate === 'string' ? raw.predicate.trim() : '';
    const object = typeof raw.object === 'string' ? raw.object.trim() : '';

    if (!subject || !predicate || !object) return null;

    const importance = typeof raw.importance === 'number'
      ? Math.max(1, Math.min(10, Math.round(raw.importance)))
      : 5;

    const category = typeof raw.category === 'string' ? raw.category.trim() : undefined;
    const timestamp = typeof raw.timestamp === 'string' && raw.timestamp.trim()
      ? raw.timestamp.trim()
      : fallbackTime;

    return { subject, predicate, object, timestamp, importance, category };
  }

  /**
   * 去重合并：相同 (subject, predicate, object) 只保留更新的那条
   * 新三元组追加到尾部（时间排序）
   */
  private deduplicateAndAppend(
    existing: SemanticTriple[],
    incoming: SemanticTriple[],
  ): SemanticTriple[] {
    const keyOf = (t: SemanticTriple) =>
      `${t.subject.toLowerCase()}|${t.predicate.toLowerCase()}|${t.object.toLowerCase()}`;

    // 用 Map 保持插入顺序，先放旧的再放新的（新的覆盖旧的）
    const map = new Map<string, SemanticTriple>();
    for (const t of existing) {
      map.set(keyOf(t), t);
    }
    for (const t of incoming) {
      map.set(keyOf(t), t);
    }
    return [...map.values()];
  }

  /**
   * 从状态树的游戏时间对象格式化为可排序字符串
   */
  private formatGameTime(stateManager: StateManager, gameTimePath: string): string {
    const time = stateManager.get<Record<string, number>>(gameTimePath);
    if (!time || typeof time !== 'object') return new Date().toISOString();

    const y = time['年'] ?? 0;
    const m = time['月'] ?? 0;
    const d = time['日'] ?? 0;
    const h = time['小时'] ?? 0;
    const min = time['分钟'] ?? 0;

    if (!y && !m && !d) return new Date().toISOString();

    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}-${String(h).padStart(2, '0')}-${String(min).padStart(2, '0')}`;
  }
}
