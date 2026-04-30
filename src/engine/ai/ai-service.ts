/**
 * AI 服务 — 统一的 AI 调用入口
 *
 * 职责：
 * 1. 管理多个 API 配置（APIConfig）和功能分配（APIAssignment）
 * 2. 根据 UsageType 路由到正确的 API 配置
 * 3. 创建对应的 Provider 实例发送请求
 * 4. 提供重试、取消、超时机制
 *
 * 移植自 demo aiService.ts，关键逻辑保留：
 * - executeWithRetry: 带退避延迟和取消检测的重试
 * - createTimeoutSignal: 合并用户取消和超时的 AbortSignal
 * - 去除酒馆模式（MVP 为独立 Web）
 *
 * 对应 STEP-03B M2.3。
 */
import type { APIConfig, GenerateOptions, UsageType, APIAssignment } from './types';
import { API_TIMEOUT_MS } from './types';
import type { BaseProvider } from './providers/base-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { ClaudeProvider } from './providers/claude-provider';
import { GeminiProvider } from './providers/gemini-provider';
import { eventBus } from '../core/event-bus';

export class AIService {
  /** 所有 API 配置（id → config） */
  private configs = new Map<string, APIConfig>();
  /** 功能分配（usageType → apiId） */
  private assignments = new Map<UsageType, string>();
  /** 当前的 AbortController — 用于取消请求 */
  private abortController: AbortController | null = null;
  /** 取消标志 — 用于在重试延迟期间检测取消 */
  private isAborted = false;
  /** 最大重试次数（0 = 不重试） */
  maxRetries = 1;

  // ─── 配置管理 ───

  /** 设置所有 API 配置 — 由 Pinia store 同步调用 */
  setConfigs(configs: APIConfig[]): void {
    this.configs.clear();
    for (const c of configs) this.configs.set(c.id, c);
  }

  /** 设置功能分配 */
  setAssignments(assignments: APIAssignment[]): void {
    this.assignments.clear();
    for (const a of assignments) this.assignments.set(a.type, a.apiId);
  }

  /**
   * 根据 UsageType 获取对应的 API 配置
   *
   * 查找策略区分 LLM 类和非 LLM 类 usage：
   *
   * - LLM 类 (main / world_generation / memory_summary 等):
   *   分配 → 默认 → 第一个可用 LLM
   *
   * - 非 LLM 类 (embedding / rerank):
   *   **只**在同类 API 中查找，不 fallback 到 LLM。原因：
   *   embedding API 走 /v1/embeddings 端点，rerank 走 /v1/rerank，
   *   把 LLM 代理的 URL 发过去会 404 或返回格式不兼容的响应，
   *   导致 Embedder/Reranker 静默 fallback 到伪实现（pseudoEmbed / scoreSort），
   *   用户看到"已向量化"但实际没调真正的 embedding API。
   *
   * 返回 undefined 时，调用方负责降级（Embedder → pseudoEmbed，Reranker → scoreSort）。
   */
  getConfigForUsage(usageType: UsageType): APIConfig | undefined {
    // 1. 显式分配的 API（最高优先级）
    const assignedId = this.assignments.get(usageType);
    if (assignedId) {
      const config = this.configs.get(assignedId);
      if (config?.enabled) return config;
    }

    // 2. 确定此 usage 需要的 API 类别
    const requiredCategory = usageType === 'embedding' ? 'embedding'
      : usageType === 'rerank' ? 'rerank'
      : usageType === 'imageGeneration' ? 'image'
      : 'llm';

    // 3. 非 LLM 类：只在同类 API 中查找，不 fallback 到 LLM
    if (requiredCategory !== 'llm') {
      for (const c of this.configs.values()) {
        if (c.enabled && (c.apiCategory ?? 'llm') === requiredCategory) return c;
      }
      return undefined;
    }

    // 4. LLM 类：分配 → default → 任意可用 LLM
    const defaultConfig = this.configs.get('default');
    if (defaultConfig?.enabled) return defaultConfig;
    for (const c of this.configs.values()) {
      if (c.enabled && (c.apiCategory ?? 'llm') === 'llm') return c;
    }
    return undefined;
  }

  // ─── 主调用方法 ───

  /**
   * 生成 AI 响应 — 带重试和超时
   * 所有 AI 调用都通过此方法
   */
  async generate(options: GenerateOptions): Promise<string> {
    // 在最外层重置取消状态（一次调用只重置一次）
    this.resetAbortState();

    return this.executeWithRetry(
      () => this.doGenerate(options),
      `generate(${options.usageType ?? 'main'})`,
    );
  }

  /** 取消当前请求（包括重试中的） */
  cancel(): void {
    this.isAborted = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  // ─── 内部实现 ───

  /** 重置取消状态 — 新请求开始前调用 */
  private resetAbortState(): void {
    this.isAborted = false;
    this.abortController = new AbortController();
  }

  /** 实际发送请求 */
  private async doGenerate(options: GenerateOptions): Promise<string> {
    const config = this.getConfigForUsage(options.usageType ?? 'main');
    if (!config) throw new Error('未配置可用的 API');

    const provider = this.createProvider(config);
    const { signal, cleanup } = this.createTimeoutSignal();

    eventBus.emit('ai:request-start', {
      usageType: options.usageType,
      model: config.model,
    });

    try {
      const result = await provider.generate({ ...options, signal });
      eventBus.emit('ai:response-complete', {
        usageType: options.usageType,
        length: result.length,
      });
      return result;
    } catch (err) {
      // ai:error 不在此处发——executeWithRetry 中每次失败都会走到这里，
      // 包括中间重试。过早发 ai:error 会导致 UI 在重试期间误认为生成结束。
      // 最终失败由 orchestrator 统一发 ai:error。
      throw err;
    } finally {
      cleanup();
    }
  }

  /**
   * 带重试的执行
   *
   * 移植自 demo 的 executeWithRetry，关键行为：
   * 1. 每次重试前检查取消状态
   * 2. 重试延迟期间也检查取消（每 100ms 一次）
   * 3. 取消信号或 abort 关键字立即停止
   * 4. 非取消错误才会重试
   * 5. 401（API Key 无效）立即停止重试，不等待退避
   * 6. 指数退避 + jitter：min(1000×2^(attempt-1) + random(0,500), 10000)ms
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 取消检查
      if (this.isAborted) throw new Error('请求已被取消');

      if (attempt > 0) {
        console.log(`[AIService] ${label} 重试 ${attempt}/${this.maxRetries}`);
        eventBus.emit('ai:retrying', { attempt, maxRetries: this.maxRetries, label });

        // 指数退避 + jitter，最长 10 秒
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 10000);
        for (let waited = 0; waited < delayMs; waited += 100) {
          if (this.isAborted) throw new Error('请求已被取消');
          await new Promise((r) => setTimeout(r, Math.min(100, delayMs - waited)));
        }
      }

      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        // 取消信号 → 立即停止，不重试
        if (
          this.isAborted ||
          lastError.message?.includes('取消') ||
          lastError.message?.includes('abort')
        ) {
          throw lastError;
        }
        // 401 认证失败 → 立即停止，不重试（重试无意义且延误用户发现配置错误）
        if (
          lastError.message?.includes('401') ||
          lastError.message?.toLowerCase().includes('unauthorized') ||
          lastError.message?.toLowerCase().includes('invalid api key')
        ) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error(`${label} 失败`);
  }

  /**
   * 创建兼顾用户取消和超时的 AbortSignal
   *
   * 返回 signal + cleanup 函数，调用方必须在 finally 中调用 cleanup()
   * 以释放定时器和事件监听器，避免长达 5 分钟的内存泄漏。
   */
  private createTimeoutSignal(): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    // 用户取消也触发此 signal
    const onUserAbort = () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
    this.abortController?.signal.addEventListener('abort', onUserAbort);

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        this.abortController?.signal.removeEventListener('abort', onUserAbort);
      },
    };
  }

  // ─── 连通测试 & 模型列表 ───

  /**
   * 真实 API 连通测试 — 发送最小测试请求，验证响应有效
   *
   * 超时：10s。不使用现有 config/assignment，直接用传入参数。
   *
   * §11.3: 按 apiCategory 发送不同的测试请求：
   * - 'llm'（或未指定）: POST /v1/chat/completions，验证 choices[0].message.content
   * - 'embedding':       POST /v1/embeddings，验证 data[0].embedding 是数组
   * - 'rerank':          POST /v1/rerank，验证 results 是数组
   *
   * 这使得用户在 APIPanel 中为不同类别的 API 测试连接时，
   * 真的命中它们实际会被调用的端点，而不是只测试 chat completion。
   */
  async testConnection(config: {
    url: string;
    apiKey: string;
    model: string;
    apiCategory?: 'llm' | 'embedding' | 'rerank' | 'image';
    /** 可选：自定义路径覆盖（仅 embedding/rerank 生效） */
    customRoutingPath?: string;
  }): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const category = config.apiCategory ?? 'llm';
    const start = Date.now();
    const baseUrl = config.url.replace(/\/+$/, '');

    // 按类别确定端点、请求体、响应校验
    let endpoint: string;
    let method: 'GET' | 'POST' = 'POST';
    let body: Record<string, unknown> | null;
    let validate: (data: unknown) => boolean;
    let invalidMsg: string;

    if (category === 'image') {
      endpoint = `${baseUrl}/v2/consumer/workflows?take=1`;
      method = 'GET';
      body = null;
      validate = (d) => d != null && typeof d === 'object';
      invalidMsg = '响应格式异常';
    } else if (category === 'embedding') {
      const defaultPath = '/v1/embeddings';
      const path = config.customRoutingPath?.trim() || defaultPath;
      endpoint = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
      body = { model: config.model, input: '连接测试' };
      validate = (d) => {
        const obj = d as { data?: Array<{ embedding?: unknown }> } | null;
        return !!(obj?.data?.[0]?.embedding && Array.isArray(obj.data[0].embedding));
      };
      invalidMsg = '响应格式异常（无 data[0].embedding 数组）';
    } else if (category === 'rerank') {
      const defaultPath = '/v1/rerank';
      const path = config.customRoutingPath?.trim() || defaultPath;
      endpoint = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
      body = {
        model: config.model,
        query: '连接测试',
        documents: ['foo', 'bar'],
        top_n: 2,
      };
      validate = (d) => {
        const obj = d as { results?: unknown } | null;
        return Array.isArray(obj?.results);
      };
      invalidMsg = '响应格式异常（无 results 数组）';
    } else {
      // LLM 类别（默认）
      // max_tokens 设为 100：thinking model（如 Gemini 2.5 Pro）会消耗部分 output
      // token 做内部推理（reasoning_tokens），10 token 根本不够输出文本，导致
      // finish_reason: "length" + content: ""。100 token 足够 thinking + 短回复。
      endpoint = `${baseUrl}/v1/chat/completions`;
      body = {
        model: config.model,
        messages: [{ role: 'user', content: '请仅输出数字 1' }],
        max_tokens: 100,
        stream: false,
      };
      validate = (d) => {
        const obj = d as { choices?: Array<{ message?: { content?: unknown } }> } | null;
        // 检测到 choices 结构即视为连通成功；content 可能为空字符串
        // （thinking model 的 reasoning 消耗完 token 后 content 可能为 ""）
        return !!(obj?.choices?.[0]?.message);
      };
      invalidMsg = '响应格式异常（无 choices[0].message）';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const fetchInit: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: controller.signal,
      };
      if (body) fetchInit.body = JSON.stringify(body);
      const res = await fetch(endpoint, fetchInit);
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        return { ok: false, latencyMs, error: `${res.status}: ${errText.slice(0, 120)}` };
      }

      const data = await res.json().catch(() => null);
      const isValid = validate(data);
      return {
        ok: isValid,
        latencyMs,
        error: isValid ? undefined : invalidMsg,
      };
    } catch (err) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('abort') || msg.includes('signal')) {
        return { ok: false, latencyMs, error: '连接超时（10s）' };
      }
      return { ok: false, latencyMs, error: msg.slice(0, 100) };
    }
  }

  /**
   * 拉取指定 API 支持的模型列表 — GET /v1/models
   * 超时：15s。不依赖现有配置，直接用传入参数。
   */
  async fetchModels(config: { url: string; apiKey: string }): Promise<string[]> {
    const baseUrl = config.url.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/v1/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      // OpenAI 格式: { data: [{id}] }；部分 providers 用 { models: [{id}] } 或直接 [{id}]
      const raw = (data?.data ?? data?.models ?? data ?? []) as Array<{ id: string } | string>;
      const ids = raw
        .map((m) => (typeof m === 'string' ? m : m?.id))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      return [...new Set(ids)].sort();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /** 根据 provider 类型创建对应的 Provider 实例 */
  private createProvider(config: APIConfig): BaseProvider {
    switch (config.provider) {
      case 'claude':
        return new ClaudeProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      case 'openai':
      case 'deepseek':
      case 'custom':
      default:
        return new OpenAIProvider(config);
    }
  }
}
