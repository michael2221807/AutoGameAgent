import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CosyVoiceProvider } from '@/engine/tts/providers/cosyvoice';

function audioResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'audio/wav' }),
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    text: async () => '',
    json: async () => ({}),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CosyVoiceProvider.buildSynthUrl', () => {
  it('encodes text/speaker/instruct into query params', () => {
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    const url = p.buildSynthUrl('你好，测试', 'jok老师', '四川话');
    expect(url.startsWith('http://localhost:9880/?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('text')).toBe('你好，测试');
    expect(q.get('speaker')).toBe('jok老师');
    expect(q.get('instruct')).toBe('四川话');
  });

  it('omits instruct when empty', () => {
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    const url = p.buildSynthUrl('hi', 'coolkey');
    expect(new URL(url).searchParams.has('instruct')).toBe(false);
  });

  it('honors a custom routing path and trailing-slash normalization', () => {
    const p = new CosyVoiceProvider('http://localhost:9880/', '', 'tts');
    const url = p.buildSynthUrl('hi', 'coolkey');
    expect(url.startsWith('http://localhost:9880/tts?')).toBe(true);
  });
});

describe('CosyVoiceProvider.getStreamUrl', () => {
  it('appends streaming=1 for true transport-level streaming', () => {
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    const url = p.getStreamUrl('你好', { speaker: 'coolkey', instruct: '四川话' });
    expect(url).not.toBeNull();
    const q = new URL(url!).searchParams;
    expect(q.get('streaming')).toBe('1');
    expect(q.get('text')).toBe('你好');
    expect(q.get('speaker')).toBe('coolkey');
    expect(q.get('instruct')).toBe('四川话');
  });
});

describe('CosyVoiceProvider.synthesize', () => {
  it('returns the audio blob on a 200 audio/wav response', async () => {
    fetchMock.mockResolvedValue(audioResponse());
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    const blob = await p.synthesize('你好', { speaker: 'coolkey' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
  });

  it('throws when response is not audio (e.g. Flask 500 html)', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<title>500</title>',
      blob: async () => new Blob([]),
    } as unknown as Response);
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    await expect(p.synthesize('x', { speaker: 'c' })).rejects.toThrow(/non-audio/);
  });

  it('throws on a non-ok status', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 500,
      headers: new Headers(),
      text: async () => 'boom',
      blob: async () => new Blob([]),
    } as unknown as Response);
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    await expect(p.synthesize('x', { speaker: 'c' })).rejects.toThrow(/500/);
  });
});

describe('CosyVoiceProvider.listSpeakers', () => {
  it('maps the /speakers JSON to {name, voiceId}', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [
        { name: 'coolkey', voice_id: 'coolkey' },
        { name: 'jok老师', voice_id: 'jok老师' },
      ],
      text: async () => '',
      blob: async () => new Blob([]),
    } as unknown as Response);
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    const speakers = await p.listSpeakers();
    expect(speakers).toEqual([
      { name: 'coolkey', voiceId: 'coolkey' },
      { name: 'jok老师', voiceId: 'jok老师' },
    ]);
  });

  it('returns [] on error or malformed body', async () => {
    fetchMock.mockRejectedValue(new Error('conn refused'));
    const p = new CosyVoiceProvider('http://localhost:9880', '', '/');
    expect(await p.listSpeakers()).toEqual([]);
  });
});
