/**
 * 行为模块配置类型定义
 *
 * 引擎内置行为模块通过 JSON 配置驱动，Game Pack 不含代码。
 * 每个行为模块由 Game Pack 的 rules/ 目录下的 JSON 文件参数化。
 *
 * 对应 STEP-02 §3.10 Engine Built-in Behavior Modules。
 */

// ─── §3.10.1 Time Service ───

/** 虚拟日历配置 — 定义游戏内的时间进位规则 */
export interface CalendarConfig {
  minutesPerHour: number;
  hoursPerDay: number;
  daysPerMonth: number;
  monthsPerYear: number;
  /** 状态树中时间对象的 dot-path */
  timeFieldPath: string;
  /** 时间字段的类型映射（如 { "年": "number", "月": "number" }） */
  timeFieldFormat: Record<string, 'number' | 'string'>;
}

// ─── §3.10.2 Effect Lifecycle ───

/** 状态效果生命周期配置 — 管理 buff/debuff 的到期清理 */
export interface EffectLifecycleConfig {
  /** 效果数组在状态树中的 dot-path */
  effectsPath: string;
  /** 效果对象的字段映射 */
  effectSchema: {
    nameField: string;
    typeField: string;
    typeValues: string[];
    startTimeField: string;
    durationField: string;
    /** 永久效果的持续时间哨兵值（如 99999） */
    permanentSentinel: number;
  };
}

// ─── §3.10.3 Cross-Reference Sync ───

/** 完整性规则条目 — 声明跨域数据的同步规则 */
export interface IntegrityRule {
  /** 规则 ID */
  id: string;
  /** 描述（用于日志和调试） */
  description?: string;
  /** 引擎内置行为模块名（如 "bidirectional-ref-sync"） */
  module: string;
  /** 模块参数 */
  config: Record<string, unknown>;
}

// ─── §3.10.5 Computed Fields ───

/** 计算字段配置 — 定义从其他字段自动计算的派生值 */
export interface ComputedFieldConfig {
  /** 目标 dot-path（计算结果写入此路径） */
  target: string;
  /** 计算公式（支持四则运算 + 内置函数） */
  formula: string;
  /** 触发时机 */
  trigger: 'onCreation' | 'onRoundEnd' | 'onLoad';
}

// ─── §3.10.6 Threshold Triggers ───

/** 阈值触发器配置 — 当值满足条件时执行预定义动作 */
export interface ThresholdTriggerConfig {
  /** 监听的 dot-path */
  watch: string;
  /** 条件表达式（如 "<= 0", ">= 20"） */
  condition: string;
  /** 触发的动作类型 */
  action: 'emit-event' | 'run-pipeline' | 'set-field';
  /** 动作参数 */
  payload: Record<string, unknown>;
}

// ─── §3.10.7 Content Filter ───

/** 内容过滤配置 — 根据评级设置控制内容可见性 */
export interface ContentFilterConfig {
  contentRatings: Record<string, {
    /** 控制开关在状态树中的 dot-path */
    settingPath: string;
    /** 评级关闭时从 prompt 中移除的标签 */
    promptStripTags: string[];
    /** 评级关闭时隐藏的 schema 字段 */
    conditionalSchemaFields: string[];
  }>;
}

// ─── §3.10.9 NPC Behavior Rules ───

/** NPC 行为规则配置 — 定义 NPC 类型和对应行为策略 */
export interface NpcBehaviorConfig {
  npcTypes: {
    /** NPC 对象中标记类型的字段名 */
    typeField: string;
    /** 各类型的行为策略 */
    types: Record<string, {
      /** 玩家离开时的行为（"follow-or-wander" | "stay"） */
      onPlayerLeave: string;
      /** 游荡时的位置描述标签 */
      wanderLabel?: string;
    }>;
    /** 未标记类型时的默认类型 */
    defaultType: string;
  };
}

// Note: QueuedAction is defined in state.ts and exported from index.ts
