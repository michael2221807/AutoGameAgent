/**
 * Engine event names — typed union for known events, plus open-ended custom events.
 * UI components (Toast, Modal, LoadingOverlay) listen to 'ui:*' events.
 */
export type EngineEventName =
  | 'engine:initialized'
  | 'engine:pack-loaded'
  | 'engine:round-start'
  | 'engine:round-complete'
  | 'engine:round-error'
  | 'engine:sub-pipelines-done'
  | 'engine:state-changed'
  | 'engine:save-complete'
  | 'engine:save-error'
  | 'engine:config-changed'
  | 'engram:config-changed'
  | 'ai:request-start'
  | 'ai:stream-chunk'
  | 'ai:response-complete'
  | 'ai:error'
  | 'pipeline:user-input'
  | 'pipeline:cancel'
  | 'ui:round-rendered'
  | 'ui:debug-prompt'
  | 'ui:debug-prompt-response'
  | 'ui:toast'
  | 'ui:modal'
  | string; // allow custom events

/** Payload for 'ui:toast' events */
export interface ToastPayload {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  /** Auto-dismiss duration in ms. Defaults to 4000. Set 0 to disable auto-dismiss. */
  duration?: number;
}

/** Generic event handler — receives the payload and optionally returns a Promise */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
