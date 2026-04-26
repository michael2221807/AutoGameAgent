/**
 * Network-failure diagnostic helper for local image providers (ComfyUI,
 * SD-WebUI). When a `fetch` to a user-hosted image server fails, the browser
 * raises an opaque `TypeError: Failed to fetch`. That covers a mix of
 * conditions (server down, CORS block, invalid URL) — pretty much all
 * indistinguishable from the client side.
 *
 * The single most common cause in dev is CORS: localhost servers like
 * ComfyUI / SD-WebUI don't send `Access-Control-Allow-Origin` by default,
 * so the browser blocks responses even though the server accepted the
 * request. Per PRINCIPLES §3.12 we can't add a Vite proxy or any built-in
 * CORS workaround — the fix belongs to the user's deployment. The least we
 * can do is give them a clear error that names the exact command.
 */

/** Backends that run locally and typically hit CORS issues. */
export type LocalImageBackend = 'comfyui' | 'sd_webui';

/** Describes the concrete fix the user needs to apply, per backend. */
const BACKEND_FIX_HINTS: Record<LocalImageBackend, string> = {
  comfyui: '以 `python main.py --enable-cors-header "*"` 启动 ComfyUI，或在其前置一个允许跨域的反向代理（nginx / Cloudflare Worker）再把 AGA 指向代理地址',
  sd_webui: '以 `--cors-allow-origins="*"` 参数启动 SD-WebUI（例如 `./webui.sh --api --cors-allow-origins="*"`），或在其前置一个允许跨域的反向代理',
};

/**
 * Wrap any fetch-throwing error from a local image provider with a message
 * that surfaces the likely CORS cause and the exact remediation steps.
 */
export function describeNetworkFailure(
  backend: LocalImageBackend,
  endpoint: string,
  err: unknown,
): Error {
  const hint = BACKEND_FIX_HINTS[backend] ?? '检查服务器是否已启用跨域（CORS）';
  const isLocal = /localhost|127\.0\.0\.1/.test(endpoint);

  if (err instanceof TypeError) {
    // TypeError on fetch = network/CORS failure. Most common case on localhost.
    const locality = isLocal ? '本地 ' : '';
    return new Error(
      `[${backend}] 无法连接到 ${locality}${endpoint}。` +
      `最常见原因是 CORS —— 浏览器拒绝了跨域响应。修复方式：${hint}。` +
      `原始错误：${err.message}`,
    );
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.toLowerCase().includes('abort')) {
      return new Error(`[${backend}] 请求已取消或超时`);
    }
    // Other errors pass through with backend prefix for easier debugging.
    return new Error(`[${backend}] ${err.message}`);
  }

  return new Error(`[${backend}] 未知网络错误：${String(err)}`);
}

/**
 * Fetch wrapper that converts network/CORS failures into human-readable
 * errors via `describeNetworkFailure`. Non-network errors (HTTP 4xx/5xx)
 * are left for the caller to handle from `response.ok`.
 */
export async function fetchWithDiagnostic(
  backend: LocalImageBackend,
  endpoint: string,
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw describeNetworkFailure(backend, endpoint, err);
  }
}
