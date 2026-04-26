/**
 * Engram 配置类型定义 — 独立类型文件
 *
 * 从 engram-manager.ts 提取至此，以打破
 * engram-manager.ts ↔ engram-config.ts 的循环导入（CR-8 修复）。
 *
 * 其他文件（engram-config.ts / unified-retriever.ts / 设置 UI 等）
 * 应从本文件导入类型，不再直接依赖 engram-manager.ts 的类型导出。
 */

/** Engram 检索模式 */
export type EngramRetrievalMode = 'legacy' | 'hybrid';

/** Engram 向量检索配置 */
export interface EngramEmbeddingConfig {
  /** 是否启用向量相似度检索 */
  enabled: boolean;
  /** 向量检索返回的最大候选数量 */
  topK: number;
  /** 向量相似度最低阈值（低于此分数的结果丢弃） */
  minScore: number;
}

/** Engram 重排配置 */
export interface EngramRerankConfig {
  /** 是否启用 Rerank API（启用需要配置 FunctionType.RERANK 的 API） */
  enabled: boolean;
  /** Rerank 后保留的最大条目数 */
  topN: number;
}

/** Engram 修剪策略配置 */
export interface EngramTrimConfig {
  /**
   * 修剪触发方式
   * - 'count'：按事件数量上限修剪
   * - 'token'：按估算 token 数修剪（4字符≈1 token）
   */
  trigger: 'count' | 'token';
  /** token 触发模式下的 token 上限 */
  tokenLimit: number;
  /** count 触发模式下的事件数量上限（同时作为 maxEvents 的语义替代） */
  countLimit: number;
  /** 无论修剪多激进，始终保留最近 N 条事件 */
  keepRecent: number;
}

/**
 * Engram 子系统完整配置
 *
 * 设计原则：新增字段均提供合理默认值（通过 DEFAULT_ENGRAM_CONFIG），
 * 保证从旧版 config 对象升级时不会因缺字段而报错（配合 normalizeEngramConfig 使用）。
 */
export interface EngramConfig {
  /** 是否启用 Engram（关闭后完全跳过所有处理） */
  enabled: boolean;
  /**
   * 检索模式
   * - 'legacy'：仅使用传统关键词+时间衰减检索（memory-retriever）
   * - 'hybrid'：向量检索 + 图遍历 + 语义三元组 + NPC 位置规则（unified-retriever）
   */
  retrievalMode: EngramRetrievalMode;
  /** 向量检索配置（retrievalMode='hybrid' 时生效） */
  embedding: EngramEmbeddingConfig;
  /** Rerank 配置（需要独立的 FunctionType.RERANK API 分配） */
  rerank: EngramRerankConfig;
  /** 修剪策略 */
  trim: EngramTrimConfig;
  /**
   * 事件节点最大保留数量（count trigger 时与 trim.countLimit 同义）
   * @deprecated 请使用 trim.countLimit；本字段保留以兼容 E.2 之前的逻辑
   */
  maxEvents: number;
  /** 实体节点最大保留数量 */
  maxEntities: number;
  /** 是否只保留与重点 NPC 相关的数据（减少噪音） */
  pruneToImportantNpcs: boolean;
  /**
   * Embedding 提供商标识（对应 AIService 的 API 配置）
   * E.3 阶段接入 FunctionType.EMBEDDING 后此字段由 APIAssignment 管理。
   */
  embeddingProvider?: string;
  /** Embedding 模型名（用于检测模型变更时清空旧向量） */
  embeddingModel?: string;
  /** 是否开启 debug 模式（开启后 EngramDebugPanel 可见） */
  debug: boolean;
}

/**
 * Engram 默认配置
 *
 * 生产环境建议从此对象出发，通过 normalizeEngramConfig() 合并用户设置。
 * enabled 默认关闭，需要用户在 Settings → Engram 中显式开启。
 */
export const DEFAULT_ENGRAM_CONFIG: EngramConfig = {
  enabled: false,
  retrievalMode: 'hybrid',
  embedding: {
    enabled: true,
    topK: 20,
    minScore: 0.3,
  },
  rerank: {
    enabled: false,
    topN: 10,
  },
  trim: {
    trigger: 'count',
    tokenLimit: 6000,
    countLimit: 120,
    keepRecent: 20,
  },
  maxEvents: 120,
  maxEntities: 60,
  pruneToImportantNpcs: true,
  embeddingProvider: undefined,
  embeddingModel: undefined,
  debug: false,
};
