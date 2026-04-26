import { describe, it, expect, beforeEach } from 'vitest';
import { TimeService } from '@/engine/behaviors/time-service';
import { createMockStateManager } from '@/engine/__test-utils__';
import type { CalendarConfig } from '@/engine/types';

const config: CalendarConfig = {
  timeFieldPath: '世界.时间',
  timeFieldFormat: { '年': 'number', '月': 'number', '日': 'number', '小时': 'number', '分钟': 'number' },
  minutesPerHour: 60,
  hoursPerDay: 24,
  daysPerMonth: 30,
  monthsPerYear: 12,
};

function makeTime(年 = 1, 月 = 1, 日 = 1, 小时 = 8, 分钟 = 0) {
  return { 世界: { 时间: { 年, 月, 日, 小时, 分钟 } }, 角色: { 基础信息: { 年龄: 20 } } };
}

describe('TimeService', () => {
  let ts: TimeService;

  beforeEach(() => {
    ts = new TimeService(config);
  });

  it('normalizes minute overflow', () => {
    const { sm } = createMockStateManager(makeTime(1, 1, 1, 8, 90));
    ts.afterCommands(sm as never, { source: 'command', timestamp: 0, changes: [{ path: '世界.时间.分钟', action: 'add', oldValue: 0, newValue: 90, timestamp: 0 }] });
    expect(sm.get('世界.时间.分钟')).toBe(30);
    expect(sm.get('世界.时间.小时')).toBe(9);
  });

  it('normalizes hour overflow into next day', () => {
    const { sm } = createMockStateManager(makeTime(1, 1, 1, 25, 0));
    ts.onGameLoad(sm as never);
    expect(sm.get('世界.时间.小时')).toBe(1);
    expect(sm.get('世界.时间.日')).toBe(2);
  });

  it('normalizes day overflow into next month', () => {
    const { sm } = createMockStateManager(makeTime(1, 1, 31, 0, 0));
    ts.onGameLoad(sm as never);
    expect(sm.get('世界.时间.日')).toBe(1);
    expect(sm.get('世界.时间.月')).toBe(2);
  });

  it('normalizes month overflow into next year', () => {
    const { sm } = createMockStateManager(makeTime(1, 13, 1, 0, 0));
    ts.onGameLoad(sm as never);
    expect(sm.get('世界.时间.月')).toBe(1);
    expect(sm.get('世界.时间.年')).toBe(2);
  });

  it('cascades multi-level overflow', () => {
    // 90 minutes + 23 hours + 29 days = should cascade across all levels
    const { sm } = createMockStateManager(makeTime(1, 1, 30, 23, 90));
    ts.onGameLoad(sm as never);
    expect(sm.get('世界.时间.分钟')).toBe(30);
    expect(sm.get('世界.时间.小时')).toBe(0);
    expect(sm.get('世界.时间.日')).toBe(1);
    expect(sm.get('世界.时间.月')).toBe(2);
  });

  it('updates age on year change', () => {
    const { sm } = createMockStateManager(makeTime(1, 13, 1, 0, 0)); // month 13 → year+1
    ts.onGameLoad(sm as never);
    expect(sm.get('角色.基础信息.年龄')).toBe(21);
  });

  it('skips when no time change in changeLog', () => {
    const { sm, mutations } = createMockStateManager(makeTime(1, 1, 1, 8, 90));
    ts.afterCommands(sm as never, { source: 'command', timestamp: 0, changes: [{ path: '角色.名字', action: 'set', oldValue: '', newValue: 'X', timestamp: 0 }] });
    // No time-related mutation should happen
    expect(mutations).toHaveLength(0);
  });

  it('handles negative minutes (borrow)', () => {
    const { sm } = createMockStateManager(makeTime(1, 1, 1, 8, -1));
    ts.onGameLoad(sm as never);
    expect(sm.get('世界.时间.分钟')).toBe(59);
    expect(sm.get('世界.时间.小时')).toBe(7);
  });

  it('no-op for already normalized time', () => {
    const { sm } = createMockStateManager(makeTime(1, 6, 15, 12, 30));
    ts.onGameLoad(sm as never);
    // Values written back same as original — mutations exist but values unchanged
    expect(sm.get('世界.时间.分钟')).toBe(30);
    expect(sm.get('世界.时间.小时')).toBe(12);
  });
});
