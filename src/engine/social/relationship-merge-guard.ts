/**
 * Relationship push merge guard — fuses duplicate NPC pushes instead of
 * appending a second entry (and instead of dropping the push).
 *
 * Wired into CommandExecutor's `pushDedupGuard` slot (composed with the
 * memory dedup guard, see main.ts). When ANY caller of the shared executor
 * (main round, field-repair, world-heartbeat, opening flows, assistant
 * PayloadApplier, card-import opening) pushes an NPC object to the
 * relationships array whose 名称 matches an existing entry:
 *
 * 1. The incoming object is FUSED into the existing entry via
 *    `mergeNpcRecords` (volatile fields take the new value, progression
 *    fields keep the accumulated value, arrays union — see npc-merge.ts).
 * 2. The merged entry is written back in place (same index — filter paths
 *    and Engram name references stay valid).
 * 3. The raw push is suppressed, and the substitute write's StateChange is
 *    returned as the verdict so CommandExecutor records it as the command's
 *    change — the round proceeds normally AND the changeLog / delta audit
 *    trail reflects the fusion (CR 2026-07-05 Important #1).
 *
 * Non-NPC pushes to the same path (malformed values, missing name) pass
 * through untouched — schema validation-repair handles those downstream.
 */
// App doc: docs/user-guide/pages/game-relationships.md §同名 NPC 自动融合
import type { PushDedupGuard, PushGuardVerdict } from '../core/command-executor';
import type { StateManager } from '../core/state-manager';
import type { EngineNpcFieldNames } from '../pipeline/types';
import { mergeNpcRecords, normalizeNpcName, type NpcRecord } from './npc-merge';

function isPlainObject(v: unknown): v is NpcRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function buildRelationshipMergeGuard(
  stateManager: StateManager,
  relationshipsPath: string,
  fields: EngineNpcFieldNames,
): PushDedupGuard {
  return (path: string, newValue: unknown, existingArray: unknown[]): PushGuardVerdict => {
    if (path.trim() !== relationshipsPath) return true;
    if (!isPlainObject(newValue)) return true;

    const name = normalizeNpcName(newValue[fields.name]);
    if (!name) return true;

    const idx = existingArray.findIndex(
      (e) => isPlainObject(e) && normalizeNpcName(e[fields.name]) === name,
    );
    if (idx === -1) return true;

    const merged = mergeNpcRecords(existingArray[idx] as NpcRecord, newValue, fields);
    const change = stateManager.set(`${relationshipsPath}[${idx}]`, merged, 'system');
    console.log(
      `[NpcMerge] Fused duplicate NPC push "${name}" into existing entry #${idx} — ` +
      'no second entry created, push treated as success',
    );
    return change;
  };
}
