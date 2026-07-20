/**
 * Audio playback abstraction — injected into TtsService so the queue/pipeline
 * orchestration can be unit-tested with a fake player (HTMLAudioElement is a
 * browser-only API). The default impl wraps a single HTMLAudioElement.
 */

export interface TtsAudioPlayer {
  /**
   * Play an audio blob to completion.
   * Resolves when playback ends; rejects if aborted or on a playback error.
   * @param signal — abort to stop this playback early (rejects with AbortError).
   */
  play(blob: Blob, opts: { rate: number; volume: number; signal: AbortSignal }): Promise<void>;
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
    this.stop();
    return new Promise<void>((resolve, reject) => {
      if (opts.signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      this.currentUrl = url;
      audio.playbackRate = opts.rate;
      audio.volume = opts.volume;

      const cleanup = () => {
        opts.signal.removeEventListener('abort', onAbort);
        audio.onended = null;
        audio.onerror = null;
        if (this.abortCurrent === onAbort) this.abortCurrent = null;
        if (this.currentUrl === url) {
          URL.revokeObjectURL(url);
          this.currentUrl = null;
        }
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
    // Settle any in-flight play() promise (rejects with AbortError) before tearing
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
