import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockGameState, type MockGameState } from './mock-game-state';

let mockState: MockGameState;

const mockPlotStore = {
  updateArc: vi.fn(),
  toStateSnapshot: vi.fn(),
};

vi.mock('@/ui/composables/useGameState', () => ({
  useGameState: () => mockState,
}));
vi.mock('@/engine/plot/plot-store', () => ({
  usePlotStore: () => mockPlotStore,
}));
vi.mock('@/engine/core/event-bus', () => ({
  eventBus: { emit: vi.fn(), on: () => () => {} },
}));

const { usePlotEditor } = await import('../usePlotEditor');
const { eventBus } = await import('@/engine/core/event-bus');

describe('usePlotEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { mock } = createMockGameState({
      元数据: { 剧情导向: {} },
    });
    mockState = mock;
    mockPlotStore.updateArc.mockReturnValue(true);
    mockPlotStore.toStateSnapshot.mockReturnValue({ arcs: [], version: 1 });
  });

  describe('updateArc', () => {
    it('updates title successfully', () => {
      const editor = usePlotEditor();
      const result = editor.updateArc('arc-1', { title: '新标题' });
      expect(result.ok).toBe(true);
      expect(mockPlotStore.updateArc).toHaveBeenCalledWith('arc-1', {
        title: '新标题',
        synopsis: undefined,
      });
      expect(mockPlotStore.toStateSnapshot).toHaveBeenCalled();
    });

    it('updates synopsis successfully', () => {
      const editor = usePlotEditor();
      const result = editor.updateArc('arc-1', { synopsis: '新概要' });
      expect(result.ok).toBe(true);
      expect(mockPlotStore.updateArc).toHaveBeenCalledWith('arc-1', {
        title: undefined,
        synopsis: '新概要',
      });
    });

    it('persists to state tree and triggers save', () => {
      const editor = usePlotEditor();
      editor.updateArc('arc-1', { title: '标题' });
      expect(mockState.get('元数据.剧情导向')).toEqual({ arcs: [], version: 1 });
      expect(eventBus.emit).toHaveBeenCalledWith('engine:request-save');
    });

    it('rejects empty title', () => {
      const editor = usePlotEditor();
      const result = editor.updateArc('arc-1', { title: '   ' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_REQUIRED');
      expect(mockPlotStore.updateArc).not.toHaveBeenCalled();
    });

    it('handles arc not found', () => {
      mockPlotStore.updateArc.mockReturnValue(false);
      const editor = usePlotEditor();
      const result = editor.updateArc('bad-id', { title: 'x' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('FIELD_INVALID');
    });
  });
});
