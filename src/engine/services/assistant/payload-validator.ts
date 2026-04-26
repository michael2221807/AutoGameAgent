/**
 * PayloadValidator — 4 层校验，把 AssistantPayload 转为 ValidatedPatch[]
 *
 * 校验层级：
 * 1. **Shape 层**：每条 patch 必须有 target + op 合法 + match/value 与 op 匹配
 * 2. **Path 层**：
 *    - target 不在 assistant-blocklist 内
 *    - target 在 state-schema 中存在
 *    - target 路径祖先有 x-assistant-editable: true（白名单）
 * 3. **Schema 层**：
 *    - value 类型与 schema 匹配（string/number/boolean/object/array）
 *    - 必填字段存在
 *    - number 字段在 min/max 范围内
 *    - enum 值合法
 * 4. **Referential 层**（弱校验，仅 warn）：
 *    - replace-item / remove-item 的 match 字段在数组中能找到对应项
 *    - append-item 添加 NPC/地点时 名称 不与现有冲突
 *
 * 用户决策：error 必须修复或全部丢弃；不允许部分注入。
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §5.2.3 + Phase 2。
 */
import type { StateManager } from '../../core/state-manager';
import type { GamePack } from '../../types';
import type {
  AssistantPatch,
  AssistantPayload,
  ValidatedPatch,
} from './types';
import { isBlockedPath, normalizeStatePath } from './assistant-blocklist';

export interface PayloadValidatorDeps {
  stateManager: StateManager;
  gamePack: GamePack | null;
}

export class PayloadValidator {
  constructor(private deps: PayloadValidatorDeps) {}

  /**
   * 校验整个 payload —— 返回每条 patch 的校验状态
   *
   * 注意：即使某条 patch 是 error，也仍出现在结果中（status='error', issues=[...]）；
   * 调用方根据是否有 error 决定是否阻止注入。
   */
  validate(payload: AssistantPayload): ValidatedPatch[] {
    return payload.patches.map((p) => this.validateOne(p));
  }

  validateOne(patch: AssistantPatch): ValidatedPatch {
    const issues: string[] = [];
    let hasError = false;

    // ── Shape 层 ──
    const shapeIssues = this.checkShape(patch);
    issues.push(...shapeIssues);
    if (shapeIssues.length > 0) hasError = true;

    // ── Path 层 ──
    const target = normalizeStatePath(patch.target);
    if (isBlockedPath(target)) {
      issues.push(`路径 "${target}" 在 assistant 黑名单内（系统/元数据/时间等不可改）`);
      hasError = true;
    }

    const schema = this.findSchema(target);
    if (!schema) {
      issues.push(`路径 "${target}" 在 game pack state-schema 中不存在`);
      hasError = true;
    } else if (!this.isAssistantEditable(target)) {
      issues.push(`路径 "${target}" 未标记为 assistant-editable（pack 未授权）`);
      hasError = true;
    }

    // ── Schema 层（仅 schema 存在时跑） ──
    if (schema && shapeIssues.length === 0) {
      const schemaIssues = this.checkSchema(patch, schema);
      issues.push(...schemaIssues.map((m) => `[schema] ${m}`));
      if (schemaIssues.length > 0) hasError = true;
    }

    // ── Referential 层（仅 warn，不 hasError） ──
    const refIssues = this.checkReferential(patch, target);
    issues.push(...refIssues.map((m) => `[ref] ${m}`));

    const status = hasError ? 'error' : issues.length > 0 ? 'warn' : 'ok';
    return { ...patch, target, status, issues };
  }

  // ─── Shape 层 ──────────────────────────────────────────

  private checkShape(p: AssistantPatch): string[] {
    const issues: string[] = [];
    if (!p.target || typeof p.target !== 'string') issues.push('target 缺失或非字符串');
    if (!p.op) issues.push('op 缺失');

    switch (p.op) {
      case 'set-field':
      case 'append-item':
      case 'replace-array':
        if (!('value' in p) || p.value === undefined) {
          issues.push(`op="${p.op}" 必须提供 value`);
        }
        if (p.op === 'replace-array' && p.value !== undefined && !Array.isArray(p.value)) {
          issues.push('replace-array 的 value 必须是数组');
        }
        break;
      case 'insert-item':
        if (!('value' in p) || p.value === undefined) {
          issues.push('insert-item 必须提供 value（单个对象）');
        }
        if (!p.position) {
          issues.push('insert-item 必须提供 position（{ at } / { before } / { after }）');
        } else {
          const posIssues = checkPositionShape(p.position);
          issues.push(...posIssues);
        }
        break;
      case 'replace-item':
        if (!p.match) issues.push('replace-item 必须提供 match');
        if (!('value' in p) || p.value === undefined) {
          issues.push('replace-item 必须提供 value');
        }
        break;
      case 'remove-item':
        if (!p.match) issues.push('remove-item 必须提供 match');
        break;
      default:
        // parser 已过滤非法 op，但防御性
        issues.push(`未知 op "${p.op}"`);
    }
    return issues;
  }

  // ─── Path 层（白名单查询） ─────────────────────────────

  /**
   * 找路径对应的 schema 节点 —— 沿 path 走 properties / items / additionalProperties
   */
  private findSchema(path: string): Record<string, unknown> | null {
    const root = this.getStateSchema();
    if (!root) return null;
    const segments = path.split('.').filter(Boolean);
    let current: Record<string, unknown> = root;
    for (const seg of segments) {
      const next = walkOneSegment(current, seg);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  /**
   * 检查 path 或其任一祖先是否标记 x-assistant-editable: true
   *
   * 这意味着 pack 作者可以在父节点（如 `社交.关系`）设置 editable=true，
   * 自动允许 assistant 改它的所有子项；不需要每个 item 字段都标。
   */
  private isAssistantEditable(path: string): boolean {
    const root = this.getStateSchema();
    if (!root) return false;
    const segments = path.split('.').filter(Boolean);
    let current: Record<string, unknown> = root;
    if (current['x-assistant-editable'] === true) return true;
    for (const seg of segments) {
      const next = walkOneSegment(current, seg);
      if (!next) return false;
      if (next['x-assistant-editable'] === true) return true;
      current = next;
    }
    return false;
  }

  private getStateSchema(): Record<string, unknown> | null {
    // GamePack.stateSchema 是直接顶级字段（camelCase 单数），不是嵌套在 schemas 里
    // 2026-04-14 fix：早期实现误读为 `pack.schemas['state-schema']`，导致所有路径被
    // validator 判 "不存在" + "未标 x-assistant-editable"
    const pack = this.deps.gamePack;
    if (!pack) return null;
    return pack.stateSchema ?? null;
  }

  // ─── Schema 层 ─────────────────────────────────────────

  /**
   * 校验 patch.value 是否符合 path 的 schema
   *
   * 不同 op 校验侧重不同：
   * - set-field：value 必须匹配 schema.type
   * - append-item / replace-item：value 必须匹配 schema.items（数组的 item schema）
   * - replace-array：value 是数组，每项匹配 items
   */
  private checkSchema(p: AssistantPatch, schema: Record<string, unknown>): string[] {
    const issues: string[] = [];
    switch (p.op) {
      case 'set-field':
        issues.push(...validateValueAgainstSchema(p.value, schema, ''));
        break;
      case 'append-item':
      case 'insert-item':
      case 'replace-item': {
        const itemSchema = (schema['items'] as Record<string, unknown>) ?? {};
        if (Object.keys(itemSchema).length > 0) {
          issues.push(...validateValueAgainstSchema(p.value, itemSchema, ''));
        }
        break;
      }
      case 'replace-array': {
        const itemSchema = (schema['items'] as Record<string, unknown>) ?? {};
        if (!Array.isArray(p.value)) {
          issues.push('value 必须是数组');
          break;
        }
        p.value.forEach((item, idx) => {
          issues.push(...validateValueAgainstSchema(item, itemSchema, `[${idx}]`));
        });
        break;
      }
      // remove-item 不检 value
    }
    return issues;
  }

  // ─── Referential 层（弱校验） ──────────────────────────

  private checkReferential(p: AssistantPatch, target: string): string[] {
    const warnings: string[] = [];

    // replace-item / remove-item：检查 match 是否能在数组中找到
    if ((p.op === 'replace-item' || p.op === 'remove-item') && p.match) {
      const arr = this.deps.stateManager.get<unknown>(target);
      if (Array.isArray(arr)) {
        const found = arr.find((item) => {
          if (item && typeof item === 'object') {
            return (item as Record<string, unknown>)[p.match!.by] === p.match!.value;
          }
          return false;
        });
        if (!found) {
          warnings.push(`未找到 match=${p.match.by}:"${p.match.value}" 的项`);
        }
      } else {
        warnings.push(`target "${target}" 在状态树中不是数组`);
      }
    }

    // insert-item 的 before/after：检查 position.before/after 的 match 能否找到
    if (p.op === 'insert-item' && p.position) {
      const pos = p.position;
      const matchSpec = 'before' in pos ? pos.before : 'after' in pos ? pos.after : null;
      if (matchSpec) {
        const arr = this.deps.stateManager.get<unknown>(target);
        if (Array.isArray(arr)) {
          const found = arr.find((item) =>
            item && typeof item === 'object'
            && (item as Record<string, unknown>)[matchSpec.by] === matchSpec.value,
          );
          if (!found) {
            warnings.push(
              `插入位置 ${'before' in pos ? 'before' : 'after'} ${matchSpec.by}:"${matchSpec.value}" ` +
              `在数组中未找到 —— 将 fallback 到数组末尾`,
            );
          }
        } else {
          warnings.push(`target "${target}" 在状态树中不是数组（无法 insert-item）`);
        }
      }
    }

    // append-item / insert-item：如果 value 含 名称/name 字段，警告同名冲突
    if ((p.op === 'append-item' || p.op === 'insert-item') && p.value && typeof p.value === 'object') {
      const v = p.value as Record<string, unknown>;
      const newName = v['名称'] ?? v['name'] ?? v['id'];
      if (typeof newName === 'string' && newName.length > 0) {
        const arr = this.deps.stateManager.get<unknown>(target);
        if (Array.isArray(arr)) {
          const collision = arr.some((item) => {
            if (item && typeof item === 'object') {
              const o = item as Record<string, unknown>;
              return o['名称'] === newName || o['name'] === newName || o['id'] === newName;
            }
            return false;
          });
          if (collision) {
            warnings.push(`数组中已存在 名称="${newName}" 的项 —— 追加将产生重复`);
          }
        }
      }
    }

    return warnings;
  }
}

// ─── insert-item position shape 校验 ────────────────────

function checkPositionShape(pos: unknown): string[] {
  const issues: string[] = [];
  if (!pos || typeof pos !== 'object') {
    issues.push('position 必须是对象');
    return issues;
  }
  const p = pos as Record<string, unknown>;
  const hasAt = 'at' in p;
  const hasBefore = 'before' in p;
  const hasAfter = 'after' in p;
  const keyCount = (hasAt ? 1 : 0) + (hasBefore ? 1 : 0) + (hasAfter ? 1 : 0);
  if (keyCount === 0) {
    issues.push('position 必须含 at / before / after 之一');
    return issues;
  }
  if (keyCount > 1) {
    issues.push('position 只能含 at / before / after 之一（不能同时指定）');
  }
  if (hasAt && p['at'] !== 'start' && p['at'] !== 'end') {
    issues.push(`position.at 必须是 "start" 或 "end"，实际：${JSON.stringify(p['at'])}`);
  }
  if (hasBefore || hasAfter) {
    const match = (hasBefore ? p['before'] : p['after']) as Record<string, unknown> | undefined;
    if (!match || typeof match !== 'object') {
      issues.push(`position.${hasBefore ? 'before' : 'after'} 必须是 { by, value } 对象`);
    } else {
      if (typeof match['by'] !== 'string' || match['by'].length === 0) {
        issues.push(`position.${hasBefore ? 'before' : 'after'}.by 必须是非空字符串`);
      }
      if (!('value' in match)) {
        issues.push(`position.${hasBefore ? 'before' : 'after'}.value 必填`);
      }
    }
  }
  return issues;
}

// ─── Schema 行走 + 校验工具 ───────────────────────────────

function walkOneSegment(node: Record<string, unknown>, seg: string): Record<string, unknown> | null {
  // 数字下标 → items
  if (/^\d+$/.test(seg)) {
    const items = node['items'];
    return (items && typeof items === 'object') ? (items as Record<string, unknown>) : null;
  }
  // properties.<seg>
  const props = node['properties'];
  if (props && typeof props === 'object') {
    const next = (props as Record<string, unknown>)[seg];
    if (next && typeof next === 'object') return next as Record<string, unknown>;
  }
  // additionalProperties (Record<string, X>)
  const addProps = node['additionalProperties'];
  if (addProps && typeof addProps === 'object') {
    return addProps as Record<string, unknown>;
  }
  return null;
}

/**
 * 校验单个 value 对一个 schema 节点
 *
 * 检查：
 * - schema.type 与 value 实际类型匹配
 * - object 时：每个 properties 中 required 列出的字段必须存在
 * - object 时：递归校验每个 property
 * - number 时：min/max
 * - string + enum：值在 enum 中
 *
 * @param prefix 错误消息前缀（用于嵌套定位）
 */
export function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  prefix: string,
): string[] {
  const issues: string[] = [];
  const type = schema['type'];

  if (typeof type === 'string') {
    const actualType = jsType(value);
    if (!matchesType(value, type)) {
      issues.push(`${prefix || '(根)'} 期望类型 ${type}，实际 ${actualType}`);
      return issues; // 类型不对就不再深入校验
    }
  }

  if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in obj)) {
          issues.push(`${prefix} 缺少必填字段 "${key}"`);
        }
      }
    }
    const props = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      for (const [k, v] of Object.entries(obj)) {
        if (props[k]) {
          issues.push(...validateValueAgainstSchema(v, props[k], `${prefix}.${k}`));
        }
      }
    }
  }

  if (type === 'array' && Array.isArray(value)) {
    const itemSchema = schema['items'] as Record<string, unknown> | undefined;
    if (itemSchema && Object.keys(itemSchema).length > 0) {
      value.forEach((item, idx) => {
        issues.push(...validateValueAgainstSchema(item, itemSchema, `${prefix}[${idx}]`));
      });
    }
  }

  if (type === 'number' && typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      issues.push(`${prefix} 值 ${value} 小于 minimum=${schema['minimum']}`);
    }
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      issues.push(`${prefix} 值 ${value} 大于 maximum=${schema['maximum']}`);
    }
  }

  if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
    issues.push(`${prefix} 值 ${JSON.stringify(value)} 不在 enum=${JSON.stringify(schema['enum'])} 中`);
  }

  return issues;
}

function jsType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, schemaType: string): boolean {
  switch (schemaType) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return true; // 未知 type 不阻断
  }
}
