/**
 * 指令执行器 — 接收 AI 返回的 Command 数组并在 StateManager 上执行
 *
 * 每次 AI 回复中的 commands 作为一个批次执行，
 * 生成统一的 BatchCommandResult（含变更日志和错误信息）。
 *
 * 对应 STEP-02 §3.3、STEP-03 M1.4。
 * 参照 demo: AIBidirectionalSystem 中的 TavernCommand 执行逻辑。
 *
 * 验证链（对齐 demo §24 四步验证）：
 * 1. 结构验证 — action/key 字段必须存在且合法
 * 2. 值清理 — NaN 转 0，字符串 trim
 * 3. 数值修复 — add/set 写入数值时，负值夹至 0，超过 MAX_NUMERIC_VALUE 夹至上限
 * 4. 数组容量限制 — push 时若已达 MAX_ARRAY_CAPACITY，先 pull 最旧元素
 *
 * §11.4 路径白名单（警告模式）：
 * 构造时可传入 pathRootWhitelist —— Game Pack state-schema 的顶层 properties 列表。
 * AI 生成的 command 如果写入的路径根段不在白名单，会触发一次性 console.warn，
 * 但**命令仍然执行**（warn-only）。这能让开发者发现 AI 产生的意外路径，
 * 收集数据后决定是否升级到严格拒绝模式。
 */
import type { Command, CommandResult, BatchCommandResult, ChangeLog } from '../types';
import type { StateManager } from './state-manager';
import { eventBus } from './event-bus';

/** 单字段数值写入的安全上限（防止 AI 生成极端值破坏 UI 渲染） */
const MAX_NUMERIC_VALUE = 999_999;

/** push 操作下，单个数组字段的最大容量（超出时自动淘汰最旧元素） */
const MAX_ARRAY_CAPACITY = 200;

export class CommandExecutor {
  /**
   * §11.4: 已警告过的未知路径根 — 避免同一 session 重复刷屏
   *
   * 每个 session 第一次遇到某个未知 root 时 console.warn 一次 + 发一个 toast，
   * 之后再遇到同名 root 保持静默（但命令仍执行）。用户刷新页面后重置。
   */
  private warnedUnknownRoots = new Set<string>();

  constructor(
    private stateManager: StateManager,
    /**
     * §11.4: 允许的路径根段白名单（Game Pack state-schema 顶层 properties 名列表）
     *
     * 例如天命 pack = `['元数据', '角色', '世界', '社交', 'NPC列表', '记忆', '系统']`
     *
     * 传入时：写入的 path 根段不在白名单 → 一次性 console.warn + toast，但**仍然执行**
     * 传入 null：禁用验证（测试或向后兼容）
     */
    private pathRootWhitelist: readonly string[] | null = null,
  ) {}

  /** 执行单条指令 — 返回执行结果 */
  execute(command: Command): CommandResult {
    // ── 步骤 1：结构验证 ──
    if (!command.action || !command.key) {
      return { success: false, command, error: 'Missing action or key' };
    }

    // ── §11.4: 路径根白名单校验（warn-only，不拒绝）──
    this.warnIfUnknownPathRoot(command.key);

    try {
      let change;

      switch (command.action) {
        case 'set': {
          const sanitized = sanitizeValue(command.value);
          const finalVal = typeof sanitized === 'number'
            ? clampNumber(sanitized)
            : sanitized;
          change = this.stateManager.set(command.key, finalVal, 'command');
          break;
        }

        case 'add': {
          // ── 步骤 2：值清理（NaN → 0） ──
          const raw = Number(command.value ?? 0);
          const numValue = Number.isNaN(raw) ? 0 : raw;
          // ── 步骤 3：数值修复（夹至合法范围） ──
          const clamped = clampNumber(numValue);
          change = this.stateManager.add(command.key, clamped, 'command');
          break;
        }

        case 'delete':
          change = this.stateManager.delete(command.key, 'command');
          break;

        case 'push': {
          // ── 步骤 4：数组容量限制 ──
          const arr = this.stateManager.get<unknown[]>(command.key);
          if (Array.isArray(arr) && arr.length >= MAX_ARRAY_CAPACITY) {
            this.stateManager.pull(command.key, arr[0], 'command');
          }
          change = this.stateManager.push(command.key, command.value, 'command');
          break;
        }

        case 'pull':
          change = this.stateManager.pull(command.key, command.value, 'command');
          break;

        default:
          return {
            success: false,
            command,
            error: `Unknown action: ${String(command.action)}`,
          };
      }

      return { success: true, command, change };
    } catch (err) {
      return { success: false, command, error: String(err) };
    }
  }

  /**
   * 批量执行指令 — 一次 AI 回复的所有 commands
   *
   * 当前实现为"尽力执行"：单条失败不影响后续指令。
   * 失败的指令会记录到 results 中并在 console 输出警告。
   */
  executeBatch(commands: Command[]): BatchCommandResult {
    const results: CommandResult[] = [];
    const changes: ChangeLog['changes'] = [];

    for (const cmd of commands) {
      const result = this.execute(cmd);
      results.push(result);
      // 只收集成功执行的变更
      if (result.change) {
        changes.push(result.change);
      }
    }

    const changeLog: ChangeLog = {
      changes,
      source: 'command',
      timestamp: Date.now(),
    };

    const hasErrors = results.some((r) => !r.success);

    if (hasErrors) {
      console.warn(
        '[CommandExecutor] Some commands failed:',
        results.filter((r) => !r.success),
      );
    }

    return { results, changeLog, hasErrors };
  }

  /**
   * §11.4: 提取 path 的根段并与白名单比对
   *
   * 根段定义：第一个 `.` 或 `[` 之前的字串。例如：
   * - `角色.基础信息.姓名` → `角色`
   * - `社交.关系[名称=李明阳].好感度` → `社交`
   * - `角色.效果[0].名称` → `角色`
   * - `世界.时间` → `世界`
   *
   * 不在白名单时 console.warn 一次 + emit ui:toast，但命令仍会执行。
   * 每个未知根段每 session 只告警一次（`warnedUnknownRoots` set dedup）。
   */
  private warnIfUnknownPathRoot(path: string): void {
    if (!this.pathRootWhitelist) return;

    // 找到第一个 '.' 或 '[' 的位置，取前面部分作为根段
    const firstDot = path.indexOf('.');
    const firstBracket = path.indexOf('[');
    let endIdx: number;
    if (firstDot === -1 && firstBracket === -1) {
      endIdx = path.length;
    } else if (firstDot === -1) {
      endIdx = firstBracket;
    } else if (firstBracket === -1) {
      endIdx = firstDot;
    } else {
      endIdx = Math.min(firstDot, firstBracket);
    }
    const root = path.slice(0, endIdx).trim();

    if (!root) return; // 路径以 '.' 或 '[' 开头是畸形的，让后续 state-manager 自己处理
    if (this.pathRootWhitelist.includes(root)) return;

    // 未知根段 — 每 session 每个根名只告警一次
    if (this.warnedUnknownRoots.has(root)) return;
    this.warnedUnknownRoots.add(root);

    const msg =
      `[CommandExecutor] AI 写入未知路径根段 "${root}"（完整路径: "${path}"）` +
      `。命令仍会执行，但可能污染状态树。若这是合法字段，请添加到 ` +
      `state-schema.json 的顶层 properties。本 session 内该根段不再重复告警。`;
    console.warn(msg);
    eventBus.emit('ui:toast', {
      type: 'warning',
      message: `AI 写入未知路径根段 "${root}" — 详见控制台`,
      duration: 3000,
    });
  }
}

// ─── Helpers ───

/** 将数值夹至 [0, MAX_NUMERIC_VALUE]（负值夹至 0，极端值夹至上限） */
function clampNumber(n: number): number {
  return Math.max(0, Math.min(MAX_NUMERIC_VALUE, n));
}

/**
 * 清理 AI 生成的值：
 * - 字符串 → trim
 * - NaN 数字 → 0
 * - 其他类型原样返回
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  return value;
}
