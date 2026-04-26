/**
 * ComfyUI Image Provider.
 *
 * ComfyUI integration. Endpoint user-configured (typically http://localhost:8188).
 *
 * Two workflow modes:
 *
 * 1. **Template mode** (preferred): user pastes their own API-format workflow
 *    JSON into Settings → ComfyUI → Workflow JSON. AGA substitutes placeholders
 *    (`__PROMPT__`, `{{prompt}}`, `%prompt%`, `%WIDTH%`, etc.) and POSTs the
 *    substituted JSON. All the user's LoRAs, custom nodes, and checkpoints
 *    flow through unchanged.
 *
 * 2. **Basic fallback**: if no template is provided, we build a minimal SD1.5
 *    txt2img workflow. `this.model` (= the API config's `model` field) is used
 *    as the checkpoint name — it MUST be set, because ComfyUI has no concept
 *    of a default checkpoint and hardcoding one (e.g., `v1-5-pruned-emaonly`)
 *    causes 400s on any install that doesn't have that exact file.
 */
import { BaseImageProvider } from './base';
import type { ImageBackendType } from '../types';
import { fetchWithDiagnostic, describeNetworkFailure } from './network-diagnostic';

export class ComfyUIImageProvider extends BaseImageProvider {
  readonly backend: ImageBackendType = 'comfyui';

  async generate(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob> {
    const seed = (options?.seed as number) ?? Math.floor(Math.random() * 4294967295);
    const steps = (options?.steps as number) ?? 20;
    const cfgScale = (options?.cfgScale as number) ?? 7;
    const workflowTemplate = typeof options?.workflowTemplate === 'string'
      ? options.workflowTemplate.trim()
      : '';

    let workflow: Record<string, unknown>;
    if (workflowTemplate) {
      console.log('[ComfyUI] Using user-provided workflow template', {
        templateLength: workflowTemplate.length,
        templatePreview: workflowTemplate.slice(0, 120),
      });
      workflow = this.renderWorkflowTemplate(workflowTemplate, {
        prompt, negative, width, height, seed, steps, cfgScale,
      });
    } else {
      if (!this.model || !this.model.trim()) {
        throw new Error(
          '[ComfyUI] 未配置 checkpoint 模型。请在 API 配置的 model 字段填入 checkpoint 文件名（例如 unholyDesireMixSinister_v70.safetensors），' +
          '或在 图像生成 → 设置 → ComfyUI 里粘贴你自己的 API workflow JSON。',
        );
      }
      console.log('[ComfyUI] Using built-in basic workflow with checkpoint:', this.model);
      workflow = this.buildBasicWorkflow(prompt, negative, width, height, seed, steps, cfgScale, this.model);
    }

    const endpoint = this.endpoint.replace(/\/+$/, '');
    // Diagnostic: dump the values we're injecting + preview the final workflow so
    // the user can verify in DevTools that attribute substitution actually landed.
    console.log('[ComfyUI] Injected values:', {
      promptLen: prompt.length,
      promptPreview: prompt.slice(0, 100),
      negativeLen: negative.length,
      negativePreview: negative.slice(0, 100),
      width,
      height,
      seed,
      steps,
      cfgScale,
    });
    const workflowJsonPreview = JSON.stringify(workflow).slice(0, 400);
    console.log('[ComfyUI] Final workflow preview (first 400 chars):', workflowJsonPreview);

    // fetchWithDiagnostic converts opaque TypeErrors (CORS / network down) into
    // user-facing errors that name the ComfyUI flag to enable (see
    // network-diagnostic.ts). HTTP 4xx/5xx still flow through as-is.
    const queueRes = await fetchWithDiagnostic('comfyui', endpoint, `${endpoint}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!queueRes.ok) {
      const errText = await queueRes.text().catch(() => `HTTP ${queueRes.status}`);
      throw new Error(`[ComfyUI] Queue failed: ${queueRes.status} — ${errText.slice(0, 200)}`);
    }

    const { prompt_id } = await queueRes.json() as { prompt_id: string };

    const imageData = await this.pollForResult(endpoint, prompt_id, options?.signal as AbortSignal | undefined);
    return imageData;
  }

  /**
   * Substitute runtime values into a user-provided workflow JSON template.
   *
   * Supports three placeholder styles so users can paste templates from any
   * source (MRJH-style `%prompt%`, ComfyUI-plugin-style `{{prompt}}`,
   * script-style `__PROMPT__`). Placeholder matching is case-insensitive for
   * the token part. Substitution happens on the raw string before JSON.parse
   * so placeholders can sit inside quoted strings OR unquoted numeric fields
   * (e.g., `"width": %WIDTH%` after substitution becomes `"width": 1024`).
   */
  private renderWorkflowTemplate(
    template: string,
    vars: { prompt: string; negative: string; width: number; height: number; seed: number; steps: number; cfgScale: number },
  ): Record<string, unknown> {
    const replacements: Array<[RegExp, string]> = [
      // Positive prompt — JSON-escape (newlines/quotes) since users type multi-line text.
      [/__PROMPT__|\{\{prompt\}\}|%prompt%/gi, escapeForJsonString(vars.prompt)],
      // Negative prompt
      [/__NEGATIVE_PROMPT__|\{\{negative_prompt\}\}|%negative_prompt%/gi, escapeForJsonString(vars.negative)],
      // Numeric values — inserted bare; users put them in quoted strings for
      // their workflow's own StringToInt nodes (as in the user's template) or
      // directly as numeric fields.
      [/__WIDTH__|\{\{width\}\}|%WIDTH%/gi, String(vars.width)],
      [/__HEIGHT__|\{\{height\}\}|%HEIGHT%/gi, String(vars.height)],
      [/__STEPS__|\{\{steps\}\}|%STEPS%/gi, String(vars.steps)],
      [/__CFG__|\{\{cfg\}\}|%CFG%/gi, String(vars.cfgScale)],
      [/__SEED__|\{\{seed\}\}|%SEED%/gi, String(vars.seed)],
    ];

    let rendered = template;
    for (const [pattern, value] of replacements) {
      rendered = rendered.replace(pattern, value);
    }

    try {
      const parsed = JSON.parse(rendered);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('workflow 模板必须是对象形式（ComfyUI API 格式）');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `[ComfyUI] Workflow 模板解析失败：${(err as Error).message}。` +
        '请确认粘贴的是 ComfyUI 的 "Save (API format)" 导出文件，不是普通 workflow.json。',
      );
    }
  }

  async testConnection(): Promise<boolean> {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    try {
      const res = await fetchWithDiagnostic('comfyui', endpoint, `${endpoint}/system_stats`, {
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      // testConnection returns bool by contract — swallow the diagnostic here
      // and let the UI surface "connection failed" with its own toast. The
      // actual error message is available during generate() instead.
      return false;
    }
  }

  private buildBasicWorkflow(
    prompt: string, negative: string,
    width: number, height: number,
    seed: number, steps: number, cfg: number, ckpt: string,
  ): Record<string, unknown> {
    return {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
          seed, steps, cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'AGA' } },
    };
  }

  private async pollForResult(endpoint: string, promptId: string, signal?: AbortSignal): Promise<Blob> {
    const maxAttempts = 120;
    let lastNetworkError: Error | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) throw new Error('[ComfyUI] Generation cancelled');
      await new Promise((r) => setTimeout(r, 1000));
      if (signal?.aborted) throw new Error('[ComfyUI] Generation cancelled');

      let historyRes: Response | null = null;
      try {
        historyRes = await fetch(`${endpoint}/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        // Track CORS/network failures during polling so that if we later time
        // out, the thrown error names the actual cause instead of a silent
        // "Timeout waiting for prompt".
        lastNetworkError = describeNetworkFailure('comfyui', endpoint, err);
        continue;
      }
      if (!historyRes?.ok) continue;

      const history = await historyRes.json() as Record<string, {
        outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
      }>;

      const entry = history[promptId];
      if (!entry?.outputs) continue;

      for (const nodeOutput of Object.values(entry.outputs)) {
        const images = nodeOutput.images;
        if (images?.length) {
          const img = images[0];
          const imgRes = await fetchWithDiagnostic(
            'comfyui',
            endpoint,
            `${endpoint}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (imgRes.ok) return imgRes.blob();
        }
      }
    }

    if (lastNetworkError) throw lastNetworkError;
    throw new Error(`[ComfyUI] Timeout waiting for prompt ${promptId} after ${maxAttempts}s`);
  }
}

/**
 * Escape an arbitrary user string for safe insertion into a JSON template
 * string literal. Handles quotes, backslashes, newlines, tabs, control chars.
 * Uses `JSON.stringify` + strip outer quotes — that's the single correct way
 * to get a JSON-safe fragment without hand-rolling an escaper.
 */
function escapeForJsonString(input: string): string {
  const quoted = JSON.stringify(input ?? '');
  return quoted.slice(1, -1);
}
