import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockGameState, type MockGameState } from './mock-game-state';

let mockState: MockGameState;

vi.mock('@/ui/composables/useGameState', () => ({
  useGameState: () => mockState,
}));
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));

const { useCharacterEditor } = await import('../useCharacterEditor');

describe('useCharacterEditor', () => {
  beforeEach(() => {
    const { mock } = createMockGameState({
      角色: {
        基础信息: { 姓名: '张三', 年龄: 20, 性别: '男', 当前位置: '京城' },
        属性: { 体质: 10, 直觉: 8 },
        身份: { 天赋: [{ 名称: '天赋A', 描述: '描述A' }], 先天六维: { 体质: 5 } },
        可变属性: { 体力: { 当前: 80, 上限: 100 }, 精力: { 当前: 60, 上限: 100 }, 声望: 50 },
        身体: {
          身高: 170,
          身体部位: [
            { 部位名称: '嘴', 敏感度: 30, 开发度: 10 },
            { 部位名称: '胸部', 敏感度: 40, 开发度: 20 },
            { 部位名称: '小穴', 敏感度: 50, 开发度: 15 },
            { 部位名称: '屁穴', 敏感度: 20, 开发度: 5 },
            { 部位名称: '自定义', 敏感度: 10, 开发度: 0 },
          ],
        },
      },
      社交: { 关系: [{ 名称: '李四' }, { 名称: '王五' }] },
    });
    mockState = mock;
  });

  describe('updateField', () => {
    it('writes a simple string field', () => {
      const editor = useCharacterEditor();
      const result = editor.updateField('角色.基础信息.性别', '女');
      expect(result.ok).toBe(true);
      expect(mockState.get('角色.基础信息.性别')).toBe('女');
    });

    it('rejects empty player name', () => {
      const editor = useCharacterEditor();
      const result = editor.updateField('角色.基础信息.姓名', '  ');
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_REQUIRED');
    });

    it('rejects player name that conflicts with NPC name', () => {
      const editor = useCharacterEditor();
      const result = editor.updateField('角色.基础信息.姓名', '李四');
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NPC_NAME_CONFLICT');
    });

    it('coerces age to number and validates non-negative', () => {
      const editor = useCharacterEditor();
      const result = editor.updateField('角色.基础信息.年龄', 25);
      expect(result.ok).toBe(true);
      expect(mockState.get('角色.基础信息.年龄')).toBe(25);
    });

    it('rejects negative age', () => {
      const editor = useCharacterEditor();
      const result = editor.updateField('角色.基础信息.年龄', -5);
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_INVALID');
    });
  });

  describe('updateAttribute', () => {
    it('increments attribute by delta', () => {
      const editor = useCharacterEditor();
      editor.updateAttribute('角色.属性.体质', 1);
      expect(mockState.get('角色.属性.体质')).toBe(11);
    });

    it('clamps at max 20', () => {
      const editor = useCharacterEditor();
      editor.updateAttribute('角色.属性.体质', 15);
      expect(mockState.get('角色.属性.体质')).toBe(20);
    });

    it('clamps at min 0', () => {
      const editor = useCharacterEditor();
      editor.updateAttribute('角色.属性.体质', -20);
      expect(mockState.get('角色.属性.体质')).toBe(0);
    });
  });

  describe('updateVitals', () => {
    it('updates health, energy, and reputation', () => {
      const editor = useCharacterEditor();
      const result = editor.updateVitals({
        health: { current: 90, max: 120 },
        energy: { current: 80, max: 100 },
        reputation: 100,
      });
      expect(result.ok).toBe(true);
      expect(mockState.get<{ 当前: number; 上限: number }>('角色.可变属性.体力')).toEqual({ 当前: 90, 上限: 120 });
      expect(mockState.get('角色.可变属性.声望')).toBe(100);
    });

    it('clamps current to max', () => {
      const editor = useCharacterEditor();
      editor.updateVitals({ health: { current: 200, max: 100 } });
      const health = mockState.get<{ 当前: number; 上限: number }>('角色.可变属性.体力');
      expect(health!.当前).toBe(100);
    });

    it('clamps current to min 0', () => {
      const editor = useCharacterEditor();
      editor.updateVitals({ health: { current: -50, max: 100 } });
      const health = mockState.get<{ 当前: number; 上限: number }>('角色.可变属性.体力');
      expect(health!.当前).toBe(0);
    });

    it('rejects max < 1', () => {
      const editor = useCharacterEditor();
      const result = editor.updateVitals({ health: { current: 0, max: 0 } });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_INVALID');
    });

    it('clamps negative reputation to 0', () => {
      const editor = useCharacterEditor();
      editor.updateVitals({ reputation: -100 });
      expect(mockState.get('角色.可变属性.声望')).toBe(0);
    });
  });

  describe('talent CRUD', () => {
    it('adds a talent', () => {
      const editor = useCharacterEditor();
      const result = editor.addTalent({ 名称: '天赋B', 描述: '描述B' });
      expect(result.ok).toBe(true);
      const talents = mockState.get<Array<{ 名称: string }>>('角色.身份.天赋');
      expect(talents).toHaveLength(2);
      expect(talents![1].名称).toBe('天赋B');
    });

    it('rejects empty talent name', () => {
      const editor = useCharacterEditor();
      const result = editor.addTalent({ 名称: '', 描述: 'x' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_REQUIRED');
    });

    it('removes a talent', () => {
      const editor = useCharacterEditor();
      const result = editor.removeTalent(0);
      expect(result.ok).toBe(true);
      const talents = mockState.get<Array<{ 名称: string }>>('角色.身份.天赋');
      expect(talents).toHaveLength(0);
    });

    it('rejects out-of-bounds removal', () => {
      const editor = useCharacterEditor();
      const result = editor.removeTalent(99);
      expect(result.ok).toBe(false);
    });

    it('updates a talent', () => {
      const editor = useCharacterEditor();
      const result = editor.updateTalent(0, { 名称: '改名天赋', 描述: '新描述' });
      expect(result.ok).toBe(true);
      const talents = mockState.get<Array<{ 名称: string }>>('角色.身份.天赋');
      expect(talents![0].名称).toBe('改名天赋');
    });
  });

  describe('body editing', () => {
    it('updates body fields', () => {
      const editor = useCharacterEditor();
      const result = editor.updateBody({ 身高: 175 });
      expect(result.ok).toBe(true);
      expect(mockState.get('角色.身体.身高')).toBe(175);
    });

    // H-2: body parts / 敏感点 / 纹身 / 子宫 are now edited as a local draft in
    // CharacterDetailsPanel's body modal and committed in one updateBody() call
    // (matching the NPC editor's batch-save pattern). The previous per-index
    // addBodyPart/removeBodyPart/updateBodyPart methods were removed as unused.
  });
});
