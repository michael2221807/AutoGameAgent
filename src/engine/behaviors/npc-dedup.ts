/**
 * NPC 去重合并模块 — 兜底清理社交关系数组中的同名重复条目
 *
 * push 级的融合守卫（relationship-merge-guard.ts）拦截经 CommandExecutor 的
 * 重复 push，但仍有绕过执行器的写入路径（整数组 set：助手 replace-array /
 * set-field、GameVariablePanel 原始 JSON 编辑、导入的历史脏存档）。本模块
 * 在两个钩子做全数组扫描合并：
 *
 * - onRoundEnd：本回合任何来源产生的重复在回合收尾时融合
 * - onGameLoad：历史脏存档（重复已持久化）读档即自愈
 *
 * 合并语义与 push 守卫完全一致（mergeDuplicateNpcArray → mergeNpcRecords）：
 * 后出现的重复条目融合进首次出现的条目（首条是 `[名称=X]` 过滤路径一直命中的
 * "活"条目），只减条目、不删名称 —— Engram 实体（按名 upsert）与知识边
 * （按名引用）不受影响。
 *
 * 与 effect-lifecycle 的同名效果去重镜像（同样 onRoundEnd + onGameLoad），
 * 区别在于效果是 keep-last 丢弃，这里是无损融合。
 */
// App doc: docs/user-guide/pages/game-relationships.md §同名 NPC 自动融合
import type { BehaviorModule } from './types';
import type { StateManager } from '../core/state-manager';
import type { EngineNpcFieldNames } from '../pipeline/types';
import { mergeDuplicateNpcArray, type NpcRecord } from '../social/npc-merge';

export class NpcDedupModule implements BehaviorModule {
  readonly id = 'npc-dedup';

  constructor(
    private relationshipsPath: string,
    private fields: EngineNpcFieldNames,
  ) {}

  onRoundEnd(stateManager: StateManager): void {
    this.mergeDuplicates(stateManager);
  }

  onGameLoad(stateManager: StateManager): void {
    this.mergeDuplicates(stateManager);
  }

  private mergeDuplicates(stateManager: StateManager): void {
    const arr = stateManager.get<NpcRecord[]>(this.relationshipsPath);
    if (!Array.isArray(arr) || arr.length <= 1) return;

    const { result, mergedCount, mergedNames } = mergeDuplicateNpcArray(arr, this.fields);
    if (mergedCount === 0) return;

    stateManager.set(this.relationshipsPath, result, 'system');
    console.log(
      `[NpcDedup] Fused ${mergedCount} duplicate NPC entr(ies) by name: ${mergedNames.join('、')}`,
    );
  }
}
