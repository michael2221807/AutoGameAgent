/**
 * 应用入口 — 引擎初始化序列
 *
 * 启动流程（按依赖顺序）：
 * 1. Vue + Pinia + Router
 * 2. API 配置加载 → AIService
 * 3. 持久化层（ProfileManager → SaveManager）
 * 4. 配置系统（Registry + Store + Resolver）
 * 5. Game Pack 加载
 * 6. Prompt 引擎（PromptRegistry + TemplateEngine + PromptAssembler + ResponseParser）
 * 7. StateManager / CommandExecutor / BehaviorRunner / CharacterInitPipeline
 * 8. PromptStorage / VectorStore / BackupService（M5 备份与 Engram 持久化）
 * 9. Action Queue 恢复
 * 10. provide → 挂载
 */
import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './ui/router';
import './ui/styles/tokens.css';

// Apply persisted font-size × ui-scale before any component renders so the
// user's preference survives page refresh regardless of which route they
// land on. SettingsPanel owns the source of truth; this is a cold-boot
// replay of what SettingsPanel.applyRootMetrics does.
(function applyPersistedRootMetrics(): void {
  try {
    const raw = localStorage.getItem('aga_user_settings');
    const scaleRaw = localStorage.getItem('aga_ui_scale');
    const parsed = raw ? (JSON.parse(raw) as { fontSize?: number; themeAccent?: string }) : {};
    const fontPx = typeof parsed.fontSize === 'number' ? parsed.fontSize : 14;
    const scalePct = scaleRaw ? Number(scaleRaw) : 100;
    const rootPx = (fontPx * scalePct) / 100;
    document.documentElement.style.fontSize = `${rootPx}px`;
    document.documentElement.style.setProperty('--base-font-size', `${fontPx}px`);
    document.documentElement.style.setProperty('--narrative-font-size', `${fontPx}px`);
    document.documentElement.style.setProperty('--ui-scale', `${scalePct}%`);
    if (typeof parsed.themeAccent === 'string') {
      document.documentElement.style.setProperty('--color-primary', parsed.themeAccent);
    }
  } catch { /* localStorage unavailable — skip silently */ }
})();

import { eventBus } from './engine/core/event-bus';
import { GamePackLoader } from './engine/core/pack-loader';
import { ConfigRegistry, ConfigStore, ConfigResolver } from './engine/core/config-system';
import { StateManager } from './engine/core/state-manager';
import { CommandExecutor } from './engine/core/command-executor';
import { BehaviorRunner } from './engine/behaviors/behavior-runner';
import { AIService } from './engine/ai/ai-service';
import { ResponseParser } from './engine/ai/response-parser';
import { PromptRegistry } from './engine/prompt/prompt-registry';
import { TemplateEngine } from './engine/prompt/template-engine';
import { PromptAssembler } from './engine/prompt/prompt-assembler';
import { CharacterInitPipeline } from './engine/pipeline/sub-pipelines/character-init';
import { MemorySummaryPipeline } from './engine/pipeline/sub-pipelines/memory-summary';
import { MidTermRefinePipeline } from './engine/pipeline/sub-pipelines/mid-term-refine';
import { LongTermCompactPipeline } from './engine/pipeline/sub-pipelines/long-term-compact';
import { WorldHeartbeatPipeline } from './engine/pipeline/sub-pipelines/world-heartbeat';
import { NpcGenerationPipeline } from './engine/pipeline/sub-pipelines/npc-generation';
import { PrivacyProfileRepairPipeline } from './engine/pipeline/sub-pipelines/privacy-profile-repair';
import { FieldRepairPipeline } from './engine/pipeline/sub-pipelines/field-repair';
import { PlotEvaluationPipeline } from './engine/plot/plot-evaluation-pipeline';
import { PlotDecomposer } from './engine/plot/plot-decomposer';
import { NpcMemorySummarizer } from './engine/social/npc-memory-summarizer';
import { ImageService } from './engine/image/image-service';
import { ImageProviderRegistry } from './engine/image/provider-registry';
import { NovelAIImageProvider } from './engine/image/providers/novelai';
import { OpenAIImageProvider } from './engine/image/providers/openai';
import { SDWebUIImageProvider } from './engine/image/providers/sd-webui';
import { ComfyUIImageProvider } from './engine/image/providers/comfyui';
import { migrateImageState } from './engine/image/save-migration';
import { NpcChatPipeline } from './engine/pipeline/sub-pipelines/npc-chat';
import { DEFAULT_ENGINE_PATHS } from './engine/pipeline/types';
import { setBootstrapGamePack } from './engine/bootstrap-pack';
import { TimeService } from './engine/behaviors/time-service';
import { MemoryCompilerModule } from './engine/behaviors/memory-compiler';
import { ComputedFieldsModule } from './engine/behaviors/computed-fields';
import { EffectLifecycleModule } from './engine/behaviors/effect-lifecycle';
import { ThresholdTriggersModule } from './engine/behaviors/threshold-triggers';
import { NpcBehaviorModule } from './engine/behaviors/npc-behavior';
import { ValidationRepairModule } from './engine/behaviors/validation-repair';
import { ContentFilterModule } from './engine/behaviors/content-filter';
import { CrossRefSyncModule } from './engine/behaviors/cross-ref-sync';
import { GameOrchestrator } from './engine/core/game-orchestrator';
import { MemoryManager } from './engine/memory/memory-manager';
import { MemoryRetriever } from './engine/memory/memory-retriever';
import { EngramManager } from './engine/memory/engram/engram-manager';
import { useEngineStateStore } from './engine/stores/engine-state';
import type { ComputedFieldConfig, ThresholdTriggerConfig, IntegrityRule, EffectLifecycleConfig, NpcBehaviorConfig, ContentFilterConfig } from './engine/types';

import { ProfileManager } from './engine/persistence/profile-manager';
import { SaveManager } from './engine/persistence/save-manager';
import { BackupService } from './engine/persistence/backup-service';
import { ImageAssetCache } from './engine/image/asset-cache';
import { PromptStorage } from './engine/prompt/prompt-storage';
import { VectorStore } from './engine/memory/engram/vector-store';
import { CustomPresetStore } from './engine/persistence/custom-preset-store';
import { AssistantService } from './engine/services/assistant/assistant-service';
import { UnifiedRetriever } from './engine/memory/engram/unified-retriever';
import { Embedder } from './engine/memory/engram/embedder';
import { Reranker } from './engine/memory/engram/reranker';
import { useEngramDebugStore } from './engine/stores/engram-debug';

import { useActionQueueStore } from './engine/stores/engine-action-queue';
import { useAPIManagementStore } from './engine/stores/engine-api';

async function bootstrap(): Promise<void> {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);
  app.use(router);

  const apiStore = useAPIManagementStore();
  apiStore.loadFromStorage();

  const aiService = new AIService();
  aiService.setConfigs([...apiStore.apiConfigs]);
  aiService.setAssignments([...apiStore.apiAssignments]);

  // ── CR-7 fix: 从 localStorage 恢复 AI 生成设置到 aiService ──
  // APIPanel 在 B.1.4 中将 maxRetries 持久化到 'aga_ai_settings'，
  // 但仅在用户主动保存时同步到 aiService。此处在启动时补做一次同步。
  try {
    const savedAISettings = JSON.parse(localStorage.getItem('aga_ai_settings') ?? '{}') as Record<string, unknown>;
    if (typeof savedAISettings.maxRetries === 'number') {
      aiService.maxRetries = savedAISettings.maxRetries;
    }
  } catch { /* localStorage 不可用时静默忽略 */ }

  // ── #9: 响应式同步 API 配置变更到 AIService ──
  // 用户在 APIPanel 修改配置后，store 更新，watch 立即同步到 AIService 实例，
  // 无需刷新页面。必须在 pinia 激活后 (app.use(pinia) 之后) 调用 watch。
  watch(() => apiStore.apiConfigs, (configs) => {
    aiService.setConfigs([...configs]);
  }, { deep: true });
  watch(() => apiStore.apiAssignments, (assignments) => {
    aiService.setAssignments([...assignments]);
  }, { deep: true });

  const profileManager = new ProfileManager();
  await profileManager.initialize();
  const saveManager = new SaveManager(profileManager);

  const configRegistry = new ConfigRegistry();
  const configStore = new ConfigStore();
  const configResolver = new ConfigResolver(configRegistry, configStore);

  const promptStorage = new PromptStorage();
  const vectorStore = new VectorStore();
  // 2026-04-14：用户自定义创角预设仓库（按 packId 隔离）
  const customPresetStore = new CustomPresetStore();
  const imageAssetCacheForBackup = new ImageAssetCache();
  const backupService = new BackupService(
    profileManager,
    saveManager,
    configStore,
    promptStorage,
    vectorStore,
    customPresetStore,
    imageAssetCacheForBackup,
  );

  const packLoader = new GamePackLoader();
  let pack = null;
  try {
    pack = await packLoader.load('tianming');
    setBootstrapGamePack(pack);
  } catch (err) {
    console.warn('[Bootstrap] Game Pack load failed:', err);
    setBootstrapGamePack(null);
  }

  // §5.2 GAP fix：把当前 pack 版本传给 SaveManager，启用 schema 迁移链
  // SaveManager.loadGame 会在读旧存档时按 slotMeta.packVersion 与此值比较，
  // 有差异且 migrationRegistry 有对应迁移则链式应用。未来新增迁移时在本行
  // 之后（或独立的 `registerMigrations()` 模块中）调 `migrationRegistry.register(...)`。
  if (pack?.manifest.version) {
    saveManager.setCurrentPackVersion(pack.manifest.version);
  }

  const promptRegistry = new PromptRegistry();
  if (pack) {
    for (const [id, content] of Object.entries(pack.prompts)) {
      promptRegistry.register({
        id,
        content,
        enabled: true,
      });
    }
  }

  // Hydrate registry from localStorage overrides (PromptPanel persists edits there)
  if (pack) {
    const packId = pack.manifest.id;
    for (const id of Object.keys(pack.prompts)) {
      const userContent = localStorage.getItem(`aga_prompt_${packId}_${id}`);
      if (userContent !== null) promptRegistry.setUserContent(id, userContent);
      const enabledRaw = localStorage.getItem(`aga_prompt_enabled_${packId}_${id}`);
      if (enabledRaw === 'false') promptRegistry.setEnabled(id, false);
    }
  }

  const templateEngine = new TemplateEngine();
  const responseParser = new ResponseParser();
  const promptAssembler = new PromptAssembler(promptRegistry, templateEngine);

  const stateManager = new StateManager();

  // §11.4: 从 pack.stateSchema 动态提取顶层 properties 作为 CommandExecutor 的路径根白名单
  // 这能让 AI 生成的写入路径在运行时被检测为未知根段（console.warn + toast）
  // 零硬编码：pack 更换或 schema 扩充时自动适配
  const schemaRoots: string[] | null = pack
    ? Object.keys(
        ((pack.stateSchema as { properties?: Record<string, unknown> }).properties) ?? {},
      )
    : null;
  const commandExecutor = new CommandExecutor(stateManager, schemaRoots);

  const behaviorRunner = new BehaviorRunner();

  // ── #21: 注册行为模块 ──
  // TimeService：推进游戏内时间进位（年/月/日 归一化）
  behaviorRunner.register(new TimeService(
    {
      minutesPerHour: 60,
      hoursPerDay: 24,
      daysPerMonth: 30,
      monthsPerYear: 12,
      timeFieldPath: DEFAULT_ENGINE_PATHS.gameTime,
      timeFieldFormat: { 年: 'number', 月: 'number', 日: 'number' },
    },
    DEFAULT_ENGINE_PATHS.characterAge,
  ));

  // ── #3: 将 Pinia tree 绑定到 StateManager 的 reactive 对象 ──
  // 必须在 createPinia() 之后、任何 UI 读取状态之前调用。
  // 绑定后 StateManager 的所有写操作自动反映到 Vue 响应式系统。
  const engineStateStore = useEngineStateStore();
  engineStateStore.linkStateManager(stateManager);

  // ── #2: 实例化记忆服务 ──
  //
  // 2026-04-11 重构（四层记忆系统）：
  // - shortTermCapacity = 5（降低自 8，match demo + design note）
  // - midTermRefineThreshold = 25（in-place 精炼阈值）
  // - longTermSummaryThreshold = 50（worldview evolution 阈值）
  // - 隐式中期和短期 1:1 配对，由 MemoryManager.shiftAndPromoteOldest 同步 shift
  // - MemoryRetriever 现在依赖 MemoryManager 做隐式中期的相关角色过滤
  const memoryPathConfig = {
    shortTermPath: '记忆.短期',
    midTermPath: '记忆.中期',
    longTermPath: '记忆.长期',
    implicitMidTermPath: '记忆.隐式中期',
    semanticMemoryPath: DEFAULT_ENGINE_PATHS.engramMemory,
    // 默认值 —— 可被 localStorage `aga_memory_settings` 运行时覆盖（SettingsPanel UI）
    shortTermCapacity: 5,
    midTermRefineThreshold: 25,
    longTermSummaryThreshold: 50,
    longTermSummarizeCount: 50,
    midTermKeep: 0,
    longTermCap: 30,
  };
  const memoryManager = new MemoryManager(stateManager, memoryPathConfig);
  const memoryRetriever = new MemoryRetriever(memoryPathConfig, memoryManager);

  // MemoryCompilerModule：在上下文组装阶段将结构化记忆注入 prompt 变量
  behaviorRunner.register(new MemoryCompilerModule(memoryManager));

  // ── GAP_AUDIT §G1: 注册剩余行为模块（读 pack.rules 的 JSON 配置） ──
  //
  // 注册顺序依赖：
  // 1. TimeService 必须在 EffectLifecycle 之前（effect 的过期判断依赖已归一化的时间）
  // 2. ComputedFields 宜在 TimeService 之后（衍生字段可能引用时间相关值）
  // 3. ValidationRepair 最后，在其他模块可能产生的"修复机会"之后执行收尾校验
  //
  // 所有模块 config 来自 Game Pack 的 rules/*.json，
  // 不存在时模块不注册（引擎不强制依赖 pack 内容）。
  if (pack) {
    const rules = pack.rules as Record<string, unknown>;

    // ComputedFields — onCreation / onRoundEnd / onLoad 计算派生字段
    const computedConfig = rules['computedFields'] as { fields?: ComputedFieldConfig[] } | undefined;
    if (computedConfig?.fields?.length) {
      behaviorRunner.register(new ComputedFieldsModule(computedConfig.fields));
    }

    // EffectLifecycle — onRoundEnd / onGameLoad 清理过期 buff/debuff
    const effectConfig = rules['effectLifecycle'] as EffectLifecycleConfig | undefined;
    if (effectConfig?.effectsPath && effectConfig.effectSchema) {
      behaviorRunner.register(new EffectLifecycleModule(
        effectConfig,
        {
          minutesPerHour: 60,
          hoursPerDay: 24,
          daysPerMonth: 30,
          monthsPerYear: 12,
          timeFieldPath: DEFAULT_ENGINE_PATHS.gameTime,
          timeFieldFormat: { 年: 'number', 月: 'number', 日: 'number', 小时: 'number', 分钟: 'number' },
        },
      ));
    }

    // ThresholdTriggers — onRoundEnd / onGameLoad 检查阈值触发事件
    const triggerConfig = rules['thresholdTriggers'] as { triggers?: ThresholdTriggerConfig[] } | undefined;
    if (triggerConfig?.triggers?.length) {
      behaviorRunner.register(new ThresholdTriggersModule(triggerConfig.triggers));
    }

    // NpcBehavior — afterCommands 钩子中处理玩家移动时的 NPC 跟随/留守
    const npcConfig = rules['npcBehavior'] as NpcBehaviorConfig | undefined;
    if (npcConfig?.npcTypes) {
      behaviorRunner.register(new NpcBehaviorModule(
        npcConfig,
        {
          playerLocation: DEFAULT_ENGINE_PATHS.playerLocation,
          npcList: DEFAULT_ENGINE_PATHS.npcList, // 已修正为 '社交.关系'
        },
      ));
    }

    // ContentFilter — onContextAssembly 钩子中按 nsfwMode 等评级开关剥离 prompt 中的敏感片段
    const filterConfig = rules['contentFilter'] as ContentFilterConfig | undefined;
    if (filterConfig?.contentRatings) {
      behaviorRunner.register(new ContentFilterModule(filterConfig));
    }

    // CrossRefSync — afterCommands 钩子中维护 NPC.位置 ↔ 地点.NPC 列表双向一致
    const syncConfig = rules['crossRefSync'] as { rules?: IntegrityRule[] } | undefined;
    if (syncConfig?.rules?.length) {
      behaviorRunner.register(new CrossRefSyncModule(syncConfig.rules));
    }

    // ValidationRepair — 最后注册，在其他模块执行完后做收尾的 schema 校验与字段修复
    // 不依赖 rules/*.json，直接读 pack.stateSchema
    behaviorRunner.register(new ValidationRepairModule(pack.stateSchema));
  }

  // E.4: 使用真实 EngramManager 代替之前的 stub
  // 配置从 localStorage (aga_engram_config) 读取，默认 enabled=false。
  // 用户在 Settings → Engram 开关后，下一回合立即生效，无需重启。
  //
  // getActiveSlot: Engram 向量存储需要 profileId+slotId 构建 IndexedDB key。
  // 这两个值是引擎元数据（存在于 Pinia store），不在游戏状态树中。
  // 旧版本从 stateManager.get('元数据.profileId') 读取 —— 该路径从未被写入，
  // 导致 vectorizeAsync 永远 early return，embedding API 从不被调用。
  const getActiveSlot = () => {
    const p = engineStateStore.activeProfileId;
    const s = engineStateStore.activeSlotId;
    return p && s ? { profileId: p, slotId: s } : null;
  };
  const engramManager = new EngramManager(aiService, undefined, getActiveSlot);

  // E.2/E.3: UnifiedRetriever 实例（hybrid 模式时由 ContextAssemblyStage 使用）
  const embedder = new Embedder(aiService);
  const reranker = new Reranker(aiService);
  const engramDebugStore = useEngramDebugStore();
  const unifiedRetriever = new UnifiedRetriever(
    vectorStore,
    embedder,
    reranker,
    () => {
      const cfg = engramManager.getConfig();
      return { embedding: cfg.embedding, rerank: cfg.rerank };
    },
    engramDebugStore,
    getActiveSlot,
  );

  let characterInitPipeline: CharacterInitPipeline | null = null;
  if (pack) {
    characterInitPipeline = new CharacterInitPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      saveManager,
      profileManager,
      behaviorRunner,
      pack,
      DEFAULT_ENGINE_PATHS,
      memoryManager, // §C1: 开场叙事写入短期记忆 → 第一回合 MEMORY_BLOCK 非空
    );
  }

  // ── GAP_AUDIT §G2: 实例化 4 个后置子管线 ──
  // 这些管线由 GameOrchestrator.runRound 在主回合结束后按条件触发：
  // - MemorySummary: 短期记忆满 → 总结为一条中期记忆条目
  // - MidTermRefine: 中期记忆满 → 精炼为长期记忆条目
  // - WorldHeartbeat: 到达心跳周期 → 为候选 NPC 更新状态
  // - NpcGeneration: 玩家移动到新地点 → 生成 1-3 个 NPC
  let memorySummaryPipeline: MemorySummaryPipeline | undefined;
  let midTermRefinePipeline: MidTermRefinePipeline | undefined;
  let longTermCompactPipeline: LongTermCompactPipeline | undefined;
  let worldHeartbeatPipeline: WorldHeartbeatPipeline | undefined;
  let npcGenerationPipeline: NpcGenerationPipeline | undefined;
  let privacyRepairPipeline: PrivacyProfileRepairPipeline | undefined;
  let fieldRepairPipeline: FieldRepairPipeline | undefined;
  let npcMemSummarizer: NpcMemorySummarizer | undefined;

  if (pack) {
    memorySummaryPipeline = new MemorySummaryPipeline(
      aiService,
      responseParser,
      promptAssembler,
      memoryManager,
      pack,
      stateManager, // 2026-04-11: worldview evolution 需要读游戏状态概要
      DEFAULT_ENGINE_PATHS, // 2026-04-11 CR M-09: 路径从 config 读，不再硬编码
    );
    midTermRefinePipeline = new MidTermRefinePipeline(
      aiService,
      responseParser,
      promptAssembler,
      memoryManager,
      pack,
    );
    longTermCompactPipeline = new LongTermCompactPipeline(
      aiService,
      responseParser,
      promptAssembler,
      memoryManager,
      pack,
    );
    worldHeartbeatPipeline = new WorldHeartbeatPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      pack,
      DEFAULT_ENGINE_PATHS,
    );
    npcGenerationPipeline = new NpcGenerationPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      pack,
      DEFAULT_ENGINE_PATHS,
    );
    // Phase 4 (2026-04-19): Body polish was promoted from sub-pipeline to
    // `BodyPolishStage` inside the main pipeline (see game-orchestrator.ts).
    // The old `BodyPolishPipeline` sub-pipeline construction was removed from here.

    // Sprint Social-5: NPC memory summarizer
    npcMemSummarizer = new NpcMemorySummarizer(
      stateManager,
      aiService,
      promptAssembler,
      DEFAULT_ENGINE_PATHS,
    );

    privacyRepairPipeline = new PrivacyProfileRepairPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      pack,
      DEFAULT_ENGINE_PATHS,
    );

    fieldRepairPipeline = new FieldRepairPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      memoryRetriever,
      pack,
      DEFAULT_ENGINE_PATHS,
    );
  }

  // Sprint Plot-1 P4: PlotEvaluationPipeline — 剧情节点评估
  let plotEvaluationPipeline: PlotEvaluationPipeline | undefined;
  let plotDecomposer: PlotDecomposer | undefined;
  if (pack) {
    plotEvaluationPipeline = new PlotEvaluationPipeline(
      stateManager,
      DEFAULT_ENGINE_PATHS,
    );
    plotDecomposer = new PlotDecomposer(
      aiService,
      responseParser,
      stateManager,
      pack,
      DEFAULT_ENGINE_PATHS,
    );
  }

  // §7.2 NPC 私聊子管线 — 独立于主回合的异步 1:1 对话
  // 通过 app.provide 暴露给 UI 层（RelationshipPanel / NpcChatModal）
  let npcChatPipeline: NpcChatPipeline | null = null;
  if (pack) {
    npcChatPipeline = new NpcChatPipeline(
      stateManager,
      commandExecutor,
      aiService,
      responseParser,
      promptAssembler,
      pack,
      DEFAULT_ENGINE_PATHS,
      memoryManager,
    );
  }

  // ── Image subsystem bootstrap (must be before orchestrator which references imageService) ──
  const imageProviderRegistry = new ImageProviderRegistry();
  imageProviderRegistry.register('novelai', (c) => new NovelAIImageProvider(c.endpoint, c.apiKey, c.model));
  imageProviderRegistry.register('openai', (c) => new OpenAIImageProvider(c.endpoint, c.apiKey, c.model));
  imageProviderRegistry.register('sd_webui', (c) => new SDWebUIImageProvider(c.endpoint, c.apiKey, c.model));
  imageProviderRegistry.register('comfyui', (c) => new ComfyUIImageProvider(c.endpoint, c.apiKey, c.model));

  const imageService = new ImageService(
    stateManager,
    aiService,
    promptAssembler,
    imageProviderRegistry,
    DEFAULT_ENGINE_PATHS,
  );

  migrateImageState(stateManager);

  // ── #1: 创建 Orchestrator，接通 pipeline:user-input → PipelineRunner ──
  let orchestrator: GameOrchestrator | null = null;
  if (pack) {
    orchestrator = new GameOrchestrator(
      stateManager,
      commandExecutor,
      behaviorRunner,
      aiService,
      responseParser,
      promptAssembler,
      memoryManager,
      memoryRetriever,
      engramManager,
      saveManager,
      pack,
      DEFAULT_ENGINE_PATHS,
      unifiedRetriever, // E.2/E.3: hybrid 检索路径
      {                 // §G2 + §11.2 B: 子管线包
        memorySummary: memorySummaryPipeline,
        midTermRefine: midTermRefinePipeline,
        longTermCompact: longTermCompactPipeline, // 2026-04-11 新增：长期二级精炼
        worldHeartbeat: worldHeartbeatPipeline,
        npcGeneration: npcGenerationPipeline,
        privacyRepair: privacyRepairPipeline,
        fieldRepair: fieldRepairPipeline,
        npcMemorySummarizer: npcMemSummarizer,
        imageService,
        memoryManager,
        paths: DEFAULT_ENGINE_PATHS,
        plotEvaluation: plotEvaluationPipeline,
      },
    );
  }

  const actionQueueStore = useActionQueueStore();
  actionQueueStore.loadFromLocalStorage();

  app.provide('profileManager', profileManager);
  app.provide('saveManager', saveManager);
  app.provide('promptStorage', promptStorage);
  if (plotDecomposer) app.provide('plotDecomposer', plotDecomposer);
  app.provide('imageService', imageService);
  app.provide('vectorStore', vectorStore);
  app.provide('embedder', embedder);
  app.provide('backupService', backupService);
  app.provide('customPresetStore', customPresetStore);

  // ── 2026-04-14：AI 助手 service ──
  // 复用现有 aiService（按 usageType='assistant' 路由 API 配置）。
  // 启动时 setSettings 从 localStorage 读 maxHistoryTurns 等。
  let assistantSettings = {
    maxHistoryTurns: 5,
    confirmBeforeInject: true,
    confirmBeforeClear: true,
  };
  try {
    const raw = localStorage.getItem('aga_assistant_settings');
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.maxHistoryTurns === 'number') assistantSettings.maxHistoryTurns = parsed.maxHistoryTurns;
      if (typeof parsed.confirmBeforeInject === 'boolean') assistantSettings.confirmBeforeInject = parsed.confirmBeforeInject;
      if (typeof parsed.confirmBeforeClear === 'boolean') assistantSettings.confirmBeforeClear = parsed.confirmBeforeClear;
    }
  } catch { /* ignore */ }
  const assistantService = new AssistantService({
    aiService,
    stateManager,
    commandExecutor,
    gamePack: pack,
    settings: assistantSettings,
  });
  app.provide('assistantService', assistantService);
  app.provide('configRegistry', configRegistry);
  app.provide('configResolver', configResolver);
  app.provide('eventBus', eventBus);
  app.provide('aiService', aiService);
  app.provide('stateManager', stateManager);
  app.provide('promptAssembler', promptAssembler);
  app.provide('promptRegistry', promptRegistry);
  app.provide('responseParser', responseParser);

  if (pack) {
    app.provide('gamePack', pack);
  }
  if (characterInitPipeline) {
    app.provide('characterInitPipeline', characterInitPipeline);
  }
  if (orchestrator) {
    app.provide('gameOrchestrator', orchestrator);
  }
  if (npcChatPipeline) {
    // §7.2: 注入 NPC 私聊管线，供 RelationshipPanel / NpcChatModal 使用
    app.provide('npcChatPipeline', npcChatPipeline);

    // ── CR-R7: 读档/创角完成后对所有 NPC 的 `私聊历史` 做一次性回溯性 trim ──
    // 场景：旧存档里 `私聊历史` 数组可能超过当前 maxChatHistory（例如 pack 调低了上限，
    // 或从未 trim 过的历史积累）。StateManager.loadTree 完成时 emit 'engine:state-changed'
    // type='load'，此时一次性收敛。运行时的增量 trim 已在 NpcChatPipeline.execute 内处理。
    const pipelineForTrim = npcChatPipeline;
    eventBus.on<{ type?: string }>('engine:state-changed', (payload) => {
      if (payload?.type === 'load') {
        pipelineForTrim.trimAllChatHistories();
      }
    });
  }

  app.mount('#app');
  eventBus.emit('engine:initialized', { packId: pack?.manifest.id ?? null });
}

bootstrap().catch(console.error);
