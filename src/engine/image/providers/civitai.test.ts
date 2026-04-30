import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CivitaiImageProvider, CivitaiBlockedError } from './civitai';

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

beforeEach(() => { vi.restoreAllMocks(); });

describe('CivitaiImageProvider', () => {
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

    it('throws when image is not available', async () => {
      mockFetchSequence(
        { status: 200, body: { images: [{ id: 'x.jpeg', available: false }] } },
      );

      await expect(makeProvider().generate('test', '', 1024, 1024))
        .rejects.toThrow('available=false');
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
