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
  | 'ai:polish-chunk'
  | 'ai:response-complete'
  | 'ai:error'
  | 'pipeline:user-input'
  | 'pipeline:cancel'
  | 'ui:round-rendered'
  | 'ui:debug-prompt'
  | 'ui:debug-prompt-response'
  | 'ui:toast'
  | 'ui:modal'
  // Cloud auto-sync toggle changed anywhere (SavePanel / HomeView / auto-pause).
  // Payload: { enabled: boolean }. Lets every sync surface + CloudSyncManager keep
  // their local view of the toggle consistent without cross-component reactive wiring.
  | 'ui:cloud-autosync-changed'
  | 'worldbook:updated'
  // TTS playback state broadcast (TtsService → UI). Payload: TtsStateEvent.
  // Lets the play button, status-bar chip, and segment highlight stay in sync
  // without the UI holding a direct ref to the audio element.
  | 'tts:state'
  // TTS round-audio cache availability (TtsService → UI). Payload: TtsCacheEvent.
  // Tells the quick-switch download button whether the latest round's full
  // narration audio is cached and downloadable.
  | 'tts:cache'
  | string; // allow custom events

/** Payload for 'ui:toast' events */
export interface ToastPayload {
  type: 'info' | 'success' | 'warning' | 'error';
  message?: string;
  /** i18n key — Toast.vue will resolve via $t(). Engine code can emit this instead of a raw message. */
  i18nKey?: string;
  /** Interpolation params for the i18n key */
  i18nParams?: Record<string, unknown>;
  /** Deduplication id — toasts with the same id replace previous ones */
  id?: string;
  /** Auto-dismiss duration in ms. Defaults to 4000. Set 0 to disable auto-dismiss. */
  duration?: number;
}

/** Generic event handler — receives the payload and optionally returns a Promise */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
