/**
 * 内容过滤模块 — 根据用户的内容评级设置过滤 prompt 变量
 *
 * 设计目的：
 * 允许 Game Pack 定义分级内容（如暴力、色情等），
 * 当用户关闭某个评级时，本模块在上下文组装阶段
 * 从 prompt 模板变量中移除对应的内容标签。
 *
 * ⚠️ 与 NSFW 系统的关系（CR-R9，2026-04-11）：
 * ------------------------------------------------
 * 本模块对 tianming pack 的 NSFW 评级（`[私密]...[/私密]`）**实际上是 no-op**。
 * 原因：
 *   1. tianming pack 未在 contentFilter.contentRatings 中声明 nsfw 评级
 *   2. 即使声明了，NSFW 的 tag 剥离也是在 ContextAssemblyStage 里直接对
 *      `messages[].content` 做（`stripTagFromMessages(messages, NSFW_STRIP_TAG)`），
 *      而不是对 `variables` 字典做 —— 因为 `[私密]` tag 出现在 PromptAssembler 模板
 *      render 之后的 message 内容里，不在 variables 里
 *   3. ContentFilterModule 的 `onContextAssembly(stateManager, variables)` 签名
 *      只能触及 variables，无法触及 messages
 *
 * 保留本模块的意义：
 *   - 为**其他评级**（暴力 / 血腥 / 恐怖等）提供 variables 级别的剥离能力
 *     （这些 tag 通常注入为模板变量，不经过二次 render）
 *   - 为 pack 作者提供声明式的评级开关机制
 *   - NSFW 走独立路径是 special case，其他评级仍然用本模块
 *
 * ContextFilter vs SnapshotSanitizer vs stripTagFromMessages 的分工：
 *   - ContentFilter（本模块）: variables 字典层的 tag 剥离（非 NSFW 评级）
 *   - snapshot-sanitizer.stringifySnapshotForPrompt(): 状态树 JSON 快照的
 *     NSFW 字段剥离（`社交.关系.*.私密信息` / `角色.身体`）
 *   - snapshot-sanitizer.stripTagFromMessages(): 组装完的 messages 里的
 *     `[私密]...[/私密]` tag 剥离
 * 三者各司其职，不会重复工作。
 *
 * 工作原理：
 * 1. Game Pack 在 ContentFilterConfig 中声明每个评级的控制开关路径和标签列表
 * 2. 在 onContextAssembly 钩子中：
 *    a. 检查每个评级的开关状态（从状态树读取）
 *    b. 如果评级关闭，遍历所有 prompt 变量，移除包含该评级标签的文本片段
 *
 * 标签格式约定：
 * Prompt 模板中用 [TAG_NAME] 和 [/TAG_NAME] 包裹分级内容，
 * 如 [VIOLENCE]这段描述包含暴力内容[/VIOLENCE]
 * 评级关闭时整段内容（含标签本身）被移除。
 *
 * 配置示例（ContentFilterConfig）：
 * {
 *   "contentRatings": {
 *     "violence": {
 *       "settingPath": "设置.内容.暴力",
 *       "promptStripTags": ["VIOLENCE", "GORE"],
 *       "conditionalSchemaFields": ["角色.描述.战斗外貌"]
 *     }
 *   }
 * }
 *
 * 对应 STEP-02 §3.10.7。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { ContentFilterConfig } from '../types';

export class ContentFilterModule implements BehaviorModule {
  readonly id = 'content-filter';

  constructor(private config: ContentFilterConfig) {}

  /**
   * onContextAssembly 钩子 — 在 prompt 变量注入前过滤受限内容
   *
   * 遍历每个内容评级，检查其开关状态。
   * 评级关闭时，对所有 prompt 变量执行标签剥离。
   */
  onContextAssembly(stateManager: StateManager, variables: Record<string, string>): void {
    for (const [ratingId, ratingConfig] of Object.entries(this.config.contentRatings)) {
      const isEnabled = Boolean(stateManager.get<unknown>(ratingConfig.settingPath));

      if (isEnabled) continue;

      // 评级关闭 — 从所有 prompt 变量中移除对应标签内容
      for (const tag of ratingConfig.promptStripTags) {
        this.stripTagFromVariables(variables, tag);
      }

      // 将受限的 schema 字段值替换为空（阻止其出现在 prompt 中）
      for (const fieldPath of ratingConfig.conditionalSchemaFields) {
        const varKey = this.pathToVariableKey(fieldPath);
        if (varKey in variables) {
          variables[varKey] = '';
        }
      }

      console.log(`[ContentFilter] Rating "${ratingId}" is OFF — stripped tags: ${ratingConfig.promptStripTags.join(', ')}`);
    }
  }

  /**
   * 从所有变量值中移除指定标签及其包裹的内容
   *
   * 标签匹配规则：
   * - 自闭合标签：[TAG] ... [/TAG]（含换行，使用 non-greedy 匹配）
   * - 大小写不敏感（AI 可能生成大小写不一致的标签）
   * - 移除后清理多余的空行
   */
  private stripTagFromVariables(variables: Record<string, string>, tag: string): void {
    // 构建匹配模式：[TAG]内容[/TAG]，支持跨行
    const pattern = new RegExp(
      `\\[${this.escapeRegex(tag)}\\][\\s\\S]*?\\[\\/${this.escapeRegex(tag)}\\]`,
      'gi',
    );

    for (const key of Object.keys(variables)) {
      if (!variables[key]) continue;
      const before = variables[key];
      const after = before.replace(pattern, '');

      if (after !== before) {
        // 清理移除标签后可能产生的连续空行
        variables[key] = after.replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  }

  /**
   * 将 dot-path 转换为模板变量名
   *
   * 约定：模板变量使用下划线分隔的大写格式
   * 如 "角色.描述.外貌详细" → "角色_描述_外貌详细"
   */
  private pathToVariableKey(path: string): string {
    return path.replace(/\./g, '_');
  }

  /** 转义正则表达式特殊字符 */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
