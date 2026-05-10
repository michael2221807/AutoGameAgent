import { eventBus } from '../core/event-bus';

interface QueueEntry {
  resolve: () => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
}

export interface RateLimiterConfig {
  enabled: boolean;
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private timestamps: number[] = [];
  private queue: QueueEntry[] = [];
  private _enabled = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private _maxRequests = 3;
  private _windowMs = 60_000;

  get enabled(): boolean { return this._enabled; }
  get pendingCount(): number { return this.queue.length; }

  configure(opts: Partial<RateLimiterConfig>): void {
    if (opts.enabled !== undefined) this._enabled = opts.enabled;
    if (opts.maxRequests !== undefined) this._maxRequests = Math.max(1, opts.maxRequests);
    if (opts.windowMs !== undefined) this._windowMs = Math.max(1000, opts.windowMs);
    if (!this._enabled) this.flush();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (!this._enabled) return;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    this.cleanup();

    if (this.timestamps.length < this._maxRequests) {
      this.timestamps.push(Date.now());
      return;
    }

    const waitMs = this.timestamps[0] + this._windowMs - Date.now();
    if (waitMs <= 0) {
      this.cleanup();
      this.timestamps.push(Date.now());
      return;
    }

    eventBus.emit('ui:toast', {
      type: 'info',
      message: `低负荷模式：请求排队中，预计等待 ${Math.ceil(waitMs / 1000)} 秒`,
      duration: waitMs + 1000,
      id: 'rate-limiter-queue',
    });

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const entry: QueueEntry = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          this.timestamps.push(Date.now());
          resolve();
        },
        reject,
        cleanup: () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        },
      };

      const onAbort = () => {
        if (timer) clearTimeout(timer);
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      this.queue.push(entry);
      signal?.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => {
        this.cleanup();
        this.drainQueue();
      }, waitMs);
    });
  }

  flush(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    const pending = this.queue.splice(0);
    for (const entry of pending) {
      entry.cleanup();
      entry.resolve();
    }
  }

  /** Visible for testing */
  _getTimestamps(): readonly number[] {
    return this.timestamps;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this._windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  private drainQueue(): void {
    this.drainTimer = null;
    while (this.queue.length > 0 && this.timestamps.length < this._maxRequests) {
      const entry = this.queue.shift()!;
      entry.cleanup();
      entry.resolve();
    }

    if (this.queue.length > 0 && this.timestamps.length > 0) {
      const nextWaitMs = this.timestamps[0] + this._windowMs - Date.now();
      if (nextWaitMs > 0) {
        this.drainTimer = setTimeout(() => {
          this.cleanup();
          this.drainQueue();
        }, nextWaitMs);
      } else {
        this.cleanup();
        this.drainQueue();
      }
    }
  }
}
