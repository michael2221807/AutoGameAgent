import { describe, it, expect, vi, afterEach } from 'vitest';
import { CosyVoiceSttProvider } from '@/engine/stt/providers/cosyvoice';
import { SttProviderRegistry } from '@/engine/stt/provider-registry';
import { SttService } from '@/engine/stt/stt-service';
import type { APIConfig } from '@/engine/ai/types';

function makeConfig(over?: Partial<APIConfig>): APIConfig {
  return {
    id: 'stt1', name: 'stt', apiCategory: 'stt', provider: 'custom',
    url: 'http://localhost:9880', apiKey: '', model: '',
    temperature: 0, maxTokens: 0, enabled: true,
    ...over,
  };
}

function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

describe('CosyVoiceSttProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds the default transcribe URL (/v1/audio/transcriptions)', () => {
    const p = new CosyVoiceSttProvider('http://localhost:9880/', '', '');
    expect(p.buildTranscribeUrl()).toBe('http://localhost:9880/v1/audio/transcriptions');
  });

  it('honors a custom routing path', () => {
    const p = new CosyVoiceSttProvider('http://localhost:9880', '', '/asr');
    expect(p.buildTranscribeUrl()).toBe('http://localhost:9880/asr');
  });

  it('POSTs multipart (file + language=auto) and returns cleaned text', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('file')).toBeInstanceOf(Blob);
      expect(body.get('language')).toBe('auto');
      return jsonRes({ text: '你好世界', raw_text: '你好世界😊' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = new CosyVoiceSttProvider('http://localhost:9880', '', '');
    const r = await p.transcribe(new Blob(['x'], { type: 'audio/webm' }));
    expect(r.text).toBe('你好世界');
    expect(r.rawText).toBe('你好世界😊');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"boom"}', { status: 500 })));
    const p = new CosyVoiceSttProvider('http://localhost:9880', '', '');
    await expect(p.transcribe(new Blob(['x']))).rejects.toThrow(/transcribe failed 500/);
  });

  it('returns empty text when server omits text (silence)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({})));
    const p = new CosyVoiceSttProvider('http://localhost:9880', '', '');
    expect((await p.transcribe(new Blob(['x']))).text).toBe('');
  });
});

describe('SttService', () => {
  function makeService(config?: APIConfig) {
    const registry = new SttProviderRegistry();
    registry.register('cosyvoice', (c) => new CosyVoiceSttProvider(c.endpoint, c.apiKey, c.routingPath));
    const aiService = { getSttConfigForBackend: () => config } as unknown as {
      getSttConfigForBackend: (b: string) => APIConfig | undefined;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SttService(aiService as any, registry);
  }

  afterEach(() => vi.restoreAllMocks());

  it('isReady reflects stt config presence', () => {
    expect(makeService(undefined).isReady()).toBe(false);
    expect(makeService(makeConfig()).isReady()).toBe(true);
  });

  it('transcribe resolves provider + returns cleaned text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ text: '录音内容' })));
    expect(await makeService(makeConfig()).transcribe(new Blob(['x']))).toBe('录音内容');
  });

  it('transcribe throws when no stt config', async () => {
    await expect(makeService(undefined).transcribe(new Blob(['x']))).rejects.toThrow(/未配置/);
  });

  it('honors useCustomRouting → custom path', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:9880/asr');
      return jsonRes({ text: 'ok' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await makeService(makeConfig({ useCustomRouting: true, customRoutingPath: '/asr' })).transcribe(new Blob(['x']));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
