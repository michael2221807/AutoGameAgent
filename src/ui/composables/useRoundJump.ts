// App doc: docs/user-guide/pages/game-main.md §3.12 (收藏楼层 · 跨面板跳转)
import { ref } from 'vue';

/**
 * Cross-panel "jump to a round" request (收藏楼层 jump from MemoryPanel → MainGamePanel).
 *
 * The target lives in a MODULE-LEVEL ref (singleton), NOT an event, on purpose:
 * MemoryPanel and MainGamePanel are sibling routes under one `<KeepAlive>`
 * (GameView), so MainGamePanel may not be mounted when the jump is requested
 * (deep-link straight to `/game/memory`, or KeepAlive eviction on mobile). An
 * eventBus emit would be lost to nobody-listening; a shared ref persists until
 * MainGamePanel next activates and consumes it. See code review 2026-07-18 #3.
 */
const pendingJumpRound = ref<number | null>(null);

export function useRoundJump() {
  return {
    pendingJumpRound,
    /** Request MainGamePanel to pin to `round` the next time it is shown. */
    requestRoundJump(round: number): void {
      pendingJumpRound.value = round;
    },
    /** Read-and-clear the pending target (returns null when none). */
    consumeRoundJump(): number | null {
      const r = pendingJumpRound.value;
      pendingJumpRound.value = null;
      return r;
    },
  };
}
