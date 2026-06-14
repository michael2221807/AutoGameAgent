/**
 * useSessionMode — reactive session-mode singleton (Story 9 / D17)
 *
 * Covers the reactive + persistence-orchestration logic the engine-review (R1)
 * hardened:
 * - default 'play' + sync from slot meta (SC-7/SC-8)
 * - optimistic setMode with rollback + toast on persist failure
 * - no-slot in-memory path vs missing-profileManager error path (R1 issue 2)
 * - concurrency guard against rapid double-toggle (R1 issue 4)
 *
 * Harness: app.runWithContext lets inject('profileManager') resolve without a DOM
 * (vitest env=node), and setActivePinia powers useEngineStateStore.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { eventBus } from '@/engine/core/event-bus';
import { useEngineStateStore } from '@/engine/stores/engine-state';
import { useSessionMode, __resetSessionModeForTest } from './useSessionMode';
import type { UseSessionModeReturn } from './useSessionMode';

function harness(profileManager?: unknown): UseSessionModeReturn {
  const app = createApp({ render: () => null });
  if (profileManager !== undefined) app.provide('profileManager', profileManager);
  // runWithContext runs the composable with the app's inject context active,
  // without mounting (no DOM in node env).
  return app.runWithContext(() => useSessionMode());
}

describe('useSessionMode (Story 9)', () => {
  let store: ReturnType<typeof useEngineStateStore>;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useEngineStateStore();
    __resetSessionModeForTest();
    emitSpy = vi.spyOn(eventBus, 'emit');
  });

  function setActiveSlot(): void {
    store.activeProfileId = 'p1';
    store.activeSlotId = 's1';
  }

  it('defaults to play', () => {
    const sm = harness(undefined);
    expect(sm.sessionType.value).toBe('play');
    expect(sm.isWorldBuilding.value).toBe(false);
  });

  it('SC-7: syncFromActiveSlot reads worldBuilding from slot meta', () => {
    setActiveSlot();
    const sm = harness({ getSlotMeta: vi.fn(() => ({ sessionType: 'worldBuilding' })) });
    sm.syncFromActiveSlot();
    expect(sm.sessionType.value).toBe('worldBuilding');
    expect(sm.isWorldBuilding.value).toBe(true);
  });

  it('SC-8: syncFromActiveSlot defaults to play when slot has no sessionType', () => {
    setActiveSlot();
    const sm = harness({ getSlotMeta: vi.fn(() => ({})) });
    sm.sessionType.value = 'worldBuilding'; // pretend stale state from a prior session
    sm.syncFromActiveSlot();
    expect(sm.sessionType.value).toBe('play');
  });

  it('R1#1: syncFromActiveSlot resets to play when no active slot (no stale carry-over)', () => {
    const getSlotMeta = vi.fn();
    const sm = harness({ getSlotMeta });
    sm.sessionType.value = 'worldBuilding';
    sm.syncFromActiveSlot();
    expect(sm.sessionType.value).toBe('play');
    expect(getSlotMeta).not.toHaveBeenCalled();
  });

  it('SC-7: setMode persists via updateSlotMeta', async () => {
    setActiveSlot();
    const updateSlotMeta = vi.fn(async () => {});
    const sm = harness({ updateSlotMeta, getSlotMeta: vi.fn() });
    await sm.setMode('worldBuilding');
    expect(updateSlotMeta).toHaveBeenCalledWith('p1', 's1', { sessionType: 'worldBuilding' });
    expect(sm.sessionType.value).toBe('worldBuilding');
  });

  it('rolls back + toasts on persist failure', async () => {
    setActiveSlot();
    const updateSlotMeta = vi.fn(async () => { throw new Error('idb fail'); });
    const sm = harness({ updateSlotMeta, getSlotMeta: vi.fn() });
    await expect(sm.setMode('worldBuilding')).rejects.toThrow('idb fail');
    expect(sm.sessionType.value).toBe('play'); // rolled back
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      expect.objectContaining({ type: 'error', i18nKey: 'layout.sessionMode.persistFailed' }),
    );
  });

  it('setMode with no active slot keeps in-memory only (no persist, no error)', async () => {
    const updateSlotMeta = vi.fn(async () => {});
    const sm = harness({ updateSlotMeta, getSlotMeta: vi.fn() });
    await sm.setMode('worldBuilding');
    expect(sm.sessionType.value).toBe('worldBuilding');
    expect(updateSlotMeta).not.toHaveBeenCalled();
  });

  it('R1#2: setMode throws + toasts when slot active but profileManager missing', async () => {
    setActiveSlot();
    const sm = harness(undefined); // no profileManager provided
    await expect(sm.setMode('worldBuilding')).rejects.toThrow(/profileManager unavailable/);
    expect(emitSpy).toHaveBeenCalledWith(
      'ui:toast',
      expect.objectContaining({ type: 'error', i18nKey: 'layout.sessionMode.persistFailed' }),
    );
  });

  it('R1#4: concurrency guard — a second setMode is ignored while persisting', async () => {
    setActiveSlot();
    let resolveWrite!: () => void;
    const updateSlotMeta = vi.fn(() => new Promise<void>((r) => { resolveWrite = r; }));
    const sm = harness({ updateSlotMeta, getSlotMeta: vi.fn() });

    const inflight = sm.setMode('worldBuilding'); // starts persisting (unresolved)
    await sm.setMode('play'); // must be ignored while persisting
    expect(sm.sessionType.value).toBe('worldBuilding');
    expect(updateSlotMeta).toHaveBeenCalledTimes(1);

    resolveWrite();
    await inflight;
    expect(sm.isPersisting.value).toBe(false);
  });

  it('toggle flips between play and worldBuilding', async () => {
    setActiveSlot();
    const updateSlotMeta = vi.fn(async () => {});
    const sm = harness({ updateSlotMeta, getSlotMeta: vi.fn() });
    await sm.toggle();
    expect(sm.sessionType.value).toBe('worldBuilding');
    await sm.toggle();
    expect(sm.sessionType.value).toBe('play');
    expect(updateSlotMeta).toHaveBeenCalledTimes(2);
  });
});
