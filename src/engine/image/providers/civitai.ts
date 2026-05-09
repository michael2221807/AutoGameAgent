// App doc: docs/user-guide/pages/game-image.md §图片提炼 §参考重绘
import { BaseImageProvider, IMAGE_DOWNLOAD_TIMEOUT_MS } from './base';
import type { ImageBackendType } from '../types';
import type { ImageToImageProvider, ImageUnderstandingProvider } from '../provider-capabilities';
import type { ImageReferenceInput, ImageUnderstandingRequest, ImageUnderstandingResult, ImageUnderstandingTag } from '../reference-types';
import { clamp } from '../utils';

interface CivitaiImage {
  id: string;
  width: number;
  height: number;
  available: boolean;
  url?: string;
  urlExpiresAt?: string;
  previewUrl?: string;
  previewUrlExpiresAt?: string;
  jobId?: string;
  nsfwLevel?: string;
  blockedReason?: string;
}

interface CivitaiRecipeResponse {
  images?: CivitaiImage[];
  cost?: number;
  totalCost?: number;
  id?: string;
  status?: string;
  error?: string;
  message?: string;
}

export class CivitaiBlockedError extends Error {
  constructor(
    public readonly blockedReason?: string,
    public readonly nsfwLevel?: string,
  ) {
    const parts = ['[Civitai] 生成被拦截'];
    if (blockedReason) parts.push(`原因: ${blockedReason}`);
    if (nsfwLevel) parts.push(`内容级别: ${nsfwLevel}`);
    parts.push('提示: 请检查Civitai账号设置、会员状态和Buzz余额');
    super(parts.join(' — '));
    this.name = 'CivitaiBlockedError';
  }
}

function parseJsonOrThrow(json: string | undefined | null, fieldName: string): unknown {
  if (!json || typeof json !== 'string' || !json.trim()) return undefined;
  try { return JSON.parse(json); }
  catch (e) {
    throw new Error(`[Civitai] ${fieldName} JSON 格式错误: ${(e as Error).message}`);
  }
}

export class CivitaiImageProvider
  extends BaseImageProvider
  implements ImageToImageProvider, ImageUnderstandingProvider {

  readonly backend: ImageBackendType = 'civitai';

  // ── Shared helpers ──

  private buildQueryParams(options?: Record<string, unknown>): URLSearchParams {
    const params = new URLSearchParams();
    if (options?.allowMatureContent === true) params.set('allowMatureContent', 'true');
    if (options?.whatif === true) params.set('whatif', 'true');
    if (options?.experimental === true) params.set('experimental', 'true');
    return params;
  }

  private buildRecipeUrl(recipePath: string, options?: Record<string, unknown>): string {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    const qs = this.buildQueryParams(options).toString();
    return `${endpoint}${recipePath}${qs ? '?' + qs : ''}`;
  }

  private buildTextToImageBody(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt,
      width: Number.isFinite(width) ? width : 1024,
      height: Number.isFinite(height) ? height : 1024,
      quantity: 1,
      batchSize: 1,
    };
    if (this.model) body.model = this.model;
    if (negative) body.negativePrompt = negative;
    if (options?.scheduler) body.scheduler = options.scheduler;
    if (options?.steps != null) body.steps = options.steps;
    if (options?.cfgScale != null) body.cfgScale = options.cfgScale;
    if (options?.clipSkip != null) body.clipSkip = options.clipSkip;
    if (options?.outputFormat) body.outputFormat = options.outputFormat;
    const seed = typeof options?.seed === 'number' ? options.seed : undefined;
    if (seed !== undefined && seed >= 0) body.seed = seed;

    const networks = parseJsonOrThrow(
      options?.additionalNetworksJson as string | undefined,
      '附加网络 (additionalNetworks)',
    );
    if (networks) body.additionalNetworks = networks;

    const controlNets = parseJsonOrThrow(
      options?.controlNetsJson as string | undefined,
      'ControlNet',
    );
    if (controlNets) body.controlNets = controlNets;

    return body;
  }

  private async executeTextToImageRecipe(
    url: string,
    body: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      if (response.status === 401) throw new Error('[Civitai] API Key 无效或已过期');
      if (response.status === 400) throw new Error(`[Civitai] 请求参数错误 — ${errBody.slice(0, 200)}`);
      if (response.status === 402) throw new Error('[Civitai] Buzz 余额不足');
      if (response.status === 429) throw new Error('[Civitai] 请求过于频繁，请稍后再试');
      throw new Error(`[Civitai] 生成失败: ${response.status} — ${errBody.slice(0, 200)}`);
    }

    let data: CivitaiRecipeResponse;
    const rawText = await response.text();
    try {
      data = JSON.parse(rawText) as CivitaiRecipeResponse;
    } catch {
      throw new Error(`[Civitai] 响应解析失败 (非 JSON) — ${rawText.slice(0, 200)}`);
    }

    if (options?.whatif === true) {
      const cost = data.cost ?? data.totalCost ?? '未知';
      throw new Error(`[Civitai] 预览模式 — 预计消耗 ${cost} Buzz，未实际生成`);
    }

    let image = data.images?.[0];
    if (!image) {
      throw new Error(`[Civitai] 响应中无图片数据 — ${JSON.stringify(data).slice(0, 200)}`);
    }
    if (image.blockedReason) {
      throw new CivitaiBlockedError(image.blockedReason, image.nsfwLevel);
    }

    if (!image.available || !image.url) {
      image = await this.pollUntilAvailable(this.endpoint.replace(/\/+$/, ''), data, image);
    }

    const imageUrl = new URL(image.url!);
    if (imageUrl.protocol !== 'https:') {
      throw new Error(`[Civitai] 图片 URL 必须为 HTTPS (实际: ${imageUrl.protocol})`);
    }
    const blobResponse = await fetch(image.url!, { signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) });
    if (!blobResponse.ok) {
      throw new Error(`[Civitai] 下载图片失败: ${blobResponse.status}`);
    }
    return blobResponse.blob();
  }

  // ── text-to-image (existing) ──

  async generate(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const body = this.buildTextToImageBody(prompt, negative, width, height, options);
    const url = this.buildRecipeUrl('/v2/consumer/recipes/textToImage', options);
    return this.executeTextToImageRecipe(url, body, options);
  }

  // ── Media URL resolution with blob upload fallback ──

  /**
   * Resolve a media reference to a URL suitable for Civitai recipes.
   * Data URLs are passed through directly — Civitai recipes may accept them.
   * If a recipe rejects a data URL (Phase 0 validation will determine this),
   * callers should catch the error and retry via `uploadAndRetry()`.
   */
  /**
   * For textToImage sourceImage: pass through directly (accepts data URL per swagger — no format constraint).
   * For wdTagging/mediaCaptioning mediaUrl: MUST be a real URL (format: "uri").
   * Use `uploadForMediaUrl()` for understanding endpoints.
   */
  private ensureSourceImage(dataUrlOrUrl: string): string {
    return dataUrlOrUrl;
  }

  /**
   * Upload a data URL to Civitai via recipes/imageUpload and return a hosted URL.
   * Required for wdTagging/mediaCaptioning which only accept format: "uri" (not data URLs).
   * Per swagger: imageUpload body is a bare JSON string (not an object), returns { blob: { url, id, ... } }.
   */
  private async uploadForMediaUrl(
    dataUrl: string,
    options?: Record<string, unknown>,
  ): Promise<string> {
    if (!dataUrl.startsWith('data:')) return dataUrl;

    const uploadUrl = this.buildRecipeUrl('/v2/consumer/recipes/imageUpload', options);
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(dataUrl),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`[Civitai] 图片上传失败: ${res.status} — ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { blob?: { url?: string; id?: string } };
    const blobUrl = data.blob?.url;
    if (blobUrl) return blobUrl;
    const blobId = data.blob?.id;
    if (blobId) return blobId;

    throw new Error('[Civitai] 图片上传成功但未返回可用 URL');
  }

  // ── image-to-image ──

  async imageToImage(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    reference: ImageReferenceInput,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const body = this.buildTextToImageBody(prompt, negative, width, height, options);

    const rawSource = reference.dataUrl ?? reference.url;
    if (!rawSource) {
      throw new Error('[Civitai] 参考图缺少 dataUrl 或 url');
    }
    body.sourceImage = this.ensureSourceImage(rawSource);
    // Civitai official API typo: "Strenght" not "Strength"
    body.sourceImageDenoiseStrenght = clamp(reference.denoiseStrength ?? 0.65, 0, 1);

    const url = this.buildRecipeUrl('/v2/consumer/recipes/textToImage', options);
    return this.executeTextToImageRecipe(url, body, options);
  }

  // ── image understanding (wdTagging / mediaCaptioning) ──

  async describeImage(
    request: ImageUnderstandingRequest,
    options?: Record<string, unknown>,
  ): Promise<ImageUnderstandingResult> {
    const rawMediaUrl = request.image.dataUrl ?? request.image.url;
    if (!rawMediaUrl) {
      throw new Error('[Civitai] 提炼图片缺少 dataUrl 或 url');
    }
    const mediaUrl = await this.uploadForMediaUrl(rawMediaUrl, options);

    let tags: ImageUnderstandingTag[] = [];
    let caption: string | undefined;

    const needTags = request.task === 'tags' || request.task === 'both';
    const needCaption = request.task === 'caption' || request.task === 'both';

    if (needTags && needCaption) {
      tags = await this.callWdTagging(mediaUrl, request, options);
      try {
        caption = await this.callMediaCaptioning(mediaUrl, request, options);
      } catch (err) {
        console.warn('[Civitai] Captioning failed, returning tags-only result:', (err as Error).message);
        caption = undefined;
      }
    } else if (needTags) {
      tags = await this.callWdTagging(mediaUrl, request, options);
    } else if (needCaption) {
      caption = await this.callMediaCaptioning(mediaUrl, request, options);
    }

    const tagString = tags
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .map((t) => t.text)
      .join(', ');

    let positiveDraft: string;
    if (request.task === 'both') {
      positiveDraft = [tagString, caption].filter(Boolean).join(', ');
    } else if (request.task === 'tags') {
      positiveDraft = tagString;
    } else {
      positiveDraft = caption ?? '';
    }

    return {
      provider: 'civitai',
      task: request.task,
      caption,
      tags: tags.length > 0 ? tags : undefined,
      positiveDraft,
      createdAt: Date.now(),
    };
  }

  private async callWdTagging(
    mediaUrl: string,
    request: ImageUnderstandingRequest,
    options?: Record<string, unknown>,
  ): Promise<ImageUnderstandingTag[]> {
    const body: Record<string, unknown> = { mediaUrl };
    if (request.threshold != null) body.threshold = request.threshold;
    if (request.prompt) body.prompt = request.prompt;

    const url = this.buildRecipeUrl('/v2/consumer/recipes/wdTagging', options);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`[Civitai] WD Tagging 失败: ${response.status} — ${errText.slice(0, 200)}`);
    }

    const rawText = await response.text();
    let data: { tags?: Record<string, number>; rating?: Record<string, number> | null };
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`[Civitai] WD Tagging 响应解析失败 (非 JSON) — ${rawText.slice(0, 200)}`); }

    if (!data.tags || typeof data.tags !== 'object') return [];

    return Object.entries(data.tags).map(([text, confidence]) => ({
      text,
      confidence,
    }));
  }

  /**
   * Media captioning via recipe endpoint with 204 retry.
   * JoyCaption VLM is slow — recipe may return 204 (accepted, not complete).
   * On 204: retry the same request up to 5 times with backoff.
   * If all retries return 204, fallback to workflow API with polling.
   */
  private async callMediaCaptioning(
    mediaUrl: string,
    request: ImageUnderstandingRequest,
    options?: Record<string, unknown>,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      mediaUrl,
      temperature: request.temperature ?? 0.2,
      maxNewTokens: request.maxNewTokens ?? 160,
    };
    const url = this.buildRecipeUrl('/v2/consumer/recipes/mediaCaptioning', options);

    // Try recipe endpoint with 204 retry
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * attempt));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (response.status === 204) continue;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`[Civitai] Media Captioning 失败: ${response.status} — ${errText.slice(0, 200)}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const rawText = await response.text();
      if (!rawText.trim()) continue;

      let data: { caption?: string };
      try { data = JSON.parse(rawText); }
      catch { throw new Error(`[Civitai] Media Captioning 响应解析失败 (content-type: ${contentType}) — ${rawText.slice(0, 300)}`); }
      return data.caption ?? '';
    }

    // Recipe exhausted — try workflow API as fallback
    return this.callMediaCaptioningViaWorkflow(mediaUrl, request, options);
  }

  private async callMediaCaptioningViaWorkflow(
    mediaUrl: string,
    request: ImageUnderstandingRequest,
    options?: Record<string, unknown>,
  ): Promise<string> {
    const endpoint = this.endpoint.replace(/\/+$/, '');

    const workflowBody = {
      steps: [{
        $type: 'mediaCaptioning',
        input: {
          mediaUrl,
          temperature: request.temperature ?? 0.5,
          maxNewTokens: request.maxNewTokens ?? 300,
        },
        priority: 'normal',
        timeout: '00:02:00',
      }],
      currencies: ['yellow', 'blue'],
      allowMatureContent: options?.allowMatureContent === true,
    };

    const response = await fetch(`${endpoint}/v2/consumer/workflows?wait=120`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify(workflowBody),
      signal: AbortSignal.timeout(180_000),
    });

    const rawText = await response.text();
    if (!rawText.trim()) {
      throw new Error('[Civitai] Media Captioning workflow 返回空响应');
    }

    let data: Record<string, unknown>;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`[Civitai] Media Captioning workflow 响应解析失败 — ${rawText.slice(0, 300)}`); }

    const status = String(data.status ?? '');
    if (status === 'succeeded' || status === 'completed') {
      const steps = data.steps as Array<Record<string, unknown>> | undefined;
      const output = steps?.[0]?.output as Record<string, unknown> | undefined;
      if (output?.caption) return String(output.caption);
      return '';
    }

    if (status === 'failed') {
      const steps = data.steps as Array<Record<string, unknown>> | undefined;
      const jobs = steps?.[0]?.jobs as Array<Record<string, unknown>> | undefined;
      const reason = jobs?.[0]?.reason ?? jobs?.[0]?.status ?? 'unknown';
      throw new Error(`[Civitai] Media Captioning 失败 (${reason})。JoyCaption 服务可能暂时不可用，请尝试"标签"模式。`);
    }

    // 202 — poll
    const workflowId = data.id;
    if (!workflowId || typeof workflowId !== 'string') {
      throw new Error('[Civitai] Media Captioning workflow 无 ID');
    }

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const pollRes = await fetch(`${endpoint}/v2/consumer/workflows/${workflowId}?wait=true`, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(65_000),
        });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json() as Record<string, unknown>;
        const s = String(pollData.status ?? '');
        if (s === 'succeeded' || s === 'completed') {
          const steps = pollData.steps as Array<Record<string, unknown>> | undefined;
          const output = steps?.[0]?.output as Record<string, unknown> | undefined;
          return output?.caption ? String(output.caption) : '';
        }
        if (s === 'failed' || s === 'expired') {
          throw new Error(`[Civitai] Media Captioning workflow ${s}。请尝试"标签"模式。`);
        }
      } catch (err) {
        if ((err as Error).message?.includes('Civitai')) throw err;
      }
    }
    throw new Error('[Civitai] Media Captioning 等待超时，请尝试"标签"模式');
  }

  // ── Polling ──

  private async pollUntilAvailable(
    endpoint: string,
    initialData: CivitaiRecipeResponse,
    initialImage: CivitaiImage,
  ): Promise<CivitaiImage> {
    const jobToken = initialData.id ?? initialImage.jobId;
    if (!jobToken) {
      throw new Error('[Civitai] 图片尚未就绪且无法获取任务 ID 用于轮询');
    }

    const maxAttempts = 60;
    const pollInterval = 3000;
    const pollUrl = `${endpoint}/v2/consumer/jobs/${jobToken}`;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval));

      let pollRes: Response;
      try {
        pollRes = await fetch(pollUrl, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        continue;
      }
      if (!pollRes.ok) continue;

      let pollData: CivitaiRecipeResponse;
      try {
        pollData = await pollRes.json() as CivitaiRecipeResponse;
      } catch { continue; }

      const img = pollData.images?.[0];
      if (!img) continue;
      if (img.blockedReason) {
        throw new CivitaiBlockedError(img.blockedReason, img.nsfwLevel);
      }
      if (img.available && img.url) return img;
    }

    throw new Error(`[Civitai] 等待图片就绪超时 (${maxAttempts * pollInterval / 1000}s)`);
  }

  async testConnection(): Promise<boolean> {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/v2/consumer/workflows?take=1`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch { return false; }
  }
}
