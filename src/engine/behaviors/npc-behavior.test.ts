import { describe, it, expect } from 'vitest';
import { NpcBehaviorModule } from './npc-behavior';
import { createMockStateManager } from '../__test-utils__/state-manager.mock';
import type { NpcBehaviorConfig, ChangeLog, StateChange } from '../types';

describe('NpcBehaviorModule', () => {
  const defaultConfig: NpcBehaviorConfig = {
    npcTypes: {
      typeField: '类型',
      types: {
        同伴: { onPlayerLeave: 'follow-or-wander', wanderLabel: '四处闲逛' },
        商人: { onPlayerLeave: 'stay' },
        路人: { onPlayerLeave: 'stay' },
        流浪者: { onPlayerLeave: 'wander', wanderLabel: '四处闲逛' },
      },
      defaultType: '路人',
    },
  };

  const pathConfig = {
    playerLocation: '角色.当前位置',
    npcList: 'NPC列表',
  };

  function makeLocationChange(
    oldLoc: string,
    newLoc: string,
  ): ChangeLog {
    const change: StateChange = {
      path: '角色.当前位置',
      action: 'set',
      oldValue: oldLoc,
      newValue: newLoc,
      timestamp: Date.now(),
    };
    return { changes: [change], source: 'command', timestamp: Date.now() };
  }

  describe('follow-or-wander behavior', () => {
    it('companion NPC follows player to new location', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '小红', 类型: '同伴', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));

      expect(sm.get('NPC列表[0].当前位置')).toBe('酒馆');
    });

    it('only moves NPCs at the OLD location', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '小红', 类型: '同伴', 当前位置: '集市' },
          { 名称: '小明', 类型: '同伴', 当前位置: '药铺' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));

      expect(sm.get('NPC列表[0].当前位置')).toBe('酒馆');
      expect(sm.get('NPC列表[1].当前位置')).toBe('药铺');
    });
  });

  describe('stay behavior', () => {
    it('merchant NPC stays at old location', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '王老板', 类型: '商人', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));

      expect(sm.get('NPC列表[0].当前位置')).toBe('集市');
    });
  });

  describe('wander behavior', () => {
    it('wanderer NPC gets wander label', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '老乞丐', 类型: '流浪者', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));

      expect(sm.get('NPC列表[0].当前位置')).toBe('四处闲逛');
    });

    it('uses default wander label when not specified', () => {
      const config: NpcBehaviorConfig = {
        npcTypes: {
          typeField: '类型',
          types: {
            流浪者: { onPlayerLeave: 'wander' },
          },
          defaultType: '路人',
        },
      };
      const mod = new NpcBehaviorModule(config, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '老乞丐', 类型: '流浪者', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      expect(sm.get('NPC列表[0].当前位置')).toBe('未知位置');
    });
  });

  describe('default type', () => {
    it('uses defaultType when NPC has no type field', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '无名', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      // default is 路人 → stay
      expect(sm.get('NPC列表[0].当前位置')).toBe('集市');
    });
  });

  describe('bilingual field support', () => {
    it('handles English field names (currentLocation)', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: 'Alice', 类型: '同伴', currentLocation: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      expect(sm.get('NPC列表[0].currentLocation')).toBe('酒馆');
    });

    it('uses name fallback for NPC naming', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { name: 'Bob', 类型: '同伴', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      expect(sm.get('NPC列表[0].当前位置')).toBe('酒馆');
    });
  });

  describe('no-op cases', () => {
    it('does nothing when no location change in changelog', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm, mutations } = createMockStateManager({
        角色: { 当前位置: '集市' },
        NPC列表: [{ 名称: '小红', 类型: '同伴', 当前位置: '集市' }],
      });

      const emptyLog: ChangeLog = { changes: [], source: 'command', timestamp: 0 };
      mod.afterCommands(sm as never, emptyLog);
      expect(mutations).toHaveLength(0);
    });

    it('does nothing when old and new location are the same', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm, mutations } = createMockStateManager({
        角色: { 当前位置: '集市' },
        NPC列表: [{ 名称: '小红', 类型: '同伴', 当前位置: '集市' }],
      });

      const sameLocChange: ChangeLog = {
        changes: [{
          path: '角色.当前位置',
          action: 'set',
          oldValue: '集市',
          newValue: '集市',
          timestamp: Date.now(),
        }],
        source: 'command',
        timestamp: Date.now(),
      };
      mod.afterCommands(sm as never, sameLocChange);
      expect(mutations).toHaveLength(0);
    });

    it('does nothing when NPC list path does not exist', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm, mutations } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      expect(mutations).toHaveLength(0);
    });

    it('does nothing when NPC list is not an array', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm, mutations } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: 'not an array',
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));
      expect(mutations).toHaveLength(0);
    });
  });

  describe('mixed NPC types', () => {
    it('handles multiple NPCs with different behaviors', () => {
      const mod = new NpcBehaviorModule(defaultConfig, pathConfig);
      const { sm } = createMockStateManager({
        角色: { 当前位置: '酒馆' },
        NPC列表: [
          { 名称: '小红', 类型: '同伴', 当前位置: '集市' },
          { 名称: '王老板', 类型: '商人', 当前位置: '集市' },
          { 名称: '老乞丐', 类型: '流浪者', 当前位置: '集市' },
          { 名称: '路人甲', 类型: '路人', 当前位置: '集市' },
        ],
      });

      mod.afterCommands(sm as never, makeLocationChange('集市', '酒馆'));

      expect(sm.get('NPC列表[0].当前位置')).toBe('酒馆');     // follow
      expect(sm.get('NPC列表[1].当前位置')).toBe('集市');     // stay
      expect(sm.get('NPC列表[2].当前位置')).toBe('四处闲逛'); // wander
      expect(sm.get('NPC列表[3].当前位置')).toBe('集市');     // stay
    });
  });
});
