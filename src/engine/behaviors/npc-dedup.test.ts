import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../core/state-manager';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';
import { NpcDedupModule } from './npc-dedup';
import type { NpcRecord } from '../social/npc-merge';

const F = DEFAULT_ENGINE_PATHS.npcFieldNames;
const REL = DEFAULT_ENGINE_PATHS.relationships;

describe('NpcDedupModule', () => {
  let stateManager: StateManager;
  let module: NpcDedupModule;

  beforeEach(() => {
    stateManager = new StateManager();
    module = new NpcDedupModule(REL, F);
  });

  function relations(): NpcRecord[] {
    return stateManager.get<NpcRecord[]>(REL) ?? [];
  }

  it('onGameLoad heals a dirty save with duplicated NPCs', () => {
    stateManager.set(REL, [
      { [F.name]: '李明阳', [F.affinity]: 72, [F.memory]: ['旧记忆'] },
      { [F.name]: '王五' },
      { [F.name]: '李明阳', [F.affinity]: 50, [F.bodyDescription]: '身形高挑', [F.memory]: ['新记忆'] },
    ]);

    module.onGameLoad(stateManager);

    const rel = relations();
    expect(rel).toHaveLength(2);
    expect(rel.map((n) => n[F.name])).toEqual(['李明阳', '王五']);
    expect(rel[0][F.affinity]).toBe(72); // progression: live entry wins
    expect(rel[0][F.bodyDescription]).toBe('身形高挑'); // gap filled from duplicate
    expect(rel[0][F.memory]).toEqual(['旧记忆', '新记忆']); // memories unioned
  });

  it('onRoundEnd fuses duplicates introduced during the round', () => {
    stateManager.set(REL, [
      { [F.name]: '苏若雪', [F.relationshipStatus]: '恋人' },
      { [F.name]: ' 苏若雪', [F.relationshipStatus]: '陌生人', [F.location]: '藏书阁' },
    ]);

    module.onRoundEnd(stateManager);

    const rel = relations();
    expect(rel).toHaveLength(1);
    expect(rel[0][F.relationshipStatus]).toBe('恋人');
    expect(rel[0][F.location]).toBe('藏书阁');
  });

  it('does not write back when there is nothing to merge', () => {
    const arr = [{ [F.name]: '李明阳' }, { [F.name]: '王五' }];
    stateManager.set(REL, arr);
    const historyBefore = stateManager.getChangeHistory().length;

    module.onRoundEnd(stateManager);

    expect(stateManager.getChangeHistory().length).toBe(historyBefore);
    expect(relations()).toHaveLength(2);
  });

  it('tolerates missing or non-array relationships path', () => {
    expect(() => module.onGameLoad(stateManager)).not.toThrow();
    stateManager.set(REL, 'corrupted' as unknown as NpcRecord[]);
    expect(() => module.onRoundEnd(stateManager)).not.toThrow();
  });
});
