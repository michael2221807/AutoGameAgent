<template>
  <nav v-if="isMobile" class="mobile-nav" role="navigation" aria-label="移动端导航">
    <router-link
      v-for="item in routeItems"
      :key="item.route"
      :to="item.route"
      :class="['mobile-nav__item', { 'mobile-nav__item--active': route.path === item.route }]"
      :aria-label="item.label"
    >
      <span class="mobile-nav__icon" v-html="item.icon" />
    </router-link>

    <button
      :class="['mobile-nav__item', { 'mobile-nav__item--active': rightOpen }]"
      aria-label="角色状态"
      @click="toggleRight"
    >
      <span class="mobile-nav__icon">
        <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd"/></svg>
      </span>
    </button>

    <button
      :class="['mobile-nav__item', { 'mobile-nav__item--active': leftOpen }]"
      aria-label="更多面板"
      @click="toggleLeft"
    >
      <span class="mobile-nav__icon">
        <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>
      </span>
    </button>
  </nav>
</template>

<script setup lang="ts">
// App doc: docs/user-guide/pages/game-overview.md §移动端布局
import { useRoute } from 'vue-router';
import { useSidebarDrawer } from '@/ui/composables/useSidebarDrawer';

const route = useRoute();
const { isMobile, leftOpen, rightOpen, toggleLeft, toggleRight } = useSidebarDrawer();

const routeItems = [
  {
    route: '/game',
    label: '主面板',
    icon: '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clip-rule="evenodd"/></svg>',
  },
  {
    route: '/game/character',
    label: '角色',
    icon: '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>',
  },
  {
    route: '/game/relationships',
    label: '关系',
    icon: '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>',
  },
];
</script>

<style scoped>
.mobile-nav {
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 52px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-top: 1px solid var(--color-border-subtle);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  flex-shrink: 0;
}

.mobile-nav__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-umber);
  cursor: pointer;
  text-decoration: none;
  transition: color var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}

.mobile-nav__item--active {
  color: var(--color-text);
  background: color-mix(in oklch, var(--color-sage-400) 11%, transparent);
}

.mobile-nav__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--color-sage-400) 40%, transparent);
}

@media (hover: none) and (pointer: coarse) {
  .mobile-nav__item:active {
    color: var(--color-sage-400);
    background: color-mix(in oklch, var(--color-sage-400) 6%, transparent);
  }
}

.mobile-nav__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.mobile-nav__icon svg {
  width: 20px;
  height: 20px;
}
</style>
