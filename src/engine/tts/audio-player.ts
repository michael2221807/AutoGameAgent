// App doc: docs/user-guide/pages/game-main.md §3.13 (配音 · CosyVoice)
/**
 * Audio playback abstraction — injected into TtsService so the orchestration can
 * be unit-tested with a fake player (HTMLAudioElement is a browser-only API). The
 * default impl wraps HTMLAudioElement(s).
 *
 * Two playback sources:
 *   - play(blob):   整段非流式 — a fully-downloaded audio Blob (objectURL).
 *   - playUrl(url): 真流式 — a streaming URL (e.g. CosyVoice streaming=1 → chunked
 *                   ogg) that the <audio> element downloads + decodes PROGRESSIVELY
 *                   (边下边播). This works because the plain <audio> element natively
 *                   decodes streamed Ogg — the MSE "no ogg" limit does NOT apply to
 *                   the media element's own progressive pipeline. The one requirement
 *                   for a cross-origin stream is crossOrigin='anonymous' (set below),
 *                   which forces a clean CORS GET and avoids the opaque-response/ORB
 *                   path that silently blocks a bare cross-origin media fetch.
 *
 * preload(url) warms the NEXT segment's stream while the current one plays so the
 * per-sentence pipeline (see TtsService.speak) is near-gapless.
 */

export interface TtsAudioPlayer {
  /** Play a fully-downloaded audio blob to completion. */
  play(blob: Blob, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void>;
  /** Play a streaming URL progressively (browser downloads + decodes as it arrives). */
  playUrl(url: string, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void>;
  /**
   * Warm the next segment's stream URL so the following playUrl() starts near-
   * instantly (best-effort; a no-op impl is a valid degradation, e.g. in tests).
   */
  preload?(url: string): void;
  /** Stop any current playback immediately (and drop any preloaded segment). */
  stop(): void;
  /** Pause current playback (resumable). */
  pause(): void;
  /** Resume a paused playback. */
  resume(): void;
}

/** Default HTMLAudioElement-based player. Browser only. */
export class HtmlAudioPlayer implements TtsAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  /** objectURL to revoke on cleanup (blob playback only; null for live stream URLs). */
  private currentObjectUrl: string | null = null;
  /** Rejects the in-flight play() promise; set while a clip is playing, else null. */
  private abortCurrent: (() => void) | null = null;
  /** A warmed <audio> for the next stream URL (see preload/playUrl). */
  private preloaded: { url: string; audio: HTMLAudioElement } | null = null;

  play(blob: Blob, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    // Blob objectURLs are same-origin — no crossOrigin needed. Revoke on cleanup.
    return this.run(audio, url, opts);
  }

  async playUrl(url: string, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void> {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
    // Reuse a matching preloaded element if we warmed this exact URL; else make one.
    let audio: HTMLAudioElement;
    if (this.preloaded && this.preloaded.url === url) {
      audio = this.preloaded.audio;
      this.preloaded = null;
    } else {
      this.dropPreloaded();
      audio = this.makeStreamAudio(url);
    }
    // Live stream URL — nothing to revoke (not an objectURL we own).
    await this.run(audio, null, opts);
  }

  preload(url: string): void {
    if (this.preloaded?.url === url) return;
    this.dropPreloaded();
    try {
      const audio = this.makeStreamAudio(url);
      audio.preload = 'auto';
      audio.load(); // begin buffering ahead of playback
      this.preloaded = { url, audio };
    } catch {
      // Best-effort — a failed preload just means the next playUrl fetches cold.
      this.preloaded = null;
    }
  }

  /** Build a cross-origin-safe <audio> for a live streaming URL. */
  private makeStreamAudio(url: string): HTMLAudioElement {
    const audio = new Audio();
    // The crux of true progressive cross-origin streaming: force a CORS GET so the
    // response is NOT opaque and ORB never blocks it. The server (CosyVoice,
    // supports_credentials=true) echoes the specific origin, so an anonymous
    // (cookie-less) CORS request is accepted and plays progressively.
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = url;
    return audio;
  }

  private run(
    audio: HTMLAudioElement,
    revokeUrl: string | null,
    opts: { rate: number; volume: number; signal: AbortSignal },
  ): Promise<void> {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      if (opts.signal.aborted) {
        if (revokeUrl) URL.revokeObjectURL(revokeUrl);
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      this.audio = audio;
      this.currentObjectUrl = revokeUrl;
      audio.playbackRate = opts.rate;
      audio.volume = opts.volume;

      const cleanup = () => {
        opts.signal.removeEventListener('abort', onAbort);
        audio.onended = null;
        audio.onerror = null;
        if (this.abortCurrent === onAbort) this.abortCurrent = null;
        if (revokeUrl && this.currentObjectUrl === revokeUrl) {
          URL.revokeObjectURL(revokeUrl);
        }
        this.currentObjectUrl = null;
        if (this.audio === audio) this.audio = null;
      };
      const onAbort = () => {
        audio.pause();
        cleanup();
        reject(new DOMException('aborted', 'AbortError'));
      };
      // Registering onAbort as abortCurrent lets stop() settle THIS promise even
      // when called directly (not via the signal) — honoring the interface
      // contract "rejects if aborted" instead of leaving the awaiter hung.
      this.abortCurrent = onAbort;
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error('[TTS] audio playback error')); };
      opts.signal.addEventListener('abort', onAbort, { once: true });

      audio.play().catch((err) => { cleanup(); reject(err); });
    });
  }

  private dropPreloaded(): void {
    if (!this.preloaded) return;
    const a = this.preloaded.audio;
    this.preloaded = null;
    try {
      a.pause();
      a.removeAttribute('src');
      a.load(); // abort the in-flight preload fetch
    } catch {
      // ignore teardown races
    }
  }

  stop(): void {
    this.dropPreloaded();
    // Settle any in-flight play promise (rejects with AbortError) before tearing
    // down, so a direct stop() never leaves the awaiting coroutine hung.
    const abort = this.abortCurrent;
    this.abortCurrent = null;
    if (abort) {
      abort();
      return; // onAbort's cleanup already revoked the url and nulled audio
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  pause(): void { this.audio?.pause(); }
  resume(): void {
    this.audio?.play().catch((err) => {
      // Autoplay re-block after focus loss etc. — low-observability but non-fatal.
      console.debug('[TTS] resume() play() rejected:', err);
    });
  }
}
