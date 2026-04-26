/**
 * PayloadApplier — 把 ValidatedPatch[] 翻译为 Command[] 并通过 CommandExecutor 执行
 *
 * 翻译表（6 op → CommandAction）：
 *   set-field      → set
 *   append-item    → push
 *   insert-item    → set（读整数组 → 按 position 构造新数组 → set 写回）
 *   replace-item   → pull(by match) + push(value)（2 步原子事务）
 *   remove-item    → pull(by match)
 *   replace-array  → set(target, [])  + push(item) × N
 *
 * insert-item 说明：
 * - 不能用 push（push 只能追加尾部）
 * - 没有直接的"splice at index" command，所以实际走"读 + 本地 splice + 整数组 set"
 * - before/after 的 match 找不到时 fallback 到末尾（validator 已 warn）
 *
 * 注意：
 * - 翻译前**必须**已通过 PayloadValidator.validate 且无 error
 *   （Phase 4 service 层强制此约束，不在此重复 enforce）
 * - 翻译后用 CommandExecutor.executeBatch 一次性执行（保留 changeLog 给 audit）
 * - 注入前快照由 AssistantService 在更高一层捕获（PayloadApplier 不管 snapshot）
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §5.3.1 + Phase 3。
 */
import type { Command, CommandAction } from '../../types';
import type { CommandExecutor } from '../../core/command-executor';
import type { StateManager } from '../../core/state-manager';
import type { ValidatedPatch, AssistantPatch, PatchMatchSpec, InsertPosition } from './types';
import { normalizeStatePath } from './assistant-blocklist';

export interface PayloadApplierDeps {
  stateManager: StateManager;
  commandExecutor: CommandExecutor;
}

export interface ApplyResult {
  ok: boolean;
  /** 翻译出的 command 数 */
  commandCount: number;
  /** 失败时的简要消息 */
  error?: string;
}

export class PayloadApplier {
  constructor(private deps: PayloadApplierDeps) {}

  /**
   * 翻译 + 执行
   *
   * @returns ok=true 当所有 command 成功；ok=false 当 executeBatch 报告 hasErrors
   *
   * 注意：CommandExecutor 是"尽力执行"模式（单条失败不阻断后续），所以 ok=false
   * 不等于"全部失败"，可能是部分失败 —— 调用方应该结合 snapshot 决定回滚。
   */
  apply(patches: ValidatedPatch[]): ApplyResult {
    const commands = this.translateAll(patches);
    if (commands.length === 0) {
      return { ok: true, commandCount: 0 };
    }
    const result = this.deps.commandExecutor.executeBatch(commands);
    return {
      ok: !result.hasErrors,
      commandCount: commands.length,
      error: result.hasErrors
        ? `${result.results.filter((r) => !r.success).length} 条 command 执行失败`
        : undefined,
    };
  }

  /** 翻译多个 patch（按数组顺序，扁平化为 Command[]） */
  translateAll(patches: AssistantPatch[]): Command[] {
    const out: Command[] = [];
    for (const p of patches) {
      out.push(...this.translateOne(p));
    }
    return out;
  }

  /**
   * 单个 patch → 一组 Command
   *
   * 翻译规则见文件头。`replace-item` 和 `replace-array` 会拆成多步。
   */
  translateOne(p: AssistantPatch): Command[] {
    const target = normalizeStatePath(p.target);

    switch (p.op) {
      case 'set-field':
        return [{ action: 'set' as CommandAction, key: target, value: p.value }];

      case 'append-item':
        return [{ action: 'push' as CommandAction, key: target, value: p.value }];

      case 'insert-item': {
        if (!p.position) return []; // validator 已 error，防御
        return this.translateInsertItem(target, p.position, p.value);
      }

      case 'remove-item': {
        const match = p.match;
        if (!match) return [];
        const matchedItem = this.findArrayItem(target, match);
        if (matchedItem === null) {
          // referential warn 已在 validator 提示，这里 no-op
          return [];
        }
        return [{ action: 'pull' as CommandAction, key: target, value: matchedItem }];
      }

      case 'replace-item': {
        const match = p.match;
        if (!match) return [];
        const matchedItem = this.findArrayItem(target, match);
        if (matchedItem === null) {
          // 找不到原项 —— 退化为单纯 append（保险起见）
          return [{ action: 'push' as CommandAction, key: target, value: p.value }];
        }
        return [
          { action: 'pull' as CommandAction, key: target, value: matchedItem },
          { action: 'push' as CommandAction, key: target, value: p.value },
        ];
      }

      case 'replace-array': {
        if (!Array.isArray(p.value)) return [];
        const cmds: Command[] = [
          { action: 'set' as CommandAction, key: target, value: [] },
        ];
        for (const item of p.value) {
          cmds.push({ action: 'push' as CommandAction, key: target, value: item });
        }
        return cmds;
      }

      default:
        return [];
    }
  }

  // ─── 内部：从状态树找匹配项 ────────────────────────────

  /**
   * 在 target 数组中按 match.by/match.value 找匹配的对象
   *
   * 返回找到的**深拷贝**（避免与 stateManager 内部 reactive 共享引用），
   * 用于后续 pull command。找不到返回 null。
   */
  private findArrayItem(target: string, match: PatchMatchSpec): unknown | null {
    const arr = this.deps.stateManager.get<unknown[]>(target);
    if (!Array.isArray(arr)) return null;
    const found = arr.find((item) => {
      if (item && typeof item === 'object') {
        return (item as Record<string, unknown>)[match.by] === match.value;
      }
      return false;
    });
    if (!found) return null;
    return JSON.parse(JSON.stringify(found));
  }

  /**
   * 翻译 insert-item → 单个 `set` command（整数组回写）
   *
   * 流程：
   * 1. 从 stateManager 读当前数组（若不是数组，fallback 为空数组；validator 已 warn）
   * 2. deep-clone（切断 reactive 引用）
   * 3. 按 position 找插入点：
   *    - `at: 'start'` → index 0
   *    - `at: 'end'` → 数组长度
   *    - `before: match` → match 项的 index（找不到 fallback 到末尾）
   *    - `after: match` → match 项的 index + 1（找不到 fallback 到末尾）
   * 4. splice 插入新值
   * 5. 生成单条 set command 回写整数组
   *
   * 注意：整数组重写**不会**污染其他 item —— 我们基于当前状态深拷贝后只做 splice，
   * 不让 AI 自由重写每个 item 的字段（与 replace-array 的本质区别）。
   */
  private translateInsertItem(target: string, position: InsertPosition, value: unknown): Command[] {
    const current = this.deps.stateManager.get<unknown[]>(target);
    const arr = Array.isArray(current)
      ? JSON.parse(JSON.stringify(current)) as unknown[]
      : [];

    const insertIdx = this.resolveInsertIndex(arr, position);
    arr.splice(insertIdx, 0, value);

    return [{ action: 'set' as CommandAction, key: target, value: arr }];
  }

  /** 计算 insert-item 在数组中的目标下标（找不到匹配时 fallback 到末尾） */
  private resolveInsertIndex(arr: unknown[], position: InsertPosition): number {
    if ('at' in position) {
      return position.at === 'start' ? 0 : arr.length;
    }
    const matchSpec = 'before' in position ? position.before : position.after;
    const matchedIdx = arr.findIndex((item) =>
      item && typeof item === 'object'
      && (item as Record<string, unknown>)[matchSpec.by] === matchSpec.value,
    );
    if (matchedIdx === -1) return arr.length; // fallback
    return 'before' in position ? matchedIdx : matchedIdx + 1;
  }
}
