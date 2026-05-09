import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CivitaiImageProvider, CivitaiBlockedError } from './civitai';
import { supportsImageToImage, supportsImageUnderstanding } from '../provider-capabilities';
import type { ImageReferenceInput, ImageUnderstandingRequest } from '../reference-types';

function makeProvider(model = 'urn:air:sdxl:checkpoint:civitai:101055@128078'): CivitaiImageProvider {
  return new CivitaiImageProvider('https://orchestration.civitai.com', 'test-key', model);
}

function mockFetchSequence(...responses: Array<{ status: number; body?: unknown; blob?: Blob; text?: string; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let callIndex = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? 'OK' : 'Error',
      headers: new Headers(resp.headers ?? { 'content-type': 'application/json' }),
      text: async () => resp.text ?? JSON.stringify(resp.body ?? {}),
      json: async () => resp.body,
      blob: async () => resp.blob ?? new Blob(['fake-image'], { type: 'image/jpeg' }),
    } as unknown as Response;
  }));
  return calls;
}

function makeReference(overrides?: Partial<ImageReferenceInput>): ImageReferenceInput {
  return {
    id: 'ref_test',
    role: 'source',
    source: 'data_url',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    denoiseStrength: 0.65,
    ...overrides,
  };
}

function makeUnderstandingRequest(task: 'tags' | 'caption' | 'both', overrides?: Partial<ImageUnderstandingRequest>): ImageUnderstandingRequest {
  return {
    backend: 'civitai',
    image: makeReference(),
    task,
    threshold: 0.35,
    temperature: 0.2,
    maxNewTokens: 160,
    ...overrides,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('CivitaiImageProvider', () => {
  // ── Capability type guards ──

  describe('capability interfaces', () => {
    it('supportsImageToImage returns true', () => {
      expect(supportsImageToImage(makeProvider())).toBe(true);
    });

    it('supportsImageUnderstanding returns true', () => {
      expect(supportsImageUnderstanding(makeProvider())).toBe(true);
    });
  });

  // ── generate() — all existing tests preserved ──

  describe('generate()', () => {
    it('returns blob on successful generation', async () => {
      const imageBlob = new Blob(['png-data'], { type: 'image/png' });
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'test.jpeg', width: 1024, height: 1024, available: true, url: 'https://orchestration-new.civitai.com/v2/consumer/blobs/test.jpeg?sig=abc' }] } },
        { status: 200, blob: imageBlob },
      );

      const result = await makeProvider().generate('a cat', 'bad', 1024, 1024);
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('image/png');
    });

    it('sends model, prompt, negative, dimensions in request body', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 512, height: 768 }] } },
        { status: 200 },
      );

      await makeProvider().generate('masterpiece', 'lowres', 512, 768);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.model).toBe('urn:air:sdxl:checkpoint:civitai:101055@128078');
      expect(body.prompt).toBe('masterpiece');
      expect(body.negativePrompt).toBe('lowres');
      expect(body.width).toBe(512);
      expect(body.height).toBe(768);
      expect(body.quantity).toBe(1);
      expect(body.batchSize).toBe(1);
    });

    it('passes allowMatureContent in query string', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, { allowMatureContent: true });
      expect(calls[0].url).toContain('allowMatureContent=true');
    });

    it('does not include allowMatureContent when false', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, { allowMatureContent: false });
      expect(calls[0].url).not.toContain('allowMatureContent');
    });

    it('passes scheduler, steps, cfgScale, clipSkip, seed in body', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, {
        scheduler: 'EulerA',
        steps: 25,
        cfgScale: 7,
        clipSkip: 2,
        seed: 42,
      });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.scheduler).toBe('EulerA');
      expect(body.steps).toBe(25);
      expect(body.cfgScale).toBe(7);
      expect(body.clipSkip).toBe(2);
      expect(body.seed).toBe(42);
    });

    it('includes cfgScale=0 and steps=0 in body (null-safe guard)', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, { steps: 0, cfgScale: 0 });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.steps).toBe(0);
      expect(body.cfgScale).toBe(0);
    });

    it('omits seed when -1 (random)', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, { seed: -1 });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.seed).toBeUndefined();
    });

    it('throws CivitaiBlockedError when blockedReason is present', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: false, blockedReason: 'content_policy', nsfwLevel: 'xxx' }] } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow(CivitaiBlockedError);

      try {
        await makeProvider().generate('test', '', 1024, 1024);
      } catch (e) {
        expect((e as CivitaiBlockedError).blockedReason).toBe('content_policy');
        expect((e as CivitaiBlockedError).nsfwLevel).toBe('xxx');
        expect((e as Error).message).toContain('content_policy');
      }
    });

    it('throws when image is not available and no job ID for polling', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: false }] } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('无法获取任务 ID');
    });

    it('throws when response has no images', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [] } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('响应中无图片数据');
    });

    it('throws descriptive error on whatif mode', async () => {
      mockFetchSequence(
        { status: 200, body: { cost: 6, totalCost: 6 } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024, { whatif: true }))
        .rejects.toThrow(/预览模式.*6 Buzz/);
    });

    it('throws on HTTP 401 with API key hint', async () => {
      mockFetchSequence({ status: 401, text: 'Unauthorized' });

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('API Key 无效');
    });

    it('throws on HTTP 402 with Buzz hint', async () => {
      mockFetchSequence({ status: 402, text: 'Payment Required' });

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('Buzz 余额不足');
    });

    it('throws on HTTP 429 with rate limit hint', async () => {
      mockFetchSequence({ status: 429, text: 'Too Many Requests' });

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('请求过于频繁');
    });

    it('throws on HTTP 400 with error body excerpt', async () => {
      mockFetchSequence({ status: 400, text: 'Invalid model AIR format' });

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow(/请求参数错误.*Invalid model/);
    });

    it('throws on non-JSON 200 response', async () => {
      mockFetchSequence({ status: 200, text: '<html>Maintenance</html>' });

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('响应解析失败');
    });

    it('throws on invalid additionalNetworks JSON', async () => {
      mockFetchSequence({ status: 200, body: {} });

      await expect(makeProvider().generate('test', '', 1024, 1024, {
        additionalNetworksJson: '{not valid json',
      })).rejects.toThrow(/附加网络.*JSON 格式错误/);
    });

    it('throws on invalid controlNets JSON', async () => {
      mockFetchSequence({ status: 200, body: {} });

      await expect(makeProvider().generate('test', '', 1024, 1024, {
        controlNetsJson: '[broken',
      })).rejects.toThrow(/ControlNet.*JSON 格式错误/);
    });

    it('ignores empty additionalNetworks JSON', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, { additionalNetworksJson: '' });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.additionalNetworks).toBeUndefined();
    });

    it('parses valid additionalNetworks JSON into body', async () => {
      const networks = { 'urn:air:sdxl:lora:civitai:123@456': { type: 'Lora', strength: 0.8 } };
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().generate('test', '', 1024, 1024, {
        additionalNetworksJson: JSON.stringify(networks),
      });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.additionalNetworks).toEqual(networks);
    });

    it('rejects non-HTTPS image URLs', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'http://example.com/img', width: 1024, height: 1024 }] } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('必须为 HTTPS');
    });

    it('throws when blob fetch fails', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 403 },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('下载图片失败: 403');
    });
  });

  // ── imageToImage() ──

  describe('imageToImage()', () => {
    it('sends sourceImage and sourceImageDenoiseStrenght (typo) in body', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      const ref = makeReference({ denoiseStrength: 0.7 });
      await makeProvider().imageToImage('portrait', 'bad', 1024, 1024, ref);

      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.sourceImage).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(body.sourceImageDenoiseStrenght).toBe(0.7);
      expect(body.prompt).toBe('portrait');
      expect(body.negativePrompt).toBe('bad');
    });

    it('uses same textToImage endpoint', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().imageToImage('test', '', 1024, 1024, makeReference());
      expect(calls[0].url).toContain('/v2/consumer/recipes/textToImage');
    });

    it('includes allowMatureContent query', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().imageToImage('test', '', 1024, 1024, makeReference(), { allowMatureContent: true });
      expect(calls[0].url).toContain('allowMatureContent=true');
    });

    it('defaults denoiseStrength to 0.65', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().imageToImage('test', '', 1024, 1024, makeReference({ denoiseStrength: undefined }));
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.sourceImageDenoiseStrenght).toBe(0.65);
    });

    it('clamps denoiseStrength to 0-1', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().imageToImage('test', '', 1024, 1024, makeReference({ denoiseStrength: 1.5 }));
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.sourceImageDenoiseStrenght).toBe(1);
    });

    it('throws when reference has no dataUrl or url', async () => {
      const ref = makeReference({ dataUrl: undefined, url: undefined });
      await expect(makeProvider().imageToImage('test', '', 1024, 1024, ref))
        .rejects.toThrow('参考图缺少 dataUrl 或 url');
    });

    it('falls back to url when dataUrl is absent', async () => {
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      const ref = makeReference({ dataUrl: undefined, url: 'https://example.com/source.png' });
      await makeProvider().imageToImage('test', '', 1024, 1024, ref);
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.sourceImage).toBe('https://example.com/source.png');
    });

    it('preserves LoRA additionalNetworks alongside sourceImage', async () => {
      const networks = { 'urn:air:sdxl:lora:civitai:123@456': { type: 'Lora', strength: 0.8 } };
      const calls = mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: true, url: 'https://example.com/img', width: 1024, height: 1024 }] } },
        { status: 200 },
      );

      await makeProvider().imageToImage('test', '', 1024, 1024, makeReference(), {
        additionalNetworksJson: JSON.stringify(networks),
      });
      const body = JSON.parse(calls[0].init?.body as string);
      expect(body.additionalNetworks).toEqual(networks);
      expect(body.sourceImage).toBeDefined();
    });
  });

  // ── describeImage() ──

  // imageUpload mock: describeImage now uploads data URLs first to get a hosted URL
  const uploadOk = { status: 200, body: { blob: { url: 'https://cdn.civitai.com/test.png', id: 'blob_test', available: true } } };

  describe('describeImage()', () => {
    it('calls wdTagging for task=tags', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { tags: { '1girl': 0.95, 'solo': 0.9, 'portrait': 0.8 }, rating: { general: 0.8 } } },
      );

      const result = await makeProvider().describeImage(makeUnderstandingRequest('tags'));

      expect(calls[0].url).toContain('/v2/consumer/recipes/imageUpload');
      expect(calls[1].url).toContain('/v2/consumer/recipes/wdTagging');
      expect(result.tags).toHaveLength(3);
      expect(result.tags![0].text).toBe('1girl');
      expect(result.tags![0].confidence).toBe(0.95);
      expect(result.positiveDraft).toContain('1girl');
      expect(result.caption).toBeUndefined();
    });

    it('calls mediaCaptioning recipe for task=caption', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { caption: 'A girl with long hair standing in a garden' } },
      );

      const result = await makeProvider().describeImage(makeUnderstandingRequest('caption'));

      expect(calls[0].url).toContain('/v2/consumer/recipes/imageUpload');
      expect(calls[1].url).toContain('/v2/consumer/recipes/mediaCaptioning');
      expect(result.caption).toBe('A girl with long hair standing in a garden');
      expect(result.positiveDraft).toBe('A girl with long hair standing in a garden');
      expect(result.tags).toBeUndefined();
    });

    it('calls both for task=both, tags then caption', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { tags: { '1girl': 0.95, 'garden': 0.7 }, rating: null } },
        { status: 200, body: { caption: 'A girl in a garden' } },
      );

      const result = await makeProvider().describeImage(makeUnderstandingRequest('both'));

      expect(calls).toHaveLength(3);
      expect(calls[0].url).toContain('/v2/consumer/recipes/imageUpload');
      expect(calls[1].url).toContain('/v2/consumer/recipes/wdTagging');
      expect(calls[2].url).toContain('/v2/consumer/recipes/mediaCaptioning');
      expect(result.tags).toHaveLength(2);
      expect(result.caption).toBe('A girl in a garden');
      expect(result.positiveDraft).toContain('1girl');
      expect(result.positiveDraft).toContain('A girl in a garden');
    });

    it('wdTagging URL includes allowMatureContent query', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { tags: { 'test': 0.5 } } },
      );

      await makeProvider().describeImage(
        makeUnderstandingRequest('tags'),
        { allowMatureContent: true },
      );

      expect(calls[0].url).toContain('allowMatureContent=true');
      expect(calls[1].url).toContain('allowMatureContent=true');
    });

    it('mediaCaptioning URL includes allowMatureContent query', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { caption: 'test' } },
      );

      await makeProvider().describeImage(
        makeUnderstandingRequest('caption'),
        { allowMatureContent: true },
      );

      expect(calls[0].url).toContain('allowMatureContent=true');
      expect(calls[1].url).toContain('allowMatureContent=true');
    });

    it('passes threshold to wdTagging body', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { tags: {} } },
      );

      await makeProvider().describeImage(makeUnderstandingRequest('tags', { threshold: 0.5 }));
      const body = JSON.parse(calls[1].init?.body as string);
      expect(body.threshold).toBe(0.5);
    });

    it('passes temperature and maxNewTokens to captioning body', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { caption: 'test' } },
      );

      await makeProvider().describeImage(makeUnderstandingRequest('caption', {
        temperature: 0.8,
        maxNewTokens: 200,
      }));
      const body = JSON.parse(calls[1].init?.body as string);
      expect(body.temperature).toBe(0.8);
      expect(body.maxNewTokens).toBe(200);
    });

    it('uploads data URL then sends hosted URL as mediaUrl', async () => {
      const calls = mockFetchSequence(
        uploadOk,
        { status: 200, body: { tags: { 'test': 0.5 } } },
      );

      await makeProvider().describeImage(makeUnderstandingRequest('tags'));
      expect(calls[0].url).toContain('/v2/consumer/recipes/imageUpload');
      const tagBody = JSON.parse(calls[1].init?.body as string);
      expect(tagBody.mediaUrl).toBe('https://cdn.civitai.com/test.png');
    });

    it('throws when reference has no dataUrl or url', async () => {
      const req = makeUnderstandingRequest('tags', {
        image: makeReference({ dataUrl: undefined, url: undefined }),
      });
      await expect(makeProvider().describeImage(req))
        .rejects.toThrow('提炼图片缺少 dataUrl 或 url');
    });

    it('returns empty positiveDraft when no tags found', async () => {
      mockFetchSequence(uploadOk, { status: 200, body: { tags: {} } });

      const result = await makeProvider().describeImage(makeUnderstandingRequest('tags'));
      expect(result.positiveDraft).toBe('');
      expect(result.tags).toBeUndefined();
    });

    it('throws on wdTagging HTTP error', async () => {
      mockFetchSequence(uploadOk, { status: 500, text: 'Internal error' });

      await expect(makeProvider().describeImage(makeUnderstandingRequest('tags')))
        .rejects.toThrow(/WD Tagging 失败.*500/);
    });

    it('throws on mediaCaptioning HTTP error', async () => {
      mockFetchSequence(uploadOk, { status: 402, text: 'Insufficient Buzz' });

      await expect(makeProvider().describeImage(makeUnderstandingRequest('caption')))
        .rejects.toThrow(/Media Captioning 失败.*402/);
    });

    it('sets provider to civitai in result', async () => {
      mockFetchSequence(uploadOk, { status: 200, body: { caption: 'test' } });

      const result = await makeProvider().describeImage(makeUnderstandingRequest('caption'));
      expect(result.provider).toBe('civitai');
      expect(result.task).toBe('caption');
      expect(result.createdAt).toBeGreaterThan(0);
    });
  });

  // ── testConnection() — existing tests preserved ──

  describe('testConnection()', () => {
    it('returns true on 200', async () => {
      mockFetchSequence({ status: 200, body: { items: [] } });
      const result = await makeProvider().testConnection();
      expect(result).toBe(true);
    });

    it('returns false on 401', async () => {
      mockFetchSequence({ status: 401, text: 'Unauthorized' });
      const result = await makeProvider().testConnection();
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
      const result = await makeProvider().testConnection();
      expect(result).toBe(false);
    });

    it('calls workflows endpoint with auth header', async () => {
      const calls = mockFetchSequence({ status: 200, body: { items: [] } });
      await makeProvider().testConnection();
      expect(calls[0].url).toContain('/v2/consumer/workflows?take=1');
      expect((calls[0].init?.headers as Record<string, string>)?.Authorization).toBe('Bearer test-key');
    });
  });
});
