import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '@/engine/ai/rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes through immediately when disabled', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: false, maxRequests: 1, windowMs: 60_000 });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(rl.pendingCount).toBe(0);
  });

  it('allows up to maxRequests without waiting', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 3, windowMs: 60_000 });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(rl._getTimestamps()).toHaveLength(3);
  });

  it('queues requests when quota is exhausted', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 2, windowMs: 60_000 });

    await rl.acquire();
    await rl.acquire();

    let resolved = false;
    const p = rl.acquire().then(() => { resolved = true; });
    // Should be queued, not resolved yet
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    expect(rl.pendingCount).toBe(1);

    // Advance past window — should drain
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    expect(resolved).toBe(true);
    expect(rl.pendingCount).toBe(0);
  });

  it('respects AbortSignal to cancel queued request', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    await rl.acquire();

    const ac = new AbortController();
    const p = rl.acquire(ac.signal);

    expect(rl.pendingCount).toBe(1);
    ac.abort();

    await expect(p).rejects.toThrow('Aborted');
    expect(rl.pendingCount).toBe(0);
  });

  it('rejects immediately if signal already aborted', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    const ac = new AbortController();
    ac.abort();
    await expect(rl.acquire(ac.signal)).rejects.toThrow('Aborted');
  });

  it('flush releases all queued requests', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    await rl.acquire();

    let r1 = false, r2 = false;
    const p1 = rl.acquire().then(() => { r1 = true; });
    const p2 = rl.acquire().then(() => { r2 = true; });

    expect(rl.pendingCount).toBe(2);
    rl.flush();
    await Promise.all([p1, p2]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(rl.pendingCount).toBe(0);
  });

  it('disabling flushes the queue automatically', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    await rl.acquire();

    let resolved = false;
    const p = rl.acquire().then(() => { resolved = true; });

    expect(rl.pendingCount).toBe(1);
    rl.configure({ enabled: false });
    await p;
    expect(resolved).toBe(true);
    expect(rl.pendingCount).toBe(0);
  });

  it('drains multiple queued requests sequentially as window slides', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 10_000 });

    await rl.acquire();

    const order: number[] = [];
    const p1 = rl.acquire().then(() => { order.push(1); });
    const p2 = rl.acquire().then(() => { order.push(2); });

    await vi.advanceTimersByTimeAsync(10_000);
    await p1;
    await vi.advanceTimersByTimeAsync(10_000);
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it('configure updates limits dynamically', async () => {
    const rl = new RateLimiter();
    rl.configure({ enabled: true, maxRequests: 1, windowMs: 60_000 });

    await rl.acquire();

    // Raise limit — next request should pass immediately
    rl.configure({ maxRequests: 5 });

    let resolved = false;
    // Need to drain queue first - no queue since we're calling acquire fresh
    await rl.acquire();
    resolved = true;
    expect(resolved).toBe(true);
  });
});
