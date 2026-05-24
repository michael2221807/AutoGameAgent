/**
 * Mock game state utility for editor composable tests.
 *
 * Creates a controllable in-memory state tree with get/setValue/useValue
 * that mirrors the real useGameState API, plus tracking of all setValue calls.
 */
import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';

function lodashGet(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function lodashSet(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (
      current[seg] == null ||
      typeof current[seg] !== 'object' ||
      Array.isArray(current[seg])
    ) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = JSON.parse(JSON.stringify(value));
}

export interface SetValueCall {
  path: string;
  value: unknown;
}

export interface MockGameState {
  get: <T = unknown>(path: string) => T | undefined;
  setValue: (path: string, value: unknown) => void;
  useValue: <T = unknown>(path: string) => ComputedRef<T | undefined>;
  tree: ComputedRef<Record<string, unknown>>;
  isLoaded: ComputedRef<boolean>;
  store: Record<string, unknown>;
  activePackId: ComputedRef<string | null>;
  activeProfileId: ComputedRef<string | null>;
  activeSlotId: ComputedRef<string | null>;
}

export function createMockGameState(
  initialTree: Record<string, unknown> = {},
): { mock: MockGameState; setValueCalls: SetValueCall[] } {
  const tree = reactive<Record<string, unknown>>(
    JSON.parse(JSON.stringify(initialTree)),
  );
  const setValueCalls: SetValueCall[] = [];

  const mock: MockGameState = {
    get: <T = unknown>(path: string): T | undefined =>
      lodashGet(tree, path) as T | undefined,
    setValue: (path: string, value: unknown): void => {
      setValueCalls.push({ path, value: JSON.parse(JSON.stringify(value)) });
      lodashSet(tree, path, value);
    },
    useValue: <T = unknown>(path: string): ComputedRef<T | undefined> =>
      computed(() => lodashGet(tree, path) as T | undefined),
    tree: computed(() => tree),
    isLoaded: computed(() => true),
    store: {},
    activePackId: computed(() => 'test-pack'),
    activeProfileId: computed(() => 'test-profile'),
    activeSlotId: computed(() => 'test-slot'),
  };

  return { mock, setValueCalls };
}
