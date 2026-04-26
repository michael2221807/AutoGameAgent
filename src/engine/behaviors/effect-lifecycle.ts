/**
 * 效果生命周期模块 — 管理状态效果（buff/debuff）的到期清理
 *
 * 游戏中的临时效果（如"中毒 3 天"、"祝福 10 回合"）存储在状态树的一个数组中。
 * 每个效果有起始时间和持续时长，本模块在 onRoundEnd 钩子中：
 * 1. 读取当前游戏时间
 * 2. 遍历效果数组
 * 3. 比较 (startTime + duration) 与当前时间
 * 4. 移除已过期的效果
 *
 * 永久效果通过特殊的哨兵持续时长值（如 99999）标记，永不过期。
 *
 * 配置示例（EffectLifecycleConfig）：
 * {
 *   "effectsPath": "角色.状态效果",
 *   "effectSchema": {
 *     "nameField": "名称",
 *     "typeField": "类型",
 *     "typeValues": ["buff", "debuff", "neutral"],
 *     "startTimeField": "开始时间",
 *     "durationField": "持续时间",
 *     "permanentSentinel": 99999
 *   }
 * }
 *
 * 对应 STEP-02 §3.10.2。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { EffectLifecycleConfig, CalendarConfig } from '../types';

export class EffectLifecycleModule implements BehaviorModule {
  readonly id = 'effect-lifecycle';

  constructor(
    private effectConfig: EffectLifecycleConfig,
    private calendarConfig: CalendarConfig,
  ) {}

  /**
   * onRoundEnd 钩子 — 每轮结束时清理过期效果
   *
   * 在 time-service 归一化时间之后执行（依赖注册顺序），
   * 确保当前时间已经是正确的进位后值。
   */
  onRoundEnd(stateManager: StateManager): void {
    this.removeExpiredEffects(stateManager);
  }

  /**
   * onGameLoad 钩子 — 读档后也做一次清理
   * 玩家可能存档后过了很久再读档，期间效果应该已经过期
   */
  onGameLoad(stateManager: StateManager): void {
    this.removeExpiredEffects(stateManager);
  }

  /**
   * 核心清理逻辑 — 遍历效果数组，移除过期项
   *
   * 时间比较策略：
   * 将时间对象转换为"总分钟数"（标量）进行比较，
   * 避免在多维时间结构上做复杂的逐字段比较。
   */
  private removeExpiredEffects(stateManager: StateManager): void {
    const effects = stateManager.get<Record<string, unknown>[]>(this.effectConfig.effectsPath);
    if (!Array.isArray(effects) || effects.length === 0) return;

    const currentTimeScalar = this.getCurrentTimeScalar(stateManager);
    const schema = this.effectConfig.effectSchema;

    const surviving = effects.filter((effect) => {
      const duration = Number(effect[schema.durationField] ?? 0);

      // 永久效果 — 永不过期
      if (duration >= schema.permanentSentinel) return true;

      const startTimeRaw = effect[schema.startTimeField];
      const startScalar = this.timeObjectToScalar(startTimeRaw);

      // 无法解析的起始时间保留效果（安全默认行为）
      if (startScalar === null) return true;

      return (startScalar + duration) > currentTimeScalar;
    });

    // 仅在有效果被移除时才写回，避免不必要的状态变更
    if (surviving.length < effects.length) {
      const removed = effects.length - surviving.length;
      console.log(`[EffectLifecycle] Removed ${removed} expired effect(s)`);
      stateManager.set(this.effectConfig.effectsPath, surviving, 'system');
    }
  }

  /**
   * 读取当前游戏时间并转换为标量
   * 使用 CalendarConfig 的进位规则做线性映射
   */
  private getCurrentTimeScalar(stateManager: StateManager): number {
    const timeObj = stateManager.get<Record<string, unknown>>(this.calendarConfig.timeFieldPath);
    return this.timeObjectToScalar(timeObj) ?? 0;
  }

  /**
   * 将时间对象转换为"总分钟数"标量
   *
   * 转换公式（从最大单位到最小单位逐级展开）：
   *   total = ((year * monthsPerYear + month) * daysPerMonth + day) * hoursPerDay + hour) * minutesPerHour + minute
   *
   * 这确保了任何两个时间点都能通过简单的数值比较判断先后。
   */
  private timeObjectToScalar(timeObj: unknown): number | null {
    if (timeObj === null || timeObj === undefined || typeof timeObj !== 'object') return null;

    const obj = timeObj as Record<string, unknown>;
    const keys = Object.keys(this.calendarConfig.timeFieldFormat);
    // keys 约定顺序：年、月、日、时、分
    const year = Number(obj[keys[0]] ?? 0);
    const month = Number(obj[keys[1]] ?? 0);
    const day = Number(obj[keys[2]] ?? 0);
    const hour = Number(obj[keys[3]] ?? 0);
    const minute = Number(obj[keys[4]] ?? 0);

    if ([year, month, day, hour, minute].some(Number.isNaN)) return null;

    const { monthsPerYear, daysPerMonth, hoursPerDay, minutesPerHour } = this.calendarConfig;
    return (
      (((year * monthsPerYear + month) * daysPerMonth + day) * hoursPerDay + hour) *
        minutesPerHour +
      minute
    );
  }
}
