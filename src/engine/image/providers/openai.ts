/**
 * OpenAI DALL-E Image Provider — Sprint Image-5
 *
 * Implements image generation via OpenAI's /v1/images/generations endpoint.
 * Supports DALL-E 3 and DALL-E 2.
 *
 * Per PRINCIPLES §3.12: user configures endpoint directly in API settings.
 */
import { BaseImageProvider } from './base';
import type { ImageBackendType } from '../types';

export class OpenAIImageProvider extends BaseImageProvider {
  readonly backend: ImageBackendType = 'openai';

  async generate(
    prompt: string,
    _negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const model = this.model || 'dall-e-3';
    const size = this.resolveSize(width, height, model);
    const quality = (options?.quality as string) ?? 'standard';
    const style = (options?.style as string) ?? 'vivid';

    const body: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    };

    if (model === 'dall-e-3') {
      body.quality = quality;
      body.style = style;
    }

    const endpoint = this.endpoint.replace(/\/+$/, '');
    const response = await fetch(`${endpoint}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`[OpenAI] Image generation failed: ${response.status} — ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      const url = data.data?.[0]?.url;
      if (url) {
        const imgResponse = await fetch(url);
        return imgResponse.blob();
      }
      throw new Error('[OpenAI] No image data in response');
    }

    const clean = b64.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }

  async testConnection(): Promise<boolean> {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/v1/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private resolveSize(w: number, h: number, model: string): string {
    if (model === 'dall-e-3') {
      if (w > h) return '1792x1024';
      if (h > w) return '1024x1792';
      return '1024x1024';
    }
    return w <= 512 ? '256x256' : w <= 768 ? '512x512' : '1024x1024';
  }
}
