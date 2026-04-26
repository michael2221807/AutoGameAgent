/**
 * Factory functions for memory tier entries.
 */
import type { ShortTermEntry, MidTermEntry, ImplicitMidTermEntry, LongTermEntry } from '@/engine/memory/memory-manager';

let _counter = 0;
function uid(): number { return ++_counter; }

export function makeShortTerm(overrides?: Partial<ShortTermEntry>): ShortTermEntry {
  const n = uid();
  return {
    round: n,
    summary: `Round ${n} narrative text.`,
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeMidTerm(overrides?: Partial<MidTermEntry>): MidTermEntry {
  return {
    相关角色: ['玩家'],
    事件时间: '1-01-01-08-00',
    记忆主体: `Mid-term event summary ${uid()}.`,
    ...overrides,
  };
}

export function makeImplicitMidTerm(overrides?: Partial<ImplicitMidTermEntry>): ImplicitMidTermEntry {
  return {
    相关角色: ['玩家'],
    事件时间: '1-01-01-08-00',
    记忆主体: `Implicit mid-term ${uid()}.`,
    ...overrides,
  };
}

export function makeLongTerm(overrides?: Partial<LongTermEntry>): LongTermEntry {
  const n = uid();
  return {
    id: `lt_test_${n}`,
    category: '综合',
    content: `Long-term world evolution entry ${n}.`,
    createdAt: Date.now(),
    ...overrides,
  };
}

export function resetCounter(): void { _counter = 0; }
