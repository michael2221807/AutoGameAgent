import { describe, it, expect } from 'vitest';
import { EntityBuilder, inferEntityType, type EntityBuilderPaths } from '@/engine/memory/engram/entity-builder';
import type { EngramEventNode, EngramEventStructuredKV } from '@/engine/memory/engram/event-builder';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';

/**
 * 2026-04-14 重构：双源 EntityBuilder
 * - 从 state tree 读玩家 + 社交.关系 NPC
 * - 从 events 补充 role / location
 * - 新增 description + is_embedded 字段
 */

const PATHS: EntityBuilderPaths = {
  playerName: '角色.基础信息.姓名',
  relationships: '社交.关系',
};

function makeKV(overrides: Partial<EngramEventStructuredKV> = {}): EngramEventStructuredKV {
  return {
    event: '测试事件',
    role: [],
    location: [],
    time_anchor: '',
    causality: '承接',
    logic: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EngramEventNode> = {}): EngramEventNode {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    subject: '玩家',
    action: 'narrative',
    tags: ['narrative'],
    text: '一段测试叙事',
    summary: '一段测试叙事',
    structured_kv: makeKV(),
    is_embedded: false,
    roundNumber: 1,
    ...overrides,
  };
}

function makeSM(overrides: Record<string, unknown> = {}) {
  return createMockStateManager({
    角色: { 基础信息: { 姓名: overrides.playerName ?? '玩家' } },
    社交: { 关系: overrides.relationships ?? [] },
  }).sm;
}

describe('EntityBuilder (2026-04-14 双源重构)', () => {
  const builder = new EntityBuilder();

  describe('player entity', () => {
    it('always includes the player as first entity', () => {
      const sm = makeSM({ playerName: '戊非春' });
      const entities = builder.build([], sm, PATHS);
      const player = entities.find((e) => e.name === '戊非春');
      expect(player).toBeDefined();
      expect(player?.type).toBe('player');
      expect(player?.summary).toBe('玩家角色');
      expect(player?.is_embedded).toBe(false);
    });

    it('falls back to "玩家" when playerName is empty', () => {
      const sm = createMockStateManager({ 角色: { 基础信息: {} }, 社交: { 关系: [] } }).sm;
      const entities = builder.build([], sm, PATHS);
      expect(entities.some((e) => e.name === '玩家' && e.type === 'player')).toBe(true);
    });
  });

  describe('NPC entities from 社交.关系', () => {
    it('adds non-普通 NPCs as npc type', () => {
      const sm = makeSM({
        relationships: [
          { 名称: '张三', 类型: '重点', 与玩家关系: '师父', 当前外貌状态: '鹤发童颜，道骨仙风' },
          { 名称: '李四', 类型: '重点', 与玩家关系: '同门', 当前外貌状态: '年轻道士' },
        ],
      });
      const entities = builder.build([], sm, PATHS);
      expect(entities.find((e) => e.name === '张三')?.type).toBe('npc');
      expect(entities.find((e) => e.name === '张三')?.summary).toBe('鹤发童颜，道骨仙风');
      expect(entities.find((e) => e.name === '李四')?.type).toBe('npc');
    });

    it('skips 普通 NPCs', () => {
      const sm = makeSM({
        relationships: [
          { 名称: '路人甲', 类型: '普通' },
          { 名称: '店主', 类型: '重点' },
        ],
      });
      const entities = builder.build([], sm, PATHS);
      expect(entities.some((e) => e.name === '路人甲')).toBe(false);
      expect(entities.some((e) => e.name === '店主')).toBe(true);
    });

    it('includes NPCs with undefined 类型 (treated as important)', () => {
      const sm = makeSM({
        relationships: [{ 名称: '未分类NPC', 与玩家关系: '初遇' }],
      });
      const entities = builder.build([], sm, PATHS);
      expect(entities.some((e) => e.name === '未分类NPC')).toBe(true);
    });

    it('uses 当前内心想法 as description fallback', () => {
      const sm = makeSM({
        relationships: [{ 名称: '某NPC', 类型: '重点', 当前内心想法: '心事重重' }],
      });
      const entities = builder.build([], sm, PATHS);
      expect(entities.find((e) => e.name === '某NPC')?.summary).toBe('心事重重');
    });

    it('skips NPCs without 名称', () => {
      const sm = makeSM({
        relationships: [{ 名称: '', 类型: '重点' }, { 类型: '重点' } as never],
      });
      const entities = builder.build([], sm, PATHS);
      // only player should remain
      expect(entities.filter((e) => e.type === 'npc')).toHaveLength(0);
    });

    it('handles non-array relationships gracefully', () => {
      const sm = createMockStateManager({
        角色: { 基础信息: { 姓名: '玩家' } },
        社交: { 关系: 'not an array' },
      }).sm;
      const entities = builder.build([], sm, PATHS);
      expect(entities).toHaveLength(1); // only player
    });
  });

  describe('events supplement entities', () => {
    it('adds entities from structured_kv.role', () => {
      const sm = makeSM();
      const events = [
        makeEvent({ structured_kv: makeKV({ role: ['玩家', '王五'] }) }),
      ];
      const entities = builder.build(events, sm, PATHS);
      expect(entities.some((e) => e.name === '王五' && e.type === 'npc')).toBe(true);
    });

    it('adds entities from structured_kv.location', () => {
      const sm = makeSM();
      const events = [
        makeEvent({ structured_kv: makeKV({ location: ['青城山·玉虚宫'] }) }),
      ];
      const entities = builder.build(events, sm, PATHS);
      expect(entities.some((e) => e.name === '青城山·玉虚宫' && e.type === 'location')).toBe(true);
    });

    it('still honors legacy subject/object/location fields', () => {
      const sm = makeSM();
      const events = [makeEvent({ subject: '玩家', object: '宝箱', location: '密室' })];
      const entities = builder.build(events, sm, PATHS);
      expect(entities.some((e) => e.name === '宝箱')).toBe(true);
      expect(entities.some((e) => e.name === '密室' && e.type === 'location')).toBe(true);
    });

    it('merges event-sourced entity with same name (dedup by name)', () => {
      const sm = makeSM({ playerName: '张三' });
      const events = [
        makeEvent({ subject: '张三', roundNumber: 1 }),
        makeEvent({ subject: '张三', roundNumber: 5 }),
      ];
      const entities = builder.build(events, sm, PATHS);
      const zhang = entities.find((e) => e.name === '张三');
      expect(zhang?.type).toBe('player');
      expect(zhang?.firstSeen).toBe(0); // player entity created in step 1 with round 0
      expect(zhang?.lastSeen).toBe(5);
    });
  });

  describe('location heuristic type detection', () => {
    it('recognizes 道观/宫殿/寺庙 as location', () => {
      const sm = makeSM();
      const events = [
        makeEvent({ structured_kv: makeKV({ role: ['玉虚宫'] }) }),
      ];
      const entities = builder.build(events, sm, PATHS);
      expect(entities.find((e) => e.name === '玉虚宫')?.type).toBe('location');
    });
  });

  describe('is_embedded defaults false', () => {
    it('all built entities start un-embedded', () => {
      const sm = makeSM({ relationships: [{ 名称: '张三', 类型: '重点' }] });
      const entities = builder.build([], sm, PATHS);
      expect(entities.every((e) => e.is_embedded === false)).toBe(true);
    });
  });
});

describe('inferEntityType', () => {
  it.each([
    { name: '玩家', expected: 'player' },
    { name: 'player', expected: 'player' },
  ])('returns "player" for "$name"', ({ name, expected }) => {
    expect(inferEntityType(name)).toBe(expected);
  });

  it.each([
    { name: '张三', label: 'a normal NPC name' },
    { name: '李四', label: 'a regular name, no markers' },
  ])('returns "npc" for $label ("$name")', ({ name }) => {
    expect(inferEntityType(name)).toBe('npc');
  });

  it.each([
    { name: '凌云·天风', marker: '·' },
    { name: '青云山', marker: '山' },
    { name: '南阳城', marker: '城' },
    { name: '天剑酒馆', marker: '酒馆' },
  ])('returns "location" for "$name" (contains $marker)', ({ name }) => {
    expect(inferEntityType(name)).toBe('location');
  });

  it.each([
    { name: '星尘计划', marker: '计划' },
    { name: '传承卷轴', marker: '卷轴' },
    { name: '太虚笔记本', marker: '笔记本' },
    { name: '破军剑', marker: '剑' },
  ])('returns "item" for "$name" (contains $marker)', ({ name }) => {
    expect(inferEntityType(name)).toBe('item');
  });
});
