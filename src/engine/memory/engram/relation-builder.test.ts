import { describe, it, expect } from 'vitest';
import { RelationBuilder, type RelationBuilderPaths } from '@/engine/memory/engram/relation-builder';
import type { EngramEventNode, EngramEventStructuredKV } from '@/engine/memory/engram/event-builder';
import type { EngramEntity } from '@/engine/memory/engram/entity-builder';
import { createMockStateManager } from '@/engine/__test-utils__/state-manager.mock';

/**
 * 2026-04-14 重构：双源 RelationBuilder
 * - 事件内共现（role ↔ role, role → location, role → concept）
 * - 社交关系（NPC → 玩家 rel_xxx）
 */

const PATHS: RelationBuilderPaths = {
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

function makeEntity(name: string, type: EngramEntity['type'] = 'npc'): EngramEntity {
  return {
    name,
    type,
    attributes: {},
    firstSeen: 0,
    lastSeen: 0,
    mentionCount: 1,
    description: '',
    is_embedded: false,
  };
}

function makeSM(overrides: Record<string, unknown> = {}) {
  return createMockStateManager({
    角色: { 基础信息: { 姓名: overrides.playerName ?? '玩家' } },
    社交: { 关系: overrides.relationships ?? [] },
  }).sm;
}

describe('RelationBuilder (2026-04-14 双源重构)', () => {
  const builder = new RelationBuilder();

  describe('social relations from 社交.关系', () => {
    it('creates rel_xxx edge from each non-普通 NPC to player', () => {
      const sm = makeSM({
        relationships: [
          { 名称: '张三', 类型: '重点', 与玩家关系: '师父' },
          { 名称: '李四', 类型: '重点', 与玩家关系: '同门' },
        ],
      });
      const entities = [makeEntity('玩家', 'player'), makeEntity('张三'), makeEntity('李四')];
      const relations = builder.build([], entities, sm, PATHS);
      const zhang = relations.find((r) => r.fromName === '张三' && r.toName === '玩家');
      expect(zhang?.type).toBe('rel_师父');
      expect(zhang?.weight).toBe(0.8);
      expect(relations.some((r) => r.fromName === '李四' && r.type === 'rel_同门')).toBe(true);
    });

    it('skips 普通 NPCs', () => {
      const sm = makeSM({
        relationships: [{ 名称: '路人甲', 类型: '普通', 与玩家关系: '陌生人' }],
      });
      const entities = [makeEntity('玩家', 'player')];
      const relations = builder.build([], entities, sm, PATHS);
      expect(relations.some((r) => r.fromName === '路人甲')).toBe(false);
    });

    it('uses "related_to" fallback when 与玩家关系 missing', () => {
      const sm = makeSM({
        relationships: [{ 名称: '神秘人', 类型: '重点' }],
      });
      const entities = [makeEntity('玩家', 'player'), makeEntity('神秘人')];
      const relations = builder.build([], entities, sm, PATHS);
      expect(relations.some((r) => r.fromName === '神秘人' && r.type === 'rel_related_to')).toBe(true);
    });
  });

  describe('event co-occurrence', () => {
    it('creates co_occurs_with for roles in same event (both directions)', () => {
      const sm = makeSM();
      const event = makeEvent({
        structured_kv: makeKV({ role: ['玩家', '张三', '李四'] }),
      });
      const entities = [makeEntity('玩家', 'player'), makeEntity('张三'), makeEntity('李四')];
      const relations = builder.build([event], entities, sm, PATHS);
      const coOccurs = relations.filter((r) => r.type === 'co_occurs_with');
      // 3 roles → 3 pairs × 2 directions = 6 edges
      expect(coOccurs.length).toBe(6);
    });

    it('creates appears_at for role → location', () => {
      const sm = makeSM();
      const event = makeEvent({
        structured_kv: makeKV({ role: ['玩家', '张三'], location: ['青城山'] }),
      });
      const entities = [makeEntity('玩家', 'player'), makeEntity('张三'), makeEntity('青城山', 'location')];
      const relations = builder.build([event], entities, sm, PATHS);
      const appearsAt = relations.filter((r) => r.type === 'appears_at');
      expect(appearsAt.length).toBe(2);
      expect(appearsAt.some((r) => r.fromName === '玩家' && r.toName === '青城山')).toBe(true);
    });

    it('creates involved_in for role → event concept (only if entity exists)', () => {
      const sm = makeSM();
      const event = makeEvent({
        structured_kv: makeKV({ role: ['玩家'], event: '修炼' }),
      });
      const entities = [makeEntity('玩家', 'player'), makeEntity('修炼', 'other')];
      const relations = builder.build([event], entities, sm, PATHS);
      expect(relations.some((r) => r.fromName === '玩家' && r.toName === '修炼' && r.type === 'involved_in')).toBe(true);
    });

    it('skips involved_in when event concept has no corresponding entity', () => {
      const sm = makeSM();
      const event = makeEvent({
        structured_kv: makeKV({ role: ['玩家'], event: '未建实体的概念' }),
      });
      const entities = [makeEntity('玩家', 'player')];
      const relations = builder.build([event], entities, sm, PATHS);
      expect(relations.some((r) => r.type === 'involved_in')).toBe(false);
    });
  });

  describe('legacy subject/object pair (compat)', () => {
    it('still extracts relation from subject+object+action', () => {
      const sm = makeSM();
      const event = makeEvent({
        subject: '玩家',
        object: '怪物',
        action: '攻击',
      });
      const relations = builder.build([event], [], sm, PATHS);
      expect(relations.some((r) => r.fromName === '玩家' && r.toName === '怪物' && r.type === 'enemy')).toBe(true);
    });

    it('skips events with empty subject or object', () => {
      const sm = makeSM();
      const event = makeEvent({ subject: '', object: '张三' });
      const relations = builder.build([event], [], sm, PATHS);
      expect(relations.every((r) => r.fromName.length > 0 && r.toName.length > 0)).toBe(true);
    });
  });

  describe('upsert + weight monotonic growth', () => {
    it('merges same (from, to, type) triples and increments weight', () => {
      const sm = makeSM();
      const events = Array.from({ length: 5 }, () =>
        makeEvent({ structured_kv: makeKV({ role: ['A', 'B'] }) }),
      );
      const entities = [makeEntity('A'), makeEntity('B')];
      const relations = builder.build(events, entities, sm, PATHS);
      const ab = relations.find((r) => r.fromName === 'A' && r.toName === 'B' && r.type === 'co_occurs_with');
      expect(ab).toBeDefined();
      expect(ab!.weight).toBeGreaterThan(0.3);
      expect(ab!.weight).toBeLessThanOrEqual(1.0);
    });
  });

  describe('no self-edges / empty names', () => {
    it('skips relations where fromName === toName', () => {
      const sm = makeSM();
      const event = makeEvent({
        structured_kv: makeKV({ role: ['玩家', '玩家'] }),
      });
      const relations = builder.build([event], [makeEntity('玩家', 'player')], sm, PATHS);
      expect(relations.every((r) => r.fromName !== r.toName)).toBe(true);
    });
  });

  describe('returns empty when no input', () => {
    it('no events + no relationships → no relations', () => {
      const sm = makeSM();
      expect(builder.build([], [], sm, PATHS)).toEqual([]);
    });
  });
});
