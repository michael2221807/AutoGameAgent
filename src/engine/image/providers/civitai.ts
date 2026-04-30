import { BaseImageProvider } from './base';
import type { ImageBackendType } from '../types';

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

export class CivitaiImageProvider extends BaseImageProvider {
  readonly backend: ImageBackendType = 'civitai';

  async generate(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
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
    const seed = options?.seed as number | undefined;
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

    const params = new URLSearchParams();
    if (options?.allowMatureContent === true) params.set('allowMatureContent', 'true');
    if (options?.whatif === true) params.set('whatif', 'true');
    if (options?.experimental === true) params.set('experimental', 'true');

    const endpoint = this.endpoint.replace(/\/+$/, '');
    const qs = params.toString();
    const url = `${endpoint}/v2/consumer/recipes/textToImage${qs ? '?' + qs : ''}`;

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

    const image = data.images?.[0];
    if (!image) {
      throw new Error(`[Civitai] 响应中无图片数据 — ${JSON.stringify(data).slice(0, 200)}`);
    }
    if (image.blockedReason) {
      throw new CivitaiBlockedError(image.blockedReason, image.nsfwLevel);
    }
    if (!image.available || !image.url) {
      throw new Error('[Civitai] 图片尚未就绪 (available=false)');
    }

    const imageUrl = new URL(image.url);
    if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') {
      throw new Error(`[Civitai] 图片 URL 协议不合法: ${imageUrl.protocol}`);
    }
    const blobResponse = await fetch(image.url);
    if (!blobResponse.ok) {
      throw new Error(`[Civitai] 下载图片失败: ${blobResponse.status}`);
    }
    return blobResponse.blob();
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
