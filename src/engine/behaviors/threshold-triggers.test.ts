import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThresholdTriggersModule } from './threshold-triggers';
import { createMockStateManager } from '../__test-utils__/state-manager.mock';
import type { ThresholdTriggerConfig } from '../types';

const emitted: Array<{ event: string; payload: unknown }> = [];

vi.mock('../core/event-bus', () => ({
  eventBus: {
    emit: (event: string, payload?: unknown) => {
      emitted.push({ event, payload });
    },
  },
}));

describe('ThresholdTriggersModule', () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  function makeConfig(overrides: Partial<ThresholdTriggerConfig> = {}): ThresholdTriggerConfig {
    return {
      watch: '角色.属性.体力',
      condition: '<= 0',
      action: 'emit-event',
      payload: { event: 'game-over' },
      ...overrides,
    };
  }

  describe('condition parsing', () => {
    it('triggers on <= condition', () => {
      const config = makeConfig({ condition: '<= 0' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('triggers on >= condition', () => {
      const config = makeConfig({ condition: '>= 80', payload: { event: 'love-max' } });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 80 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('triggers on == condition', () => {
      const config = makeConfig({ condition: '== 100' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 100 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('triggers on < condition', () => {
      const config = makeConfig({ condition: '< 5' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 4 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('triggers on > condition', () => {
      const config = makeConfig({ condition: '> 20' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 21 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('handles negative thresholds', () => {
      const config = makeConfig({ condition: '<= -5' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: -5 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('handles decimal thresholds', () => {
      const config = makeConfig({ condition: '>= 3.14' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 3.14 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('skips invalid condition format', () => {
      const config = makeConfig({ condition: 'bad' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(0);
    });
  });

  describe('deduplication', () => {
    it('fires only once while condition stays satisfied', () => {
      const config = makeConfig({ condition: '<= 0' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });

      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);

      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);
    });

    it('fires again after condition no longer met then re-met', () => {
      const config = makeConfig({ condition: '<= 0' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });

      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);

      sm.set('角色.属性.体力', 5);
      mod.onRoundEnd(sm as never);

      sm.set('角色.属性.体力', -1);
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(2);
    });
  });

  describe('non-numeric values', () => {
    it('skips NaN values silently', () => {
      const config = makeConfig();
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 'not a number' } } });
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(0);
    });

    it('skips undefined values', () => {
      const config = makeConfig();
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({});
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(0);
    });
  });

  describe('action types', () => {
    it('emit-event — emits with watch path in payload', () => {
      const config = makeConfig({
        action: 'emit-event',
        payload: { event: 'game-over', reason: 'hp_zero' },
      });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });
      mod.onRoundEnd(sm as never);

      expect(emitted[0].event).toBe('game-over');
      expect(emitted[0].payload).toMatchObject({ watch: '角色.属性.体力', reason: 'hp_zero' });
    });

    it('set-field — sets the specified path', () => {
      const config = makeConfig({
        action: 'set-field',
        payload: { path: '角色.状态.已死亡', value: true },
      });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 }, 状态: {} } });
      mod.onRoundEnd(sm as never);
      expect(sm.get('角色.状态.已死亡')).toBe(true);
    });

    it('run-pipeline — emits engine:run-pipeline event', () => {
      const config = makeConfig({
        action: 'run-pipeline',
        payload: { pipeline: 'death-sequence' },
      });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });
      mod.onRoundEnd(sm as never);

      expect(emitted[0].event).toBe('engine:run-pipeline');
      expect(emitted[0].payload).toMatchObject({
        pipeline: 'death-sequence',
        trigger: '角色.属性.体力',
      });
    });
  });

  describe('onGameLoad', () => {
    it('clears firedSet and re-checks all triggers', () => {
      const config = makeConfig({ condition: '<= 0' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });

      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);

      mod.onGameLoad(sm as never);
      expect(emitted).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('allows trigger to fire again after reset', () => {
      const config = makeConfig({ condition: '<= 0' });
      const mod = new ThresholdTriggersModule([config]);
      const { sm } = createMockStateManager({ 角色: { 属性: { 体力: 0 } } });

      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(1);

      mod.reset();
      mod.onRoundEnd(sm as never);
      expect(emitted).toHaveLength(2);
    });
  });
});
