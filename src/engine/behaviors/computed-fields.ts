/**
 * 计算字段模块 — 从其他状态字段自动计算派生值
 *
 * 许多游戏数值是由基础属性推导出来的（如"攻击力 = 力量 * 2 + 武器加成"），
 * 与其让 AI 每次都手动计算（容易出错），不如引擎自动维护这些派生值。
 *
 * Game Pack 通过 ComputedFieldConfig[] 声明计算规则：
 * - target: 结果写入的 dot-path
 * - formula: 计算公式字符串
 * - trigger: 触发时机（onCreation / onRoundEnd / onLoad）
 *
 * 公式语言（简单表达式求值器）：
 * - 操作数：数字字面量 或 dot-path 引用（从状态树读值）
 * - 运算符：+, -, *, /
 * - 内置函数：min(a,b), max(a,b), get(path)
 * - 求值顺序：先乘除后加减，支持括号
 *
 * 示例公式：
 *   "get(角色.属性.力量) * 2 + get(角色.装备.武器.攻击力)"
 *   "max(0, get(角色.属性.体力.当前) - 10)"
 *
 * 对应 STEP-02 §3.10.5。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { ComputedFieldConfig } from '../types';

export class ComputedFieldsModule implements BehaviorModule {
  readonly id = 'computed-fields';

  constructor(private configs: ComputedFieldConfig[]) {}

  onCreation(stateManager: StateManager): void {
    this.evaluate(stateManager, 'onCreation');
  }

  onRoundEnd(stateManager: StateManager): void {
    this.evaluate(stateManager, 'onRoundEnd');
  }

  onGameLoad(stateManager: StateManager): void {
    this.evaluate(stateManager, 'onLoad');
  }

  /** 执行指定触发时机的所有计算字段 */
  private evaluate(stateManager: StateManager, trigger: ComputedFieldConfig['trigger']): void {
    const configs = this.configs.filter((c) => c.trigger === trigger);
    for (const config of configs) {
      try {
        const result = this.evaluateFormula(config.formula, stateManager);
        stateManager.set(config.target, result, 'system');
      } catch (err) {
        console.error(
          `[ComputedFields] Error evaluating "${config.formula}" → "${config.target}":`,
          err,
        );
      }
    }
  }

  /**
   * 公式求值器 — 将公式字符串解析并计算为数值
   *
   * 实现方式：递归下降解析器（手写，不使用 eval）
   * 语法：
   *   expr     = term (('+' | '-') term)*
   *   term     = factor (('*' | '/') factor)*
   *   factor   = NUMBER | funcCall | '(' expr ')' | '-' factor
   *   funcCall = ('get' | 'min' | 'max') '(' args ')'
   *
   * 使用 eval() 会带来安全风险（Game Pack 是用户创建的数据包），
   * 所以用受限的手写解析器替代。
   */
  evaluateFormula(formula: string, stateManager: StateManager): number {
    const tokens = this.tokenize(formula);
    const ctx: ParseContext = { tokens, pos: 0, stateManager };
    const result = this.parseExpr(ctx);
    return result;
  }

  // ─── 词法分析 ───

  /**
   * 将公式字符串拆分为 token 数组
   *
   * Token 类型：
   * - 数字（含小数点和负号开头）
   * - 标识符（函数名或 dot-path，如 "get", "min", "角色.属性.力量"）
   * - 运算符（+, -, *, /）
   * - 括号和逗号
   */
  private tokenize(formula: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < formula.length) {
      const ch = formula[i];

      // 跳过空白
      if (/\s/.test(ch)) { i++; continue; }

      // 数字字面量
      if (/\d/.test(ch) || (ch === '.' && i + 1 < formula.length && /\d/.test(formula[i + 1]))) {
        let num = '';
        while (i < formula.length && (/\d/.test(formula[i]) || formula[i] === '.')) {
          num += formula[i++];
        }
        tokens.push(num);
        continue;
      }

      // 标识符（函数名或 dot-path）— 支持字母、数字、下划线、点号、中文
      if (/[\w\u4e00-\u9fff]/.test(ch)) {
        let id = '';
        while (i < formula.length && /[\w\u4e00-\u9fff.]/.test(formula[i])) {
          id += formula[i++];
        }
        tokens.push(id);
        continue;
      }

      // 单字符 token：运算符、括号、逗号
      tokens.push(ch);
      i++;
    }
    return tokens;
  }

  // ─── 语法分析（递归下降） ───

  /** 解析加减表达式 */
  private parseExpr(ctx: ParseContext): number {
    let left = this.parseTerm(ctx);
    while (ctx.pos < ctx.tokens.length) {
      const op = ctx.tokens[ctx.pos];
      if (op !== '+' && op !== '-') break;
      ctx.pos++;
      const right = this.parseTerm(ctx);
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  /** 解析乘除表达式 */
  private parseTerm(ctx: ParseContext): number {
    let left = this.parseFactor(ctx);
    while (ctx.pos < ctx.tokens.length) {
      const op = ctx.tokens[ctx.pos];
      if (op !== '*' && op !== '/') break;
      ctx.pos++;
      const right = this.parseFactor(ctx);
      if (op === '*') {
        left *= right;
      } else {
        left = right === 0 ? 0 : left / right;
      }
    }
    return left;
  }

  /** 解析因子：数字、函数调用、括号表达式、一元负号 */
  private parseFactor(ctx: ParseContext): number {
    const token = ctx.tokens[ctx.pos];
    if (token === undefined) throw new Error('Unexpected end of formula');

    // 一元负号
    if (token === '-') {
      ctx.pos++;
      return -this.parseFactor(ctx);
    }

    // 括号表达式
    if (token === '(') {
      ctx.pos++;
      const val = this.parseExpr(ctx);
      this.expect(ctx, ')');
      return val;
    }

    // 内置函数
    if (token === 'get' || token === 'min' || token === 'max') {
      return this.parseFuncCall(ctx);
    }

    // 数字字面量
    const num = Number(token);
    if (!Number.isNaN(num)) {
      ctx.pos++;
      return num;
    }

    // 未知 token — 尝试作为 dot-path 直接读取（无 get() 包裹的简写）
    ctx.pos++;
    const raw = ctx.stateManager.get<unknown>(token);
    const resolved = Number(raw);
    return Number.isNaN(resolved) ? 0 : resolved;
  }

  /** 解析函数调用 */
  private parseFuncCall(ctx: ParseContext): number {
    const funcName = ctx.tokens[ctx.pos];
    ctx.pos++;
    this.expect(ctx, '(');

    switch (funcName) {
      case 'get': {
        // get(dot.path) — 从状态树读取数值
        const path = ctx.tokens[ctx.pos];
        if (!path || '+-*/(),'.includes(path)) {
          throw new Error(
            `Invalid get() argument: expected a dot-path, got "${path ?? 'EOF'}"`,
          );
        }
        ctx.pos++;
        this.expect(ctx, ')');
        const raw = ctx.stateManager.get<unknown>(path);
        const num = Number(raw);
        return Number.isNaN(num) ? 0 : num;
      }
      case 'min': {
        const a = this.parseExpr(ctx);
        this.expect(ctx, ',');
        const b = this.parseExpr(ctx);
        this.expect(ctx, ')');
        return Math.min(a, b);
      }
      case 'max': {
        const a = this.parseExpr(ctx);
        this.expect(ctx, ',');
        const b = this.parseExpr(ctx);
        this.expect(ctx, ')');
        return Math.max(a, b);
      }
      default:
        throw new Error(`Unknown function: ${funcName}`);
    }
  }

  /** 期望下一个 token 为指定值，否则抛出错误 */
  private expect(ctx: ParseContext, expected: string): void {
    const actual = ctx.tokens[ctx.pos];
    if (actual !== expected) {
      throw new Error(`Expected "${expected}" but got "${actual ?? 'EOF'}" at position ${ctx.pos}`);
    }
    ctx.pos++;
  }
}

/** 解析上下文 — 在递归调用间传递的可变状态 */
interface ParseContext {
  tokens: string[];
  pos: number;
  stateManager: StateManager;
}
