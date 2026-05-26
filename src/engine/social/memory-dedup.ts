/**
 * NPC memory deduplication — prevents identical or near-identical entries
 * from accumulating in the `记忆` array.
 *
 * Two integration points consume this module:
 * 1. CommandExecutor push-dedup guard (main-round AI commands)
 * 2. NpcChatPipeline.appendNpcMemory (private chat memoryEntry)
 *
 * Uses Dice coefficient on character bigrams — works well for short CJK
 * text (20-80 chars) without requiring word segmentation.
 */
import type { PushDedupGuard } from '../core/command-executor';
import { parseMemoryEntry } from './npc-memory-format';
import { isNearDuplicate, DEDUP_THRESHOLD } from '../utils/text-similarity';

/**
 * Extract the text content from an NPC memory entry (string or object).
 * Delegates to `parseMemoryEntry` for back-compat with both formats.
 */
function extractMemoryText(entry: unknown): string {
  return parseMemoryEntry(entry).content.trim();
}

/**
 * Check whether a new memory entry is a near-duplicate of any existing
 * entry in the array.
 *
 * @param newEntry  The entry about to be pushed (string or {内容, 时间} object)
 * @param existing  The current memory array
 * @param threshold Dice coefficient threshold (default: 0.65)
 */
export function isDuplicateMemory(
  newEntry: unknown,
  existing: readonly unknown[],
  threshold: number = DEDUP_THRESHOLD,
): boolean {
  const newText = extractMemoryText(newEntry);
  if (!newText) return false;

  const existingTexts = existing
    .map(extractMemoryText)
    .filter((t) => t.length > 0);

  return isNearDuplicate(newText, existingTexts, threshold);
}

/**
 * Build a PushDedupGuard that only activates for paths ending with
 * the NPC memory field name (e.g. `社交.关系[名称=X].记忆`).
 *
 * Returns `true` → allow push; `false` → suppress (duplicate).
 */
export function buildMemoryPushDedupGuard(memoryFieldName: string): PushDedupGuard {
  const suffix = `.${memoryFieldName}`;
  return (path: string, newValue: unknown, existingArray: unknown[]): boolean => {
    if (!path.endsWith(suffix)) return true;
    if (isDuplicateMemory(newValue, existingArray)) {
      console.debug(
        `[MemoryDedup] Suppressed duplicate push to "${path}": ${String(newValue).slice(0, 50)}…`,
      );
      return false;
    }
    return true;
  };
}
