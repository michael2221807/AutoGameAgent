/**
 * useLocationEditor — CRUD composable for world locations.
 *
 * Wraps: useGameState().setValue() on 世界.地点信息 array
 * Why: Centralizes location create/update/delete with cascade (child parent,
 *      bidirectional connections, NPC location references).
 *
 * Story 2 — Phase 1 foundation.
 */
import { useGameState } from '@/ui/composables/useGameState';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import type {
  EditorResult,
  LocationEntry,
  LocationFormData,
  LocationDeleteImpact,
} from './types';
import { emitEditorToast } from './types';

interface NpcRelation extends Record<string, unknown> {
  名称: string;
}

export interface UseLocationEditorReturn {
  create(formData: LocationFormData): EditorResult;
  update(index: number, formData: LocationFormData): EditorResult;
  delete(index: number): EditorResult;
  analyzeDeleteImpact(index: number): LocationDeleteImpact;
}

export function useLocationEditor(): UseLocationEditorReturn {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;
  const F = P.npcFieldNames;

  function wouldCreateCycle(
    name: string,
    parent: string,
    locations: LocationEntry[],
    selfIndex?: number,
  ): boolean {
    let current = parent;
    const visited = new Set<string>([name]);
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      const parentLoc = locations.find(
        (l, i) => l.名称 === current && i !== selfIndex,
      );
      current = parentLoc?.上级 ?? '';
    }
    return false;
  }

  function create(formData: LocationFormData): EditorResult {
    const locations = [...(get<LocationEntry[]>(P.locations) ?? [])];
    const name = formData.名称?.trim();

    if (!name) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'map.validate.nameRequired',
          message: 'Location name is required',
        },
      };
    }
    if (locations.some(l => l.名称 === name)) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_NAME_CONFLICT',
          i18nKey: 'map.validate.nameDuplicate',
          message: 'Location name already exists',
        },
      };
    }
    if (formData.上级 && wouldCreateCycle(name, formData.上级, locations)) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_CIRCULAR_PARENT',
          i18nKey: 'map.validate.circularParent',
          message: 'Circular parent reference',
        },
      };
    }

    const newLoc: LocationEntry = { ...formData, 名称: name };
    const updatedList = [...locations, newLoc];

    if (formData.连接?.length) {
      for (const target of formData.连接) {
        const targetLoc = updatedList.find(l => l.名称 === target);
        if (targetLoc && !(targetLoc.连接 ?? []).includes(name)) {
          targetLoc.连接 = [...(targetLoc.连接 ?? []), name];
        }
      }
    }

    setValue(P.locations, updatedList);
    emitEditorToast('success', 'map.toast.created');
    return { ok: true };
  }

  function update(index: number, formData: LocationFormData): EditorResult {
    const original = get<LocationEntry[]>(P.locations) ?? [];
    if (index < 0 || index >= original.length) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_NOT_FOUND',
          i18nKey: 'map.validate.notFound',
          message: 'Location not found',
        },
      };
    }

    const oldName = original[index].名称;
    const newName = formData.名称?.trim();
    if (!newName) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'map.validate.nameRequired',
          message: 'Name required',
        },
      };
    }

    if (
      newName !== oldName &&
      original.some((l, i) => i !== index && l.名称 === newName)
    ) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_NAME_CONFLICT',
          i18nKey: 'map.validate.nameDuplicate',
          message: 'Duplicate name',
        },
      };
    }

    if (
      formData.上级 &&
      wouldCreateCycle(newName, formData.上级, original, index)
    ) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_CIRCULAR_PARENT',
          i18nKey: 'map.validate.circularParent',
          message: 'Circular parent',
        },
      };
    }

    // Build new immutable locations array
    let locations = original.map((loc, i) => {
      if (i === index) {
        return { ...loc, ...formData, 名称: newName };
      }
      let updated = loc;
      // Cascade rename: child parent + connection refs
      if (oldName !== newName) {
        if (loc.上级 === oldName) {
          updated = { ...updated, 上级: newName };
        }
        if (loc.连接?.includes(oldName)) {
          updated = {
            ...updated,
            连接: loc.连接.map(c => (c === oldName ? newName : c)),
          };
        }
      }
      return updated;
    });

    // Bidirectional connection diff
    const oldConnections = new Set(original[index].连接 ?? []);
    const newConnections = new Set(formData.连接 ?? []);

    locations = locations.map(loc => {
      const locName = loc.名称;
      if (locName === newName) return loc;
      // Removed connection: strip oldName/newName from target
      if (oldConnections.has(locName) && !newConnections.has(locName)) {
        return {
          ...loc,
          连接: (loc.连接 ?? []).filter(c => c !== oldName && c !== newName),
        };
      }
      // Added connection: add newName to target
      if (!oldConnections.has(locName) && newConnections.has(locName)) {
        if (!(loc.连接 ?? []).includes(newName)) {
          return { ...loc, 连接: [...(loc.连接 ?? []), newName] };
        }
      }
      return loc;
    });

    setValue(P.locations, locations);

    // Cascade rename NPC location refs
    if (oldName !== newName) {
      const updatedNpcs = (get<NpcRelation[]>(P.relationships) ?? []).map(
        npc => {
          if (npc[F.location] === oldName) {
            return { ...npc, [F.location]: newName };
          }
          return npc;
        },
      );
      if (updatedNpcs.some((n, i) => n !== (get<NpcRelation[]>(P.relationships) ?? [])[i])) {
        setValue(P.relationships, updatedNpcs);
      }
    }

    emitEditorToast('success', 'map.toast.updated');
    return { ok: true };
  }

  function delete_(index: number): EditorResult {
    const original = get<LocationEntry[]>(P.locations) ?? [];
    if (index < 0 || index >= original.length) {
      return {
        ok: false,
        error: {
          code: 'LOCATION_NOT_FOUND',
          i18nKey: 'map.validate.notFound',
          message: 'Not found',
        },
      };
    }
    const name = original[index].名称;

    // Immutably cascade: clear child parent, remove connection refs, then remove self
    const locations = original
      .filter((_, i) => i !== index)
      .map(loc => {
        let updated = loc;
        if (loc.上级 === name) {
          updated = { ...updated, 上级: undefined };
        }
        if (loc.连接?.includes(name)) {
          updated = { ...updated, 连接: loc.连接.filter(c => c !== name) };
        }
        return updated;
      });
    setValue(P.locations, locations);

    // Cascade: clear NPC location refs
    const updatedNpcs = (get<NpcRelation[]>(P.relationships) ?? []).map(npc => {
      if (npc[F.location] === name) {
        return { ...npc, [F.location]: '' };
      }
      return npc;
    });
    if (updatedNpcs.some((n, i) => n !== (get<NpcRelation[]>(P.relationships) ?? [])[i])) {
      setValue(P.relationships, updatedNpcs);
    }

    emitEditorToast('success', 'map.toast.deleted');
    return { ok: true };
  }

  function analyzeDeleteImpact(index: number): LocationDeleteImpact {
    const locations = get<LocationEntry[]>(P.locations) ?? [];
    const loc = locations[index];
    const name = loc?.名称 ?? '';
    const childLocations = locations
      .filter(l => l.上级 === name)
      .map(l => l.名称);
    const connectionRefs = locations
      .filter(l => l.连接?.includes(name))
      .map(l => l.名称);
    const npcs = get<NpcRelation[]>(P.relationships) ?? [];
    const npcRefs = npcs
      .filter(n => n[F.location] === name)
      .map(n => n[F.name] as string);
    return { locationName: name, childLocations, npcRefs, connectionRefs };
  }

  return {
    create,
    update,
    delete: delete_,
    analyzeDeleteImpact,
  };
}
