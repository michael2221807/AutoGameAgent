/**
 * SD-WebUI Image Provider — Sprint Image-6
 *
 * Automatic1111 / Forge SD-WebUI integration.
 * Endpoint: user-configured (typically http://localhost:7860).
 * API: POST /sdapi/v1/txt2img
 *
 * Full implementation — calls the real SD-WebUI API.
 */
import { BaseImageProvider } from './base';
import type { ImageBackendType } from '../types';
import { fetchWithDiagnostic } from './network-diagnostic';

export class SDWebUIImageProvider extends BaseImageProvider {
  readonly backend: ImageBackendType = 'sd_webui';

  async generate(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const steps = (options?.steps as number) ?? 28;
    const cfgScale = (options?.cfgScale as number) ?? 7;
    const sampler = (options?.sampler as string) ?? 'Euler a';
    const seed = (options?.seed as number) ?? -1;

    const body = {
      prompt,
      negative_prompt: negative,
      width,
      height,
      steps,
      cfg_scale: cfgScale,
      sampler_name: sampler,
      seed,
      n_iter: 1,
      batch_size: 1,
    };

    const endpoint = this.endpoint.replace(/\/+$/, '');
    // Diagnostic wrapper: converts opaque TypeError (CORS / server down) into
    // a human-readable error that names the --cors-allow-origins flag.
    const response = await fetchWithDiagnostic('sd_webui', endpoint, `${endpoint}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(`[SD-WebUI] Generation failed: ${response.status} — ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as { images?: string[] };
    const b64 = data.images?.[0];
    if (!b64) throw new Error('[SD-WebUI] No image data in response');

    const clean = b64.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  }

  async testConnection(): Promise<boolean> {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    try {
      const res = await fetchWithDiagnostic('sd_webui', endpoint, `${endpoint}/sdapi/v1/sd-models`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
