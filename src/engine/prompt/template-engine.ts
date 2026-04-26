/**
 * 模板引擎 — 将 {{VAR}} 占位符替换为实际值
 *
 * Prompt 模板中可使用 {{变量名}} 语法引用运行时变量。
 * 引擎在组装 prompt 时通过此模块注入实际值。
 *
 * 示例：
 *   模板: "当前时间为 {{GAME_TIME}}，{{PLAYER_NAME}} 位于 {{LOCATION}}"
 *   变量: { GAME_TIME: "第三年春", PLAYER_NAME: "李白", LOCATION: "长安" }
 *   结果: "当前时间为 第三年春，李白 位于 长安"
 *
 * 对应 STEP-03B M2.6 template-engine.ts。
 * 参照 demo: promptAssembler.ts 中的 {{CUSTOM_ACTION_PROMPT}} 替换逻辑。
 */

export class TemplateEngine {
  /**
   * 渲染模板 — 替换所有 {{VAR}} 占位符
   *
   * 规则：
   * - 匹配 {{word_chars}} 格式的占位符
   * - 变量名支持字母、数字、下划线
   * - 未找到对应变量时保留原占位符（不替换）
   * - 变量值为空字符串时替换为空（与"未找到"行为不同）
   */
  render(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return key in variables ? variables[key] : match;
    });
  }
}
