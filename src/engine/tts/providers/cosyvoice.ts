/**
 * CosyVoice TTS provider.
 *
 * Real contract (probed against a live CosyVoice3 build @ localhost:9880, 2026-07-20):
 *   - Synthesize:  GET {endpoint}{routingPath}?text=…&speaker=…&instruct=…
 *                  → 200, Content-Type: audio/wav (full WAV, 24kHz float32 mono, non-streaming)
 *   - Speakers:    GET {endpoint}/speakers
 *                  → [{ "name": "coolkey", "voice_id": "coolkey" }, …]
 *   - CORS:        Access-Control-Allow-Origin: * (callable from an https origin like github.io,
 *                  same as the gproxy setup — localhost is a secure context so no mixed-content block)
 *   - Server:      Werkzeug/Flask. `stream` query param is NOT honored on the simple GET path.
 *
 * See docs/design/tts-system-design.md §1.
 */
import { BaseTtsProvider, TTS_SYNTHESIZE_TIMEOUT_MS, TTS_LIST_TIMEOUT_MS } from './base';
import type { TtsBackendType, TtsSynthesizeOptions, TtsSpeaker } from '../types';

export class CosyVoiceProvider extends BaseTtsProvider {
  readonly backend: TtsBackendType = 'cosyvoice';

  /** 构造合成 URL(纯函数式,便于测试断言) */
  buildSynthUrl(text: string, speaker: string, instruct?: string): string {
    const path = this.routingPath?.trim() || '/';
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const params = new URLSearchParams({ text, speaker });
    if (instruct && instruct.trim()) params.set('instruct', instruct.trim());
    return `${this.baseUrl}${normalized}?${params.toString()}`;
  }

  async synthesize(text: string, options: TtsSynthesizeOptions): Promise<Blob> {
    const url = this.buildSynthUrl(text, options.speaker, options.instruct);
    const { signal, cleanup } = this.withTimeout(options.signal, TTS_SYNTHESIZE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', signal });
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(`[CosyVoice] synthesize failed ${res.status}: ${errText.slice(0, 120)}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.toLowerCase().includes('audio')) {
        // Werkzeug 500 error pages are text/html — surface that instead of feeding
        // a non-audio blob to the player.
        const errText = await res.text().catch(() => '');
        throw new Error(`[CosyVoice] non-audio response (Content-Type: ${ct || 'empty'}): ${errText.slice(0, 120)}`);
      }
      return await res.blob();
    } finally {
      cleanup();
    }
  }

  async listSpeakers(external?: AbortSignal): Promise<TtsSpeaker[]> {
    const { signal, cleanup } = this.withTimeout(external, TTS_LIST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/speakers`, { method: 'GET', signal });
      if (!res.ok) return [];
      const data: unknown = await res.json().catch(() => null);
      if (!Array.isArray(data)) return [];
      return data
        .map((d): TtsSpeaker | null => {
          if (!d || typeof d !== 'object') return null;
          const obj = d as { name?: unknown; voice_id?: unknown };
          const name = typeof obj.name === 'string' ? obj.name : undefined;
          if (!name) return null;
          const voiceId = typeof obj.voice_id === 'string' ? obj.voice_id : name;
          return { name, voiceId };
        })
        .filter((s): s is TtsSpeaker => s !== null);
    } catch {
      return [];
    } finally {
      cleanup();
    }
  }
}
