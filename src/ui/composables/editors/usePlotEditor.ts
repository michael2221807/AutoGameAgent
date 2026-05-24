/**
 * usePlotEditor — CRUD composable for plot direction arc editing.
 *
 * Wraps: usePlotStore().updateArc() + useGameState().setValue()
 * Why: PlotPanel manages arcs through usePlotStore (in-memory) with manual
 *      persist() to state tree. This composable adds validation + toast
 *      and encapsulates the persist pattern.
 *
 * Story 2 — Phase 1 foundation.
 */
import { useGameState } from '@/ui/composables/useGameState';
import { usePlotStore } from '@/engine/plot/plot-store';
import { DEFAULT_ENGINE_PATHS } from '@/engine/pipeline/types';
import { eventBus } from '@/engine/core/event-bus';
import type { EditorResult } from './types';
import { emitEditorToast } from './types';

export interface UsePlotEditorReturn {
  updateArc(
    arcId: string,
    data: { title?: string; synopsis?: string },
  ): EditorResult;
}

export function usePlotEditor(): UsePlotEditorReturn {
  const plotStore = usePlotStore();
  const { setValue } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;

  function updateArc(
    arcId: string,
    data: { title?: string; synopsis?: string },
  ): EditorResult {
    if (data.title !== undefined && !data.title.trim()) {
      return {
        ok: false,
        error: {
          code: 'FIELD_REQUIRED',
          i18nKey: 'plot.validate.titleRequired',
          message: 'Title required',
        },
      };
    }

    const ok = plotStore.updateArc(arcId, {
      title: data.title?.trim(),
      synopsis: data.synopsis,
    });
    if (!ok) {
      return {
        ok: false,
        error: {
          code: 'FIELD_INVALID',
          i18nKey: 'plot.validate.arcNotFound',
          message: 'Arc not found',
        },
      };
    }

    setValue(P.plotDirection, plotStore.toStateSnapshot());
    eventBus.emit('engine:request-save');
    emitEditorToast('success', 'plot.toast.arcUpdated');
    return { ok: true };
  }

  return { updateArc };
}
