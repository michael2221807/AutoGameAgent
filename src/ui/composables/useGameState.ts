/**
 * useGameState — Convenience composable wrapping useEngineStateStore
 *
 * Why this exists:
 * Components rarely need the full Pinia store API. This composable
 * cherry-picks the most common access patterns (read tree, get by path,
 * reactive computed getters) and re-exports them as a slim, typed API.
 *
 * The key addition over raw store access is `useValue<T>(path)`, which
 * returns a `ComputedRef<T | undefined>` that automatically re-evaluates
 * whenever the underlying reactive state tree changes — enabling
 * fine-grained reactivity in templates without manual watchers.
 *
 * Phase M4 — UI Composable Layer.
 */
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useEngineStateStore } from '@/engine/stores/engine-state';
import type { GameStateTree, StatePath } from '@/engine/types';

/**
 * Public return type for documentation and testing convenience.
 * Avoids leaking the full Pinia store type into consumer components.
 */
export interface UseGameStateReturn {
  /** Whether a game session has been loaded (post-creation or post-load) */
  isLoaded: ComputedRef<boolean>;
  /** The full reactive state tree — bind directly in templates for broad reactivity */
  tree: ComputedRef<GameStateTree>;
  /** Active game pack ID, null when no game is loaded */
  activePackId: ComputedRef<string | null>;
  /** Active profile ID, null when no game is loaded */
  activeProfileId: ComputedRef<string | null>;
  /** Active save slot ID, null when no game is loaded */
  activeSlotId: ComputedRef<string | null>;
  /** Imperative getter — retrieve a value by dot-path at call time */
  get: <T = unknown>(path: StatePath) => T | undefined;
  /**
   * Reactive getter — returns a ComputedRef that re-evaluates when the
   * state tree changes. Prefer this over `get()` inside templates or
   * watchers where automatic updates are desired.
   */
  useValue: <T = unknown>(path: StatePath) => ComputedRef<T | undefined>;
  /** Set a value at a dot-path from the UI (source = 'user') */
  setValue: (path: StatePath, value: unknown) => void;
  /** Escape hatch to the underlying Pinia store for advanced usage */
  store: ReturnType<typeof useEngineStateStore>;
}

export function useGameState(): UseGameStateReturn {
  const store = useEngineStateStore();

  // ─── Derived reactive properties ─────────────────────────────
  // These are computed refs so template bindings stay in sync with
  // the Pinia store's state without requiring explicit watchers.

  const isLoaded = computed(() => store.isGameLoaded);
  const tree = computed(() => store.tree);
  const activePackId = computed(() => store.activePackId);
  const activeProfileId = computed(() => store.activeProfileId);
  const activeSlotId = computed(() => store.activeSlotId);

  // ─── Path-based accessors ────────────────────────────────────

  /**
   * Imperative one-shot getter for use in event handlers, lifecycle
   * hooks, or any non-reactive context. Does NOT trigger Vue reactivity.
   */
  function get<T = unknown>(path: StatePath): T | undefined {
    return store.get<T>(path);
  }

  /**
   * Returns a ComputedRef that re-evaluates whenever `store.tree` changes.
   *
   * Implementation note: we access `store.tree` inside the computed callback
   * to establish a reactive dependency on the entire tree. The StateManager
   * uses Vue's `reactive()` internally, so deep property changes propagate.
   * This is intentionally coarse-grained; if granular reactivity becomes
   * a bottleneck, we can introduce per-path watchers with debouncing.
   */
  function useValue<T = unknown>(path: StatePath): ComputedRef<T | undefined> {
    return computed(() => {
      // Touch the tree ref to establish dependency tracking.
      // Without this, Vue cannot know when to re-evaluate.
      void store.tree;
      return store.get<T>(path);
    });
  }

  /**
   * Write a value from the UI layer. Delegates to the store's `setValue`
   * which records the change with source='user' for audit trail clarity.
   */
  function setValue(path: StatePath, value: unknown): void {
    store.setValue(path, value);
  }

  return {
    isLoaded,
    tree,
    activePackId,
    activeProfileId,
    activeSlotId,
    get,
    useValue,
    setValue,
    store,
  };
}
