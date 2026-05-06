// App doc: docs/user-guide/pages/game-overview.md §移动端布局
import { ref, type Ref } from 'vue';

const mql = typeof window !== 'undefined'
  ? window.matchMedia('(max-width: 767px)')
  : null;

// Module-level singleton — one ref, one listener, shared by all consumers.
// SSR-safe: defaults to false when window is unavailable.
const isMobile = ref(mql?.matches ?? false);

if (mql) {
  mql.addEventListener('change', (e: MediaQueryListEvent) => {
    isMobile.value = e.matches;
  });
}

export function useMobile(): { isMobile: Ref<boolean> } {
  return { isMobile };
}
