/**
 * Demo V3 存档适配器 — 将 ming demo 等旧版存档转为正式引擎状态树格式
 *
 * 变换规则与 STEP-03B §M5.3 一致；幂等可重复执行。
 * 路径与 `DEFAULT_ENGINE_PATHS`、Game Pack schema 对齐（如 `世界.状态.心跳`、`系统.扩展.engramMemory`）。
 */
import {
  cloneDeep,
  get as _get,
  set as _set,
  unset as _unset,
} from 'lodash-es';

const RETIRED_PATHS: readonly string[] = [
  '角色.修炼功法',
  '角色.修炼',
  '角色.功法模块',
  '角色.技能模块',
  '角色.掌握技能',
  '角色.装备',
] as const;

const RENAME_MAP: ReadonlyArray<{ from: string; to: string }> = [
  { from: '角色.基础信息.灵根', to: '角色.基础信息.特质' },
  { from: '角色.基础信息.境界', to: '角色.基础信息.地位' },
] as const;

const SIX_DIM_OLD = '角色.基础信息.先天六司';
const SIX_DIM_NEW = '角色.基础信息.先天六维属性';

/** 与 STEP-03B 一致：社交树下的记忆数组 */
const MEMORY_PATHS: readonly string[] = [
  '社交.记忆.短期记忆',
  '社交.记忆.中期记忆',
  '社交.记忆.长期记忆',
  '社交.记忆.隐式中期记忆',
] as const;

const HEARTBEAT_PATH = '世界.状态.心跳';

const CURRENCY_PATH = '角色.背包.金钱';

const ENGRAM_PATH = '系统.扩展.engramMemory';

const ROUND_PATH = '元数据.回合序号';

/** 四级货币（与正式版背包展示一致） */
interface CurrencyTiers {
  铜币: number;
  银币: number;
  金币: number;
  灵石: number;
}

const DEFAULT_CURRENCY: CurrencyTiers = {
  铜币: 0,
  银币: 0,
  金币: 0,
  灵石: 0,
};

/**
 * 将 demo / 旧版存档适配为正式引擎可用的状态树
 */
export function adaptDemoSave(
  demoData: Record<string, unknown>,
): Record<string, unknown> {
  const data = cloneDeep(demoData);

  for (const path of RETIRED_PATHS) {
    _unset(data, path);
  }

  for (const { from, to } of RENAME_MAP) {
    const oldVal = _get(data, from);
    if (oldVal === undefined) continue;
    if (_get(data, to) !== undefined) continue;
    _set(data, to, oldVal);
    _unset(data, from);
  }

  const sixOld = _get(data, SIX_DIM_OLD);
  if (sixOld !== undefined && _get(data, SIX_DIM_NEW) === undefined) {
    if (typeof sixOld === 'object' && sixOld !== null && !Array.isArray(sixOld)) {
      _set(data, SIX_DIM_NEW, sixOld);
      _unset(data, SIX_DIM_OLD);
    }
    /* 若旧值为非对象，保留旧路径，避免误删有效数据 */
  }

  for (const p of MEMORY_PATHS) {
    const val = _get(data, p);
    if (val && !Array.isArray(val)) {
      _set(data, p, []);
    }
  }

  if (!_get(data, HEARTBEAT_PATH)) {
    _set(data, HEARTBEAT_PATH, {
      配置: { enabled: false, period: 5 },
      历史: [],
      上次执行时间: 0,
    });
  }

  const currency = _get(data, CURRENCY_PATH);
  if (typeof currency === 'number') {
    _set(data, CURRENCY_PATH, { ...DEFAULT_CURRENCY, 铜币: currency });
  }

  if (!_get(data, ENGRAM_PATH)) {
    _set(data, ENGRAM_PATH, {
      events: [],
      entities: [],
      relations: [],
      meta: {},
    });
  }

  if (typeof _get(data, ROUND_PATH) !== 'number') {
    _set(data, ROUND_PATH, 0);
  }

  return data;
}
