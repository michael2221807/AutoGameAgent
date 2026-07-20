import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TtsService } from '@/engine/tts/tts-service';
import { TtsProviderRegistry } from '@/engine/tts/provider-registry';
import { DEFAULT_TTS_SETTINGS } from '@/engine/tts/types';
import type { TtsProvider, TtsSettings, TtsSynthesizeOptions } from '@/engine/tts/types';
import type { TtsAudioPlayer } from '@/engine/tts/audio-player';
import { eventBus } from '@/engine/core/event-bus';

// ─── fakes ───

function makeFakeProvider(overrides?: Partial<TtsProvider>): TtsProvider & { synthCalls: string[] } {
  const synthCalls: string[] = [];
  const provider = {
    backend: 'cosyvoice' as const,
    synthCalls,
    async synthesize(text: string, _o: TtsSynthesizeOptions): Promise<Blob> {
      synthCalls.push(text);
      return new Blob([text], { type: 'audio/wav' });
    },
    async listSpeakers() { return [{ name: 'coolkey', voiceId: 'coolkey' }]; },
    async testConnection() { return true; },
    ...overrides,
  };
  return provider as TtsProvider & { synthCalls: string[] };
}

function makeFakePlayer(): TtsAudioPlayer & { playOrder: string[]; release: () => void } {
  const playOrder: string[] = [];
  let pending: (() => void) | null = null;
  const player: TtsAudioPlayer & { playOrder: string[]; release: () => void } = {
    playOrder,
    release() { pending?.(); pending = null; },
    play(blob, opts) {
      return new Promise<void>((resolve, reject) => {
        blob.text().then((t) => {
          playOrder.push(t);
          if (opts.signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
          // resolve on next microtask so the pipeline advances deterministically
          resolve();
        });
      });
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
          temperature: 1, maxTokens: 0, enabled: true,
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
  });

  it('emits a warning toast when no TTS config is available', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { enabled: true }, { noConfig: true });
    await svc.speak('你好世界。', 'r1');
    expect(provider.synthCalls).toEqual([]);
    expect(toasts.some((t) => (t as { i18nKey?: string }).i18nKey === 'engine.toast.ttsNoConfig')).toBe(true);
  });
});

describe('TtsService segmented pipeline', () => {
  it('synthesizes and plays every segment in order', async () => {
    const provider = makeFakeProvider();
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'segment', defaultSpeaker: 'coolkey' }, { player });
    await svc.speak('第一句话内容够长。第二句话内容够长。第三句话内容够长。', 'r1');
    expect(provider.synthCalls.length).toBe(3);
    expect(player.playOrder.length).toBe(3);
    // played in narrative order
    expect(player.playOrder[0]).toContain('第一句');
    expect(player.playOrder[1]).toContain('第二句');
    expect(player.playOrder[2]).toContain('第三句');
  });

  it('skips a segment whose synthesis fails, continues the rest', async () => {
    let call = 0;
    const provider = makeFakeProvider({
      async synthesize(text: string) {
        call++;
        if (call === 2) throw new Error('synth boom');
        return new Blob([text], { type: 'audio/wav' });
      },
    });
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'segment' }, { player });
    await svc.speak('第一句话内容够长。第二句话内容够长。第三句话内容够长。', 'r1');
    // 3 attempted, 2 played (the failing one skipped)
    expect(player.playOrder.length).toBe(2);
  });

  it('ends in idle state after completing', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, { transmissionMode: 'segment' });
    await svc.speak('一段足够长的正文内容用于测试。', 'r1');
    expect(svc.getState().status).toBe('idle');
    expect(svc.getState().roundKey).toBeNull();
  });
});

describe('TtsService abort / re-entrancy', () => {
  it('stop() mid-flight resets to idle and produces no unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | { reason?: unknown }) => {
      rejections.push('reason' in e ? e.reason : e);
    };
    process.on('unhandledRejection', onUnhandled);

    // provider that never resolves until aborted — simulates in-flight synth
    const provider = makeFakeProvider({
      synthesize(_t, o) {
        return new Promise<Blob>((_res, rej) => {
          o.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
        });
      },
    });
    const svc = makeService(provider, { transmissionMode: 'segment' });
    const p = svc.speak('第一句话内容够长。第二句话内容够长。', 'r1');
    // let the first synth start, then stop
    await Promise.resolve();
    svc.stop();
    await p;
    // allow any discarded prefetch promise to settle
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

describe('TtsService full mode', () => {
  it('synthesizes the whole text once and plays once', async () => {
    const provider = makeFakeProvider();
    const player = makeFakePlayer();
    const svc = makeService(provider, { transmissionMode: 'full' }, { player });
    await svc.speak('第一句话。第二句话。第三句话。', 'r1');
    expect(provider.synthCalls.length).toBe(1);
    expect(player.playOrder.length).toBe(1);
  });
});

describe('TtsService listSpeakers', () => {
  it('delegates to the provider', async () => {
    const provider = makeFakeProvider();
    const svc = makeService(provider, {});
    expect(await svc.listSpeakers()).toEqual([{ name: 'coolkey', voiceId: 'coolkey' }]);
  });
});
