// App doc: docs/user-guide/pages/game-overview.md §移动端布局
import { ref, watch, readonly } from 'vue';
import { useRouter } from 'vue-router';
import { useMobile } from './useMobile';

const leftOpen = ref(false);
const rightOpen = ref(false);

const { isMobile } = useMobile();

// Module-level watcher — one instance, not per call site.
watch(isMobile, (mobile) => {
  if (!mobile) {
    leftOpen.value = false;
    rightOpen.value = false;
  }
});

let routerUnhook: (() => void) | null = null;

function toggleLeft() {
  leftOpen.value = !leftOpen.value;
  rightOpen.value = false;
}

function toggleRight() {
  rightOpen.value = !rightOpen.value;
  leftOpen.value = false;
}

function closeAll() {
  leftOpen.value = false;
  rightOpen.value = false;
}

export function useSidebarDrawer() {
  const router = useRouter();

  if (!routerUnhook) {
    routerUnhook = router.afterEach(() => {
      leftOpen.value = false;
      rightOpen.value = false;
    });
  }

  return {
    isMobile,
    leftOpen: readonly(leftOpen),
    rightOpen: readonly(rightOpen),
    toggleLeft,
    toggleRight,
    closeAll,
  };
}
