/**
 * EventBus mock — tracks all emitted events for assertion.
 */
export interface EmittedEvent {
  event: string;
  payload: unknown;
}

export function createMockEventBus() {
  const emitted: EmittedEvent[] = [];
  const listeners = new Map<string, Array<(payload: unknown) => void>>();

  const eventBus = {
    emit(event: string, payload?: unknown): void {
      emitted.push({ event, payload });
      const handlers = listeners.get(event);
      if (handlers) handlers.forEach((fn) => fn(payload));
    },
    on(event: string, handler: (payload: unknown) => void): () => void {
      const arr = listeners.get(event) ?? [];
      arr.push(handler);
      listeners.set(event, arr);
      return () => {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
    off(event: string, handler: (payload: unknown) => void): void {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
  };

  return {
    eventBus,
    getEmitted: () => [...emitted],
    getEmittedByEvent: (name: string) => emitted.filter((e) => e.event === name),
    clear: () => { emitted.length = 0; listeners.clear(); },
  };
}
