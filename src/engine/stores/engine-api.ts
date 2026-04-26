/**
 * API 管理 Pinia Store — 管理多 API 配置和功能分配
 *
 * 职责：
 * 1. 维护 API 配置列表（增删改查、启用/禁用）
 * 2. 维护功能分配（UsageType → API 路由）
 * 3. 持久化到 localStorage
 * 4. 与 AIService 实例同步配置
 *
 * 对应 STEP-03B M2.7 engine-api.ts。
 * 参照 demo: apiManagementStore.ts（去除酒馆相关逻辑）。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { APIConfig, UsageType, APIAssignment, APIProviderType } from '../ai/types';

/** localStorage key */
const STORAGE_KEY = 'aga_api_management';

/** 所有支持的 UsageType — must match the union in ai/types.ts */
const ALL_USAGE_TYPES: UsageType[] = [
  'main', 'memory_summary', 'text_optimization', 'cot',
  'instruction_generation', 'world_generation', 'event_generation',
  'world_heartbeat', 'location_npc_generation', 'privacy_repair',
  'field_repair',
  'npc_chat', 'embedding', 'rerank',
  'assistant', 'imageGeneration',
  'imageCharacterTokenizer', 'imageSceneTokenizer', 'imageSecretTokenizer',
  'bodyPolish', 'plot_decompose',
];

/** 默认 Rerank 路由路径 */
export const DEFAULT_RERANK_ROUTING_PATH = '/rerank';

export const useAPIManagementStore = defineStore('apiManagement', () => {
  // ─── State ───

  /** API 配置列表 */
  const apiConfigs = ref<APIConfig[]>([]);
  /** 功能分配（usageType → apiId） */
  const apiAssignments = ref<APIAssignment[]>(
    ALL_USAGE_TYPES.map((type) => ({ type, apiId: 'default' })),
  );

  // ─── Getters ───

  /** 所有已启用的 API 配置 */
  const enabledAPIs = computed(() => apiConfigs.value.filter((api) => api.enabled));

  // ─── Actions ───

  /** 从 localStorage 加载配置 */
  function loadFromStorage(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        apiConfigs.value = Array.isArray(data.apiConfigs) ? data.apiConfigs : [];

        // 合并已保存的分配（确保所有 UsageType 都有记录）
        if (Array.isArray(data.apiAssignments)) {
          const savedMap = new Map<string, string>();
          for (const a of data.apiAssignments) {
            if (a?.type && typeof a.apiId === 'string') {
              savedMap.set(a.type, a.apiId);
            }
          }
          // 验证 apiId 是否存在，不存在则回退到 default
          const existingIds = new Set(apiConfigs.value.map((c) => c.id));
          apiAssignments.value = ALL_USAGE_TYPES.map((type) => {
            const savedId = savedMap.get(type);
            const apiId = savedId && existingIds.has(savedId) ? savedId : 'default';
            return { type, apiId };
          });
        }
      }

      // 向后兼容迁移：给所有缺失 apiCategory 的旧配置补上 'llm'
      // 确保 UI 过滤和 Reranker 类别检查都能正确工作
      for (const cfg of apiConfigs.value) {
        if (!cfg.apiCategory) cfg.apiCategory = 'llm';
      }

      // 确保至少有一个默认配置
      if (apiConfigs.value.length === 0) {
        apiConfigs.value.push({
          id: 'default',
          name: '默认 API',
          apiCategory: 'llm',
          provider: 'openai' as APIProviderType,
          url: 'https://api.openai.com',
          apiKey: '',
          model: 'gpt-4o',
          temperature: 0.7,
          maxTokens: 16000,
          enabled: true,
        });
      }
    } catch (err) {
      console.error('[APIStore] 加载配置失败:', err);
    }
  }

  /** 保存到 localStorage */
  function saveToStorage(): void {
    try {
      const data = {
        apiConfigs: apiConfigs.value,
        apiAssignments: apiAssignments.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[APIStore] 保存配置失败:', err);
    }
  }

  /** 添加 API 配置 — 返回新配置的 ID */
  function addAPI(config: Omit<APIConfig, 'id'>): string {
    const id = `api_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    apiConfigs.value.push({ ...config, id });
    saveToStorage();
    return id;
  }

  /** 更新 API 配置 */
  function updateAPI(id: string, updates: Partial<APIConfig>): void {
    const idx = apiConfigs.value.findIndex((c) => c.id === id);
    if (idx !== -1) {
      apiConfigs.value[idx] = { ...apiConfigs.value[idx], ...updates };
      saveToStorage();
    }
  }

  /** 删除 API 配置 — 默认配置不可删除 */
  function deleteAPI(id: string): void {
    if (id === 'default') throw new Error('不能删除默认 API 配置');

    // 使用此 API 的分配回退到 default
    for (const a of apiAssignments.value) {
      if (a.apiId === id) a.apiId = 'default';
    }
    apiConfigs.value = apiConfigs.value.filter((c) => c.id !== id);
    saveToStorage();
  }

  /** 设置功能分配 */
  function assignAPI(type: UsageType, apiId: string): void {
    const assignment = apiAssignments.value.find((a) => a.type === type);
    if (assignment) {
      assignment.apiId = apiId;
    } else {
      apiAssignments.value.push({ type, apiId });
    }
    saveToStorage();
  }

  /** 获取功能对应的 API 配置 */
  function getAPIForType(type: UsageType): APIConfig | null {
    const assignment = apiAssignments.value.find((a) => a.type === type);
    if (!assignment) return null;

    const api = apiConfigs.value.find((a) => a.id === assignment.apiId && a.enabled);
    if (api) return api;

    // 回退到默认 API（也需检查 enabled）
    return apiConfigs.value.find((a) => a.id === 'default' && a.enabled) ?? null;
  }

  /**
   * 获取 Rerank 请求的完整 URL
   * 支持自定义路由路径
   */
  function getRerankEndpointUrl(): string | null {
    const api = getAPIForType('rerank');
    if (!api?.url) return null;
    const base = api.url.replace(/\/+$/, '');
    const useCustom = api.useCustomRouting === true &&
      typeof api.customRoutingPath === 'string' &&
      api.customRoutingPath.trim().length > 0;
    const pathRaw = useCustom ? api.customRoutingPath!.trim() : DEFAULT_RERANK_ROUTING_PATH;
    const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
    return `${base}${path}`;
  }

  /** 切换 API 启用状态 */
  function toggleAPI(id: string): void {
    const api = apiConfigs.value.find((c) => c.id === id);
    if (api) {
      api.enabled = !api.enabled;
      saveToStorage();
    }
  }

  /** 导出配置 */
  function exportConfig(): Record<string, unknown> {
    return {
      apiConfigs: apiConfigs.value,
      apiAssignments: apiAssignments.value,
      exportTime: new Date().toISOString(),
    };
  }

  /** 导入配置 */
  function importConfig(data: Record<string, unknown>): void {
    if (Array.isArray(data.apiConfigs)) {
      apiConfigs.value = data.apiConfigs as APIConfig[];
    }
    if (Array.isArray(data.apiAssignments)) {
      apiAssignments.value = data.apiAssignments as APIAssignment[];
    }
    saveToStorage();
  }

  return {
    apiConfigs,
    apiAssignments,
    enabledAPIs,
    loadFromStorage,
    saveToStorage,
    addAPI,
    updateAPI,
    deleteAPI,
    assignAPI,
    getAPIForType,
    getRerankEndpointUrl,
    toggleAPI,
    exportConfig,
    importConfig,
  };
});
