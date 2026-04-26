import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NpcPresenceService } from '@/engine/social/npc-presence';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';

function makeStateManager(npcs: Record<string, unknown>[]) {
  const store: Record<string, unknown> = {
    [DEFAULT_ENGINE_PATHS.relationships]: npcs,
  };
  return {
    get: vi.fn(<T>(path: string): T | undefined => store[path] as T | undefined),
    set: vi.fn((path: string, value: unknown) => { store[path] = value; }),
    _store: store,
  };
}

const paths = DEFAULT_ENGINE_PATHS;

describe('NpcPresenceService', () => {
  const npcs = [
    { 名称: 'Alice', 是否在场: true, 好感度: 80 },
    { 名称: 'Bob', 是否在场: false, 好感度: 50 },
    { 名称: 'Carol', 好感度: 30 },
  ];

  let sm: ReturnType<typeof makeStateManager>;
  let svc: NpcPresenceService;

  beforeEach(() => {
    sm = makeStateManager([...npcs.map((n) => ({ ...n }))]);
    svc = new NpcPresenceService(sm as never, paths);
  });

  describe('partition', () => {
    it('separates present from absent', () => {
      const { present, absent } = svc.partition();
      expect(present).toHaveLength(1);
      expect(present[0]['名称']).toBe('Alice');
      expect(absent).toHaveLength(2);
    });

    it('treats missing isPresent as absent', () => {
      const { absent } = svc.partition();
      const carol = absent.find((n) => n['名称'] === 'Carol');
      expect(carol).toBeDefined();
    });

    it('handles empty NPC list', () => {
      sm._store[DEFAULT_ENGINE_PATHS.relationships] = [];
      const { present, absent } = svc.partition();
      expect(present).toHaveLength(0);
      expect(absent).toHaveLength(0);
    });

    it('handles undefined NPC list', () => {
      sm._store[DEFAULT_ENGINE_PATHS.relationships] = undefined;
      const { present, absent } = svc.partition();
      expect(present).toHaveLength(0);
      expect(absent).toHaveLength(0);
    });
  });

  describe('setPresence', () => {
    it('sets NPC presence to true', () => {
      svc.setPresence('Bob', true);
      expect(sm.set).toHaveBeenCalled();
      const written = sm.set.mock.calls[0][1] as Record<string, unknown>[];
      const bob = written.find((n) => n['名称'] === 'Bob');
      expect(bob?.['是否在场']).toBe(true);
    });

    it('does not mutate original NPC objects', () => {
      const original = sm._store[DEFAULT_ENGINE_PATHS.relationships] as Record<string, unknown>[];
      const bobBefore = original.find((n) => n['名称'] === 'Bob');
      svc.setPresence('Bob', true);
      expect(bobBefore?.['是否在场']).toBe(false);
    });

    it('no-ops for unknown NPC name', () => {
      svc.setPresence('Unknown', true);
      expect(sm.set).not.toHaveBeenCalled();
    });
  });

  describe('clearAllPresence', () => {
    it('sets all NPCs to absent', () => {
      svc.clearAllPresence();
      const written = sm.set.mock.calls[0][1] as Record<string, unknown>[];
      expect(written.every((n) => n['是否在场'] === false)).toBe(true);
    });
  });
});
