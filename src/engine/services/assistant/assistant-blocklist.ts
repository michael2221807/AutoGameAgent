/**
 * Assistant 路径黑名单 —— assistant 永远不允许写入的状态树路径
 *
 * 这一层在 `state-schema.json` 的 `x-assistant-editable` 白名单**之外**，
 * 是工程级硬约束 —— 即使 pack 作者 careless 把某个敏感路径标记成可编辑，
 * blocklist 也会拦下来。
 *
 * 黑名单优先级 > 白名单：
 *   blocklist match → 拒绝（status='error'）
 *   非 blocklist + x-assistant-editable=true → 允许
 *   非 blocklist + x-assistant-editable 缺失 → 拒绝（status='error'）
 *
 * 设计原则：
 * 1. 用 RegExp 而非字符串前缀匹配 —— 灵活处理 `$.前缀` 与无前缀两种 path 写法
 * 2. 加 `(\.|$)` 边界 —— 防止 `元数据X.foo` 这种意外匹配 `元数据`
 * 3. 路径名必须用 escape 后的正则字符（中文不需要 escape，但加 `.` 等元字符要小心）
 *
 * 对应 docs/status/plan-assistant-utility-2026-04-14.md §7。
 */

/**
 * 路径黑名单 —— assistant 在任何情况下都不应改写
 *
 * 范围：
 * - `元数据.*`：游戏包名、回合序号、叙事历史、上次对话前快照（主回合 rollback 用）
 * - `系统.*`：API keys、nsfwMode、其他用户隐私/配置
 * - `世界.时间.*`：由 TimeService 进位管控
 * - `世界.状态.心跳.*`：由 HeartbeatPipeline 管控
 * - `角色.身份.先天六维.*`：创角后只读基线
 *
 * 注意：`角色.身份` 整体允许，仅 `先天六维` 子树阻断
 */
export const ASSISTANT_BLOCKED_PATTERNS: readonly RegExp[] = Object.freeze([
  /^\$?\.?元数据(\.|$)/,
  /^\$?\.?系统(\.|$)/,
  /^\$?\.?世界\.时间(\.|$)/,
  /^\$?\.?世界\.状态\.心跳(\.|$)/,
  /^\$?\.?角色\.身份\.先天六维(\.|$)/,
]);

/**
 * 检查路径是否在 assistant 黑名单内
 *
 * @param path StatePath（可带 `$.` 或不带）
 * @returns true 表示该路径被阻断
 *
 * @example
 *   isBlockedPath('元数据.叙事历史') === true
 *   isBlockedPath('$.系统.api') === true
 *   isBlockedPath('社交.关系') === false
 *   isBlockedPath('元数据X') === false (边界字符校验)
 */
export function isBlockedPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return true;
  return ASSISTANT_BLOCKED_PATTERNS.some((re) => re.test(path));
}

/**
 * 规范化 path —— 统一去掉前导 `$.`，方便后续 schema 查询和路径比较
 *
 * `$.角色.基础信息.姓名` → `角色.基础信息.姓名`
 * `角色.基础信息.姓名` → 原样
 * 其他形式（如 `$['角色']['基础信息']`）暂不支持，返回原值
 */
export function normalizeStatePath(path: string): string {
  if (typeof path !== 'string') return '';
  return path.startsWith('$.') ? path.slice(2) : path;
}
