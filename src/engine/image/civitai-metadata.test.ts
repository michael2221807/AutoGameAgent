import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractVersionIdFromAir,
  fetchCivitaiLoraMetadata,
  trainedWordsToTriggers,
} from './civitai-metadata';

beforeEach(() => { vi.restoreAllMocks(); });

describe('extractVersionIdFromAir', () => {
  it('extracts version ID from valid AIR', () => {
    expect(extractVersionIdFromAir('urn:air:sdxl:lora:civitai:82098@87153')).toBe(87153);
  });

  it('returns null for AIR without version', () => {
    expect(extractVersionIdFromAir('urn:air:sdxl:lora:civitai:82098')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractVersionIdFromAir('')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(extractVersionIdFromAir('  urn:air:sdxl:lora:civitai:123@456  ')).toBe(456);
  });
});

describe('fetchCivitaiLoraMetadata', () => {
  function mockFetch(response: { status: number; body?: unknown }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
        text: async () => JSON.stringify(response.body ?? {}),
      } as unknown as Response;
    }));
    return calls;
  }

  it('returns metadata on successful fetch', async () => {
    mockFetch({
      status: 200,
      body: {
        id: 87153,
        name: 'v1.0',
        trainedWords: ['redshift style', 'cinematic'],
        baseModel: 'SDXL 1.0',
        modelId: 82098,
        model: { name: 'Detail Enhancer', type: 'LORA', nsfw: false },
      },
    });

    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:82098@87153' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelName).toBe('Detail Enhancer');
    expect(result.data.versionName).toBe('v1.0');
    expect(result.data.trainedWords).toEqual(['redshift style', 'cinematic']);
    expect(result.data.baseModel).toBe('SDXL 1.0');
    expect(result.data.mature).toBe(false);
    expect(result.data.modelVersionId).toBe(87153);
    expect(result.data.modelId).toBe(82098);
    expect(result.data.sourceUrl).toContain('civitai.com/models/82098');
  });

  it('calls correct public API URL', async () => {
    const calls = mockFetch({ status: 200, body: { id: 456, model: {} } });
    await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    expect(calls[0].url).toBe('https://civitai.com/api/v1/model-versions/456');
  });

  it('does not send auth header by default', async () => {
    const calls = mockFetch({ status: 200, body: { id: 456, model: {} } });
    await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('retries with auth on failure when apiKey provided', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      callCount++;
      const hasAuth = !!(init?.headers as Record<string, string>)?.Authorization;
      if (!hasAuth) return { ok: false, status: 403, json: async () => ({}), text: async () => '' } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ id: 456, model: { name: 'Test', nsfw: true } }) } as unknown as Response;
    }));

    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456', apiKey: 'test-key' });
    expect(callCount).toBe(2);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mature).toBe(true);
  });

  it('fails gracefully when AIR has no version ID', async () => {
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('版本 ID');
  });

  it('fails gracefully on HTTP error without apiKey', async () => {
    const calls = mockFetch({ status: 404 });
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('404');
    expect(calls).toHaveLength(1);
  });

  it('does not retry on 404 even with apiKey', async () => {
    const calls = mockFetch({ status: 404 });
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456', apiKey: 'test' });
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('does not retry on 500 even with apiKey', async () => {
    const calls = mockFetch({ status: 500 });
    await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456', apiKey: 'test' });
    expect(calls).toHaveLength(1);
  });

  it('fails gracefully on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch'); }));
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('网络错误');
  });

  it('handles response with missing fields', async () => {
    mockFetch({ status: 200, body: { id: 456 } });
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelName).toBe('');
    expect(result.data.trainedWords).toEqual([]);
    expect(result.data.mature).toBe(false);
  });

  it('filters non-string trainedWords', async () => {
    mockFetch({
      status: 200,
      body: { id: 456, trainedWords: ['valid', 123, null, '', '  ', 'also valid'], model: {} },
    });
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    if (result.success) expect(result.data.trainedWords).toEqual(['valid', 'also valid']);
  });

  it('detects mature from model.nsfw', async () => {
    mockFetch({ status: 200, body: { id: 456, model: { name: 'NSFW Model', nsfw: true } } });
    const result = await fetchCivitaiLoraMetadata({ air: 'urn:air:sdxl:lora:civitai:123@456' });
    if (result.success) expect(result.data.mature).toBe(true);
  });
});

describe('trainedWordsToTriggers', () => {
  it('converts words to trigger entries', () => {
    const triggers = trainedWordsToTriggers(['moonlit robe', 'silver thread']);
    expect(triggers).toHaveLength(2);
    expect(triggers[0].text).toBe('moonlit robe');
    expect(triggers[0].enabled).toBe(true);
    expect(triggers[0].source).toBe('metadata');
    expect(triggers[1].text).toBe('silver thread');
  });

  it('filters empty strings', () => {
    const triggers = trainedWordsToTriggers(['valid', '', '  ']);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].text).toBe('valid');
  });

  it('returns empty array for empty input', () => {
    expect(trainedWordsToTriggers([])).toEqual([]);
  });

  it('trims whitespace', () => {
    const triggers = trainedWordsToTriggers(['  padded  ']);
    expect(triggers[0].text).toBe('padded');
  });

  it('assigns unique IDs', () => {
    const triggers = trainedWordsToTriggers(['a', 'b', 'c']);
    const ids = new Set(triggers.map((t) => t.id));
    expect(ids.size).toBe(3);
  });
});
