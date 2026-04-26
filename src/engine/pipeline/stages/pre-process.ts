/**
 * 预处理阶段 — 管线的第一个阶段
 *
 * 职责：
 * 1. 消费动作队列（面板操作如装备、使用物品等）
 * 2. 将队列中的操作格式化为文本并 prepend 到用户输入
 * 3. 递增状态树中的回合序号
 *
 * 为什么动作队列在这里消费而非在 ContextAssembly：
 * 动作队列影响的是"用户输入"的内容，而非 prompt 模板变量。
 * 在最早的阶段处理可以保证后续所有阶段看到的 userInput 已包含面板操作。
 * 如果放到 ContextAssembly，那 userInput 和 actionQueuePrompt 的时序关系
 * 就会变得模糊，增加调试难度。
 *
 * 为什么格式化在这里做而非在 ActionQueueStore：
 * consumeActions() 返回结构化的 QueuedAction[]（M1 review fix），
 * 格式化逻辑属于"如何呈现给 AI"的决策，应由管线阶段控制。
 * Store 只负责排队/消费的数据管理。
 *
 * 对应 STEP-03B M3.4 PreProcessStage。
 */
import { unset as _unset } from 'lodash-es';
import type { PipelineStage, PipelineContext, IActionQueueConsumer, EnginePathConfig } from '../types';
import type { StateManager } from '../../core/state-manager';
import type { QueuedAction } from '../../types';

export class PreProcessStage implements PipelineStage {
  name = 'PreProcess';

  constructor(
    private stateManager: StateManager,
    private actionQueue: IActionQueueConsumer,
    private paths: EnginePathConfig,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    // 在任何状态变更（包括递增回合序号）之前，捕获本回合开始前的完整快照。
    // PostProcessStage 会将此快照持久化到 paths.preRoundSnapshot，供 Rollback 使用。
    //
    // 2026-04-11 critical fix: 删除捕获快照里已有的 `元数据.上次对话前快照` 字段，
    // 防止**递归嵌套快照爆炸**。
    //
    // 之前的 bug 机制：
    // - 回合 1 结束后，`元数据.上次对话前快照` = 回合 1 开始时的状态
    // - 回合 2 开始，`toSnapshot()` 克隆整棵状态树（包含回合 1 的嵌套快照）
    // - 回合 2 结束后，`元数据.上次对话前快照` = 包含回合 1 嵌套的回合 2 快照
    // - 回合 N 时，快照已经嵌套了 N-1 层 —— O(N) 状态树克隆，存档体积指数级膨胀
    //   且 prompt 里的 `GAME_STATE_JSON` 每次都多一层嵌套
    //
    // 修复：捕获后用 lodash `unset` 删除嵌套字段，保证 preRoundSnapshot 永远是
    // 单层快照（当前回合开始时的状态，不含"上次的上次"）。Rollback 功能不受
    // 影响 —— 回滚到上一回合时只需要当前快照，不需要回滚链。
    const preRoundSnapshot = this.stateManager.toSnapshot();
    _unset(preRoundSnapshot, this.paths.preRoundSnapshot);

    // 立即持久化快照到状态树（不等 PostProcess）。
    // 如果 AI 调用失败，PostProcess 不会执行，之前快照只在 ctx 里（内存），
    // 刷新后丢失 → 手动回退按钮读不到。提前写入保证任何时候都能回退。
    this.stateManager.set(this.paths.preRoundSnapshot, preRoundSnapshot, 'system');

    const consumed = this.actionQueue.consumeActions();
    const actionQueuePrompt = this.formatActions(consumed);

    const userInput = actionQueuePrompt
      ? `${actionQueuePrompt}\n\n${ctx.userInput}`
      : ctx.userInput;

    const roundNumber = (this.stateManager.get<number>(this.paths.roundNumber) ?? 0) + 1;
    this.stateManager.set(this.paths.roundNumber, roundNumber, 'system');

    return { ...ctx, userInput, actionQueuePrompt, roundNumber, preRoundSnapshot };
  }

  /**
   * 将 QueuedAction[] 格式化为 AI 可读的文本
   *
   * 格式：[操作类型] 操作描述
   * 例如：
   *   [装备] 玩家装备了「破旧铁剑」
   *   [使用] 玩家使用了「小型回复药水」
   *
   * 使用 [type] 前缀让 AI 能区分操作类型，
   * 便于在 prompt 中用不同策略处理（如装备操作不消耗回合时间）
   */
  private formatActions(actions: QueuedAction[]): string {
    if (actions.length === 0) return '';
    return actions.map((a) => `[${a.type}] ${a.description}`).join('\n');
  }
}
