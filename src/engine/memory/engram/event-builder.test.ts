import { describe, it, expect } from 'vitest';
import { EventBuilder, type EventBuilderPaths } from '@/engine/memory/engram/event-builder';
import type { AIResponse } from '@/engine/ai/types';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';

/**
 * 2026-04-14 重写：EventBuilder 新契约
 * - 每回合产出 1 个事件（不是 3 个碎片）
 * - 事件含 structured_kv（role/location/time_anchor）+ burned summary + is_embedded
 * - 从 stateManager 读玩家名/位置/时间，从 response.midTermMemory.相关角色 读 role
 */
function makeResponse(overrides: Partial<AIResponse> = {}): AIResponse {
  return { text: '', commands: [], raw: '', ...overrides };
}

const PATHS: EventBuilderPaths = {
  playerName: '角色.基础信息.姓名',
  playerLocation: '角色.基础信息.当前位置',
  gameTime: '世界.时间',
};

function makeStateManager(overrides: Record<string, unknown> = {}) {
  return createMockStateManager({
    角色: {
      基础信息: {
        姓名: overrides.playerName ?? '玩家',
        当前位置: overrides.location ?? '青城山·玉虚宫',
      },
    },
    世界: {
      时间: overrides.time ?? { 年: 1, 月: 3, 日: 5, 小时: 14, 分钟: 20 },
    },
    ...(overrides.tree as Record<string, unknown> ?? {}),
  }).sm;
}

describe('EventBuilder (2026-04-14 重写)', () => {
  const builder = new EventBuilder();

  describe('single-event-per-round', () => {
    it('produces exactly 1 event regardless of narrative sentence count', () => {
      const sm = makeStateManager();
      const response = makeResponse({
        text: '玩家走进茶馆。老板娘微笑着迎了上来。玩家点了一壶龙井。',
      });
      const events = builder.build(response, sm, 1, PATHS);
      expect(events).toHaveLength(1);
    });

    it('empty text returns empty array', () => {
      const sm = makeStateManager();
      expect(builder.build(makeResponse(), sm, 1, PATHS)).toEqual([]);
      expect(builder.build(makeResponse({ text: '   ' }), sm, 1, PATHS)).toEqual([]);
    });

    it('attaches roundNumber', () => {
      const sm = makeStateManager();
      const events = builder.build(makeResponse({ text: '玩家环顾四周。' }), sm, 42, PATHS);
      expect(events[0].roundNumber).toBe(42);
    });
  });

  describe('subject = player name', () => {
    it('uses player name from state tree', () => {
      const sm = makeStateManager({ playerName: '戊非春' });
      const events = builder.build(makeResponse({ text: '戊非春走向书房。' }), sm, 1, PATHS);
      expect(events[0].subject).toBe('戊非春');
    });

    it('falls back to "玩家" when player name missing', () => {
      const sm = createMockStateManager({ 角色: { 基础信息: {} }, 世界: { 时间: {} } }).sm;
      const events = builder.build(makeResponse({ text: '有人在走路。' }), sm, 1, PATHS);
      expect(events[0].subject).toBe('玩家');
    });
  });

  describe('structured_kv.role from midTermMemory.相关角色', () => {
    it('populates roles from AI response', () => {
      const sm = makeStateManager();
      const events = builder.build(
        makeResponse({
          text: '你与张三对话。',
          midTermMemory: { 相关角色: ['玩家', '张三'], 事件时间: '', 记忆主体: '' },
        }),
        sm, 1, PATHS,
      );
      expect(events[0].structured_kv.role).toEqual(['玩家', '张三']);
    });

    it('filters out empty/non-string roles', () => {
      const sm = makeStateManager();
      const events = builder.build(
        makeResponse({
          text: '对话。',
          midTermMemory: { 相关角色: ['玩家', '', '  ', 42 as unknown as string], 事件时间: '', 记忆主体: '' },
        }),
        sm, 1, PATHS,
      );
      expect(events[0].structured_kv.role).toEqual(['玩家']);
    });

    it('empty role array when midTermMemory missing', () => {
      const sm = makeStateManager();
      const events = builder.build(makeResponse({ text: '独白。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.role).toEqual([]);
    });

    it('handles midTermMemory as string (legacy format)', () => {
      const sm = makeStateManager();
      const events = builder.build(
        makeResponse({ text: '独白。', midTermMemory: '旧格式字符串' }),
        sm, 1, PATHS,
      );
      expect(events[0].structured_kv.role).toEqual([]);
    });
  });

  describe('structured_kv.location from state tree', () => {
    it('populates location from player location path', () => {
      const sm = makeStateManager({ location: '青城山·玉虚宫' });
      const events = builder.build(makeResponse({ text: '你在冥想。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.location).toEqual(['青城山·玉虚宫']);
      expect(events[0].location).toBe('青城山·玉虚宫');
    });

    it('empty location array when path missing or blank', () => {
      const sm = makeStateManager({ location: '' });
      const events = builder.build(makeResponse({ text: '空间静止。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.location).toEqual([]);
      expect(events[0].location).toBeUndefined();
    });
  });

  describe('structured_kv.time_anchor from 世界.时间', () => {
    it('formats year/month/day/hour/minute', () => {
      const sm = makeStateManager({ time: { 年: 1, 月: 3, 日: 5, 小时: 14, 分钟: 20 } });
      const events = builder.build(makeResponse({ text: '日落时分。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.time_anchor).toBe('1年3月5日 14:20');
    });

    it('omits hour/minute when missing', () => {
      const sm = makeStateManager({ time: { 年: 5, 月: 6, 日: 7 } });
      const events = builder.build(makeResponse({ text: '晨昏交替。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.time_anchor).toBe('5年6月7日');
    });

    it('empty when no time data', () => {
      const sm = makeStateManager({ time: {} });
      const events = builder.build(makeResponse({ text: '时间不明。' }), sm, 1, PATHS);
      expect(events[0].structured_kv.time_anchor).toBe('');
    });
  });

  describe('burned summary embeds metadata into text', () => {
    it('includes title + meta + raw text', () => {
      const sm = makeStateManager({ location: '青城山', time: { 年: 1, 月: 3, 日: 5, 小时: 14, 分钟: 20 } });
      const events = builder.build(
        makeResponse({
          text: '你与张三对话，讨论了修炼之道。',
          midTermMemory: { 相关角色: ['玩家', '张三'], 事件时间: '', 记忆主体: '' },
        }),
        sm, 1, PATHS,
      );
      const { summary } = events[0];
      // 标题行应含事件标题 + 因果
      expect(summary).toContain('你与张三对话');
      expect(summary).toContain('(承接)');
      // 元数据行应含时间、地点、角色
      expect(summary).toContain('1年3月5日 14:20');
      expect(summary).toContain('青城山');
      expect(summary).toContain('玩家, 张三');
      // 原文也要保留
      expect(summary).toContain('你与张三对话，讨论了修炼之道。');
    });

    it('truncates over-long titles at 48 chars', () => {
      const sm = makeStateManager();
      const longText = '这是一个非常长的第一句话需要被截断因为它超过了标题允许的最大长度当然实际上这句话本身就超过了四十八个字的上限所以一定会被截断';
      const events = builder.build(makeResponse({ text: longText }), sm, 1, PATHS);
      expect(events[0].structured_kv.event.length).toBeLessThanOrEqual(49); // 48 + ellipsis
      expect(events[0].structured_kv.event.endsWith('…')).toBe(true);
    });
  });

  describe('is_embedded defaults to false', () => {
    it('newly-built events start unembedded', () => {
      const sm = makeStateManager();
      const events = builder.build(makeResponse({ text: '某件事。' }), sm, 1, PATHS);
      expect(events[0].is_embedded).toBe(false);
    });
  });

  describe('unique IDs', () => {
    it('each call produces fresh IDs', () => {
      const sm = makeStateManager();
      const a = builder.build(makeResponse({ text: '事件 A。' }), sm, 1, PATHS);
      const b = builder.build(makeResponse({ text: '事件 B。' }), sm, 2, PATHS);
      expect(a[0].id).not.toBe(b[0].id);
    });

    it('id format matches evt_{ts}_{rand}', () => {
      const sm = makeStateManager();
      const events = builder.build(makeResponse({ text: '一次事件。' }), sm, 1, PATHS);
      expect(events[0].id).toMatch(/^evt_[a-z0-9]+_[a-z0-9]+$/);
    });
  });

  describe('action is always "narrative"', () => {
    it('narrative tag', () => {
      const sm = makeStateManager();
      const events = builder.build(makeResponse({ text: '事件。' }), sm, 1, PATHS);
      expect(events[0].action).toBe('narrative');
      expect(events[0].tags).toContain('narrative');
    });
  });
});
