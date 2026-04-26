import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockStateManager, createMockLocalStorage } from '@/engine/__test-utils__';
import { makeMidTerm, makeImplicitMidTerm, makeLongTerm, resetCounter } from '@/engine/__test-utils__/fixtures';

// Mock eventBus + logger
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));
vi.mock('@/engine/core/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { MemoryManager, MEMORY_SETTINGS_KEY } = await import('@/engine/memory/memory-manager');
const { eventBus } = await import('@/engine/core/event-bus');

const testConfig = {
  shortTermPath: '记忆.短期',
  midTermPath: '记忆.中期',
  longTermPath: '记忆.长期',
  implicitMidTermPath: '记忆.隐式中期',
  shortTermCapacity: 5,
  midTermRefineThreshold: 25,
  longTermSummaryThreshold: 50,
  longTermSummarizeCount: 50,
  midTermKeep: 0,
  longTermCap: 30,
};

const ls = createMockLocalStorage();

describe('MemoryManager', () => {
  let sm: ReturnType<typeof createMockStateManager>['sm'];
  let mm: InstanceType<typeof MemoryManager>;

  beforeEach(() => {
    const mock = createMockStateManager({
      记忆: { 短期: [], 中期: [], 长期: [], 隐式中期: [] },
    });
    sm = mock.sm;
    mm = new MemoryManager(sm as never, testConfig);
    ls.install();
    vi.mocked(eventBus.emit).mockClear();
    resetCounter();
  });

  afterEach(() => {
    ls.restore();
  });

  describe('short-term memory', () => {
    it('appends entry', () => {
      mm.appendShortTerm('Narrative text.', 1);
      expect(mm.getShortTermEntries()).toHaveLength(1);
      expect(mm.getShortTermEntries()[0].summary).toBe('Narrative text.');
    });

    it('isShortTermFull returns true at capacity', () => {
      for (let i = 0; i < 5; i++) mm.appendShortTerm(`r${i}`, i);
      expect(mm.isShortTermFull()).toBe(true);
    });

    it('isShortTermFull returns false under capacity', () => {
      mm.appendShortTerm('r0', 0);
      expect(mm.isShortTermFull()).toBe(false);
    });
  });

  describe('shiftAndPromoteOldest', () => {
    it('promotes 1:1 when overflow by 1', () => {
      for (let i = 0; i < 6; i++) {
        mm.appendShortTerm(`r${i}`, i);
        mm.appendImplicitMidTerm(makeImplicitMidTerm({ 记忆主体: `im${i}` }));
      }
      const promoted = mm.shiftAndPromoteOldest();
      expect(promoted).toBe(1);
      expect(mm.getShortTermEntries()).toHaveLength(5);
      expect(mm.getMidTermEntries()).toHaveLength(1);
    });

    it('filters out _占位 entries during promotion', () => {
      for (let i = 0; i < 6; i++) mm.appendShortTerm(`r${i}`, i);
      // First implicit is a placeholder
      mm.appendImplicitMidTerm({ 相关角色: [], 事件时间: '', 记忆主体: '[占位]', _占位: true } as never);
      for (let i = 1; i < 6; i++) mm.appendImplicitMidTerm(makeImplicitMidTerm());

      mm.shiftAndPromoteOldest();
      // Placeholder should NOT be in mid-term
      const mid = mm.getMidTermEntries();
      expect(mid.every((m) => !('_占位' in m))).toBe(true);
    });

    it('warns on length mismatch', () => {
      for (let i = 0; i < 6; i++) mm.appendShortTerm(`r${i}`, i);
      // Only 3 implicits for 6 shorts
      for (let i = 0; i < 3; i++) mm.appendImplicitMidTerm(makeImplicitMidTerm());

      mm.shiftAndPromoteOldest();
      expect(eventBus.emit).toHaveBeenCalledWith('ui:toast', expect.objectContaining({ type: 'warning' }));
    });

    it('returns 0 when not full', () => {
      mm.appendShortTerm('r0', 0);
      expect(mm.shiftAndPromoteOldest()).toBe(0);
    });

    it('promotes 0 when ALL implicits are placeholders', () => {
      for (let i = 0; i < 6; i++) {
        mm.appendShortTerm(`r${i}`, i);
        mm.appendImplicitMidTerm({
          相关角色: [], 事件时间: '', 记忆主体: `[占位 · round ${i}]`, _占位: true,
        } as never);
      }
      const promoted = mm.shiftAndPromoteOldest();
      expect(promoted).toBe(0); // all filtered out
      expect(mm.getShortTermEntries()).toHaveLength(5); // short still trimmed
      expect(mm.getMidTermEntries()).toHaveLength(0); // nothing promoted
    });
  });

  describe('mid-term memory', () => {
    it('shouldRefineMidTerm at threshold', () => {
      const entries = Array.from({ length: 25 }, () => makeMidTerm());
      sm.set('记忆.中期', entries);
      expect(mm.shouldRefineMidTerm()).toBe(true);
    });

    it('shouldRefineMidTerm below threshold', () => {
      sm.set('记忆.中期', [makeMidTerm()]);
      expect(mm.shouldRefineMidTerm()).toBe(false);
    });

    it('isMidTermEntryRefined checks flag', () => {
      expect(mm.isMidTermEntryRefined(makeMidTerm({ 已精炼: true }))).toBe(true);
      expect(mm.isMidTermEntryRefined(makeMidTerm())).toBe(false);
    });
  });

  describe('long-term memory', () => {
    it('shouldCompactLongTerm uses strict > (not >=)', () => {
      sm.set('记忆.长期', Array.from({ length: 30 }, () => makeLongTerm()));
      expect(mm.shouldCompactLongTerm()).toBe(false); // 30 === cap, NOT >
      sm.push('记忆.长期', makeLongTerm());
      expect(mm.shouldCompactLongTerm()).toBe(true); // 31 > 30
    });

    it('fallbackTrimLongTerm trims to cap', () => {
      sm.set('记忆.长期', Array.from({ length: 35 }, () => makeLongTerm()));
      const trimmed = mm.fallbackTrimLongTerm();
      expect(trimmed).toBe(5);
      expect(mm.getLongTermEntries()).toHaveLength(30);
    });
  });

  describe('commitSummaryResult', () => {
    it('atomically adds long-term and replaces mid-term', () => {
      sm.set('记忆.中期', [makeMidTerm(), makeMidTerm()]);
      sm.set('记忆.长期', [makeLongTerm()]);

      const newLong = [makeLongTerm({ category: 'test' })];
      const keepMid = [makeMidTerm({ 记忆主体: 'kept' })];

      mm.commitSummaryResult(newLong, keepMid);
      expect(mm.getLongTermEntries()).toHaveLength(2); // 1 existing + 1 new
      expect(mm.getMidTermEntries()).toHaveLength(1);
      expect(mm.getMidTermEntries()[0].记忆主体).toBe('kept');
    });

    it('both long-term and mid-term update in the same call (no partial state)', () => {
      sm.set('记忆.中期', Array.from({ length: 5 }, () => makeMidTerm()));
      sm.set('记忆.长期', []);

      const newLong = [makeLongTerm(), makeLongTerm()];
      const keepMid: never[] = []; // consume all

      mm.commitSummaryResult(newLong, keepMid);
      expect(mm.getLongTermEntries()).toHaveLength(2);
      expect(mm.getMidTermEntries()).toHaveLength(0); // all consumed
    });
  });

  describe('implicit mid-term', () => {
    it('normalizes string input', () => {
      mm.appendImplicitMidTerm('纯文本摘要' as never);
      const entries = mm.getImplicitMidTerm();
      expect(entries).toHaveLength(1);
      expect(entries[0].记忆主体).toBe('纯文本摘要');
    });

    it('normalizes English-key object', () => {
      mm.appendImplicitMidTerm({ characters: ['Player'], gameTime: '1-01', content: 'event' } as never);
      const entries = mm.getImplicitMidTerm();
      expect(entries[0].记忆主体).toBe('event');
    });

    it('filterImplicitByRelevantChars skips _占位', () => {
      mm.appendImplicitMidTerm(makeImplicitMidTerm({ 相关角色: ['玩家'] }));
      mm.appendImplicitMidTerm({ 相关角色: [], 事件时间: '', 记忆主体: '[占位]', _占位: true } as never);
      const filtered = mm.filterImplicitByRelevantChars('玩家', []);
      expect(filtered).toHaveLength(1);
    });

    it('filterImplicitByRelevantChars includes entry with mixed relevant + irrelevant chars', () => {
      // Entry mentions both a relevant NPC and an irrelevant one — should still be included
      mm.appendImplicitMidTerm(makeImplicitMidTerm({ 相关角色: ['张三', '路人甲'] }));
      const filtered = mm.filterImplicitByRelevantChars('玩家', ['张三']);
      expect(filtered).toHaveLength(1);
    });

    it('filterImplicitByRelevantChars excludes entry with no intersection', () => {
      mm.appendImplicitMidTerm(makeImplicitMidTerm({ 相关角色: ['路人甲', '路人乙'] }));
      const filtered = mm.filterImplicitByRelevantChars('玩家', ['张三']);
      expect(filtered).toHaveLength(0);
    });

    it('filterImplicitByRelevantChars always includes entries mentioning 玩家', () => {
      mm.appendImplicitMidTerm(makeImplicitMidTerm({ 相关角色: ['玩家'] }));
      const filtered = mm.filterImplicitByRelevantChars('不同名字', []);
      expect(filtered).toHaveLength(1); // 玩家 is always in the relevant set
    });
  });

  describe('getEffectiveConfig', () => {
    it('returns defaults without localStorage', () => {
      const cfg = mm.getEffectiveConfig();
      expect(cfg.shortTermCapacity).toBe(5);
      expect(cfg.longTermCap).toBe(30);
    });

    it('applies localStorage override', () => {
      ls.storage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify({ shortTermLimit: 10 }));
      mm.clearConfigCache();
      const cfg = mm.getEffectiveConfig();
      expect(cfg.shortTermCapacity).toBe(10);
    });

    it('clamps out-of-range values', () => {
      ls.storage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify({ shortTermLimit: 999 }));
      mm.clearConfigCache();
      expect(mm.getEffectiveConfig().shortTermCapacity).toBe(50); // max clamp
    });

    it('handles corrupt JSON', () => {
      ls.storage.setItem(MEMORY_SETTINGS_KEY, '{invalid json}');
      mm.clearConfigCache();
      expect(mm.getEffectiveConfig().shortTermCapacity).toBe(5); // default
    });

    it('caches within TTL', () => {
      const a = mm.getEffectiveConfig();
      const b = mm.getEffectiveConfig();
      expect(a).toBe(b); // same reference = cache hit
    });

    it('clearConfigCache forces re-read', () => {
      const a = mm.getEffectiveConfig();
      mm.clearConfigCache();
      const b = mm.getEffectiveConfig();
      expect(a).not.toBe(b); // different reference
    });
  });
});
