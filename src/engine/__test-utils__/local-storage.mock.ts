/**
 * In-memory localStorage mock for Node test environment.
 */
export function createMockLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  let originalStorage: Storage | undefined;

  const storage: Storage = {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key: string) { return data.get(key) ?? null; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    removeItem(key: string) { data.delete(key); },
    setItem(key: string, value: string) { data.set(key, value); },
  };

  return {
    storage,
    install() {
      originalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: storage,
        writable: true,
        configurable: true,
      });
    },
    restore() {
      if (originalStorage !== undefined) {
        Object.defineProperty(globalThis, 'localStorage', {
          value: originalStorage,
          writable: true,
          configurable: true,
        });
      }
    },
  };
}
