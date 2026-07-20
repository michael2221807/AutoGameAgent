/**
 * Audio playback abstraction — injected into TtsService so the orchestration can
 * be unit-tested with a fake player (HTMLAudioElement is a browser-only API). The
 * default impl wraps a single HTMLAudioElement.
 *
 * Two playback sources:
 *   - play(blob):   整段非流式 — a fully-downloaded audio Blob (objectURL).
 *   - playUrl(url): 真流式 — a streaming URL (e.g. CosyVoice streaming=1 → chunked
 *                   ogg) that the <audio> element downloads + decodes progressively.
 */

export interface TtsAudioPlayer {
  /** Play a fully-downloaded audio blob to completion. */
  play(blob: Blob, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void>;
  /** Play a streaming URL progressively (browser downloads + decodes as it arrives). */
  playUrl(url: string, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void>;
  /** Stop any current playback immediately. */
  stop(): void;
  /** Pause current playback (resumable). */
  pause(): void;
  /** Resume a paused playback. */
  resume(): void;
}

/** Default HTMLAudioElement-based player. Browser only. */
export class HtmlAudioPlayer implements TtsAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  /** Rejects the in-flight play() promise; set while a clip is playing, else null. */
  private abortCurrent: (() => void) | null = null;

  play(blob: Blob, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void> {
    const url = URL.createObjectURL(blob);
    // revokeOwned=true → this is an objectURL we created and must revoke on cleanup.
    return this.run(url, true, opts);
  }

  async playUrl(url: string, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void> {
    // Fetch the streaming endpoint (CosyVoice streaming=1 → chunked audio/ogg) and
    // play the collected blob via a same-origin objectURL.
    //
    // Why fetch→blob and NOT `<audio src=streamUrl>` (which would be truly
    // progressive): a cross-origin `<audio>` makes an internal Range request whose
    // CORS/ORB handling of the server's chunked response is unreliable in Chromium
    // (ORB blocks the no-cors variant; the CORS variant's Range sub-request trips
    // the ACAC:true + specific-origin rule). `fetch()` reads the same CORS stream
    // cleanly. The server still streams as it generates; the client collects then
    // plays — first sound after the stream completes (Chrome can't MSE-decode ogg
    // for true progressive playback anyway).
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`[TTS] stream fetch failed ${res.status}`);
    const blob = await res.blob();
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
    await this.run(URL.createObjectURL(blob), true, opts);
  }

  private run(
    src: string,
    revokeOwned: boolean,
    opts: { rate: number; volume: number; signal: AbortSignal },
  ): Promise<void> {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      if (opts.signal.aborted) {
        if (revokeOwned) URL.revokeObjectURL(src);
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const audio = new Audio(src);
      this.audio = audio;
      this.currentUrl = revokeOwned ? src : null;
      audio.playbackRate = opts.rate;
      audio.volume = opts.volume;

      const cleanup = () => {
        opts.signal.removeEventListener('abort', onAbort);
        audio.onended = null;
        audio.onerror = null;
        if (this.abortCurrent === onAbort) this.abortCurrent = null;
        if (revokeOwned && this.currentUrl === src) {
          URL.revokeObjectURL(src);
        }
        this.currentUrl = null;
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

  stop(): void {
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
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
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
