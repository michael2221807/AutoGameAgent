import { describe, it, expect } from 'vitest';
import { CrossRefSyncModule } from './cross-ref-sync';
import { createMockStateManager } from '../__test-utils__/state-manager.mock';
import type { IntegrityRule, ChangeLog } from '../types';

describe('CrossRefSyncModule', () => {
  const emptyChangeLog: ChangeLog = { changes: [], source: 'command', timestamp: 0 };

  function makeRule(overrides: Partial<IntegrityRule['config']> = {}): IntegrityRule {
    return {
      id: 'npc-location-sync',
      module: 'bidirectional-ref-sync',
      config: {
        entityPath: 'NPC列表',
        entityRefField: '当前位置',
        targetBasePath: '地点',
        targetListField: 'NPC',
        entityIdField: '名称',
        ...overrides,
      },
    };
  }

  describe('bidirectional-ref-sync with array entities', () => {
    it('syncs NPC locations to location NPC lists', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm } = createMockStateManager({
        NPC列表: [
          { 名称: '张三', 当前位置: '集市' },
          { 名称: '李四', 当前位置: '酒馆' },
          { 名称: '王五', 当前位置: '集市' },
        ],
        地点: {
          集市: { NPC: [] },
          酒馆: { NPC: [] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get<string[]>('地点.集市.NPC')!.sort()).toEqual(['张三', '王五']);
      expect(sm.get<string[]>('地点.酒馆.NPC')).toEqual(['李四']);
    });

    it('clears NPC list for locations with no NPCs', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm } = createMockStateManager({
        NPC列表: [{ 名称: '张三', 当前位置: '集市' }],
        地点: {
          集市: { NPC: [] },
          酒馆: { NPC: ['旧数据'] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get('地点.酒馆.NPC')).toEqual([]);
    });

    it('does not write when content is already correct', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm, mutations } = createMockStateManager({
        NPC列表: [{ 名称: '张三', 当前位置: '集市' }],
        地点: {
          集市: { NPC: ['张三'] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(mutations).toHaveLength(0);
    });

    it('order-independent comparison (does not rewrite for different order)', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm, mutations } = createMockStateManager({
        NPC列表: [
          { 名称: '张三', 当前位置: '集市' },
          { 名称: '李四', 当前位置: '集市' },
        ],
        地点: {
          集市: { NPC: ['李四', '张三'] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(mutations).toHaveLength(0);
    });
  });

  describe('bidirectional-ref-sync with object entities', () => {
    it('handles entities stored as an object (keyed by name)', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm } = createMockStateManager({
        NPC列表: {
          张三: { 名称: '张三', 当前位置: '集市' },
          李四: { 名称: '李四', 当前位置: '酒馆' },
        },
        地点: {
          集市: { NPC: [] },
          酒馆: { NPC: [] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get('地点.集市.NPC')).toEqual(['张三']);
      expect(sm.get('地点.酒馆.NPC')).toEqual(['李四']);
    });
  });

  describe('edge cases', () => {
    it('skips entities with empty entityId', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm } = createMockStateManager({
        NPC列表: [{ 名称: '', 当前位置: '集市' }],
        地点: { 集市: { NPC: ['旧'] } },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get('地点.集市.NPC')).toEqual([]);
    });

    it('skips entities with empty targetRef', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm } = createMockStateManager({
        NPC列表: [{ 名称: '张三', 当前位置: '' }],
        地点: { 集市: { NPC: ['旧'] } },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get('地点.集市.NPC')).toEqual([]);
    });

    it('handles empty entity collection', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm, mutations } = createMockStateManager({
        NPC列表: [],
        地点: { 集市: { NPC: [] } },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(mutations).toHaveLength(0);
    });

    it('handles missing targetBase', () => {
      const mod = new CrossRefSyncModule([makeRule()]);
      const { sm, mutations } = createMockStateManager({
        NPC列表: [{ 名称: '张三', 当前位置: '集市' }],
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(mutations).toHaveLength(0);
    });

    it('warns for unknown module type (does not throw)', () => {
      const mod = new CrossRefSyncModule([{
        id: 'unknown',
        module: 'nonexistent-module',
        config: {},
      }]);
      const { sm, mutations } = createMockStateManager({});
      expect(() => mod.afterCommands(sm as never, emptyChangeLog)).not.toThrow();
      expect(mutations).toHaveLength(0);
    });
  });

  describe('multiple rules', () => {
    it('processes each rule independently', () => {
      const npcRule = makeRule();
      const itemRule: IntegrityRule = {
        id: 'item-location-sync',
        module: 'bidirectional-ref-sync',
        config: {
          entityPath: '物品',
          entityRefField: '位置',
          targetBasePath: '地点',
          targetListField: '物品列表',
          entityIdField: '名称',
        },
      };
      const mod = new CrossRefSyncModule([npcRule, itemRule]);
      const { sm } = createMockStateManager({
        NPC列表: [{ 名称: '张三', 当前位置: '集市' }],
        物品: [{ 名称: '宝剑', 位置: '酒馆' }],
        地点: {
          集市: { NPC: [], 物品列表: [] },
          酒馆: { NPC: [], 物品列表: [] },
        },
      });
      mod.afterCommands(sm as never, emptyChangeLog);
      expect(sm.get('地点.集市.NPC')).toEqual(['张三']);
      expect(sm.get('地点.酒馆.物品列表')).toEqual(['宝剑']);
    });
  });
});
