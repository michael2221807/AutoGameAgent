import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockGameState, type MockGameState } from './mock-game-state';

let mockState: MockGameState;

vi.mock('@/ui/composables/useGameState', () => ({
  useGameState: () => mockState,
}));
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));

const { useLocationEditor } = await import('../useLocationEditor');

describe('useLocationEditor', () => {
  beforeEach(() => {
    const { mock } = createMockGameState({
      世界: {
        地点信息: [
          { 名称: '东荒大陆', 描述: '广袤的大陆', 类型: '大陆' },
          { 名称: '京城', 上级: '东荒大陆', 连接: ['青云城'], NPC: ['张三'] },
          { 名称: '青云城', 上级: '东荒大陆', 连接: ['京城'] },
        ],
      },
      社交: {
        关系: [
          { 名称: '张三', 位置: '京城' },
          { 名称: '李四', 位置: '青云城' },
        ],
      },
    });
    mockState = mock;
  });

  describe('create', () => {
    it('creates a new location', () => {
      const editor = useLocationEditor();
      const result = editor.create({ 名称: '密道', 上级: '京城' });
      expect(result.ok).toBe(true);
      const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息');
      expect(locations).toHaveLength(4);
      expect(locations![3].名称).toBe('密道');
    });

    it('rejects empty name', () => {
      const editor = useLocationEditor();
      const result = editor.create({ 名称: '' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_REQUIRED');
    });

    it('rejects duplicate name', () => {
      const editor = useLocationEditor();
      const result = editor.create({ 名称: '京城' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('LOCATION_NAME_CONFLICT');
    });

    it('maintains bidirectional connections on create', () => {
      const editor = useLocationEditor();
      editor.create({ 名称: '密道', 连接: ['京城'] });
      const locations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
      const jingcheng = locations!.find(l => l.名称 === '京城');
      expect(jingcheng!.连接).toContain('密道');
    });
  });

  describe('update', () => {
    it('updates location fields', () => {
      const editor = useLocationEditor();
      const result = editor.update(1, { 名称: '京城', 描述: '繁华的都城', 连接: ['青云城'] });
      expect(result.ok).toBe(true);
      const loc = mockState.get<Array<{ 描述: string }>>('世界.地点信息')![1];
      expect(loc.描述).toBe('繁华的都城');
    });

    it('cascades rename to child locations', () => {
      const editor = useLocationEditor();
      editor.update(0, { 名称: '西荒大陆' });
      const locations = mockState.get<Array<{ 名称: string; 上级?: string }>>('世界.地点信息');
      const jingcheng = locations!.find(l => l.名称 === '京城');
      expect(jingcheng!.上级).toBe('西荒大陆');
    });

    it('cascades rename to NPC location references', () => {
      const editor = useLocationEditor();
      editor.update(1, { 名称: '新京城', 连接: ['青云城'] });
      const npcs = mockState.get<Array<{ 位置: string }>>('社交.关系');
      expect(npcs![0].位置).toBe('新京城');
    });

    it('cascades rename to connection references', () => {
      const editor = useLocationEditor();
      editor.update(1, { 名称: '新京城', 连接: ['青云城'] });
      const locations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
      const qingyun = locations!.find(l => l.名称 === '青云城');
      expect(qingyun!.连接).toContain('新京城');
      expect(qingyun!.连接).not.toContain('京城');
    });

    it('rejects duplicate name (excluding self)', () => {
      const editor = useLocationEditor();
      const result = editor.update(1, { 名称: '青云城' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('LOCATION_NAME_CONFLICT');
    });

    it('rejects circular parent', () => {
      const editor = useLocationEditor();
      const result = editor.update(0, { 名称: '东荒大陆', 上级: '京城' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('LOCATION_CIRCULAR_PARENT');
    });

    it('handles bidirectional connection diff (add + remove)', () => {
      const editor = useLocationEditor();
      // 京城 originally connects to 青云城. Change to connect to 东荒大陆 instead.
      editor.update(1, { 名称: '京城', 上级: '东荒大陆', 连接: ['东荒大陆'] });
      const locations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
      // 青云城 should no longer connect to 京城
      const qingyun = locations!.find(l => l.名称 === '青云城');
      expect(qingyun!.连接).not.toContain('京城');
      // 东荒大陆 should now connect to 京城
      const donghuang = locations!.find(l => l.名称 === '东荒大陆');
      expect(donghuang!.连接).toContain('京城');
    });
  });

  describe('delete', () => {
    it('removes a location', () => {
      const editor = useLocationEditor();
      const result = editor.delete(2); // 青云城
      expect(result.ok).toBe(true);
      const locations = mockState.get<Array<{ 名称: string }>>('世界.地点信息');
      expect(locations).toHaveLength(2);
    });

    it('clears child locations parent on delete', () => {
      const editor = useLocationEditor();
      editor.delete(0); // 东荒大陆
      const locations = mockState.get<Array<{ 名称: string; 上级?: string }>>('世界.地点信息');
      const jingcheng = locations!.find(l => l.名称 === '京城');
      expect(jingcheng!.上级).toBeUndefined();
    });

    it('clears NPC location references on delete', () => {
      const editor = useLocationEditor();
      editor.delete(1); // 京城
      const npcs = mockState.get<Array<{ 名称: string; 位置: string }>>('社交.关系');
      expect(npcs![0].位置).toBe('');
    });

    it('removes connection references from other locations', () => {
      const editor = useLocationEditor();
      editor.delete(1); // 京城
      const locations = mockState.get<Array<{ 名称: string; 连接?: string[] }>>('世界.地点信息');
      const qingyun = locations!.find(l => l.名称 === '青云城');
      expect(qingyun!.连接).not.toContain('京城');
    });

    it('rejects invalid index', () => {
      const editor = useLocationEditor();
      const result = editor.delete(99);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('LOCATION_NOT_FOUND');
    });
  });

  describe('analyzeDeleteImpact', () => {
    it('correctly identifies all impacts', () => {
      const editor = useLocationEditor();
      const impact = editor.analyzeDeleteImpact(1); // 京城
      expect(impact.locationName).toBe('京城');
      expect(impact.childLocations).toEqual([]);
      expect(impact.npcRefs).toEqual(['张三']);
      expect(impact.connectionRefs).toEqual(['青云城']);
    });

    it('identifies child locations', () => {
      const editor = useLocationEditor();
      const impact = editor.analyzeDeleteImpact(0); // 东荒大陆
      expect(impact.childLocations).toContain('京城');
      expect(impact.childLocations).toContain('青云城');
    });
  });
});
