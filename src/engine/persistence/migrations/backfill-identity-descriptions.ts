/**
 * Migration 0 → 0.5.0: Convert flat identity fields to nested {名称, 描述} objects.
 *
 * Handles THREE possible input states per field:
 * 1. string "将门遗孤" → {名称: "将门遗孤", 描述: lookup}     (never migrated)
 * 2. {} or {名称: ""}  → {名称: "", 描述: ""}                  (corrupted by old ValidationRepair)
 * 3. {名称: "X", 描述: "Y"} → keep as-is                      (already migrated)
 */
import { get as _get, set as _set } from 'lodash-es';
import type { Migration } from '../migration-registry';

interface PresetEntry {
  name: string;
  description?: string;
}

function isValidObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasName(v: Record<string, unknown>): boolean {
  return typeof v['名称'] === 'string' && v['名称'] !== '';
}

export function createBackfillIdentityDescriptionsMigration(
  origins: PresetEntry[],
  traits: PresetEntry[],
  talents: PresetEntry[],
): Migration {
  const originMap = new Map(origins.map((p) => [p.name, p.description ?? '']));
  const traitMap = new Map(traits.map((p) => [p.name, p.description ?? '']));
  const talentMap = new Map(talents.map((p) => [p.name, p.description ?? '']));

  function convertSingle(raw: unknown, lookup: Map<string, string>): { '名称': string; '描述': string } {
    if (typeof raw === 'string' && raw) {
      return { '名称': raw, '描述': lookup.get(raw) ?? '' };
    }
    if (isValidObj(raw) && hasName(raw)) {
      return raw as { '名称': string; '描述': string };
    }
    return { '名称': '', '描述': '' };
  }

  return {
    fromVersion: '0',
    toVersion: '0.5.0',
    description: '将出身/特质/天赋从扁平字符串转为 {名称, 描述} 嵌套对象',
    migrate: (data) => {
      const state = structuredClone(data);

      // ── 出身 ──
      _set(state, '角色.身份.出身', convertSingle(_get(state, '角色.身份.出身'), originMap));
      const identityObj = _get(state, '角色.身份') as Record<string, unknown> | undefined;
      if (identityObj && '出身描述' in identityObj) delete identityObj['出身描述'];

      // ── 特质 ──
      _set(state, '角色.基础信息.特质', convertSingle(_get(state, '角色.基础信息.特质'), traitMap));
      const baseInfoObj = _get(state, '角色.基础信息') as Record<string, unknown> | undefined;
      if (baseInfoObj && '特质描述' in baseInfoObj) delete baseInfoObj['特质描述'];

      // ── 天赋 ──
      const talentsRaw = _get(state, '角色.身份.天赋');
      if (Array.isArray(talentsRaw)) {
        _set(state, '角色.身份.天赋', talentsRaw.map((item) => {
          if (typeof item === 'string') {
            return { '名称': item, '描述': talentMap.get(item) ?? '' };
          }
          if (isValidObj(item)) {
            // Already an object (current {名称,描述} shape, possibly empty-named). Keep named ones
            // as-is; normalize the fields otherwise. NEVER String(item) → that corrupts an
            // empty-named talent to '[object Object]' (the import's '0' stamp re-runs this migration).
            if (hasName(item)) return item;
            const o = item as Record<string, unknown>;
            return {
              '名称': typeof o['名称'] === 'string' ? o['名称'] : '',
              '描述': typeof o['描述'] === 'string' ? o['描述'] : '',
            };
          }
          return { '名称': String(item ?? ''), '描述': '' }; // non-object, non-string scalar fallback
        }));
      }
      if (identityObj && '天赋描述' in identityObj) delete identityObj['天赋描述'];

      console.log('[Migration 0→0.5.0] identity fields converted to nested objects');
      return state;
    },
  };
}
