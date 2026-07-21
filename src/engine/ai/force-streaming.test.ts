/**
 * forceStreaming — streaming-as-universal-transport tests.
 *
 * Covers APIConfig.forceStreaming: some providers/proxies expose ONLY a streaming
 * endpoint, so EVERY request (including background/non-narrative calls that pass no
 * onStreamChunk) must be sent as `stream: true` while the caller still receives the
 * full assembled text. And a failed stream must NOT downgrade to a non-streaming retry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AIService } from './ai-service';
import { OpenAIProvider } from './providers/openai-provider';
import type { APIConfig } from './types';

const baseConfig: APIConfig = {
  id: 'default',
  name: 'test',
  apiCategory: 'llm',
  provider: 'openai',
  url: 'https://proxy.test',
  apiKey: 'k',
  model: 'gpt-4o',
  temperature: 0.7,
  maxTokens: 1000,
  enabled: true,
};

/** Build an SSE Response streaming the given content chunks (OpenAI delta format). */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        const payload = JSON.stringify({ choices: [{ delta: { content: c } }] });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Build a non-streaming JSON chat-completion Response. */
function jsonResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 200 whose content-type is NOT SSE — triggers the "stream unsupported" branch. */
function nonSseResponse(): Response {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}

function bodyOf(mock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  const init = mock.mock.calls[callIndex][1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AIService — forceStreaming override', () => {
  it('forces stream:true for a background call with no onStreamChunk, still returns full text', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['Hello', ' world']));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new AIService();
    svc.setConfigs([{ ...baseConfig, forceStreaming: true }]);

    // No onStreamChunk, non-narrative usage — exactly the "invisible background request" case.
    const out = await svc.generate({
      messages: [{ role: 'user', content: 'summarize' }],
      usageType: 'memory_summary',
    });

    expect(out).toBe('Hello world');
    expect(bodyOf(fetchMock).stream).toBe(true);
  });

  it('leaves stream:false when forceStreaming is off and no onStreamChunk is passed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse('non-stream result'));
    vi.stubGlobal('fetch', fetchMock);

    const svc = new AIService();
    svc.setConfigs([{ ...baseConfig, forceStreaming: false }]);

    const out = await svc.generate({
      messages: [{ role: 'user', content: 'summarize' }],
      usageType: 'memory_summary',
    });

    expect(out).toBe('non-stream result');
    expect(bodyOf(fetchMock).stream).toBe(false);
  });
});

describe('OpenAIProvider — no downgrade under forceStreaming', () => {
  it('re-throws instead of downgrading to non-streaming when forceStreaming is on', async () => {
    const fetchMock = vi.fn(async () => nonSseResponse());
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ ...baseConfig, forceStreaming: true });

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
    ).rejects.toThrow();

    // Must NOT have made a second (non-streaming) request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still downgrades to non-streaming when forceStreaming is off (regression guard)', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1 ? nonSseResponse() : jsonResponse('downgraded');
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ ...baseConfig, forceStreaming: false });

    const out = await provider.generate({ messages: [{ role: 'user', content: 'hi' }], stream: true });

    expect(out).toBe('downgraded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).stream).toBe(false);
  });
});
