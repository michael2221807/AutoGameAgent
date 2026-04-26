/**
 * 引擎日志工具 — 2026-04-11 CR S-07
 *
 * 替代散布在管线和记忆模块中的裸 `console.log/warn/error` 调用。
 * 生产 build 下 debug 级别输出自动关闭（通过 `import.meta.env.DEV`），
 * warn 和 error 始终输出。
 *
 * 用法：
 * ```ts
 * import { logger } from '../core/logger';
 * logger.debug('[MidTermRefine]', 'xxx');   // 开发环境可见，生产静默
 * logger.warn('[MidTermRefine]', 'xxx');     // 始终可见
 * logger.error('[MidTermRefine]', 'xxx');    // 始终可见
 * ```
 *
 * 设计考量：
 * - 不引入外部依赖（如 debug / pino），保持零依赖
 * - 不做日志收集 / 远程上报 —— 那是应用层的事
 * - 可扩展：未来需要日志收集时，只改此文件
 */

const isDev = typeof import.meta !== 'undefined'
  && typeof (import.meta as unknown as { env?: { DEV?: boolean } }).env !== 'undefined'
  && (import.meta as unknown as { env: { DEV?: boolean } }).env.DEV === true;

export const logger = {
  debug(...args: unknown[]): void {
    if (isDev) console.log(...args);
  },
  info(...args: unknown[]): void {
    if (isDev) console.info(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
