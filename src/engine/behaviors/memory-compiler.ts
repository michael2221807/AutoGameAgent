/**
 * 记忆编译模块 — 将结构化记忆数据编译为 prompt 可注入的文本变量
 *
 * 设计背景：
 * MemoryManager 以结构化格式（数组、对象）存储记忆数据，
 * 但 prompt 模板需要的是自然语言文本。
 * 本模块在 onContextAssembly 阶段将记忆数据"编译"为文本变量：
 *
 * 输出变量（注入到 prompt 模板变量字典）：
 * - SHORT_TERM_MEMORY: 近期事件摘要（按轮次排列）
 * - MID_TERM_MEMORY:   半持久化的重要记忆条目
 * - LONG_TERM_MEMORY:  永久记忆（角色背景、重要里程碑）
 * - MEMORY_SUMMARY:    三层记忆的整合摘要（给 AI 的快速上下文）
 *
 * 对应 STEP-02 §3.10.8。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { MemoryManager, ShortTermEntry, MidTermEntry, LongTermEntry } from '../memory/memory-manager';

export class MemoryCompilerModule implements BehaviorModule {
  readonly id = 'memory-compiler';

  constructor(private memoryManager: MemoryManager) {}

  /**
   * onContextAssembly 钩子 — 将记忆编译为 prompt 模板变量
   *
   * 在其他模块（如 content-filter）之前注入变量，
   * 使得后续模块可以对记忆文本做进一步处理。
   */
  onContextAssembly(_stateManager: StateManager, variables: Record<string, string>): void {
    const shortTerm = this.memoryManager.getShortTermEntries();
    const midTerm = this.memoryManager.getMidTermEntries();
    const longTerm = this.memoryManager.getLongTermEntries();

    variables['SHORT_TERM_MEMORY'] = this.compileShortTerm(shortTerm);
    variables['MID_TERM_MEMORY'] = this.compileMidTerm(midTerm);
    variables['LONG_TERM_MEMORY'] = this.compileLongTerm(longTerm);
    variables['MEMORY_SUMMARY'] = this.compileSummary(shortTerm, midTerm, longTerm);
  }

  /**
   * 编译短期记忆 — 按轮次倒序排列（最近的在最前面）
   *
   * 格式：
   * [第N回合] 摘要内容
   * [第N-1回合] 摘要内容
   */
  private compileShortTerm(entries: ShortTermEntry[]): string {
    if (entries.length === 0) return '';

    return [...entries]
      .sort((a, b) => b.round - a.round)
      .map((e) => `[第${e.round}回合] ${e.summary}`)
      .join('\n');
  }

  /**
   * 编译中期记忆 — 按时间顺序排列，包含相关角色信息
   *
   * 格式：
   * - [游戏时间] (涉及角色: A, B) 记忆内容
   */
  private compileMidTerm(entries: MidTermEntry[]): string {
    if (entries.length === 0) return '';

    // 2026-04-11 重构：MidTermEntry 字段改为中文（相关角色/事件时间/记忆主体 + 可选 已精炼）
    return entries
      .map((e) => {
        const refinedTag = e.已精炼 ? '[已精炼] ' : '';
        const chars =
          Array.isArray(e.相关角色) && e.相关角色.length > 0
            ? ` (涉及角色: ${e.相关角色.join('、')})`
            : '';
        const time = e.事件时间 && e.事件时间.trim() ? `[${e.事件时间.trim()}]` : '';
        return `- ${refinedTag}${time}${chars} ${e.记忆主体 ?? ''}`;
      })
      .join('\n');
  }

  /**
   * 编译长期记忆 — 按类别分组展示
   *
   * 格式：
   * 【类别名】
   * - 记忆内容
   */
  private compileLongTerm(entries: LongTermEntry[]): string {
    if (entries.length === 0) return '';

    // 按类别分组
    const grouped = new Map<string, string[]>();
    for (const e of entries) {
      const list = grouped.get(e.category);
      if (list) {
        list.push(e.content);
      } else {
        grouped.set(e.category, [e.content]);
      }
    }

    const sections: string[] = [];
    for (const [category, contents] of grouped) {
      sections.push(`【${category}】\n${contents.map((c) => `- ${c}`).join('\n')}`);
    }
    return sections.join('\n\n');
  }

  /**
   * 编译整合摘要 — 三层记忆的统计信息
   *
   * 提供给 AI 一个快速概览，让它知道有多少记忆可用
   */
  private compileSummary(
    shortTerm: ShortTermEntry[],
    midTerm: MidTermEntry[],
    longTerm: LongTermEntry[],
  ): string {
    const parts: string[] = [];

    if (shortTerm.length > 0) {
      const latestRound = Math.max(...shortTerm.map((e) => e.round));
      parts.push(`近期记忆: ${shortTerm.length}条 (最近: 第${latestRound}回合)`);
    }
    if (midTerm.length > 0) {
      parts.push(`中期记忆: ${midTerm.length}条`);
    }
    if (longTerm.length > 0) {
      const categories = [...new Set(longTerm.map((e) => e.category))];
      parts.push(`长期记忆: ${longTerm.length}条 (${categories.join(', ')})`);
    }

    return parts.length > 0 ? parts.join(' | ') : '无历史记忆';
  }
}
