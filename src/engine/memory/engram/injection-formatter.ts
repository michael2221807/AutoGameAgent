/**
 * 注入格式化器 — 将检索结果格式化为 prompt 注入文本
 *
 * 在 UnifiedRetriever 检索完成后，InjectionFormatter 负责将
 * 原始检索结果转换为适合注入 AI prompt 的格式化文本块。
 *
 * 核心功能是"预算控制"—— AI prompt 的总 token 数有限，
 * Engram 记忆需要在有限的行数/字符预算内尽可能多地传递关键信息。
 *
 * 预算分配策略：
 * - 事件记忆 60%，实体概要 25%，关系概要 15%
 * - 每个部分内部按相关度分数排序
 * - 超出预算的内容被静默裁剪（优先丢弃低分内容）
 *
 * 对应 STEP-03B M3.6 Engram 数据流（InjectionFormatter 最终输出）。
 */

// ─── 类型定义 ───

/** 格式化输入 — 来自 UnifiedRetriever 的检索结果 */
export interface FormatterInput {
  /** 检索到的事件文本（已按相关度排序） */
  eventTexts: string[];
  /** 相关的实体概要 */
  entitySummaries: EntitySummary[];
  /** 相关的关系概要 */
  relationSummaries: RelationSummary[];
}

/** 实体概要（供格式化使用的简化视图） */
export interface EntitySummary {
  name: string;
  type: string;
  summary: string;
}

/** 关系概要（供格式化使用的简化视图） */
export interface RelationSummary {
  from: string;
  to: string;
  label: string;
}

/** 预算配置 */
export interface BudgetConfig {
  /** 总最大行数 */
  maxLines: number;
  /** 总最大字符数（如果设置，会在行数限制之外额外限制字符总数） */
  maxChars?: number;
  /** 事件记忆占比（默认 0.6） */
  eventRatio?: number;
  /** 实体概要占比（默认 0.25） */
  entityRatio?: number;
  /** 关系概要占比（默认 0.15） */
  relationRatio?: number;
}

export class InjectionFormatter {
  /**
   * 带预算控制的格式化
   *
   * 将检索结果格式化为 markdown 风格的文本块，各部分按预算分配行数。
   * 返回空字符串表示没有任何可用内容。
   *
   * @param input 检索结果（事件文本 + 实体/关系概要）
   * @param budget 预算配置
   * @returns 格式化后的 prompt 注入文本
   */
  formatWithBudget(input: FormatterInput, budget: BudgetConfig): string {
    const { maxLines, maxChars } = budget;

    // 计算各部分的行数预算
    const eventRatio = budget.eventRatio ?? 0.6;
    const entityRatio = budget.entityRatio ?? 0.25;
    const relationRatio = budget.relationRatio ?? 0.15;

    const eventBudget = Math.floor(maxLines * eventRatio);
    const entityBudget = Math.floor(maxLines * entityRatio);
    const relationBudget = Math.floor(maxLines * relationRatio);

    const sections: string[] = [];

    // 事件记忆（占预算最大比例，因为叙事细节对 AI 最有价值）
    const eventSection = this.formatEvents(input.eventTexts, eventBudget);
    if (eventSection) sections.push(eventSection);

    // 实体概要（提供"谁是谁"的上下文，帮助 AI 保持角色一致性）
    const entitySection = this.formatEntities(input.entitySummaries, entityBudget);
    if (entitySection) sections.push(entitySection);

    // 关系概要（提供"谁和谁有什么关系"的上下文）
    const relationSection = this.formatRelations(input.relationSummaries, relationBudget);
    if (relationSection) sections.push(relationSection);

    if (sections.length === 0) return '';

    let result = sections.join('\n\n');

    // 字符总数裁剪（粗略的安全网，主要依靠行数控制）
    if (maxChars && result.length > maxChars) {
      result = this.truncateToCharLimit(result, maxChars);
    }

    return result;
  }

  /**
   * 简单格式化 — 不做预算分配，直接将文本列表格式化
   *
   * 用于不需要精细预算控制的场景（如调试面板显示）。
   */
  formatSimple(texts: string[], maxLines: number): string {
    if (texts.length === 0) return '';

    return texts
      .slice(0, maxLines)
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n');
  }

  /**
   * 格式化事件记忆部分
   *
   * 使用编号列表，方便 AI 在生成时引用具体条目。
   * 标题使用 markdown H4（避免与记忆系统的 H3 层级冲突）。
   */
  private formatEvents(texts: string[], maxLines: number): string {
    if (texts.length === 0 || maxLines <= 0) return '';

    // 预留 1 行给标题
    const contentLines = Math.max(0, maxLines - 1);
    const items = texts.slice(0, contentLines);

    if (items.length === 0) return '';

    const lines = items.map((t, i) => `${i + 1}. ${t}`);
    return `#### 相关事件记忆\n${lines.join('\n')}`;
  }

  /**
   * 格式化实体概要部分
   *
   * 每个实体一行：名字（类型）— 描述。
   * 简洁优先，因为实体信息主要是给 AI 一个"人物表"参考。
   */
  private formatEntities(summaries: EntitySummary[], maxLines: number): string {
    if (summaries.length === 0 || maxLines <= 0) return '';

    const contentLines = Math.max(0, maxLines - 1);
    const items = summaries.slice(0, contentLines);

    if (items.length === 0) return '';

    const lines = items.map(
      (e) => `- **${e.name}**（${e.type}）${e.summary ? `— ${e.summary}` : ''}`,
    );
    return `#### 相关角色/实体\n${lines.join('\n')}`;
  }

  /**
   * 格式化关系概要部分
   *
   * 每条关系一行：A → B：关系描述。
   * 使用箭头表示有向关系，直观且 token 开销小。
   */
  private formatRelations(summaries: RelationSummary[], maxLines: number): string {
    if (summaries.length === 0 || maxLines <= 0) return '';

    const contentLines = Math.max(0, maxLines - 1);
    const items = summaries.slice(0, contentLines);

    if (items.length === 0) return '';

    const lines = items.map((r) => `- ${r.from} → ${r.to}：${r.label}`);
    return `#### 关系网络\n${lines.join('\n')}`;
  }

  /**
   * 字符级裁剪 — 在最近的换行符处截断
   *
   * 不在字符中间截断（避免 UTF-8 破损和语义不完整），
   * 而是找到不超过 maxChars 的最后一个换行符位置。
   */
  private truncateToCharLimit(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    // 在 maxChars 范围内找最后一个换行符
    const truncated = text.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');

    if (lastNewline > 0) {
      return truncated.slice(0, lastNewline) + '\n...（记忆内容已截断）';
    }

    return truncated + '...';
  }
}
