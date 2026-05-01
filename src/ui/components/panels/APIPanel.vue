<script setup lang="ts">
/**
 * APIPanel — API 管理面板（B.1 全功能实现）
 *
 * B.1.1 真实连通测试：status dot（idle/testing/ok/error）+ 延迟显示
 * B.1.2 模型列表拉取：编辑 Modal 中"获取模型"按钮 + datalist 选择
 * B.1.3 功能分配增强：必选/可选功能分组，可选功能含开关（关闭时置灰）
 * B.1.4 AI 生成全局设置：流式输出开关 + 最大重试次数
 */
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useAPIManagementStore } from '@/engine/stores/engine-api';
import Modal from '@/ui/components/common/Modal.vue';
import { eventBus } from '@/engine/core/event-bus';
import { API_PROVIDER_PRESETS } from '@/engine/ai/types';
import type { AIService } from '@/engine/ai/ai-service';
import type { APIConfig, APIProviderType, UsageType, APICategory } from '@/engine/ai/types';

const apiStore = useAPIManagementStore();
const aiService = inject<AIService | undefined>('aiService', undefined);

onMounted(() => {
  apiStore.loadFromStorage();
});

// ─── Usage type config ───

type AssignCategory = 'narrative' | 'world_memory' | 'npc_social' | 'plot' | 'repair' | 'image' | 'rag' | 'utility';

interface UsageTypeMeta {
  label: string;
  category: AssignCategory;
  tip: string;
}

const USAGE_TYPE_META: Record<UsageType, UsageTypeMeta> = {
  main:                    { label: '主回合',        category: 'narrative',    tip: '每回合叙事生成的核心调用，消耗最多 token，建议分配最强模型' },
  cot:                     { label: '思维链（CoT）', category: 'narrative',    tip: '主回合前的独立推理步骤，提升剧情一致性和判定质量，需额外 API 调用' },
  bodyPolish:              { label: '文本润色',      category: 'narrative',    tip: '主回合生成后由独立 AI 对叙事文本进行润色，消耗额外 token' },
  text_optimization:       { label: '文本优化',      category: 'narrative',    tip: '对生成文本做语法和文笔优化，可分配较便宜的模型' },
  memory_summary:          { label: '记忆总结',      category: 'world_memory', tip: '将短期/中期记忆压缩为长期记忆摘要，定期触发' },
  world_generation:        { label: '世界生成',      category: 'world_memory', tip: '开局时生成世界背景设定，仅在创建角色时调用一次' },
  event_generation:        { label: '事件生成',      category: 'world_memory', tip: '生成世界随机事件（节日、灾害、商队等），丰富世界动态' },
  world_heartbeat:         { label: '世界心跳',      category: 'world_memory', tip: '每隔数回合自动更新世界状态（天气、势力、物价等），模拟活世界' },
  npc_chat:                { label: 'NPC 私聊',     category: 'npc_social',   tip: '独立于主回合的 1:1 NPC 对话，在关系面板中发起' },
  location_npc_generation: { label: '地点 NPC 生成', category: 'npc_social',   tip: '玩家到达新地点时自动生成当地 NPC，需开启后才会触发' },
  plot_decompose:          { label: '剧情大纲拆解',  category: 'plot',         tip: '将玩家输入的剧情大纲用 AI 拆解为可追踪的节点链' },
  instruction_generation:  { label: '指令生成',      category: 'plot',         tip: '生成结构化指令和行动选项，通常随主回合一起执行' },
  privacy_repair:          { label: '扩展字段修复',   category: 'repair',       tip: 'NSFW 模式下自动修复不合规的私密字段描述，可配置重试次数' },
  field_repair:            { label: '字段补齐',      category: 'repair',       tip: '自动补齐 AI 遗漏的必填字段（如属性、装备等），减少数据缺失' },
  imageGeneration:         { label: '图像生成',      category: 'image',        tip: '调用图像生成 API（DALL-E / ComfyUI / SD / Civitai 等）生成场景或角色图' },
  imageCharacterTokenizer: { label: '角色视觉提取',  category: 'image',        tip: '用 LLM 从角色图像中提取叙事描述，供后续 prompt 引用' },
  imageSceneTokenizer:     { label: '场景视觉提取',  category: 'image',        tip: '用 LLM 从场景图像中提取环境描述，增强叙事沉浸感' },
  imageSecretTokenizer:    { label: '私密视觉提取',  category: 'image',        tip: '用 LLM 从 NSFW 图像中提取描述（仅 NSFW 模式下使用）' },
  embedding:               { label: '向量化',        category: 'rag',          tip: '将文本转换为向量用于语义搜索，需分配 Embedding 类别的 API' },
  rerank:                  { label: '重排序',        category: 'rag',          tip: '对检索结果做精排以提升相关性，需 Rerank 类别 API 或 LLM 兜底' },
  assistant:               { label: 'AI 助手',      category: 'utility',      tip: '游戏内 AI 助手聊天面板，回答玩家关于游戏世界的问题' },
};

const ASSIGN_CATEGORY_META: Record<AssignCategory, { label: string; hint?: string }> = {
  narrative:    { label: '正文生成' },
  world_memory: { label: '世界与记忆' },
  npc_social:   { label: 'NPC 与社交' },
  plot:         { label: '剧情导向' },
  repair:       { label: '修复与补齐' },
  image:        { label: '图像相关' },
  rag:          { label: 'RAG 检索', hint: '下拉框只显示类别匹配的 API。如果没有选项，请先添加 Embedding 或 Rerank 类别的 API 配置。' },
  utility:      { label: '工具' },
};

const CATEGORY_ORDER: AssignCategory[] = [
  'narrative', 'world_memory', 'npc_social', 'plot', 'repair', 'image', 'rag', 'utility',
];

// ─── Optional feature toggles (B.1.3) ───

const FEATURE_TOGGLES_KEY = 'aga_feature_toggles';

function loadFeatureToggles(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FEATURE_TOGGLES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const featureToggles = ref<Record<string, boolean>>(loadFeatureToggles());

const ALWAYS_ON_TYPES: Set<UsageType> = new Set([
  'main', 'memory_summary', 'world_generation', 'event_generation',
  'instruction_generation', 'embedding', 'rerank',
]);

function isFeatureEnabled(type: UsageType): boolean {
  if (ALWAYS_ON_TYPES.has(type)) return true;
  return featureToggles.value[type] !== false;
}

function toggleFeature(type: UsageType): void {
  featureToggles.value[type] = !isFeatureEnabled(type);
  try {
    localStorage.setItem(FEATURE_TOGGLES_KEY, JSON.stringify(featureToggles.value));
  } catch { /* ignore */ }
}

function isToggleable(type: UsageType): boolean {
  return !ALWAYS_ON_TYPES.has(type);
}

function typesForCategory(cat: AssignCategory): UsageType[] {
  return (Object.entries(USAGE_TYPE_META) as [UsageType, UsageTypeMeta][])
    .filter(([, m]) => m.category === cat)
    .map(([t]) => t);
}

// ─── AI generation settings (B.1.4) ───

const AI_SETTINGS_KEY = 'aga_ai_settings';

function loadAISettings() {
  try {
    return JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const savedSettings = loadAISettings();
const streamingEnabled = ref<boolean>(savedSettings.streaming !== false);
const splitGenEnabled = ref<boolean>(savedSettings.splitGen === true);
const maxRetries = ref<number>(savedSettings.maxRetries ?? 1);
/**
 * §11.2 B: NSFW 私密信息修复重试次数（0-3）
 * 首次调用是必定的（下方 PrivacyProfileRepairPipeline 首次扫描到缺失时总会调一次），
 * 此值控制失败/不完整时额外再调几次。默认 1（= 最多 2 次调用）。
 */
const privacyRepairRetries = ref<number>(
  typeof savedSettings.privacyRepairRetries === 'number' ? savedSettings.privacyRepairRetries : 1,
);

function saveAISettings() {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
      streaming: streamingEnabled.value,
      splitGen: splitGenEnabled.value,
      maxRetries: maxRetries.value,
      privacyRepairRetries: privacyRepairRetries.value,
    }));
    // Sync to aiService if available
    if (aiService) {
      aiService.maxRetries = maxRetries.value;
    }
  } catch { /* ignore */ }
}

// ─── Connection test (B.1.1) ───

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';
const testStatuses = ref<Record<string, TestStatus>>({});
const testLatencies = ref<Record<string, number>>({});

async function testConnection(api: APIConfig): Promise<void> {
  if (testStatuses.value[api.id] === 'testing') return;
  if (!aiService) {
    eventBus.emit('ui:toast', { type: 'warning', message: 'AI 服务未初始化', duration: 2000 });
    return;
  }
  if (!api.url || !api.apiKey || !api.model) {
    eventBus.emit('ui:toast', { type: 'warning', message: '请先填写 URL、Key 和模型', duration: 2000 });
    return;
  }

  testStatuses.value[api.id] = 'testing';
  // CR-R18: 在 toast 中展示正在测试的类别（LLM/Embedding/Rerank），让用户
  // 明确知道走的是哪条端点路径 —— 特别在配置 SiliconFlow 这类多端点 provider 时
  // 能一眼看出 "我点的是 Rerank 按钮，走的确实是 /rerank 端点"。
  const categoryForToast = CATEGORY_META[api.apiCategory ?? 'llm'].label;
  try {
    // §11.3: 按 apiCategory 测试对应的端点（LLM → chat/completions，
    // Embedding → /v1/embeddings，Rerank → /v1/rerank）
    const result = await aiService.testConnection({
      url: api.url,
      apiKey: api.apiKey,
      model: api.model,
      apiCategory: api.apiCategory ?? 'llm',
      customRoutingPath: api.useCustomRouting ? api.customRoutingPath : undefined,
    });
    testStatuses.value[api.id] = result.ok ? 'ok' : 'error';
    testLatencies.value[api.id] = result.latencyMs;
    if (result.ok) {
      eventBus.emit('ui:toast', {
        type: 'success',
        message: `${api.name} [${categoryForToast}] 连接成功 ${result.latencyMs}ms`,
        duration: 2500,
      });
    } else {
      eventBus.emit('ui:toast', {
        type: 'error',
        message: `${api.name} [${categoryForToast}] 连接失败: ${result.error}`,
        duration: 4000,
      });
    }
  } catch (e) {
    testStatuses.value[api.id] = 'error';
    eventBus.emit('ui:toast', {
      type: 'error',
      message: `${api.name} [${categoryForToast}] 连接异常`,
      duration: 3000,
    });
  }
}

// ─── Model fetch (B.1.2) ───

const availableModels = ref<string[]>([]);
const isFetchingModels = ref(false);
const MODEL_DATALIST_ID = 'api-model-list';

async function fetchModelsForForm(): Promise<void> {
  if (!aiService) return;
  if (!form.value.url || !form.value.apiKey) {
    eventBus.emit('ui:toast', { type: 'warning', message: '请先填写 API URL 和 Key', duration: 2000 });
    return;
  }
  isFetchingModels.value = true;
  try {
    const models = await aiService.fetchModels({ url: form.value.url, apiKey: form.value.apiKey });
    availableModels.value = models;
    if (models.length === 0) {
      eventBus.emit('ui:toast', { type: 'warning', message: '未返回任何模型', duration: 2000 });
    } else {
      eventBus.emit('ui:toast', { type: 'success', message: `获取到 ${models.length} 个模型`, duration: 2000 });
    }
  } catch (e) {
    eventBus.emit('ui:toast', { type: 'error', message: `获取模型失败: ${(e as Error).message?.slice(0, 60)}`, duration: 3000 });
  } finally {
    isFetchingModels.value = false;
  }
}

// ─── Add/Edit modal ───

const showEditModal = ref(false);
const isNewAPI = ref(false);
const editingId = ref('');

interface APIFormData {
  name: string;
  /** §11.3: API 类别 — 决定调用时走哪条路径 */
  apiCategory: APICategory;
  provider: APIProviderType;
  url: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  /** §11.3: 高级 — 使用自定义路径覆盖默认 /v1/embeddings 或 /v1/rerank */
  useCustomRouting: boolean;
  /** §11.3: 高级 — 自定义路径内容（如 "/v2/embeddings"） */
  customRoutingPath: string;
}

/**
 * 三选一类别定义 — 用于编辑弹窗顶部的 segment 控件
 */
const CATEGORY_META: Record<APICategory, { label: string; desc: string }> = {
  llm: {
    label: 'LLM',
    desc: '对话 / 指令生成 / 叙事（主回合等）',
  },
  embedding: {
    label: 'Embedding',
    desc: '向量化 — 把文本转成向量供 Engram 检索使用',
  },
  rerank: {
    label: 'Rerank',
    desc: '重排序 — Cohere / SiliconFlow / Jina 格式原生端点',
  },
  image: {
    label: '图像生成',
    desc: '图像生成 — NovelAI / DALL-E / SD-WebUI / ComfyUI / Civitai 等图像 API',
  },
};

const CATEGORY_OPTIONS: APICategory[] = ['llm', 'embedding', 'rerank', 'image'];

type ImageBackendHint = 'civitai' | 'novelai' | 'openai' | 'sd_webui' | 'comfyui' | 'custom';
const IMAGE_BACKEND_PRESETS: Record<ImageBackendHint, { label: string; url: string; modelPlaceholder: string; modelHint: string }> = {
  civitai:  { label: 'Civitai',       url: 'https://orchestration.civitai.com', modelPlaceholder: 'urn:air:sdxl:checkpoint:civitai:101055@128078', modelHint: '在 civitai.com 模型页面找到 AIR 标识符' },
  novelai:  { label: 'NovelAI',       url: 'https://image.novelai.net',          modelPlaceholder: 'nai-diffusion-4-5-full',                       modelHint: 'NovelAI 模型名称' },
  openai:   { label: 'OpenAI DALL-E', url: 'https://api.openai.com',             modelPlaceholder: 'dall-e-3',                                     modelHint: 'dall-e-2 或 dall-e-3' },
  sd_webui: { label: 'SD-WebUI',      url: 'http://localhost:7860',              modelPlaceholder: 'v1-5-pruned-emaonly.safetensors',               modelHint: 'Checkpoint 文件名' },
  comfyui:  { label: 'ComfyUI',       url: 'http://localhost:8188',              modelPlaceholder: 'v1-5-pruned-emaonly.safetensors',               modelHint: 'Checkpoint 文件名（仅基础模式使用）' },
  custom:   { label: '自定义',         url: '',                                   modelPlaceholder: '',                                             modelHint: '由后端决定' },
};
const imageBackend = ref<ImageBackendHint>('civitai');

function onImageBackendChange(): void {
  const preset = IMAGE_BACKEND_PRESETS[imageBackend.value];
  form.value.url = preset.url;
  form.value.model = '';
}

function inferImageBackend(url: string): ImageBackendHint {
  if (url.includes('orchestration.civitai.com')) return 'civitai';
  if (url.includes('image.novelai.net') || url.includes('novelai')) return 'novelai';
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes(':8188')) return 'comfyui';
  if (url.includes(':7860')) return 'sd_webui';
  return 'custom';
}

const form = ref<APIFormData>({
  name: '',
  apiCategory: 'llm',
  provider: 'openai',
  url: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 16000,
  enabled: true,
  useCustomRouting: false,
  customRoutingPath: '',
});

function openAddModal(): void {
  isNewAPI.value = true;
  editingId.value = '';
  availableModels.value = [];
  // CR-R10: 每次打开弹窗都清空类别缓存
  categoryFormCache.value = {};
  form.value = {
    name: '',
    apiCategory: 'llm',
    provider: 'openai',
    url: API_PROVIDER_PRESETS.openai.url,
    apiKey: '',
    model: API_PROVIDER_PRESETS.openai.defaultModel,
    temperature: 0.7,
    maxTokens: 16000,
    enabled: true,
    useCustomRouting: false,
    customRoutingPath: '',
  };
  showEditModal.value = true;
}

function openEditModal(api: APIConfig): void {
  isNewAPI.value = false;
  editingId.value = api.id;
  availableModels.value = [];
  // CR-R10: 每次打开弹窗都清空类别缓存
  categoryFormCache.value = {};
  form.value = {
    name: api.name,
    apiCategory: api.apiCategory ?? 'llm', // 向后兼容旧配置
    provider: api.provider,
    url: api.url,
    apiKey: api.apiKey,
    model: api.model,
    temperature: api.temperature,
    maxTokens: api.maxTokens,
    enabled: api.enabled,
    useCustomRouting: api.useCustomRouting ?? false,
    customRoutingPath: api.customRoutingPath ?? '',
  };
  if ((api.apiCategory ?? 'llm') === 'image') {
    imageBackend.value = inferImageBackend(api.url);
  }
  showEditModal.value = true;
}

/**
 * §11.3: 切换 API 类别时的字段处理
 *
 * CR-R10 (2026-04-11)：升级为 per-category 缓存模式。
 * 之前版本会把 temperature/maxTokens/provider 强制重置到类别默认值，
 * 导致用户如果"LLM 填了一半 → 切 Embedding 看一眼 → 切回 LLM"时
 * 已经填好的 temperature/maxTokens 被清零，体验很糟。
 *
 * 新策略：
 * 1. 切出时把"当前类别相关字段"存到 `categoryFormCache[旧类别]`
 * 2. 切入时若 `categoryFormCache[新类别]` 存在则恢复，否则用默认值
 * 3. name / apiKey 不属于任何类别 —— 始终保留（用户角度"它们是全局的"）
 *
 * 每个类别相关的字段集合：
 * - llm:       provider, url, model, temperature, maxTokens
 * - embedding: url, model, useCustomRouting, customRoutingPath
 * - rerank:    url, model, useCustomRouting, customRoutingPath
 */
interface CategorySlice {
  provider: APIProviderType;
  url: string;
  model: string;
  temperature: number;
  maxTokens: number;
  useCustomRouting: boolean;
  customRoutingPath: string;
}

/**
 * 每个类别对应的字段缓存。切换时先把当前表单字段存入当前类别的 slot，
 * 再从目标类别 slot 恢复（或使用默认值）。跟随 form 的生命周期 —
 * 关闭弹窗时 reset（见 openAddModal / openEditModal）。
 */
const categoryFormCache = ref<Partial<Record<APICategory, CategorySlice>>>({});

/** 类别默认值 —— 仅在首次切入且无缓存时使用 */
const CATEGORY_DEFAULTS: Record<APICategory, CategorySlice> = {
  llm: {
    provider: 'openai',
    url: API_PROVIDER_PRESETS.openai.url,
    model: API_PROVIDER_PRESETS.openai.defaultModel,
    temperature: 0.7,
    maxTokens: 16000,
    useCustomRouting: false,
    customRoutingPath: '',
  },
  embedding: {
    provider: 'custom',
    url: '',
    model: '',
    temperature: 0,
    maxTokens: 0,
    useCustomRouting: false,
    customRoutingPath: '',
  },
  rerank: {
    provider: 'custom',
    url: '',
    model: '',
    temperature: 0,
    maxTokens: 0,
    useCustomRouting: false,
    customRoutingPath: '',
  },
  image: {
    provider: 'custom',
    url: '',
    model: '',
    temperature: 0,
    maxTokens: 0,
    useCustomRouting: false,
    customRoutingPath: '',
  },
};

/** 当前表单字段 → CategorySlice */
function snapshotCurrentSlice(): CategorySlice {
  return {
    provider: form.value.provider,
    url: form.value.url,
    model: form.value.model,
    temperature: form.value.temperature,
    maxTokens: form.value.maxTokens,
    useCustomRouting: form.value.useCustomRouting,
    customRoutingPath: form.value.customRoutingPath,
  };
}

/** CategorySlice → 当前表单字段 */
function applySlice(slice: CategorySlice): void {
  form.value.provider = slice.provider;
  form.value.url = slice.url;
  form.value.model = slice.model;
  form.value.temperature = slice.temperature;
  form.value.maxTokens = slice.maxTokens;
  form.value.useCustomRouting = slice.useCustomRouting;
  form.value.customRoutingPath = slice.customRoutingPath;
}

/**
 * 切换类别时的主处理：缓存 + 恢复
 *
 * previousCategory 参数来自 segment 控件的 @click，
 * 因为 v-model 已经把 form.apiCategory 切到新值之后才触发 onCategoryChange，
 * 单独参数能让我们正确寻找"切出"的类别 slot。
 */
function onCategoryChange(previousCategory: APICategory): void {
  const newCat = form.value.apiCategory;
  if (newCat === previousCategory) return;
  availableModels.value = [];
  // 1. 把当前表单字段存到"切出"类别的 slot
  categoryFormCache.value[previousCategory] = snapshotCurrentSlice();
  // 2. 从"切入"类别恢复，或用默认值
  const cached = categoryFormCache.value[newCat];
  applySlice(cached ?? CATEGORY_DEFAULTS[newCat]);
  // 3. 切入 image 时，用 imageBackend 预设填充 URL
  if (newCat === 'image' && !cached) {
    imageBackend.value = 'civitai';
    form.value.url = IMAGE_BACKEND_PRESETS.civitai.url;
  }
}

function onProviderChange(): void {
  const preset = API_PROVIDER_PRESETS[form.value.provider];
  if (preset) {
    form.value.url = preset.url;
    form.value.model = preset.defaultModel;
  }
  availableModels.value = [];
}

/**
 * 表单保存级校验：仅 name + url 必填。
 *
 * apiKey / model 在保存时可留空 —— 部分本地或企业网关不需要 key，
 * model 也可以留到实际调用时再填（或走 provider 默认）。测试连接 /
 * 拉取模型列表仍在各自按钮上做更严格的 preflight 检查。
 */
const formValidationError = computed<string | null>(() => {
  if (!form.value.name.trim()) return '请输入 API 名称';
  if (!form.value.url.trim()) return '请输入 API URL';
  return null;
});

function saveAPI(): void {
  // CR-R3: 服务端兜底校验（即使按钮被误点也不会保存不完整配置）
  const err = formValidationError.value;
  if (err) {
    eventBus.emit('ui:toast', { type: 'error', message: err, duration: 2000 });
    return;
  }
  if (isNewAPI.value) {
    apiStore.addAPI(form.value);
    eventBus.emit('ui:toast', { type: 'success', message: '已添加 API 配置', duration: 1500 });
  } else {
    apiStore.updateAPI(editingId.value, form.value);
    // Reset test status when config is updated
    delete testStatuses.value[editingId.value];
    eventBus.emit('ui:toast', { type: 'success', message: '已更新 API 配置', duration: 1500 });
  }
  showEditModal.value = false;
}

function deleteAPI(id: string): void {
  try {
    apiStore.deleteAPI(id);
    delete testStatuses.value[id];
    eventBus.emit('ui:toast', { type: 'warning', message: '已删除 API 配置', duration: 1500 });
  } catch (e) {
    eventBus.emit('ui:toast', { type: 'error', message: (e as Error).message, duration: 2500 });
  }
}

// ─── Assignment modal ───

const showAssignModal = ref(false);

watch(showAssignModal, (open) => {
  if (open) featureToggles.value = loadFeatureToggles();
});

/**
 * CR-R11 (2026-04-11)：功能分配弹窗 "显示全部 API" 开关
 *
 * 默认（false）：下拉框按 usageType 的 requiredCategoryFor 过滤 —
 *   例如 embedding 槽位只显示 apiCategory='embedding' 的 API，
 *   避免用户误把 LLM 分给向量化。
 * 开启（true）：绕过类别过滤，显示所有 API（即使类别不匹配也能选）。
 *   用户角度："我就是要强制分配一个类别不符的 API，别拦我。"
 *   适用场景：自建网关把不同类别路由到同一个 endpoint，
 *   或用户想让一个 LLM 勉强跑 rerank 任务。
 * 类别不匹配的选项仍然带 "⚠ 类别不匹配" 标记，保留警示效果。
 */
const showAllInAssign = ref(false);

function assignAPI(type: UsageType, apiId: string): void {
  apiStore.assignAPI(type, apiId);
  eventBus.emit('ui:toast', { type: 'info', message: '分配已更新', duration: 1000 });
}



function getAssignedApiId(type: UsageType): string {
  return apiStore.apiAssignments.find((a) => a.type === type)?.apiId ?? 'default';
}

function providerName(provider: APIProviderType): string {
  return API_PROVIDER_PRESETS[provider]?.name ?? provider;
}

/**
 * §11.3: 根据 UsageType 确定应该使用哪个 apiCategory 的 API
 *
 * - embedding → 'embedding'
 * - rerank    → 'rerank'
 * - 其他所有 → 'llm'
 */
function requiredCategoryFor(type: UsageType): APICategory {
  if (type === 'embedding') return 'embedding';
  if (type === 'rerank') return 'rerank';
  if (type === 'imageGeneration') return 'image';
  return 'llm';
}

/**
 * §11.3: 按 UsageType 过滤可用的 API 列表
 *
 * 只返回 apiCategory 与 usageType 匹配的 API，防止用户把 LLM 分配给 embedding
 * 或把 rerank 分配给 main 等错误配置。
 *
 * 特殊处理：当前分配的 API 即使类别不匹配也要保留在列表中（否则 dropdown 显示为空），
 * 但额外加一个"（类别不匹配）"标记，让用户有机会看到并自行修正。
 */
function getAssignableAPIs(type: UsageType): APIConfig[] {
  // CR-R11: "显示全部" 开关开启时直接返回所有 API（带 mismatch 标记）
  if (showAllInAssign.value) return [...apiStore.apiConfigs];

  const required = requiredCategoryFor(type);
  const currentAssigned = getAssignedApiId(type);
  return apiStore.apiConfigs.filter((api) => {
    const cat = api.apiCategory ?? 'llm';
    if (cat === required) return true;
    // 保留已分配但类别不符的 API（显示警告）
    if (api.id === currentAssigned) return true;
    return false;
  });
}

/**
 * 判断某个 API 是否与指定 usageType 的类别匹配（用于 UI 警告显示）
 */
function isApiCategoryMismatch(api: APIConfig, type: UsageType): boolean {
  const required = requiredCategoryFor(type);
  return (api.apiCategory ?? 'llm') !== required;
}
</script>

<template>
  <div class="api-panel">
    <!-- ─── Header ─── -->
    <header class="panel-header">
      <h2 class="panel-title">API 管理</h2>
      <div class="header-actions">
        <button class="btn-secondary" @click="showAssignModal = true">功能分配</button>
        <button class="btn-primary" @click="openAddModal">+ 添加 API</button>
      </div>
    </header>

    <!-- ─── API list ─── -->
    <div v-if="apiStore.apiConfigs.length" class="api-list">
      <div
        v-for="api in apiStore.apiConfigs"
        :key="api.id"
        :class="['api-card', { 'api-card--disabled': !api.enabled }]"
      >
        <div class="api-header">
          <div class="api-title-area">
            <!-- Status dot (B.1.1) -->
            <div
              :class="['status-dot', `status-dot--${testStatuses[api.id] ?? 'idle'}`]"
              :title="testStatuses[api.id] === 'ok' ? `${testLatencies[api.id]}ms` : (testStatuses[api.id] ?? '未测试')"
            />
            <span class="api-name">{{ api.name }}</span>
            <!-- §11.3: API 类别 badge -->
            <span
              :class="['api-category-badge', `api-category-badge--${api.apiCategory ?? 'llm'}`]"
              :title="CATEGORY_META[api.apiCategory ?? 'llm'].desc"
            >
              {{ CATEGORY_META[api.apiCategory ?? 'llm'].label }}
            </span>
            <span v-if="(api.apiCategory ?? 'llm') === 'llm'" class="api-provider">{{ providerName(api.provider) }}</span>
            <span v-if="testStatuses[api.id] === 'ok'" class="latency-badge">
              {{ testLatencies[api.id] }}ms
            </span>
          </div>
          <div class="api-actions">
            <button
              :class="['toggle-btn', { 'toggle-btn--on': api.enabled }]"
              :title="api.enabled ? '禁用' : '启用'"
              @click="apiStore.toggleAPI(api.id)"
            >
              {{ api.enabled ? 'ON' : 'OFF' }}
            </button>
          </div>
        </div>

        <div class="api-details">
          <div class="detail-item">
            <span class="detail-label">URL</span>
            <span class="detail-value detail-value--mono">{{ api.url || '未设置' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">模型</span>
            <span class="detail-value">{{ api.model || '未设置' }}</span>
          </div>
          <!-- §11.3: 温度仅 LLM 类别显示 -->
          <div v-if="(api.apiCategory ?? 'llm') === 'llm'" class="detail-item">
            <span class="detail-label">温度</span>
            <span class="detail-value detail-value--mono">{{ api.temperature }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Key</span>
            <span class="detail-value detail-value--mono">
              {{ api.apiKey ? '••••••' + api.apiKey.slice(-4) : '未设置' }}
            </span>
          </div>
        </div>

        <div class="api-footer">
          <button
            :class="['btn-sm', { 'btn-sm--testing': testStatuses[api.id] === 'testing' }]"
            :disabled="testStatuses[api.id] === 'testing'"
            @click="testConnection(api)"
          >
            {{ testStatuses[api.id] === 'testing' ? '测试中…' : '测试连接' }}
          </button>
          <button class="btn-sm" @click="openEditModal(api)">编辑</button>
          <button
            v-if="api.id !== 'default'"
            class="btn-sm btn-sm--danger"
            @click="deleteAPI(api.id)"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <p>暂无 API 配置</p>
    </div>

    <!-- ─── AI 生成全局设置 (B.1.4) ─── -->
    <section class="ai-settings-section">
      <h3 class="settings-title">AI 生成设置</h3>
      <div class="settings-grid">
        <!-- Streaming toggle -->
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">流式输出</span>
            <span class="setting-desc">逐字流式返回叙事内容</span>
          </div>
          <button
            role="switch"
            :aria-checked="streamingEnabled"
            :class="['toggle-switch', { 'toggle-switch--on': streamingEnabled }]"
            @click="streamingEnabled = !streamingEnabled; saveAISettings()"
          >
            {{ streamingEnabled ? 'ON' : 'OFF' }}
          </button>
        </div>

        <!-- Split generation toggle -->
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">分步生成</span>
            <span class="setting-desc">主回合分两次 API 调用：第1步生成正文叙事，第2步生成指令和行动选项，提高稳定性</span>
          </div>
          <button
            role="switch"
            :aria-checked="splitGenEnabled"
            :class="['toggle-switch', { 'toggle-switch--on': splitGenEnabled }]"
            @click="splitGenEnabled = !splitGenEnabled; saveAISettings()"
          >
            {{ splitGenEnabled ? 'ON' : 'OFF' }}
          </button>
        </div>

        <!-- Max retries -->
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">失败重试次数</span>
            <span class="setting-desc">请求失败后的最大重试次数（0–5）</span>
          </div>
          <input
            v-model.number="maxRetries"
            type="number"
            min="0"
            max="5"
            class="retry-input"
            @change="saveAISettings()"
          />
        </div>

        <!-- §11.2 B: Privacy repair retries -->
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">扩展字段修复重试次数</span>
            <span class="setting-desc">
              扩展字段（NPC 私密信息 / 玩家法身）缺失时的自动修复调用次数（0–3）。
              首次调用是必定的，此值控制失败/仍不完整时额外再调几次。
              建议保持 1 — 避免 AI 顽固不配合导致的无限循环。
            </span>
          </div>
          <input
            v-model.number="privacyRepairRetries"
            type="number"
            min="0"
            max="3"
            class="retry-input"
            @change="saveAISettings()"
          />
        </div>
      </div>
    </section>

    <!-- ─── Add/Edit Modal ─── -->
    <Modal v-model="showEditModal" :title="isNewAPI ? '添加 API 配置' : '编辑 API 配置'" width="520px">
      <div class="edit-form">

        <!-- §11.3: Three-way category segment -->
        <div class="form-group">
          <label class="form-label">API 类别</label>
          <div class="category-segment">
            <button
              v-for="cat in CATEGORY_OPTIONS"
              :key="cat"
              type="button"
              class="category-segment__btn"
              :class="{ 'category-segment__btn--active': form.apiCategory === cat }"
              @click="(() => { const prev = form.apiCategory; form.apiCategory = cat; onCategoryChange(prev); })()"
            >
              {{ CATEGORY_META[cat].label }}
            </button>
          </div>
          <span class="form-hint">{{ CATEGORY_META[form.apiCategory].desc }}</span>
        </div>

        <div class="form-group">
          <label class="form-label">名称</label>
          <input v-model="form.name" type="text" class="form-input" placeholder="API 显示名称" />
        </div>

        <!-- Provider only for LLM category -->
        <div v-if="form.apiCategory === 'llm'" class="form-group">
          <label class="form-label">提供商</label>
          <select v-model="form.provider" class="form-input" @change="onProviderChange">
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="deepseek">DeepSeek</option>
            <option value="custom">自定义(OpenAI兼容)</option>
          </select>
        </div>

        <!-- Image backend selector -->
        <div v-if="form.apiCategory === 'image'" class="form-group">
          <label class="form-label">图像后端</label>
          <select v-model="imageBackend" class="form-input" @change="onImageBackendChange">
            <option value="civitai">Civitai</option>
            <option value="novelai">NovelAI</option>
            <option value="openai">OpenAI DALL-E</option>
            <option value="sd_webui">SD-WebUI (本地)</option>
            <option value="comfyui">ComfyUI (本地)</option>
            <option value="custom">自定义</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">API URL</label>
          <input
            v-model="form.url"
            type="text"
            class="form-input"
            :placeholder="form.apiCategory === 'rerank' || form.apiCategory === 'embedding'
              ? 'https://api.siliconflow.cn'
              : form.apiCategory === 'image'
                ? IMAGE_BACKEND_PRESETS[imageBackend].url || 'https://example.com'
                : 'https://api.example.com'"
          />
          <span v-if="form.apiCategory === 'embedding' || form.apiCategory === 'rerank'" class="form-hint">
            只填 base URL，不含 <code>/v1/...</code>。系统会自动拼接
            <code>{{ form.apiCategory === 'rerank' ? '/v1/rerank' : '/v1/embeddings' }}</code>
          </span>
          <span v-else-if="form.apiCategory === 'image'" class="form-hint">
            {{ IMAGE_BACKEND_PRESETS[imageBackend].label }} 的 base URL
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">API Key</label>
          <input v-model="form.apiKey" type="password" class="form-input" placeholder="sk-..." />
        </div>

        <!-- Model with fetch button (B.1.2) -->
        <div class="form-group">
          <label class="form-label">模型</label>
          <div class="model-input-row">
            <input
              v-model="form.model"
              type="text"
              list="api-model-list"
              class="form-input model-input"
              :placeholder="form.apiCategory === 'rerank'
                ? 'BAAI/bge-reranker-v2-m3'
                : form.apiCategory === 'embedding'
                  ? 'BAAI/bge-m3'
                  : form.apiCategory === 'image'
                    ? IMAGE_BACKEND_PRESETS[imageBackend].modelPlaceholder
                    : 'gpt-4o'"
            />
            <button
              v-if="form.apiCategory !== 'image'"
              class="btn-fetch-models"
              :disabled="isFetchingModels"
              @click="fetchModelsForForm"
            >
              {{ isFetchingModels ? '获取中…' : '获取模型' }}
            </button>
          </div>
          <span v-if="form.apiCategory === 'image'" class="form-hint">
            {{ IMAGE_BACKEND_PRESETS[imageBackend].modelHint }}
          </span>
          <datalist :id="MODEL_DATALIST_ID">
            <option v-for="m in availableModels" :key="m" :value="m" />
          </datalist>
          <span v-if="availableModels.length > 0" class="model-hint">
            已获取 {{ availableModels.length }} 个模型，可在输入框中选择
          </span>
        </div>

        <!-- Temperature + maxTokens only for LLM category -->
        <div v-if="form.apiCategory === 'llm'" class="form-row">
          <div class="form-group form-group--half">
            <label class="form-label">温度 ({{ form.temperature }})</label>
            <input v-model.number="form.temperature" type="range" min="0" max="2" step="0.1" class="form-range" />
          </div>
          <div class="form-group form-group--half">
            <label class="form-label">最大 Tokens</label>
            <input v-model.number="form.maxTokens" type="number" min="100" class="form-input" />
          </div>
        </div>

        <!-- §11.3: Advanced — custom routing path (only for embedding/rerank) -->
        <details v-if="form.apiCategory === 'embedding' || form.apiCategory === 'rerank'" class="form-advanced">
          <summary>高级选项</summary>
          <div class="form-group">
            <label class="form-label">
              <input
                v-model="form.useCustomRouting"
                type="checkbox"
                class="form-checkbox"
              />
              使用自定义端点路径
            </label>
            <span class="form-hint">
              覆盖默认的
              <code>{{ form.apiCategory === 'rerank' ? '/v1/rerank' : '/v1/embeddings' }}</code>
              路径。仅在你的 provider 使用非标准路径时才需要。
            </span>
          </div>
          <div v-if="form.useCustomRouting" class="form-group">
            <label class="form-label">自定义路径</label>
            <input
              v-model="form.customRoutingPath"
              type="text"
              class="form-input"
              :placeholder="form.apiCategory === 'rerank' ? '/v1/rerank' : '/v1/embeddings'"
            />
          </div>
        </details>
      </div>
      <template #footer>
        <!-- CR-R3: 错误提示 + 禁用保存按钮 -->
        <span v-if="formValidationError" class="form-validation-error">
          {{ formValidationError }}
        </span>
        <div style="flex: 1" />
        <button class="btn-secondary" @click="showEditModal = false">取消</button>
        <button
          class="btn-primary"
          :disabled="!!formValidationError"
          :title="formValidationError ?? '保存配置'"
          @click="saveAPI"
        >
          保存
        </button>
      </template>
    </Modal>

    <!-- ─── Assignment Modal (B.1.3 → categorized) ─── -->
    <Modal v-model="showAssignModal" title="功能分配" width="620px">
      <div class="assign-content">
        <label class="assign-show-all">
          <input type="checkbox" v-model="showAllInAssign" />
          <span>显示全部 API（绕过类别过滤）</span>
          <span class="assign-show-all-hint">
            {{ showAllInAssign
              ? '已启用：下拉框显示所有 API，允许跨类别强制分配'
              : '默认：按任务类别过滤，防止误分配' }}
          </span>
        </label>

        <div v-for="cat in CATEGORY_ORDER" :key="cat" class="assign-group">
          <div class="assign-group-label">{{ ASSIGN_CATEGORY_META[cat].label }}</div>
          <span v-if="ASSIGN_CATEGORY_META[cat].hint" class="assign-group-hint">{{ ASSIGN_CATEGORY_META[cat].hint }}</span>
          <div class="assign-list">
            <div v-for="type in typesForCategory(cat)" :key="type" class="assign-row">
              <div class="assign-label-with-toggle">
                <button
                  v-if="isToggleable(type)"
                  role="switch"
                  :aria-checked="isFeatureEnabled(type)"
                  :class="['feature-toggle', { 'feature-toggle--on': isFeatureEnabled(type) }]"
                  :title="isFeatureEnabled(type) ? '已启用 — 点击关闭' : '已关闭 — 点击启用'"
                  @click="toggleFeature(type)"
                >
                  {{ isFeatureEnabled(type) ? '开' : '关' }}
                </button>
                <span
                  :class="['assign-label', { 'assign-label--disabled': isToggleable(type) && !isFeatureEnabled(type) }]"
                  :title="USAGE_TYPE_META[type].tip"
                >
                  {{ USAGE_TYPE_META[type].label }}
                  <span class="assign-tip-icon">?</span>
                </span>
              </div>
              <select
                class="assign-select"
                :disabled="isToggleable(type) && !isFeatureEnabled(type)"
                :value="getAssignedApiId(type)"
                @change="assignAPI(type, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="getAssignableAPIs(type).length === 0" value="">
                  — 暂无匹配类别的 API —
                </option>
                <option v-for="api in getAssignableAPIs(type)" :key="api.id" :value="api.id">
                  {{ api.name }}{{ !api.enabled ? ' (已禁用)' : '' }}{{ isApiCategoryMismatch(api, type) ? ' ⚠ 类别不匹配' : '' }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="showAssignModal = false">完成</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.api-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px var(--sidebar-right-reserve, 40px) 20px var(--sidebar-left-reserve, 40px);
  transition: padding-left var(--duration-open) var(--ease-droplet), padding-right var(--duration-open) var(--ease-droplet);
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text, #e0e0e6);
}

.header-actions {
  display: flex;
  gap: 8px;
}

/* ── API list ── */
.api-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.api-card {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
  transition: opacity 0.15s ease;
}
.api-card--disabled {
  opacity: 0.5;
}

.api-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.api-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* ── Status dot (B.1.1) ── */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot--idle    { background: var(--color-text-secondary, #6b7280); }
.status-dot--testing { background: var(--color-amber-400); animation: pulse 1s infinite; }
.status-dot--ok      { background: var(--color-success); }
.status-dot--error   { background: var(--color-danger); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

.latency-badge {
  font-size: 0.65rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--color-success, #22c55e);
  background: color-mix(in oklch, var(--color-success) 10%, transparent);
  padding: 1px 6px;
  border-radius: 8px;
}

.api-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-text, #e0e0e6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-provider {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 8px;
  color: var(--color-primary, #6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border-radius: 8px;
  text-transform: uppercase;
  flex-shrink: 0;
}

/* §11.3: API 类别 badge — 三色主题（LLM 紫 / Embedding 蓝 / Rerank 金） */
.api-category-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
  flex-shrink: 0;
  letter-spacing: 0.03em;
}
.api-category-badge--llm {
  color: var(--color-primary, #6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
}
.api-category-badge--embedding {
  color: var(--color-sage-300);
  background: color-mix(in oklch, var(--color-sage-300) 15%, transparent);
}
.api-category-badge--rerank {
  color: var(--color-amber-400);
  background: color-mix(in oklch, var(--color-amber-400) 15%, transparent);
}

.api-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.toggle-btn {
  padding: 2px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.15s ease;
}
.toggle-btn--on {
  color: var(--color-success, #22c55e);
  border-color: color-mix(in oklch, var(--color-success) 30%, transparent);
  background: color-mix(in oklch, var(--color-success) 8%, transparent);
}

.api-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
  margin-bottom: 10px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.detail-label {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  min-width: 28px;
  flex-shrink: 0;
}

.detail-value {
  font-size: 0.78rem;
  color: var(--color-text, #e0e0e6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-value--mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.72rem;
}

.api-footer {
  display: flex;
  gap: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding-top: 10px;
}

/* ── Small buttons ── */
.btn-sm {
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-sm:hover:not(:disabled) {
  color: var(--color-text, #e0e0e6);
  border-color: var(--color-primary, #6366f1);
}
.btn-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-sm--danger:hover:not(:disabled) {
  color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
  background: color-mix(in oklch, var(--color-danger) 8%, transparent);
}
.btn-sm--testing {
  color: var(--color-warning, #f59e0b) !important;
  border-color: color-mix(in oklch, var(--color-amber-400) 30%, transparent) !important;
}

/* ── AI Generation Settings (B.1.4) ── */
.ai-settings-section {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 10px;
}

.settings-title {
  margin: 0 0 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #8888a0);
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text, #e0e0e6);
}

.setting-desc {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
}

.toggle-switch {
  flex-shrink: 0;
  padding: 3px 14px;
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 52px;
}
.toggle-switch--on {
  color: var(--color-success, #22c55e);
  border-color: color-mix(in oklch, var(--color-success) 30%, transparent);
  background: color-mix(in oklch, var(--color-success) 8%, transparent);
}

.retry-input {
  width: 60px;
  padding: 4px 8px;
  font-size: 0.85rem;
  text-align: center;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  outline: none;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.retry-input:focus { border-color: var(--color-primary, #6366f1); }

/* ── Edit form ── */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group--half {
  flex: 1;
}

.form-row {
  display: flex;
  gap: 14px;
}

.form-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-secondary, #8888a0);
}

.form-input {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  outline: none;
  font-family: inherit;
}
.form-input:focus { border-color: var(--color-primary, #6366f1); }

.form-range {
  width: 100%;
  accent-color: var(--color-primary, #6366f1);
}

/* ── Model input (B.1.2) ── */
.model-input-row {
  display: flex;
  gap: 8px;
}

.model-input {
  flex: 1;
}

.btn-fetch-models {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-primary, #6366f1);
  background: color-mix(in oklch, var(--color-sage-400) 10%, transparent);
  border: 1px solid color-mix(in oklch, var(--color-sage-400) 30%, transparent);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.btn-fetch-models:hover:not(:disabled) {
  background: color-mix(in oklch, var(--color-sage-400) 20%, transparent);
}
.btn-fetch-models:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-hint {
  font-size: 0.72rem;
  color: var(--color-success, #22c55e);
  opacity: 0.8;
}

/* §11.3: form-hint — 说明文本（灰色，带 code 内嵌） */
.form-hint {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  margin-top: 4px;
  line-height: 1.5;
}
.form-hint code {
  padding: 1px 5px;
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-radius: 3px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.7rem;
  color: var(--color-primary, #6366f1);
}

/* §11.3: 三选一类别 segment */
.category-segment {
  display: flex;
  gap: 0;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 8px;
  overflow: hidden;
}
.category-segment__btn {
  flex: 1;
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--color-border, #2a2a3a);
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.category-segment__btn:last-child { border-right: none; }
.category-segment__btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text, #e0e0e6);
}
.category-segment__btn--active {
  background: color-mix(in oklch, var(--color-sage-400) 15%, transparent);
  color: var(--color-primary, #6366f1);
}
.category-segment__btn--active:hover {
  background: color-mix(in oklch, var(--color-sage-400) 20%, transparent);
}

/* §11.3: 高级选项折叠区 */
.form-advanced {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--color-border, #2a2a3a);
  border-radius: 6px;
}
.form-advanced > summary {
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #8888a0);
  user-select: none;
}
.form-advanced[open] > summary {
  margin-bottom: 8px;
  color: var(--color-text, #e0e0e6);
}
.form-checkbox {
  margin-right: 6px;
  vertical-align: middle;
}

/* ── Assignment (B.1.3) ── */
.assign-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* CR-R11: 显示全部 API 开关行 */
.assign-show-all {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--color-bg-secondary, #2a2a3e);
  border: 1px solid var(--color-border, #44445a);
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  user-select: none;
}
.assign-show-all input[type="checkbox"] {
  cursor: pointer;
}
.assign-show-all-hint {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  margin-left: auto;
}

.assign-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.assign-group-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-secondary, #8888a0);
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

/* §11.3: RAG 分组说明提示 */
.assign-group-hint {
  font-size: 0.72rem;
  color: var(--color-text-secondary, #8888a0);
  opacity: 0.8;
  padding: 4px 0;
  line-height: 1.5;
}
.assign-group-hint code {
  padding: 1px 5px;
  background: color-mix(in oklch, var(--color-sage-400) 12%, transparent);
  border-radius: 3px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.7rem;
  color: var(--color-primary, #6366f1);
}

.assign-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.assign-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  gap: 12px;
}

.assign-label-with-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feature-toggle {
  padding: 1px 8px;
  font-size: 0.68rem;
  font-weight: 700;
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary, #8888a0);
  cursor: pointer;
  transition: all 0.12s ease;
  min-width: 30px;
}
.feature-toggle--on {
  color: var(--color-success, #22c55e);
  border-color: color-mix(in oklch, var(--color-success) 30%, transparent);
  background: color-mix(in oklch, var(--color-success) 6%, transparent);
}

.assign-label {
  font-size: 0.82rem;
  color: var(--color-text, #e0e0e6);
  transition: opacity 0.15s ease;
}

.assign-label--disabled {
  opacity: 0.4;
}

.assign-select {
  padding: 4px 8px;
  font-size: 0.78rem;
  color: var(--color-text, #e0e0e6);
  background: var(--color-bg, #0f0f14);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 5px;
  min-width: 150px;
  transition: opacity 0.15s ease;
}
.assign-select:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.assign-tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--color-text-secondary, #8888a0);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  margin-left: 4px;
  opacity: 0.5;
  transition: opacity 0.15s ease;
  vertical-align: middle;
  cursor: help;
}
.assign-label:hover .assign-tip-icon {
  opacity: 1;
}

/* ── Buttons ── */
.btn-primary {
  padding: 6px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-bone);
  background: var(--color-primary, #6366f1);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.btn-primary:hover:not(:disabled) { background: var(--color-primary-hover, #4f46e5); }
.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* CR-R3: 表单校验错误提示（显示在 modal footer 左侧） */
.form-validation-error {
  font-size: 0.75rem;
  color: var(--color-danger, #ef4444);
  align-self: center;
  opacity: 0.9;
}

.btn-secondary {
  padding: 6px 14px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-text-secondary, #8888a0);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, #2a2a3a);
  border-radius: 6px;
  cursor: pointer;
}
.btn-secondary:hover { color: var(--color-text, #e0e0e6); border-color: var(--color-primary, #6366f1); }

/* ── Empty ── */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  color: var(--color-text-secondary, #8888a0);
  font-size: 0.88rem;
}

/* ── Scrollbar ── */
.api-panel::-webkit-scrollbar { width: 5px; }
.api-panel::-webkit-scrollbar-track { background: transparent; }
.api-panel::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--color-text-umber) 35%, transparent); border-radius: 3px; }
</style>
