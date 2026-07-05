import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../core/state-manager';
import { CommandExecutor, composePushGuards } from '../core/command-executor';
import { DEFAULT_ENGINE_PATHS } from '../pipeline/types';
import { buildMemoryPushDedupGuard } from './memory-dedup';
import { buildRelationshipMergeGuard } from './relationship-merge-guard';
import type { NpcRecord } from './npc-merge';

const F = DEFAULT_ENGINE_PATHS.npcFieldNames;
const REL = DEFAULT_ENGINE_PATHS.relationships;

describe('buildRelationshipMergeGuard (end-to-end through CommandExecutor)', () => {
  let stateManager: StateManager;
  let executor: CommandExecutor;

  beforeEach(() => {
    stateManager = new StateManager();
    stateManager.set(REL, [
      {
        [F.name]: '李明阳',
        [F.affinity]: 72,
        [F.relationshipStatus]: '挚友',
        [F.location]: '青云茶馆',
        [F.isPresent]: false,
        [F.memory]: ['与玩家在茶馆相识'],
      },
      { [F.name]: '王五', [F.affinity]: 10 },
    ]);
    // Production wiring: memory guard + relationship merge guard composed
    const guard = composePushGuards(
      buildMemoryPushDedupGuard(F.memory),
      buildRelationshipMergeGuard(stateManager, REL, F),
    );
    executor = new CommandExecutor(stateManager, null, guard);
  });

  function relations(): NpcRecord[] {
    return stateManager.get<NpcRecord[]>(REL) ?? [];
  }

  it('duplicate NPC push is fused into the existing entry — no second entry, command succeeds', () => {
    const result = executor.execute({
      action: 'push',
      key: REL,
      value: {
        [F.name]: '李明阳',
        [F.affinity]: 50, // AI-reset progression value — must NOT clobber
        [F.location]: '城南集市', // volatile — must win
        [F.isPresent]: true,
        [F.bodyDescription]: '身形高挑', // missing on base — must fill
        [F.memory]: ['收到玩家赠送的桂花糕'],
      },
    });

    expect(result.success).toBe(true);
    const rel = relations();
    expect(rel).toHaveLength(2);
    const fused = rel[0];
    expect(fused[F.affinity]).toBe(72);
    expect(fused[F.relationshipStatus]).toBe('挚友');
    expect(fused[F.location]).toBe('城南集市');
    expect(fused[F.isPresent]).toBe(true);
    expect(fused[F.bodyDescription]).toBe('身形高挑');
    expect(fused[F.memory]).toEqual(['与玩家在茶馆相识', '收到玩家赠送的桂花糕']);
  });

  it('name variants (whitespace / full-width) are recognized as duplicates', () => {
    executor.execute({
      action: 'push',
      key: REL,
      value: { [F.name]: ' 李明阳　', [F.currentActivity]: '在挑选新茶' },
    });
    const rel = relations();
    expect(rel).toHaveLength(2);
    expect(rel[0][F.name]).toBe('李明阳'); // base spelling kept
    expect(rel[0][F.currentActivity]).toBe('在挑选新茶');
  });

  it('genuinely new NPC push appends normally', () => {
    const result = executor.execute({
      action: 'push',
      key: REL,
      value: { [F.name]: '赵六', [F.description]: '新登场的说书人' },
    });
    expect(result.success).toBe(true);
    expect(relations()).toHaveLength(3);
    expect(relations()[2][F.name]).toBe('赵六');
  });

  it('non-object and nameless pushes pass through untouched', () => {
    executor.execute({ action: 'push', key: REL, value: 'garbage' });
    executor.execute({ action: 'push', key: REL, value: { [F.description]: '无名对象' } });
    expect(relations()).toHaveLength(4);
  });

  it('pushes to other array paths are unaffected', () => {
    stateManager.set('社交.事件.事件记录', ['旧事件']);
    executor.execute({ action: 'push', key: '社交.事件.事件记录', value: '新事件' });
    expect(stateManager.get<string[]>('社交.事件.事件记录')).toHaveLength(2);
  });

  it('composed memory guard still suppresses near-duplicate memory pushes', () => {
    const memPath = `${REL}[名称=李明阳].${F.memory}`;
    const before = (relations()[0][F.memory] as unknown[]).length;
    const result = executor.execute({
      action: 'push',
      key: memPath,
      value: '与玩家在茶馆相识', // exact duplicate
    });
    expect(result.success).toBe(true); // suppressed as no-op success
    expect((relations()[0][F.memory] as unknown[]).length).toBe(before);
  });

  it('round is never blocked: batch with duplicate pushes reports no errors', () => {
    const batch = executor.executeBatch([
      { action: 'push', key: REL, value: { [F.name]: '李明阳', [F.age]: 25 } },
      { action: 'push', key: REL, value: { [F.name]: '王五', [F.description]: '铁匠' } },
      { action: 'set', key: `${REL}[名称=王五].${F.affinity}`, value: 15 },
    ]);
    expect(batch.hasErrors).toBe(false);
    const rel = relations();
    expect(rel).toHaveLength(2);
    expect(rel[1][F.description]).toBe('铁匠');
    expect(rel[1][F.affinity]).toBe(15);
  });

  it('fused push surfaces its substitute StateChange in the batch changeLog (audit trail)', () => {
    const batch = executor.executeBatch([
      { action: 'push', key: REL, value: { [F.name]: '李明阳', [F.currentActivity]: '在挑选新茶' } },
    ]);
    expect(batch.hasErrors).toBe(false);
    expect(batch.changeLog.changes).toHaveLength(1);
    const change = batch.changeLog.changes[0];
    expect(change.action).toBe('set');
    expect(change.path).toBe(`${REL}[0]`);
    expect((change.newValue as NpcRecord)[F.currentActivity]).toBe('在挑选新茶');
  });
});

describe('composePushGuards contract', () => {
  it('first false verdict short-circuits later guards', () => {
    const calls: string[] = [];
    const g = (id: string, verdict: boolean) => () => {
      calls.push(id);
      return verdict;
    };
    const composed = composePushGuards(g('a', true), g('b', false), g('c', true));
    expect(composed('any.path', {}, [])).toBe(false);
    expect(calls).toEqual(['a', 'b']);
  });

  it('StateChange verdict short-circuits and is passed through', () => {
    const substitute = {
      path: 'x', action: 'set' as const, oldValue: 1, newValue: 2, timestamp: 0,
    };
    const calls: string[] = [];
    const composed = composePushGuards(
      () => { calls.push('a'); return true; },
      () => { calls.push('b'); return substitute; },
      () => { calls.push('c'); return true; },
    );
    expect(composed('any.path', {}, [])).toBe(substitute);
    expect(calls).toEqual(['a', 'b']);
  });

  it('all-true composition allows the push', () => {
    const composed = composePushGuards(() => true, () => true);
    expect(composed('any.path', {}, [])).toBe(true);
  });

  it('empty composition allows the push', () => {
    expect(composePushGuards()('any.path', {}, [])).toBe(true);
  });
});
