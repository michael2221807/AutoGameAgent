/**
 * SystemPromptBuilder — replaces PromptAssembler with MRJH-style context piece architecture.
 *
 * Builds named context pieces from game state + prompts + world book,
 * then assembles them into ordered message entries for the API call.
 *
 * Reference: MRJH hooks/useGame/systemPromptBuilder.ts (1598 lines)
 *            MRJH hooks/useGame/mainStoryRequest.ts (message assembly)
 *
 * Phase 1: Skeleton with piece definitions and build interface.
 * Phase 2 (Sprint 2): Full implementation of all formatters.
 */
import type { StateManager } from '../core/state-manager';
import type {
  MessageEntry,
  SystemPromptBuildResult,
  WorldBook,
  BuiltinPromptEntry,
  PromptSettings,
} from './world-book';
import { formatHeroinePlanForContext, type HeroinePlan } from '../story/heroine-plan';
import { DEFAULT_PROMPT_SETTINGS } from './world-book';
import { BUILTIN_SLOTS } from './builtin-slots';
import type { EnginePathConfig } from '../pipeline/types';

/** Parameters for building the system prompt */
export interface SystemPromptBuildParams {
  stateManager: StateManager;
  paths: EnginePathConfig;
  /** Pack prompt content by ID (loaded from manifest.prompts) */
  packPrompts: Record<string, string>;
  /** User-edited built-in prompt overrides */
  builtinOverrides: BuiltinPromptEntry[];
  /** User world books (enabled only) */
  worldBooks: WorldBook[];
  /** Current user input for this round */
  userInput: string;
  /** Player name (for template rendering) */
  playerName: string;
  /** Whether CoT is enabled */
  cotEnabled: boolean;
  /** Whether CoT judge is enabled */
  cotJudgeEnabled: boolean;
  /** Whether split-gen mode is active */
  splitGen: boolean;
  /** CoT masquerade pseudo-history prompt */
  cotPseudoEnabled: boolean;
  /** Pre-built engram/unified retrieval block (if hybrid mode active) */
  engramRetrievalBlock?: string;
  /** Implicit mid-term memory entries (from MemoryRetriever) */
  implicitMidTermBlock?: string;
}

/**
 * Resolve the effective content for a built-in slot.
 *
 * Priority: user override (from builtinOverrides) > pack default > empty
 */
function resolveSlotContent(
  slotId: string,
  builtinOverrides: BuiltinPromptEntry[],
  packPrompts: Record<string, string>,
): string {
  // 1. Check user override
  const override = builtinOverrides.find((e) => e.slotId === slotId && e.enabled !== false);
  if (override?.userContent != null && override.userContent.trim()) {
    return override.userContent;
  }

  // 2. Check pack default
  const slotDef = BUILTIN_SLOTS[slotId];
  if (slotDef?.defaultPromptId && packPrompts[slotDef.defaultPromptId]) {
    return packPrompts[slotDef.defaultPromptId];
  }

  // 3. Check override content (non-user-edited)
  if (override?.content?.trim()) {
    return override.content;
  }

  return '';
}

/**
 * Render template variables in prompt content.
 * Supports ${playerName} and {{VAR}} syntax.
 */
function renderTemplateVars(content: string, vars: Record<string, string>): string {
  let rendered = content;
  // ${var} syntax (MRJH style)
  rendered = rendered.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  // {{VAR}} syntax (AGA style)
  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  return rendered;
}

/**
 * Estimate token count for a string.
 * Rough: Chinese chars / 2, English chars / 4, average to chars / 3.
 */
/**
 * Step 3: Apply writing settings — inject word count into write_req prompts.
 * Matches MRJH 应用写作设置.
 */
function applyWritingSettings(promptId: string, content: string, wordCount: number): string {
  if (promptId !== 'write_req' && promptId !== 'wordCountReq') return content;
  const lengthRule = `<字数>本次<正文>标签内内容必须达到${wordCount}字以上。</字数>`;
  // Replace existing <字数> block if present
  if (/<字数>[\s\S]*?<\/字数>/m.test(content)) {
    return content.replace(/<字数>[\s\S]*?<\/字数>/m, lengthRule);
  }
  return `${content.trim()}\n${lengthRule}`;
}

/**
 * Step 5: Filter by feature toggles — strip PROMPT_FEATURE blocks based on settings.
 * Matches MRJH 按功能开关过滤提示词内容 + 解析功能附加块.
 *
 * Feature blocks are HTML comments: <!-- PROMPT_FEATURE:xxx:START -->...<!-- PROMPT_FEATURE:xxx:END -->
 * If the feature is disabled, the block is removed entirely.
 */
function filterByFeatureToggles(content: string, settings: PromptSettings): string {
  const featureBlockRegex = /<!--\s*PROMPT_FEATURE:([a-z0-9_-]+):START\s*-->([\s\S]*?)<!--\s*PROMPT_FEATURE:\1:END\s*-->/giu;

  const isFeatureEnabled = (featureId: string): boolean => {
    switch (featureId.toLowerCase()) {
      case 'nocontrol': return settings.enableNoControl;
      case 'action_options': return settings.enableActionOptions;
      default: return true; // unknown features default to enabled
    }
  };

  let result = content;
  let previous = '';
  // Iterative replacement (handles nested blocks)
  while (result !== previous) {
    previous = result;
    result = result.replace(featureBlockRegex, (_match, featureId: string, body: string) =>
      isFeatureEnabled(featureId) ? body.trim() : ''
    );
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Full rendering pipeline for a prompt — matches MRJH's 5-step chain:
 * 1. Slot override resolution (done by resolveSlotContent)
 * 2. Template variable replacement
 * 3. Writing settings application (word count)
 * 4. (Realm block replacement — N/A in AGA)
 * 5. Feature toggle filtering
 */
function renderPromptPipeline(
  slotId: string,
  rawContent: string,
  vars: Record<string, string>,
  settings: PromptSettings,
): string {
  if (!rawContent.trim()) return '';
  let content = renderTemplateVars(rawContent, vars);
  content = applyWritingSettings(slotId, content, settings.wordCountRequirement);
  content = filterByFeatureToggles(content, settings);
  return content;
}

/** Estimate token count (rough: chars / 3 average for mixed CJK + English) */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/**
 * Build the system prompt as ordered message entries.
 *
 * This is the MAIN entry point. It:
 * 1. Resolves all built-in slot content (with world book overrides)
 * 2. Reads game state to build dynamic context pieces (NPC, world, player, etc.)
 * 3. Applies prompt settings (perspective, word count)
 * 4. Assembles into ordered MessageEntry[] matching MRJH's message structure
 */
export function buildSystemPrompt(params: SystemPromptBuildParams): SystemPromptBuildResult {
  const {
    stateManager,
    paths,
    packPrompts,
    builtinOverrides,
    worldBooks,
    userInput,
    playerName,
    cotEnabled,
    cotJudgeEnabled,
    cotPseudoEnabled,
  } = params;

  const templateVars: Record<string, string> = {
    playerName,
    wordCount: String(params.stateManager.get<number>('系统.设置.prompt.wordCountRequirement') ?? 650),
  };

  console.debug('[SystemPromptBuilder] Pack prompts available:', Object.keys(packPrompts).length, Object.keys(packPrompts));

  // Read prompt settings from state tree
  const rawSettings = stateManager.get<Partial<PromptSettings>>('系统.设置.prompt');
  const settings: PromptSettings = { ...DEFAULT_PROMPT_SETTINGS, ...rawSettings };

  // Helper to resolve + render a slot through the full MRJH-style 5-step pipeline
  const slot = (slotId: string): string => {
    const raw = resolveSlotContent(slotId, builtinOverrides, packPrompts);
    return renderPromptPipeline(slotId, raw, templateVars, settings);
  };

  // Helper to render a raw pack prompt through the pipeline (for prompts not tied to a slot)
  const renderPackPrompt = (promptId: string): string => {
    const raw = packPrompts[promptId] ?? '';
    return renderPromptPipeline(promptId, raw, templateVars, settings);
  };

  // ── Build context pieces ──────────────────────────────────

  const contextPieces: Record<string, string> = {};
  const entries: MessageEntry[] = [];

  const push = (id: string, title: string, category: string, role: 'system' | 'user' | 'assistant', content: string, options?: { isUserInput?: boolean }) => {
    const trimmed = (content || '').trim();
    if (!trimmed) return;
    contextPieces[id] = trimmed;
    entries.push({ id, title, category, role, content: trimmed, isUserInput: options?.isUserInput });
  };

  // ── 1. AI Role Declaration ──
  push('ai_role', 'AI角色声明', '系统', 'system', slot('narrator_role'));

  // ── 2. World Prompt (world info + world book lore) ──
  const worldInfo = stateManager.get<Record<string, unknown>>('世界.信息');
  const worldName = (worldInfo?.['世界名称'] ?? '') as string;
  const worldDesc = (worldInfo?.['世界背景'] ?? worldInfo?.['描述'] ?? '') as string;
  const worldLore = worldBooks
    .filter((b) => b.enabled !== false)
    .flatMap((b) => b.entries.filter((e) => e.enabled !== false && e.type === 'world_lore' && e.injectionMode === 'always'))
    .map((e) => e.content)
    .join('\n\n');
  const worldPrompt = [
    worldName ? `世界名称：${worldName}` : '',
    worldDesc ? `\n世界总览\n${worldDesc}` : '',
    worldLore,
  ].filter(Boolean).join('\n\n');
  push('world_prompt', '世界观提示词', '系统', 'system', worldPrompt);

  // ── 3. Map & Buildings ──
  const locationInfo = stateManager.get<unknown[]>('世界.地点信息');
  const currentLocation = stateManager.get<string>(paths.playerLocation) ?? '';
  if (Array.isArray(locationInfo) && locationInfo.length > 0) {
    const mapText = `【地图与建筑】\n当前具体地点: ${currentLocation}\n地图列表:\n${locationInfo.map((l) => `- ${JSON.stringify(l)}`).join('\n')}`;
    push('world_map', '地图与建筑', '系统', 'system', mapText);
  }

  // ── 4. Off-scene NPCs ──
  const relationships = stateManager.get<Array<Record<string, unknown>>>(paths.relationships) ?? [];
  const npcNameKey = paths.npcFieldNames?.name ?? '名称';
  const offSceneNpcs = relationships.filter((npc) => npc['是否在场'] !== true);
  if (offSceneNpcs.length > 0) {
    const offSceneText = `【以下为不在场角色】(源于社交)\n${offSceneNpcs.map((npc, i) => {
      const name = npc[npcNameKey] ?? '?';
      const gender = npc['性别'] ?? '';
      const relation = npc['与玩家关系'] ?? '';
      const affinity = npc['好感度'] ?? 50;
      const desc = npc['描述'] ?? '';
      const isMajor = npc['是否主要角色'] ? '是' : '否';
      return `- [${i}] 姓名: ${name}\n  性别: ${gender}\n  关系状态: ${relation}\n  好感度: ${affinity}\n  简介: ${String(desc).slice(0, 100)}\n  是否主要角色: ${isMajor}`;
    }).join('\n')}`;
    push('npc_away', '以下为不在场角色', '系统', 'system', offSceneText);
  }

  // ── 5. Other Prompts (world book system_rule entries with scope=main) ──
  const otherPrompts = worldBooks
    .filter((b) => b.enabled !== false)
    .flatMap((b) => b.entries.filter((e) =>
      e.enabled !== false &&
      e.type === 'system_rule' &&
      e.injectionMode === 'always' &&
      (e.scope.includes('main') || e.scope.includes('all'))
    ))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((e) => renderPromptPipeline(e.id, e.content, templateVars, settings))
    .join('\n\n');
  push('other_prompts', '叙事/规则提示词', '系统', 'system', otherPrompts);

  // ── 5b. Writing prompts (style, emotion guard, noControl) ──
  push('write_style', '写作文风', '系统', 'system', slot('write_style'));
  push('write_emotion_guard', '避免极端情绪', '系统', 'system', slot('write_emotion_guard'));
  if (settings.enableNoControl) {
    push('write_no_control', '禁止操控玩家', '系统', 'system', slot('write_no_control'));
  }

  // ── 6. Perspective Prompt ──
  const perspectiveMap: Record<string, string> = {
    '第一人称': 'write_perspective_first',
    '第二人称': 'write_perspective_second',
    '第三人称': 'write_perspective_third',
  };
  const perspectiveSlotId = perspectiveMap[settings.perspective] ?? 'write_perspective_second';
  push('perspective_prompt', '叙事人称提示词', '系统', 'system', slot(perspectiveSlotId));

  // ── 7. Word Count ──
  const wordCountContent = slot('write_req') ||
    `【字数要求】\n<字数>本次<正文>标签内内容必须达到${settings.wordCountRequirement}字以上。</字数>\n- 正文指 \`<正文>\` 中除【判定】外的叙事与对白总和。`;
  push('length_prompt', '字数要求提示词', '系统', 'system', wordCountContent);

  // ── 8. Long-term Memory ──
  const longTerm = stateManager.get<Array<{ content: string; category?: string }>>('记忆.长期') ?? [];
  if (longTerm.length > 0) {
    const longText = `【长期记忆】\n${longTerm.map((e) => `${e.category ? `[${e.category}] ` : ''}${e.content}`).join('\n')}`;
    push('memory_long', '长期记忆', '记忆', 'system', longText);
  } else {
    push('memory_long', '长期记忆', '记忆', 'system', '【长期记忆】\n暂无');
  }

  // ── 9. Mid-term Memory ──
  const midTerm = stateManager.get<Array<Record<string, unknown>>>('记忆.中期') ?? [];
  if (midTerm.length > 0) {
    const midText = `【中期记忆】\n${midTerm.map((e) => {
      const roles = Array.isArray(e['相关角色']) ? `【相关角色: ${(e['相关角色'] as string[]).join('、')}】` : '';
      const time = e['事件时间'] ? `【${e['事件时间']}】` : '';
      const body = e['记忆主体'] ?? '';
      return `${roles}${time}${body}`;
    }).join('\n')}`;
    push('memory_mid', '中期记忆', '记忆', 'system', midText);
  } else {
    push('memory_mid', '中期记忆', '记忆', 'system', '【中期记忆】\n暂无');
  }

  // ── 9b. Implicit Mid-term Memory ──
  if (params.implicitMidTermBlock?.trim()) {
    push('memory_implicit', '隐式中期记忆', '记忆', 'system', `【隐式记忆（AI 标记）】\n${params.implicitMidTermBlock}`);
  }

  // ── 9c. Engram / Unified Retrieval ──
  if (params.engramRetrievalBlock?.trim()) {
    push('memory_engram', '语义记忆检索', '记忆', 'system', `# 统一记忆检索\n${params.engramRetrievalBlock}`);
  }

  // ── 10. Story Plan ──
  const storyPlan = stateManager.get<string>(paths.storyPlan) ?? '';
  push('story_plan', '剧情安排', '系统', 'system',
    storyPlan ? `【剧情安排】\n${storyPlan}` : '【剧情安排】\n暂无');

  // ── 11. On-scene NPCs ──
  const onSceneNpcs = relationships.filter((npc) => npc['是否在场'] === true);
  if (onSceneNpcs.length > 0) {
    const onSceneText = `【以下为在场角色】(源于社交)\n${onSceneNpcs.map((npc, i) => {
      const name = npc[npcNameKey] ?? '?';
      const gender = npc['性别'] ?? '';
      const identity = npc['身份'] ?? npc['描述'] ?? '';
      const relation = npc['与玩家关系'] ?? '';
      const affinity = npc['好感度'] ?? 50;
      const desc = npc['描述'] ?? '';
      const personality = Array.isArray(npc['性格特征']) ? (npc['性格特征'] as string[]).join('、') : '';
      const isMajor = npc['是否主要角色'] ? '是' : '否';
      const memory = Array.isArray(npc['记忆']) ? (npc['记忆'] as Array<string | Record<string, unknown>>).slice(-3).map((m) => typeof m === 'string' ? m : (m as Record<string, unknown>)['内容'] ?? m).join('\n    ') : '';
      return `- [${i}] 姓名: ${name}\n  性别: ${gender}\n  身份: ${identity}\n  关系状态: ${relation}\n  好感度: ${affinity}\n  简介: ${String(desc).slice(0, 200)}\n  核心性格特征: ${personality}\n  是否主要角色: ${isMajor}${memory ? `\n  记忆 (最近3条):\n    ${memory}` : ''}`;
    }).join('\n')}`;
    push('npc_present', '以下为在场角色', '系统', 'system', onSceneText);
  }

  // ── 12. Heroine Plan (uses structured formatter) ──
  const heroinePlanRaw = stateManager.get<HeroinePlan>('元数据.女主规划');
  if (heroinePlanRaw) {
    const formattedPlan = formatHeroinePlanForContext(heroinePlanRaw);
    if (formattedPlan) {
      push('heroine_plan', '女主剧情规划', '系统', 'system', formattedPlan);
    }
  }

  // ── 13. World State ──
  const worldState = stateManager.get<unknown>('世界.状态');
  if (worldState && typeof worldState === 'object') {
    const ws = worldState as Record<string, unknown>;
    const parts = [];
    if (ws['天气']) parts.push(`天气: ${JSON.stringify(ws['天气'])}`);
    if (ws['事件']) parts.push(`世界事件: ${JSON.stringify(ws['事件'])}`);
    push('state_world', '世界', '系统', 'system',
      parts.length > 0 ? `【世界】\n${parts.join('\n')}` : '【世界】\n无');
  }

  // ── 14. Environment State ──
  const gameTime = stateManager.get<unknown>('元数据.时间');
  const environment = stateManager.get<unknown>('世界.状态.环境');
  const envParts = [];
  if (gameTime) envParts.push(`时间: ${JSON.stringify(gameTime)}`);
  envParts.push(`当前位置: ${currentLocation}`);
  if (environment) envParts.push(`环境: ${JSON.stringify(environment)}`);
  push('state_environment', '当前环境', '系统', 'system', `【当前环境】\n${envParts.join('\n')}`);

  // ── 15. Player State ──
  const playerIdentity = stateManager.get<Record<string, unknown>>('角色.基础信息') ?? {};
  const playerAttrs = stateManager.get<Record<string, unknown>>('角色.属性');
  const playerBody = stateManager.get<unknown>('角色.身体');
  const playerEffects = stateManager.get<unknown>('角色.效果');
  const roleParts = [];
  roleParts.push(`姓名: ${playerName}`);
  if (playerIdentity['性别']) roleParts.push(`性别: ${playerIdentity['性别']}`);
  if (playerIdentity['年龄']) roleParts.push(`年龄: ${playerIdentity['年龄']}`);
  if (playerIdentity['描述']) roleParts.push(`描述: ${playerIdentity['描述']}`);
  if (playerAttrs) roleParts.push(`属性: ${JSON.stringify(playerAttrs)}`);
  if (playerBody) roleParts.push(`身体: ${JSON.stringify(playerBody)}`);
  if (playerEffects) roleParts.push(`效果: ${JSON.stringify(playerEffects)}`);
  push('state_role', '用户角色数据', '系统', 'system', `【用户角色数据】\n${roleParts.join('\n')}`);

  // ── 16. (Sect removed — not in AGA scope per user directive) ──

  // ── 17. Task List ──
  const tasks = stateManager.get<unknown[]>('社交.任务');
  push('state_tasks', '任务列表', '系统', 'system',
    Array.isArray(tasks) && tasks.length > 0 ? `【任务列表】\n${JSON.stringify(tasks, null, 2)}` : '【任务列表】\n无');

  // ── 18. Agreement List ──
  const agreements = stateManager.get<unknown[]>('社交.约定');
  push('state_agreements', '约定列表', '系统', 'system',
    Array.isArray(agreements) && agreements.length > 0 ? `【约定列表】\n${JSON.stringify(agreements, null, 2)}` : '【约定列表】\n无');

  // ── 19. Short-term Memory (即时剧情回顾) — returned separately ──
  const shortTerm = stateManager.get<Array<{ summary: string; round?: number }>>('记忆.短期') ?? [];
  const shortMemoryContext = shortTerm.length > 0
    ? `【即时剧情回顾】\n${shortTerm.map((e) => typeof e === 'string' ? e : (e.summary ?? '')).join('\n')}`
    : '';

  // ── 20. Narrative Constraints + Story Style (radio group: one active at a time) ──
  const constraintsBase = slot('narrative_constraints');
  const storyStyleMap: Record<string, string> = {
    general: 'storyStyleGeneral',
    harem: 'storyStyleHarem',
    pureLove: 'storyStylePureLove',
    cultivation: 'storyStyleCultivation',
    shura: 'storyStyleShura',
    ntlHarem: 'storyStyleNtlHarem',
  };
  const stylePromptId = storyStyleMap[settings.storyStyle] ?? 'storyStyleGeneral';
  const styleContent = renderPackPrompt(stylePromptId);
  const fullConstraints = [constraintsBase, styleContent ? `\n\n【剧情风格偏好】\n${styleContent}` : ''].filter(Boolean).join('');
  push('narrative_constraints', '叙事总约束 + 风格偏好', '系统', 'system', fullConstraints);

  // ── 21. Extra Prompt ──
  if (settings.customSystemPrompt?.trim()) {
    push('extra_prompt', '额外要求提示词', '用户', 'user', settings.customSystemPrompt.trim());
  }

  // ── 22. Format/Output Protocol ──
  push('format_prompt', '输出格式提示词', '系统', 'system', slot('format_prompt'));

  // ── 23. CoT ──
  if (cotEnabled) {
    push('cot_core', 'COT提示词', '系统', 'system', slot('main_cot'));
    if (cotJudgeEnabled) {
      push('cot_judge', '判定COT提示词', '系统', 'system', slot('main_cot_judge'));
    }
  }

  // ── 24. Player Input (as assistant message, MRJH style) ──
  push('player_input', '最新用户输入', '助手', 'assistant',
    `以下是用户最新输入内容：\n<用户输入>${userInput}</用户输入>`,
    { isUserInput: true });

  // ── 25. Start Task (as user message) ──
  push('start_task', '开始任务', '用户', 'user', '开始任务');

  // ── 26. CoT Masquerade (as assistant prefill) ──
  if (cotEnabled && cotPseudoEnabled) {
    push('cot_masquerade', 'COT伪装历史消息', '助手', 'assistant', slot('cot_masquerade'));
  }

  // ── Build runtime prompt states ──
  const runtimePromptStates: Record<string, boolean> = {};
  for (const [key] of Object.entries(BUILTIN_SLOTS)) {
    runtimePromptStates[key] = !!contextPieces[key];
  }

  return {
    contextPieces,
    messageEntries: entries,
    shortMemoryContext,
    runtimePromptStates,
  };
}
