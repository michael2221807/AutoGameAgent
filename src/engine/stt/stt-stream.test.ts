import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { deriveStreamUrl, buildHandshake, parseStreamMessage, openSttStream } from '@/engine/stt/stt-stream';
import { SttService } from '@/engine/stt/stt-service';
import { SttProviderRegistry } from '@/engine/stt/provider-registry';
import { STT_CHUNK_SIZE } from '@/engine/stt/types';
import type { APIConfig } from '@/engine/ai/types';

function makeConfig(over?: Partial<APIConfig>): APIConfig {
  return {
    id: 'stt1', name: 'stt', apiCategory: 'stt', provider: 'custom',
    url: 'http://localhost:9880', apiKey: '', model: '',
    temperature: 0, maxTokens: 0, enabled: true,
    ...over,
  };
}

describe('deriveStreamUrl', () => {
  it('http → ws + default stream path', () => {
    expect(deriveStreamUrl('http://localhost:9880')).toBe('ws://localhost:9880/v1/audio/stream');
  });
  it('https → wss', () => {
    expect(deriveStreamUrl('https://voice.example.com')).toBe('wss://voice.example.com/v1/audio/stream');
  });
  it('strips trailing slash on base', () => {
    expect(deriveStreamUrl('http://localhost:9880/')).toBe('ws://localhost:9880/v1/audio/stream');
  });
  it('keeps ws:// scheme (does not force ws on an already-ws base)', () => {
    expect(deriveStreamUrl('ws://h:1')).toBe('ws://h:1/v1/audio/stream');
    expect(deriveStreamUrl('wss://h:1')).toBe('wss://h:1/v1/audio/stream');
  });
  it('bare host:port defaults to ws://', () => {
    expect(deriveStreamUrl('localhost:9880')).toBe('ws://localhost:9880/v1/audio/stream');
  });
  it('empty → null', () => {
    expect(deriveStreamUrl('')).toBeNull();
    expect(deriveStreamUrl('   ')).toBeNull();
  });
});

describe('buildHandshake', () => {
  it('defaults to 2pass / 16k / balanced chunk / itn on', () => {
    const h = buildHandshake();
    expect(h.mode).toBe('2pass');
    expect(h.audio_fs).toBe(16000);
    expect(h.wav_format).toBe('pcm');
    expect(h.is_speaking).toBe(true);
    expect(h.itn).toBe(true);
    expect(h.chunk_size).toEqual(STT_CHUNK_SIZE.balanced);
  });
  it('maps latency profile to chunk_size', () => {
    expect(buildHandshake('fast').chunk_size).toEqual(STT_CHUNK_SIZE.fast);
    expect(buildHandshake('stable').chunk_size).toEqual(STT_CHUNK_SIZE.stable);
  });
  it('honors itn=false', () => {
    expect(buildHandshake('balanced', false).itn).toBe(false);
  });
});

describe('parseStreamMessage', () => {
  it('2pass-online → partial', () => {
    expect(parseStreamMessage(JSON.stringify({ mode: '2pass-online', text: '希望你', is_final: false })))
      .toEqual({ kind: 'partial', text: '希望你' });
  });
  it('2pass-offline → final', () => {
    expect(parseStreamMessage(JSON.stringify({ mode: '2pass-offline', text: '希望你以后。', is_final: true })))
      .toEqual({ kind: 'final', text: '希望你以后。' });
  });
  it('is_final=true forces final even without offline mode', () => {
    expect(parseStreamMessage(JSON.stringify({ mode: 'online', text: 'x', is_final: true })))
      .toEqual({ kind: 'final', text: 'x' });
  });
  it('unknown mode → null (ignored)', () => {
    expect(parseStreamMessage(JSON.stringify({ mode: 'heartbeat' }))).toBeNull();
  });
  it('malformed json → null', () => {
    expect(parseStreamMessage('not json')).toBeNull();
    expect(parseStreamMessage('123')).toBeNull();
  });
  it('missing text coerces to empty string', () => {
    expect(parseStreamMessage(JSON.stringify({ mode: '2pass-online' }))).toEqual({ kind: 'partial', text: '' });
  });
});

describe('SttService streaming entry', () => {
  function makeService(config: APIConfig | undefined): SttService {
    const registry = new SttProviderRegistry();
    const aiService = { getSttConfigForBackend: () => config };
    return new SttService(aiService, registry);
  }

  it('getStreamUrl derives ws URL from config base url', () => {
    expect(makeService(makeConfig()).getStreamUrl()).toBe('ws://localhost:9880/v1/audio/stream');
  });
  it('getStreamUrl null when no config', () => {
    expect(makeService(undefined).getStreamUrl()).toBeNull();
  });
  it('isStreamReady reflects config presence', () => {
    expect(makeService(makeConfig()).isStreamReady()).toBe(true);
    expect(makeService(undefined).isStreamReady()).toBe(false);
  });
  it('startStream returns null when no config (caller falls back)', () => {
    const handle = makeService(undefined).startStream({});
    expect(handle).toBeNull();
  });
});

// ── Controller: mic-denied path (no AudioContext needed) ──
describe('openSttStream — getUserMedia denied', () => {
  const origNav = globalThis.navigator;
  beforeEach(() => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(denied) } },
      configurable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  });

  it('maps NotAllowedError → MIC_PERMISSION_DENIED via onError + onClose', async () => {
    const onError = vi.fn();
    const onClose = vi.fn();
    openSttStream({ url: 'ws://localhost:9880/v1/audio/stream' }, { onError, onClose });
    // let the async start() settle
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe('MIC_PERMISSION_DENIED');
    expect(onClose).toHaveBeenCalledWith(expect.any(Error));
  });
});
