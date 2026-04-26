/**
 * 记忆条目 ID 生成工具 — 2026-04-11 CR M-10 修复
 *
 * 旧版本子管线用 `lt_${Date.now()}` 或 `lt_${Date.now()}_${i}` 拼 ID，存在两个问题：
 *
 * 1. 同毫秒内多次调用 `Date.now()` 返回相同值（常见于循环里批量生成）
 * 2. 跨调用碰撞：两次 compact 管线在同一毫秒完成时，不同批次的 ID 会冲突
 *
 * 即便 `out.length` 下标后缀能防止单次循环内的碰撞，跨调用碰撞仍然存在，
 * 会导致以 ID 做 key 的索引/去重/渲染出错。
 *
 * 本模块提供 `generateMemoryId(prefix)` 统一生成全局唯一 ID。
 * 优先使用 `crypto.randomUUID()`（浏览器和 Node 16+ 均支持），
 * 降级到 `Date.now() + Math.random()` 组合保证兼容性。
 */

/**
 * 生成全局唯一的记忆条目 ID
 *
 * @param prefix 前缀，便于在日志和状态树里人眼识别条目类型
 *               （`lt` = long-term, `lt_archive` = theme archive, `mt` = mid-term 等）
 * @returns `"{prefix}_{uuid}"` 格式的字符串
 *
 * @example
 * generateMemoryId('lt')          // "lt_a1b2c3d4-e5f6-..."
 * generateMemoryId('lt_archive')  // "lt_archive_9f8e7d..."
 */
export function generateMemoryId(prefix: string): string {
  // 优先使用 crypto.randomUUID —— 全局唯一，浏览器和 Node 16+ 内置
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  // Fallback：时间戳 + 随机 base36 字符串
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
