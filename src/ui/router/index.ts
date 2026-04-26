import { createRouter, createWebHistory } from 'vue-router';
import { getBootstrapGamePack } from '@/engine/bootstrap-pack';

/**
 * Application router — mirrors the route structure from the M0 spec.
 * Panel components under /game/* are lazy-loaded to reduce initial bundle size.
 */
const routes = [
  { path: '/', name: 'Home', component: () => import('../views/HomeView.vue') },
  { path: '/creation', name: 'Creation', component: () => import('../views/CreationView.vue') },
  {
    path: '/game',
    name: 'Game',
    component: () => import('../views/GameView.vue'),
    children: [
      { path: '', name: 'GameMain', component: () => import('../components/panels/MainGamePanel.vue') },
      { path: 'character', name: 'CharacterDetails', component: () => import('../components/panels/CharacterDetailsPanel.vue') },
      { path: 'inventory', name: 'Inventory', component: () => import('../components/panels/InventoryPanel.vue') },
      { path: 'relationships', name: 'Relationships', component: () => import('../components/panels/RelationshipPanel.vue') },
      { path: 'map', name: 'Map', component: () => import('../components/panels/MapPanel.vue') },
      { path: 'memory', name: 'Memory', component: () => import('../components/panels/MemoryPanel.vue') },
      { path: 'events', name: 'Events', component: () => import('../components/panels/EventPanel.vue') },
      { path: 'heartbeat', name: 'Heartbeat', component: () => import('../components/panels/HeartbeatPanel.vue') },
      { path: 'variables', name: 'GameVariables', component: () => import('../components/panels/GameVariablePanel.vue') },
      { path: 'assistant', name: 'Assistant', component: () => import('../components/panels/AssistantPanel.vue') },
      { path: 'prompts', name: 'Prompts', component: () => import('../components/panels/PromptPanel.vue') },
      { path: 'api', name: 'API', component: () => import('../components/panels/APIPanel.vue') },
      { path: 'settings', name: 'Settings', component: () => import('../components/panels/SettingsPanel.vue') },
      { path: 'save', name: 'Save', component: () => import('../components/panels/SavePanel.vue') },
      { path: 'prompt-assembly', name: 'PromptAssembly', component: () => import('../components/panels/PromptAssemblyPanel.vue') },
      { path: 'engram-debug',   name: 'EngramDebug',   component: () => import('../components/panels/EngramDebugPanel.vue') },
      { path: 'image',          name: 'Image',         component: () => import('../components/panels/ImagePanel.vue') },
      { path: 'plot',           name: 'Plot',          component: () => import('../components/panels/PlotPanel.vue') },
    ],
  },
  { path: '/management', name: 'Management', component: () => import('../views/ManagementView.vue') },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/** 创角依赖 Game Pack；未加载时回到首页（避免 useCreationFlow 抛错） */
router.beforeEach((to) => {
  if (to.path === '/creation' && !getBootstrapGamePack()) {
    return { path: '/', query: { ...to.query, reason: 'no-pack' } };
  }
  return true;
});
