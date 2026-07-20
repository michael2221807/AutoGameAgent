import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TtsService } from '@/engine/tts/tts-service';
import { TtsProviderRegistry } from '@/engine/tts/provider-registry';
import { DEFAULT_TTS_SETTINGS } from '@/engine/tts/types';
import type { TtsProvider, TtsSettings } from '@/engine/tts/types';
import type { TtsAudioPlayer } from '@/engine/tts/audio-player';
import { eventBus } from '@/engine/core/event-bus';

// ─── fakes ───

type FakeProvider = TtsProvider & { synthCalls: string[]; streamUrlCalls: string[] };

function makeFakeProvider(overrides?: Partial<TtsProvider>): FakeProvider {
  const synthCalls: string[] = [];
  const streamUrlCalls: string[] = [];
  const provider = {
    backend: 'cosyvoice' as const,
    synthCalls,
    streamUrlCalls,
    async synthesize(text: string): Promise<Blob> {
      synthCalls.push(text);
      return new Blob([text], { type: 'audio/wav' });
    },
    getStreamUrl(text: string): string | null {
      streamUrlCalls.push(text);
      return `http://localhost:9880/?text=${encodeURIComponent(text)}&streaming=1`;
    },
    async listSpeakers() { return [{ name: 'coolkey', voiceId: 'coolkey' }]; },
    ...overrides,
  };
  return provider as FakeProvider;
}

type FakePlayer = TtsAudioPlayer & { played: Array<{ kind: 'blob' | 'url'; value: string }> };

function makeFakePlayer(): FakePlayer {
  const played: Array<{ kind: 'blob' | 'url'; value: string }> = [];
  const player: FakePlayer = {
    played,
    async play(blob, opts) {
      const t = await blob.text();
      if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
      played.push({ kind: 'blob', value: t });
    },
    async playUrl(url, opts) {
      if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
      played.push({ kind: 'url', value: url });
    },
    stop() {},
    pause() {},
    resume() {},
  };
  return player;
}

function makeService(
  provider: TtsProvider,
  settings: Partial<TtsSettings>,
  opts?: { player?: TtsAudioPlayer; noConfig?: boolean },
) {
  const registry = new TtsProviderRegistry();
  registry.register('cosyvoice', () => provider);
  const aiService = {
    getTtsConfigForBackend: () => (opts?.noConfig
      ? undefined
      : {
          id: 'tts1', name: 'cosy', apiCategory: 'tts', provider: 'custom',
          url: 'http://localhost:9880', apiKey: '', model: '',
          temperature: 0, maxTokens: 0, enabled: true,
        }),
  } as unknown as { getTtsConfigForBackend: (b: string) => unknown };
  const merged: TtsSettings = { ...DEFAULT_TTS_SETTINGS, enabled: true, ...settings };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new TtsService(aiService as any, registry, { player: opts?.player ?? makeFakePlayer(), settings: merged });
}

let toasts: unknown[];
let offToast: () => void;
beforeEach(() => {
  toasts = [];
  offToast = eventBus.on('ui:toast', (p) => { toasts.push(p); });
});
afterEach(() => {
  offToast();
  vi.restoreAllMocks();
});

describe('TtsService guards', () => {
  it('does nothing when disabled', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { enabled: false });
    await svc.speak('你好世界。', 'r1');
    expect(provider.synthCalls).toEqual([]);
    expect(provider.streamUrlCalls).toEqual([]);
  });

  it('emits a warning toast when no TTS config is available', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { enabled: true }, { noConfig: true });
    await svc.speak('你好世界。', 'r1');
    expect(provider.streamUrlCalls).toEqual([]);
    expect(toasts.some((t) => (t as { i18nKey?: string }).i18nKey === 'engine.toast.ttsNoConfig')).toBe(true);
  });

  it('does nothing for empty/marker-only text', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, {});
    await svc.speak('   \n  ', 'r1');
    expect(provider.streamUrlCalls).toEqual([]);
    expect(provider.synthCalls).toEqual([]);
  });
});

describe('TtsService stream mode (default)', () => {
  it('uses getStreamUrl + player.playUrl, never synthesize', async () => {
    const provider = makeFakeProvider();
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'stream', defaultSpeaker: 'coolkey' }, { player });
    await svc.speak('第一句话内容。第二句话内容。', 'r1');
    expect(provider.streamUrlCalls.length).toBe(1);
    expect(provider.synthCalls).toEqual([]);
    expect(player.played.length).toBe(1);
    expect(player.played[0].kind).toBe('url');
    expect(player.played[0].value).toContain('streaming=1');
  });

  it('strips markers before building the stream URL', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { transmissionMode: 'stream' });
    await svc.speak('【环境】天黑了。`他在想`。', 'r1');
    expect(provider.streamUrlCalls[0]).not.toContain('【');
    expect(provider.streamUrlCalls[0]).not.toContain('`');
  });

  it('falls back to full (synthesize) when getStreamUrl returns null', async () => {
    const provider = makeFakeProvider({ getStreamUrl: () => null });
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'stream' }, { player });
    await svc.speak('一段正文内容。', 'r1');
    expect(provider.synthCalls.length).toBe(1);
    expect(player.played[0].kind).toBe('blob');
  });

  it('falls back to full (synthesize) when the stream fetch fails (non-abort)', async () => {
    const provider = makeFakeProvider();
    const player = makeFakePlayer();
    player.playUrl = async () => { throw new Error('[TTS] stream fetch failed 500'); };
    const svc = makeService(provider, { transmissionMode: 'stream' }, { player });
    await svc.speak('一段正文内容。', 'r1');
    expect(provider.streamUrlCalls.length).toBe(1); // stream attempted
    expect(provider.synthCalls.length).toBe(1);     // then fell back to full
    expect(player.played.length).toBe(1);
    expect(player.played[0].kind).toBe('blob');
    expect(svc.getState().status).toBe('idle');
  });

  it('ends in idle state after completing', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { transmissionMode: 'stream' });
    await svc.speak('一段足够长的正文内容用于测试。', 'r1');
    expect(svc.getState().status).toBe('idle');
    expect(svc.getState().roundKey).toBeNull();
  });
});

describe('TtsService full mode', () => {
  it('synthesizes the whole text once and plays a blob', async () => {
    const provider = makeFakeProvider();
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'full' }, { player });
    await svc.speak('第一句话。第二句话。第三句话。', 'r1');
    expect(provider.synthCalls.length).toBe(1);
    expect(provider.streamUrlCalls).toEqual([]);
    expect(player.played.length).toBe(1);
    expect(player.played[0].kind).toBe('blob');
  });
});

describe('TtsService abort / re-entrancy', () => {
  it('stop() mid-flight resets to idle with no unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (e: { reason?: unknown }) => { rejections.push('reason' in e ? e.reason : e); };
    process.on('unhandledRejection', onUnhandled);

    // player.playUrl that never resolves until aborted
    const player = makeFakePlayer();
    player.playUrl = (_url, opts) => new Promise<void>((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
    });
    const provider = makeFakeProvider();
    const svc = makeService(provider, { transmissionMode: 'stream' }, { player });
    const p = svc.speak('第一句话内容。', 'r1');
    await Promise.resolve();
    svc.stop();
    await p;
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);

    expect(svc.getState().status).toBe('idle');
    expect(rejections).toEqual([]);
  });

  it('a second speak() supersedes the first without leaving stale state', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { transmissionMode: 'full' });
    const p1 = svc.speak('第一次朗读的正文内容。', 'r1');
    const p2 = svc.speak('第二次朗读的正文内容。', 'r2');
    await Promise.allSettled([p1, p2]);
    expect(svc.getState().status).toBe('idle');
  });
});

describe('TtsService listSpeakers', () => {
  it('delegates to the provider', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, {});
    expect(await svc.listSpeakers()).toEqual([{ name: 'coolkey', voiceId: 'coolkey' }]);
  });
});
