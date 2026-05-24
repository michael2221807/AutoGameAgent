/**
 * useCharacterEditor — CRUD composable for character fields in CharacterDetailsPanel.
 *
 * Wraps: useGameState().setValue()
 * Why: Centralizes validation, type coercion, and toast feedback for character
 *      editing. UI components call these methods instead of setValue directly.
 *
 * Story 2 — Phase 1 foundation.
 */
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import type { EditorResult, BodyPartEntry } from './types';
import { emitEditorToast } from './types';

interface NpcRelation {
  [key: string]: unknown;
}

export interface UseCharacterEditorReturn {
  updateField(path: string, value: unknown): EditorResult;
  updateAttribute(attrPath: string, delta: number): EditorResult;
  updateVitals(vitalsData: {
    health?: { current: number; max: number };
    energy?: { current: number; max: number };
    reputation?: number;
  }): EditorResult;
  addTalent(talent: { 名称: string; 描述: string }): EditorResult;
  removeTalent(index: number): EditorResult;
  updateTalent(index: number, talent: { 名称: string; 描述: string }): EditorResult;
  updateBody(bodyData: Record<string, unknown>): EditorResult;
  addBodyPart(part: BodyPartEntry): EditorResult;
  removeBodyPart(index: number): EditorResult;
  updateBodyPart(index: number, part: BodyPartEntry): EditorResult;
}

const REQUIRED_BODY_PART_COUNT = 4;
const BODY_PATH = '角色.身体';
const BODY_PARTS_PATH = '角色.身体.身体部位';

export function useCharacterEditor(): UseCharacterEditorReturn {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;
  const F = P.npcFieldNames;

  function updateField(path: string, value: unknown): EditorResult {
    if (path === P.playerName && (!value || String(value).trim() === '')) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'character.edit.nameRequired',
          message: 'Name is required',
        },
      };
    }

    if (path === P.playerName) {
      const npcs = get<NpcRelation[]>(P.relationships) ?? [];
      if (npcs.some(npc => npc[F.name] === String(value).trim())) {
        return {
          ok: false,
          error: {
            code: 'NPC_NAME_CONFLICT',
            i18nKey: 'character.edit.nameConflictNpc',
            message: 'Player name conflicts with NPC name',
          },
        };
      }
    }

    if (path === P.characterAge) {
      const numVal = typeof value === 'number' ? value : Number(value);
      if (isNaN(numVal) || numVal < 0) {
        return {
          ok: false,
          error: {
            code: 'FIELD_INVALID',
            i18nKey: 'character.edit.invalidAge',
            message: 'Invalid age',
          },
        };
      }
      setValue(path, numVal);
      emitEditorToast('success', 'character.toast.fieldUpdated');
      return { ok: true };
    }

    setValue(path, value);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function updateAttribute(attrPath: string, delta: number): EditorResult {
    const current = get<number>(attrPath) ?? 0;
    const max = 20;
    const min = 0;
    const newVal = Math.max(min, Math.min(max, current + delta));
    setValue(attrPath, newVal);
    return { ok: true };
  }

  function updateVitals(vitalsData: {
    health?: { current: number; max: number };
    energy?: { current: number; max: number };
    reputation?: number;
  }): EditorResult {
    if (vitalsData.health) {
      if (vitalsData.health.max < 1) {
        return { ok: false, error: { code: 'FIELD_INVALID', i18nKey: 'character.edit.invalidVitalMax', message: 'Max must be >= 1' } };
      }
      const clampedCurrent = Math.max(0, Math.min(vitalsData.health.current, vitalsData.health.max));
      setValue(P.vitalHealth, { 当前: clampedCurrent, 上限: vitalsData.health.max });
    }
    if (vitalsData.energy) {
      if (vitalsData.energy.max < 1) {
        return { ok: false, error: { code: 'FIELD_INVALID', i18nKey: 'character.edit.invalidVitalMax', message: 'Max must be >= 1' } };
      }
      const clampedCurrent = Math.max(0, Math.min(vitalsData.energy.current, vitalsData.energy.max));
      setValue(P.vitalEnergy, { 当前: clampedCurrent, 上限: vitalsData.energy.max });
    }
    if (vitalsData.reputation !== undefined) {
      setValue(P.reputation, Math.max(0, vitalsData.reputation));
    }
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function addTalent(talent: { 名称: string; 描述: string }): EditorResult {
    if (!talent.名称?.trim()) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'character.edit.nameRequired',
          message: 'Talent name is required',
        },
      };
    }
    const talents = get<Array<{ 名称: string; 描述: string }>>(P.talents) ?? [];
    const updated = [...talents, { 名称: talent.名称.trim(), 描述: talent.描述 }];
    setValue(P.talents, updated);
    emitEditorToast('success', 'character.toast.talentAdded');
    return { ok: true };
  }

  function removeTalent(index: number): EditorResult {
    const talents = get<Array<{ 名称: string; 描述: string }>>(P.talents) ?? [];
    if (index < 0 || index >= talents.length) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'character.edit.invalidIndex',
          message: 'Invalid talent index',
        },
      };
    }
    const updated = [...talents];
    updated.splice(index, 1);
    setValue(P.talents, updated);
    emitEditorToast('success', 'character.toast.talentRemoved');
    return { ok: true };
  }

  function updateTalent(index: number, talent: { 名称: string; 描述: string }): EditorResult {
    if (!talent.名称?.trim()) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'character.edit.nameRequired',
          message: 'Talent name is required',
        },
      };
    }
    const talents = get<Array<{ 名称: string; 描述: string }>>(P.talents) ?? [];
    if (index < 0 || index >= talents.length) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'character.edit.invalidIndex',
          message: 'Invalid talent index',
        },
      };
    }
    const updated = [...talents];
    updated[index] = { 名称: talent.名称.trim(), 描述: talent.描述 };
    setValue(P.talents, updated);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function updateBody(bodyData: Record<string, unknown>): EditorResult {
    const currentBody = get<Record<string, unknown>>(BODY_PATH) ?? {};
    const merged = { ...currentBody, ...bodyData };
    setValue(BODY_PATH, merged);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function addBodyPart(part: BodyPartEntry): EditorResult {
    if (!part.部位名称?.trim()) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'character.body.edit.partNameRequired',
          message: 'Body part name is required',
        },
      };
    }
    const body = get<Record<string, unknown>>(BODY_PATH) ?? {};
    const parts = (body['身体部位'] as BodyPartEntry[] | undefined) ?? [];
    const updated = [...parts, { ...part, 部位名称: part.部位名称.trim() }];
    setValue(BODY_PARTS_PATH, updated);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function removeBodyPart(index: number): EditorResult {
    const body = get<Record<string, unknown>>(BODY_PATH) ?? {};
    const parts = (body['身体部位'] as BodyPartEntry[] | undefined) ?? [];
    if (index < 0 || index >= parts.length) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'character.body.edit.invalidIndex',
          message: 'Invalid body part index',
        },
      };
    }
    if (index < REQUIRED_BODY_PART_COUNT) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'character.body.edit.cannotRemoveRequired',
          message: 'Cannot remove required body part',
        },
      };
    }
    const updated = [...parts];
    updated.splice(index, 1);
    setValue(BODY_PARTS_PATH, updated);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function updateBodyPart(index: number, part: BodyPartEntry): EditorResult {
    const body = get<Record<string, unknown>>(BODY_PATH) ?? {};
    const parts = (body['身体部位'] as BodyPartEntry[] | undefined) ?? [];
    if (index < 0 || index >= parts.length) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'character.body.edit.invalidIndex',
          message: 'Invalid body part index',
        },
      };
    }
    const updated = [...parts];
    updated[index] = { ...updated[index], ...part };
    setValue(BODY_PARTS_PATH, updated);
    emitEditorToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  return {
    updateField,
    updateAttribute,
    updateVitals,
    addTalent,
    removeTalent,
    updateTalent,
    updateBody,
    addBodyPart,
    removeBodyPart,
    updateBodyPart,
  };
}
