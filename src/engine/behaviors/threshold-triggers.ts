/**
 * 阈值触发器模块 — 当状态值满足条件时自动执行预定义动作
 *
 * 典型场景：
 * - 体力 <= 0 时触发"game-over"事件
 * - 好感度 >= 80 时设置"亲密关系"标志
 * - 金钱 == 0 时触发"破产"事件
 *
 * Game Pack 通过 ThresholdTriggerConfig[] 声明触发规则：
 * - watch: 要监听的状态 dot-path
 * - condition: 条件表达式（如 "<= 0", ">= 80"）
 * - action: 触发的动作类型
 * - payload: 动作参数
 *
 * 去重机制：
 * 使用 Set 记录已触发的规则，避免同一轮内重复触发。
 * 当条件不再满足时从 Set 中移除，允许下次再触发。
 *
 * 对应 STEP-02 §3.10.6。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { ThresholdTriggerConfig } from '../types';
import { eventBus } from '../core/event-bus';

/** 条件运算符类型 */
type ComparisonOp = '<=' | '>=' | '==' | '<' | '>';

export class ThresholdTriggersModule implements BehaviorModule {
  readonly id = 'threshold-triggers';

  /**
   * 已触发的规则 — 按 watch+condition 做 key
   * 防止同一条件在持续满足期间每轮都触发
   */
  private firedSet = new Set<string>();

  constructor(private configs: ThresholdTriggerConfig[]) {}

  /**
   * onRoundEnd 钩子 — 每轮结束后检查所有阈值条件
   *
   * 放在 onRoundEnd 而非 afterCommands 是因为：
   * 1. afterCommands 阶段其他行为模块（如 computed-fields）可能还未完成计算
   * 2. onRoundEnd 时所有衍生值已更新，判断条件更准确
   */
  onRoundEnd(stateManager: StateManager): void {
    this.checkAllTriggers(stateManager);
  }

  /**
   * onGameLoad 钩子 — 切换存档/档案时调用
   *
   * 先清空 firedSet（旧存档的触发状态与新存档无关），
   * 再做一次全量检查以捕获加载后已满足的条件。
   */
  onGameLoad(stateManager: StateManager): void {
    this.firedSet.clear();
    this.checkAllTriggers(stateManager);
  }

  /** 重置触发状态 — 切换 Game Pack 或销毁引擎时调用 */
  reset(): void {
    this.firedSet.clear();
  }

  /** 遍历所有触发器配置，检查条件并执行动作 */
  private checkAllTriggers(stateManager: StateManager): void {
    for (const config of this.configs) {
      try {
        this.checkSingleTrigger(stateManager, config);
      } catch (err) {
        console.error(
          `[ThresholdTriggers] Error checking "${config.watch}" ${config.condition}:`,
          err,
        );
      }
    }
  }

  /** 检查单个触发器 */
  private checkSingleTrigger(stateManager: StateManager, config: ThresholdTriggerConfig): void {
    const currentValue = stateManager.get<unknown>(config.watch);
    const numValue = Number(currentValue);

    // 非数值类型无法比较，跳过
    if (Number.isNaN(numValue)) return;

    const parsed = this.parseCondition(config.condition);
    if (!parsed) return;

    const { op, threshold } = parsed;
    const conditionMet = this.evaluateCondition(numValue, op, threshold);
    const triggerKey = `${config.watch}::${config.condition}`;

    if (conditionMet && !this.firedSet.has(triggerKey)) {
      // 条件首次满足 → 触发动作并记录
      this.firedSet.add(triggerKey);
      this.executeAction(stateManager, config);
    } else if (!conditionMet && this.firedSet.has(triggerKey)) {
      // 条件不再满足 → 清除记录，允许下次再触发
      this.firedSet.delete(triggerKey);
    }
  }

  /**
   * 解析条件字符串 — 提取运算符和阈值
   *
   * 支持格式："<= 0", ">=80", "== 100", "< -5", "> 20"
   * 运算符与数字之间的空格可选
   */
  private parseCondition(condition: string): { op: ComparisonOp; threshold: number } | null {
    const match = condition.match(/^(<=|>=|==|<|>)\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      console.warn(`[ThresholdTriggers] Invalid condition format: "${condition}"`);
      return null;
    }
    return {
      op: match[1] as ComparisonOp,
      threshold: Number(match[2]),
    };
  }

  /** 评估条件表达式 */
  private evaluateCondition(value: number, op: ComparisonOp, threshold: number): boolean {
    switch (op) {
      case '<=': return value <= threshold;
      case '>=': return value >= threshold;
      case '==': return value === threshold;
      case '<': return value < threshold;
      case '>': return value > threshold;
    }
  }

  /** 执行触发动作 */
  private executeAction(stateManager: StateManager, config: ThresholdTriggerConfig): void {
    switch (config.action) {
      case 'emit-event': {
        /**
         * 发射自定义事件 — payload.event 指定事件名
         * 其他 payload 字段作为事件数据传递
         */
        const eventName = String(config.payload.event ?? 'threshold:triggered');
        const { event: _, ...eventData } = config.payload;
        eventBus.emit(eventName, { watch: config.watch, ...eventData });
        console.log(`[ThresholdTriggers] Emitted event "${eventName}" for ${config.watch}`);
        break;
      }
      case 'set-field': {
        /**
         * 设置状态字段 — payload.path 和 payload.value 指定目标
         * 用于在阈值触发时设置标志位（如"已死亡"、"已破产"）
         */
        const path = String(config.payload.path ?? '');
        if (path) {
          stateManager.set(path, config.payload.value, 'system');
          console.log(`[ThresholdTriggers] Set "${path}" for ${config.watch}`);
        }
        break;
      }
      case 'run-pipeline': {
        /**
         * 触发子流水线 — payload.pipeline 指定流水线名
         * 实际执行由引擎的流水线调度器处理，此处只发事件通知
         */
        const pipelineName = String(config.payload.pipeline ?? '');
        eventBus.emit('engine:run-pipeline', {
          pipeline: pipelineName,
          trigger: config.watch,
        });
        console.log(`[ThresholdTriggers] Requested pipeline "${pipelineName}" for ${config.watch}`);
        break;
      }
    }
  }
}
