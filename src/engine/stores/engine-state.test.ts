import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEngineStateStore } from './engine-state';
import { StateManager } from '../core/state-manager';
import { BehaviorRunner } from '../behaviors/behavior-runner';
import { NpcDedupModule } from '../behaviors/npc-dedup';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';
import type { NpcRecord } from '../social/npc-merge';

const F = DEFAULT_ENGINE_PATHS.npcFieldNames;
const REL = DEFAULT_ENGINE_PATHS.relationships;

describe('engine-state store — onGameLoad dispatch on real save load', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // loadGame 内部会同步 localStorage 设置 — jsdom 环境下保持默认即可
  });

  it('loadGame dispatches runOnGameLoad to the linked BehaviorRunner', () => {
    const store = useEngineStateStore();
    const stateManager = new StateManager();
    const runner = { runOnGameLoad: vi.fn() };

    store.linkStateManager(stateManager);
    store.linkBehaviorRunner(runner);
    store.loadGame({ 元数据: { 回合序号: 3 } }, 'tianming', 'p1', 's1');

    expect(runner.runOnGameLoad).toHaveBeenCalledTimes(1);
    expect(runner.runOnGameLoad).toHaveBeenCalledWith(stateManager);
  });

  it('loading a dirty save with duplicate NPCs heals it (real NpcDedupModule)', () => {
    const store = useEngineStateStore();
    const stateManager = new StateManager();
    const runner = new BehaviorRunner();
    runner.register(new NpcDedupModule(REL, F));

    store.linkStateManager(stateManager);
    store.linkBehaviorRunner(runner);

    // 模拟历史脏存档：同一角色两条，第一条带累积状态，第二条是字段更全的重复
    store.loadGame(
      {
        社交: {
          关系: [
            { [F.name]: '李明阳', [F.affinity]: 72, [F.memory]: ['旧记忆'] },
            { [F.name]: '李明阳', [F.affinity]: 50, [F.bodyDescription]: '身形高挑' },
            { [F.name]: '王五' },
          ],
        },
      },
      'tianming', 'p1', 's1',
    );

    const rel = stateManager.get<NpcRecord[]>(REL) ?? [];
    expect(rel).toHaveLength(2);
    expect(rel[0][F.name]).toBe('李明阳');
    expect(rel[0][F.affinity]).toBe(72); // 累积好感度保留
    expect(rel[0][F.bodyDescription]).toBe('身形高挑'); // 重复条目的增量字段融合进来
    expect(rel[1][F.name]).toBe('王五');
  });

  it('loadGame without a linked runner still works (no throw)', () => {
    const store = useEngineStateStore();
    const stateManager = new StateManager();
    store.linkStateManager(stateManager);
    expect(() => store.loadGame({}, 'tianming', 'p1', 's1')).not.toThrow();
  });
});
