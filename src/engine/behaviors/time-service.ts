/**
 * 时间服务模块 — 虚拟日历的进位归一化和年龄更新
 *
 * 问题背景：
 * AI 在修改游戏时间时只做简单加减（如"分钟 + 90"），
 * 不会处理进位逻辑（90 分钟应该进位为 1 小时 30 分钟）。
 * 本模块在 afterCommands 钩子中检测时间字段是否溢出，
 * 并按 CalendarConfig 的进位规则做 cascade 归一化。
 *
 * 归一化流程：
 * 1. 从状态树读取时间对象（由 CalendarConfig.timeFieldPath 定位）
 * 2. 按 分钟→小时→天→月→年 的顺序逐级检查溢出
 * 3. 溢出部分进位到上一级，当前级取余
 * 4. 写回状态树
 *
 * 年龄自动更新：
 * 如果时间对象中存在"年"字段且状态树中有年龄字段（约定路径），
 * 则在年份增长时同步增加年龄。
 *
 * 对应 STEP-02 §3.10.1。
 */
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { ChangeLog, CalendarConfig } from '../types';

/**
 * 时间字段在状态树中的标准字段名
 * CalendarConfig.timeFieldFormat 的 key 值定义了实际使用的字段名，
 * 但进位逻辑需要知道这些字段的语义角色（哪个是"分钟"级别、哪个是"小时"级别等）。
 * 本模块按 STEP-02 约定的字段顺序处理：从最小单位到最大单位。
 */
interface TimeFields {
  minute: string;
  hour: string;
  day: string;
  month: string;
  year: string;
}

export class TimeService implements BehaviorModule {
  readonly id = 'time-service';

  /** 进位规则 */
  private config: CalendarConfig;
  /** 时间字段语义映射 — 由 timeFieldFormat 的 key 顺序推断 */
  private fieldNames: TimeFields;
  /** 角色年龄路径（由 EnginePathConfig 注入） */
  private characterAgePath: string;

  constructor(config: CalendarConfig, characterAgePath?: string) {
    this.characterAgePath = characterAgePath ?? '角色.基础信息.年龄';
    this.config = config;
    /*
     * timeFieldFormat 的 key 按照从大到小的约定排列（年、月、日、时、分），
     * 我们需要反转为从小到大以便做进位。
     * 典型配置示例：{ "年": "number", "月": "number", "日": "number", "时": "number", "分": "number" }
     */
    const keys = Object.keys(config.timeFieldFormat);
    this.fieldNames = {
      year: keys[0] ?? 'year',
      month: keys[1] ?? 'month',
      day: keys[2] ?? 'day',
      hour: keys[3] ?? 'hour',
      minute: keys[4] ?? 'minute',
    };
  }

  /**
   * afterCommands 钩子 — AI 修改时间后做进位归一化
   *
   * 只在 changeLog 中包含时间路径的变更时才执行，
   * 避免每次 AI 回复都做不必要的归一化计算。
   */
  afterCommands(stateManager: StateManager, changeLog: ChangeLog): void {
    const timePath = this.config.timeFieldPath;
    const hasTimeChange = changeLog.changes.some((c) => c.path.startsWith(timePath));
    if (!hasTimeChange) return;

    this.normalizeTime(stateManager);
  }

  /**
   * onGameLoad 钩子 — 读档后确保时间数据合法
   * 防止手动编辑存档导致的非法时间值
   */
  onGameLoad(stateManager: StateManager): void {
    this.normalizeTime(stateManager);
  }

  /**
   * 核心归一化逻辑 — 按从小到大的顺序逐级进位
   *
   * 每一级的进位规则：
   *   carry = Math.floor(value / limit)
   *   remainder = value - carry * limit  (使用减法而非模运算，正确处理负数)
   *
   * 负数处理：当值为负时向下借位（如 -1 分钟 → 上一小时借 1，分钟变为 limit-1）
   */
  private normalizeTime(stateManager: StateManager): void {
    const basePath = this.config.timeFieldPath;
    const fn = this.fieldNames;

    const minute = this.readTimeField(stateManager, basePath, fn.minute);
    const hour = this.readTimeField(stateManager, basePath, fn.hour);
    const day = this.readTimeField(stateManager, basePath, fn.day);
    const month = this.readTimeField(stateManager, basePath, fn.month);
    const year = this.readTimeField(stateManager, basePath, fn.year);

    const oldYear = year;

    // 分钟 → 小时
    const [normMinute, carryToHour] = this.carryOver(minute, this.config.minutesPerHour);
    // 小时 → 天
    const [normHour, carryToDay] = this.carryOver(hour + carryToHour, this.config.hoursPerDay);
    // 天 → 月
    const [normDay, carryToMonth] = this.carryOver(day + carryToDay, this.config.daysPerMonth);
    // 月 → 年
    const [normMonth, carryToYear] = this.carryOver(month + carryToMonth, this.config.monthsPerYear);
    const normYear = year + carryToYear;

    this.writeTimeField(stateManager, basePath, fn.minute, normMinute);
    this.writeTimeField(stateManager, basePath, fn.hour, normHour);
    this.writeTimeField(stateManager, basePath, fn.day, normDay);
    this.writeTimeField(stateManager, basePath, fn.month, normMonth);
    this.writeTimeField(stateManager, basePath, fn.year, normYear);

    // 年份变动时同步更新年龄
    const yearDelta = normYear - oldYear;
    if (yearDelta !== 0) {
      this.updateAge(stateManager, yearDelta);
    }
  }

  /**
   * 进位计算 — 返回 [归一化后的值, 进位数]
   *
   * 使用 Math.floor 而非整除，使得负数也能正确处理：
   * 例如 value=-1, limit=60 → carry=-1, remainder=59（即借位1，得到59分钟）
   */
  private carryOver(value: number, limit: number): [remainder: number, carry: number] {
    if (limit <= 0) return [value, 0];
    const carry = Math.floor(value / limit);
    const remainder = value - carry * limit;
    return [remainder, carry];
  }

  /** 从状态树读取时间子字段，缺失时默认为 0 */
  private readTimeField(stateManager: StateManager, basePath: string, field: string): number {
    const raw = stateManager.get<unknown>(`${basePath}.${field}`);
    const num = Number(raw);
    return Number.isNaN(num) ? 0 : num;
  }

  /** 写回时间子字段 */
  private writeTimeField(stateManager: StateManager, basePath: string, field: string, value: number): void {
    stateManager.set(`${basePath}.${field}`, value, 'system');
  }

  /**
   * 年龄同步更新
   *
   * 在状态树中查找常见的年龄路径（Game Pack 约定），
   * 找到后加上年份变化量。
   * 路径搜索顺序：角色.年龄 → 角色.属性.年龄（覆盖中文 Game Pack 常用布局）
   */
  private updateAge(stateManager: StateManager, yearDelta: number): void {
    const currentAge = stateManager.get<number>(this.characterAgePath);
    if (typeof currentAge === 'number') {
      stateManager.set(this.characterAgePath, currentAge + yearDelta, 'system');
    }
  }
}
