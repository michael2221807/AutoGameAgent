/**
 * 上下文组装阶段 — 将游戏状态、记忆、行为模块输出组装为 AI 消息列表
 *
 * E.2 升级：
 * - 接收 engramManager 和 unifiedRetriever 依赖
 * - 当 engram.enabled && retrievalMode='hybrid' 时用 UnifiedRetriever 替换 legacy memoryRetriever
 * - legacy 路径：memoryRetriever.retrieve(stateManager)（传统关键词检索）
 *
 * 对应 STEP-03B M3.4 ContextAssemblyStage。
 */
import type {
  PipelineStage,
  PipelineContext,
  IMemoryRetriever,
  IBehaviorRunner,
  IEngramManager,
  IUnifiedRetriever,
  EnginePathConfig,
} from '../types';
import type { AIMessage } from '../../ai/types';
import type { GamePack } from '../../types';
import type { StateManager } from '../../core/state-manager';
import type { PromptAssembler } from '../../prompt/prompt-assembler';
import { eventBus } from '../../core/event-bus';
import { stringifySnapshotForPrompt, stripTagFromMessages, NSFW_STRIP_TAG } from '../../memory/snapshot-sanitizer';
import { loadShortTermInjectionSettings } from '../../memory/memory-manager';
import { NpcPresenceService } from '../../social/npc-presence';
import { NpcContextRenderer } from '../../social/npc-context-renderer';
import { buildSystemPrompt } from '../../prompt/system-prompt-builder';
import { buildEnvironmentBlock } from '../../prompt/environment-block';
import { PlotInjector } from '../../plot/plot-injector';
import type { WorldBook, BuiltinPromptEntry } from '../../prompt/world-book';

/** 状态树中叙事历史条目的结构 — 从 "元数据.叙事历史" 读取 */
interface NarrativeEntry {
  role: string;
  content: string;
}

export class ContextAssemblyStage implements PipelineStage {
  name = 'ContextAssembly';

  constructor(
    private stateManager: StateManager,
    private promptAssembler: PromptAssembler,
    private memoryRetriever: IMemoryRetriever,
    private behaviorRunner: IBehaviorRunner,
    private pack: GamePack,
    private paths: EnginePathConfig,
    /** E.2: Engram 管理器，用于读取当前检索配置 */
    private engramManager?: IEngramManager,
    /** E.2: 统一检索器，hybrid 模式时使用 */
    private unifiedRetriever?: IUnifiedRetriever,
    /** World book: user-created world books (loaded at init) */
    private worldBooks?: WorldBook[],
    /** World book: user overrides of built-in prompts */
    private builtinOverrides?: BuiltinPromptEntry[],
    /** Whether to use the new MRJH-style builder (default: false for backward compat) */
    private useNewBuilder?: boolean,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    // ── 1. 冻结状态树快照 ──
    const stateSnapshot = this.stateManager.toSnapshot();

    // ── 2. 检查世界事件触发 ──
    const worldEventTriggered = this.behaviorRunner.checkScheduledEvents(this.stateManager);

    // ── 3. 记忆检索（E.2：按 retrievalMode 选择检索路径） ──
    // 参照 ming: 短期记忆单独作为 assistant 消息注入 chat history (depth=2)
    // MEMORY_BLOCK 只包含中期/长期/隐式中期（避免重复注入短期）
    const memoryBlock = await this.retrieveMemory(ctx.userInput, ctx);

    // 读取短期记忆用于单独注入（参照 ming: 短期记忆作为独立 assistant 消息注入 chat history 末端）
    // 路径来自 memoryPathConfig，默认 '记忆.短期'
    const shortTermEntries = this.stateManager.get<Array<{ summary: string; round?: number }>>(
      '记忆.短期'
    ) ?? [];
    const shortTermText = shortTermEntries.length > 0
      ? `# 【最近事件】\n${shortTermEntries.map((e) => typeof e === 'string' ? e : (e.summary ?? '')).join('\n')}。根据这刚刚发生的文本事件，合理生成下一次文本信息，要保证衔接流畅、不断层，符合上文的文本信息`
      : '';

    // ── 4. 构建模板变量 ──
    // ── NSFW 脱敏 — §11.2 C ──
    // nsfwMode=false 时从发给 AI 的 JSON 快照剥离 私密信息 和 角色.身体，
    // 原始状态树保持不变（存档完整，UI 可继续显示）。
    const nsfwMode = this.stateManager.get<boolean>('系统.nsfwMode') === true;
    // 2026-04-11 token 节省：
    // 1. 去重：叙事历史 / 记忆 / engramMemory / 上次对话前快照 **无条件**从 JSON 剥离
    //    （它们通过 chatHistory + MEMORY_BLOCK 等专用渠道独立注入，不应再在
    //     GAME_STATE_JSON 里重复）
    // 2. 紧凑：indent=0 去掉 JSON 缩进空白，单回合 prompt 可节省数千 token
    // 见 `snapshot-sanitizer.ts` 的 `PROMPT_ALWAYS_STRIP_PATHS` 注释。
    const gameStateJson = stringifySnapshotForPrompt(stateSnapshot, nsfwMode, 0);

    // ── 4a. 行动选项模式 (bugfix 2026-04-11) ──
    //
    // User report：剧情导向和行为导向 prompt 应不一样，demo 有实现，但正式版里
    // `actionOptions.md` / `actionOptionsStory.md` 俩 prompt 存在却从未被任何 flow
    // 加载，且 SettingsPanel 的 mode/pace setting 只存 localStorage，pipeline 看不见。
    //
    // 修复策略：
    //   1. SettingsPanel 把 mode/pace/customPrompt 同步写到状态树 `系统.actionOptions.*`
    //   2. 此处读取后派生出条件变量 `ACTION_OPTIONS_MODE_IS_ACTION` / `_IS_STORY`
    //   3. main-round.json 和 split-gen-main-round-step2.json 用 `condition` 字段
    //      按模式动态加载 `actionOptions` 或 `actionOptionsStory` prompt 模块
    //   4. `ACTION_PACE_HINT` / `CUSTOM_ACTION_PROMPT` 作为模板变量供 prompt 内部引用
    //
    // Fallback：状态树未设置时默认 'action' + 'fast'（保持之前的行为导向行为）
    const actionMode = (this.stateManager.get<string>('系统.actionOptions.mode') ?? 'action') as 'action' | 'story';
    const actionPace = (this.stateManager.get<string>('系统.actionOptions.pace') ?? 'fast') as 'fast' | 'slow';
    const customActionPrompt = this.stateManager.get<string>('系统.actionOptions.customPrompt') ?? '';

    const paceHint = actionPace === 'slow'
      ? '## 节奏提示\n\n当前节奏为**慢节奏**：倾向于生成更细腻、更思考性的选项，鼓励观察、对话、深度互动；避免催促性的推进动作。'
      : '## 节奏提示\n\n当前节奏为**快节奏**：倾向于生成推进剧情的选项，鼓励明确的行动和决策；避免纯观察或等待。';

    // ── NPC Presence (Sprint Social-2) — read flag, render present/absent blocks ──
    const presenceEnabled = this.stateManager.get<boolean>('系统.设置.social.presenceEnabled') === true;
    let npcPresentBlock = '';
    let npcAbsentBlock = '';
    if (presenceEnabled) {
      const presenceSvc = new NpcPresenceService(this.stateManager, this.paths);
      const renderer = new NpcContextRenderer(presenceSvc, this.paths);
      const split = renderer.renderSplit();
      npcPresentBlock = split.presentBlock;
      npcAbsentBlock = split.absentBlock;
    }

    // ── CoT flags (Sprint CoT-2) — read once, freeze into ctx.meta ──
    const cotEnabled = this.stateManager.get<boolean>('系统.设置.cot.enabled') === true;
    const cotJudgeEnabled = cotEnabled && this.stateManager.get<boolean>('系统.设置.cot.judgeEnabled') === true;
    const cotInjectStep2 = cotEnabled && this.stateManager.get<boolean>('系统.设置.cot.injectStep2') !== false;
    console.debug('[ContextAssembly] CoT flags:', { cotEnabled, cotJudgeEnabled, cotInjectStep2 });
    console.debug('[ContextAssembly] Short-term entries:', shortTermEntries.length, 'Memory block length:', memoryBlock.length);

    const reasoningHistory = cotEnabled
      ? (this.stateManager.get<string[]>(this.paths.reasoningHistory) ?? [])
      : [];
    const prevThinking = reasoningHistory.length > 0
      ? reasoningHistory[reasoningHistory.length - 1]
      : '';

    const storyPlanRaw = cotEnabled
      ? (this.stateManager.get<string>(this.paths.storyPlan) ?? '')
      : '';
    const prevStoryPlan = storyPlanRaw;

    // ── Environment tags (P2 env-tags port, 2026-04-19) ──
    //
    // Build the `【当前环境】` block from 世界.天气 / 世界.节日 / 世界.环境.
    // The same data is already inside GAME_STATE_JSON (P0 sanitizer guards
    // them), but an explicit section with plain-language formatting raises
    // AI attention. Also forwarded to `ctx.meta.environmentBlock` so
    // BodyPolishStage can inject it into the polish user message as a
    // read-only reference (polish must not contradict active weather).
    const environmentBlock = buildEnvironmentBlock({
      weather: this.stateManager.get<unknown>(this.paths.weather),
      festival: this.stateManager.get<unknown>(this.paths.festival),
      environment: this.stateManager.get<unknown>(this.paths.environmentTags),
    });

    const variables: Record<string, string> = {
      PLAYER_NAME: this.stateManager.get<string>(this.paths.playerName) ?? '',
      CURRENT_LOCATION: this.stateManager.get<string>(this.paths.playerLocation) ?? '',
      GAME_STATE_JSON: gameStateJson,
      MEMORY_BLOCK: memoryBlock,
      WORLD_EVENT_CONTEXT: worldEventTriggered
        ? (ctx.meta['worldEventContext'] as string | undefined) ?? ''
        : '',
      USER_INPUT: ctx.userInput,

      // Action options wiring — 条件变量 + 内容注入
      ACTION_OPTIONS_MODE: actionMode,
      ACTION_OPTIONS_MODE_IS_ACTION: actionMode === 'action' ? '1' : '',
      ACTION_OPTIONS_MODE_IS_STORY: actionMode === 'story' ? '1' : '',
      ACTION_OPTIONS_PACE: actionPace,
      ACTION_PACE_HINT: paceHint,
      CUSTOM_ACTION_PROMPT: customActionPrompt
        ? `## 自定义附加要求\n\n${customActionPrompt}`
        : '',

      // ── CoT plugin variables (Sprint CoT-2) ──
      // Flag frozen at context-assembly time → downstream stages read from ctx.meta
      COT_ENABLED: cotEnabled ? '1' : '',
      COT_DISABLED: cotEnabled ? '' : '1',
      COT_JUDGE_ENABLED: cotJudgeEnabled ? '1' : '',
      COT_INJECT_STEP2_ENABLED: cotInjectStep2 ? '1' : '',
      PREV_THINKING: prevThinking,
      PREV_STORY_PLAN: prevStoryPlan,

      // ── NPC Presence plugin variables (Sprint Social-2) ──
      NPC_PRESENCE_ENABLED: presenceEnabled ? '1' : '',
      NPC_PRESENT_BLOCK: npcPresentBlock,
      NPC_ABSENT_BLOCK: npcAbsentBlock,

      // ── Environment tags plugin variable (P2 env-tags port 2026-04-19) ──
      ENVIRONMENT_BLOCK: environmentBlock,
    };

    // ── 4.5 Plot Direction System variables (Sprint Plot-1 P2) ──
    {
      const plotEnabled = this.stateManager.get<boolean>('系统.设置.plot.enabled');
      if (plotEnabled !== false) {
        const splitGen = ctx.meta['splitGen'] === true;
        const plotVars = splitGen
          ? PlotInjector.buildStep1Variables(this.stateManager, this.paths)
          : PlotInjector.buildAllVariables(this.stateManager, this.paths);
        Object.assign(variables, plotVars);
      }
    }

    // ── 5. 行为模块：上下文组装阶段钩子 ──
    this.behaviorRunner.runOnContextAssembly(this.stateManager, variables);

    // ── 6. 从状态树读取叙事历史 → AIMessage[] ──
    //
    // 2026-04-11 强化：给每条 history 消息包一层 XML 标签。
    //
    // 原因：demo 的 chat history 里 assistant 消息存的是**完整 raw JSON 输出**
    // （包含 text + commands + mid_term_memory + action_options），模型看自己
    // 的历史能立即感知到"我之前一直是这个格式"—— few-shot 效应下新回合也会
    // 保持同样格式。
    //
    // AutoGameAgent 为了节省存档体积，只存 `parsedResponse.text`（纯叙事
    // 文本），这破坏了 few-shot 信号。模型看历史会怀疑"之前的 assistant 没
    // 输 JSON，我也不用输"，导致格式漂移。
    //
    // 之前已用 `historyFraming.md` 系统提示词**显式解释**这个现象，但那是
    // "软"信号 —— 模型可能被历史里的隐式格式盖过。此处再加一层 XML 包装
    // 作为**双重约束**：
    //   user:      <玩家输入>...</玩家输入>
    //   assistant: <叙事正文>...</叙事正文>
    //
    // 这样模型看到的 few-shot 模式是"user 发 <玩家输入> tag，assistant 回
    // <叙事正文> tag"—— 显而易见的结构。再配合 historyFraming 明确声明
    // "你本回合仍须输出完整 JSON 而非单独的叙事 tag"，最终 AI 的输出：
    //   {
    //     "text": "<content matches previous 叙事正文 style>",
    //     "commands": [...], "action_options": [...], "mid_term_memory": ...
    //   }
    //
    // 存档里 narrativeHistory 仍然是纯文本，包装只在 prompt assembly 时发生，
    // 不影响 UI 展示和存档体积。
    const narrativeHistory =
      this.stateManager.get<NarrativeEntry[]>(this.paths.narrativeHistory) ?? [];

    // ── 2026-04-14：按用户选择的注入模式裁剪 chatHistory ──
    //
    // 两种模式（`aga_memory_settings.shortTermInjectionStyle`）：
    //
    // A) `single_assistant_block`（Demo 风格 / 极省 token）：
    //    完全清空 chatHistory，旧回合叙事全部通过 MEMORY_BLOCK 内的短期记忆压缩块
    //    （`记忆.短期`）注入。最终 messages = system + user = 2 条（+ 中期/长期注入）。
    //
    // B) `few_shot_pairs`（推荐默认 / 保留 few-shot 信号）：
    //    保留最近 N 对 (user, assistant)；更早历史依赖 MEMORY_BLOCK 内短期记忆。
    //    messages = system + 2×N + user 条。N 默认 3。
    //
    // 旧版本行为（无裁剪）等价于 fewShotPairs = +∞，在长回合游戏中会爆 token。
    const injection = loadShortTermInjectionSettings();

    const wrap = (m: NarrativeEntry): AIMessage => {
      const role = m.role as AIMessage['role'];
      let wrapped = m.content;
      if (role === 'user') {
        wrapped = `<玩家输入>\n${m.content}\n</玩家输入>`;
      } else if (role === 'assistant') {
        wrapped = `<叙事正文>\n${m.content}\n</叙事正文>`;
      }
      return { role, content: wrapped };
    };

    let chatHistory: AIMessage[];
    if (injection.injectionStyle === 'single_assistant_block') {
      // 模式 A：不带任何历史轮次，全部交给 MEMORY_BLOCK 中的短期记忆压缩块
      chatHistory = [];
    } else {
      // 模式 B：保留最近 N 对 (user, assistant)；假设历史中 user / assistant 严格交替
      // 从尾部向前取 2N 条即可（超过起点则截断）
      const keepCount = injection.fewShotPairs * 2;
      const tail = narrativeHistory.slice(-keepCount);
      chatHistory = tail.map(wrap);
    }

    // ── 7. Prompt 组装 ──
    const splitGen = ctx.meta.splitGen === true;

    let messages: AIMessage[];
    let messageSources: string[];
    let splitStep2Messages: AIMessage[] | undefined;
    let splitStep2Sources: string[] | undefined;

    if (this.useNewBuilder) {
      // ═══ NEW PATH: MRJH-style SystemPromptBuilder ═══
      // Produces ~26 individually named system messages + user input + masquerade
      // Read implicit mid-term for the builder
      const implicitMidRaw = this.stateManager.get<unknown[]>('记忆.隐式中期') ?? [];
      const implicitMidBlock = implicitMidRaw
        .filter((e): e is Record<string, unknown> => e != null && typeof e === 'object' && !Array.isArray(e))
        .filter((e) => e['记忆主体'] && String(e['记忆主体']).trim())
        .map((e) => {
          const time = e['事件时间'] ? `[${e['事件时间']}] ` : '';
          return `${time}${e['记忆主体']}`;
        })
        .join('\n');

      // memoryBlock from retrieveMemory() — if hybrid mode, this is the unified retrieval result
      // We pass it as engramRetrievalBlock so the builder includes it
      const buildResult = buildSystemPrompt({
        stateManager: this.stateManager,
        paths: this.paths,
        packPrompts: this.pack.prompts,
        builtinOverrides: this.builtinOverrides ?? [],
        worldBooks: this.worldBooks ?? [],
        userInput: ctx.userInput,
        playerName: this.stateManager.get<string>(this.paths.playerName) ?? '',
        cotEnabled,
        cotJudgeEnabled,
        splitGen,
        cotPseudoEnabled: cotEnabled,
        engramRetrievalBlock: memoryBlock, // Pass the full memory retrieval result
        implicitMidTermBlock: implicitMidBlock,
      });

      // Convert MessageEntry[] → AIMessage[]
      messages = buildResult.messageEntries.map((e) => ({
        role: e.role as AIMessage['role'],
        content: e.content,
      }));
      messageSources = buildResult.messageEntries.map((e) => `builder:${e.id}`);

      // Inject short-term memory as separate assistant message (即时剧情回顾)
      // Insert before the tail block (player_input + start_task + optional cot_masquerade)
      if (buildResult.shortMemoryContext) {
        // Find player_input position (the assistant message with user's input)
        const playerInputIdx = messageSources.findIndex((s) => s === 'builder:player_input');
        const insertAt = playerInputIdx >= 0 ? playerInputIdx : Math.max(0, messages.length - 2);
        messages.splice(insertAt, 0, { role: 'assistant' as const, content: buildResult.shortMemoryContext });
        messageSources.splice(insertAt, 0, 'short_term_memory');
      }

      // GAP-08 fix: inject plot directive as system message for new builder path
      if (variables['PLOT_DIRECTIVE']) {
        const plotDirectivePrompt = this.pack.prompts?.['plotDirective'] ?? '';
        if (plotDirectivePrompt) {
          const rendered = plotDirectivePrompt.replace(/\{\{(\w+)\}\}/g,
            (_: string, key: string) => key in variables ? variables[key] : '');
          if (rendered.trim()) {
            // Insert before the last 2 messages (player_input + start_task)
            const insertAt = Math.max(0, messages.length - 2);
            messages.splice(insertAt, 0, { role: 'system' as const, content: rendered });
            messageSources.splice(insertAt, 0, 'builder:plot_directive');
          }
        }
        // Also inject evaluation prompt in non-split-gen mode
        if (!splitGen && variables['PLOT_COMPLETION_HINT']) {
          const evalPrompt = this.pack.prompts?.['plotEvaluationStep2'] ?? '';
          if (evalPrompt) {
            const rendered = evalPrompt.replace(/\{\{(\w+)\}\}/g,
              (_: string, key: string) => key in variables ? variables[key] : '');
            if (rendered.trim()) {
              const insertAt = Math.max(0, messages.length - 2);
              messages.splice(insertAt, 0, { role: 'system' as const, content: rendered });
              messageSources.splice(insertAt, 0, 'builder:plot_evaluation_step2');
            }
          }
        }
      }

      // For split-gen step2, use the old assembler (step2后面再做)
      if (splitGen) {
        const step2Vars = {
          ...variables,
          ...PlotInjector.buildStep2Variables(this.stateManager, this.paths),
        };

        const step2Flow = this.pack.promptFlows['splitGenMainRoundStep2'];
        if (step2Flow) {
          const s2 = this.promptAssembler.assemble(step2Flow, step2Vars, chatHistory);
          splitStep2Messages = s2.messages;
          splitStep2Sources = s2.messageSources;
        }
      }

      console.debug('[ContextAssembly][NewBuilder] Messages:', messages.length, 'pieces:', Object.keys(buildResult.contextPieces).length);
      console.debug('[ContextAssembly][NewBuilder] Message roles:', messages.map((m) => m.role));
      console.debug('[ContextAssembly][NewBuilder] Context pieces:', Object.keys(buildResult.contextPieces));

    } else {
      // ═══ LEGACY PATH: flow-based PromptAssembler ═══
      const step1Flow = splitGen ? this.pack.promptFlows['splitGenMainRoundStep1'] : null;
      const step2Flow = splitGen ? this.pack.promptFlows['splitGenMainRoundStep2'] : null;

      if (splitGen && step1Flow && step2Flow) {
        const s1 = this.promptAssembler.assemble(step1Flow, variables, chatHistory);
        const step2Vars = {
          ...variables,
          ...PlotInjector.buildStep2Variables(this.stateManager, this.paths),
        };
        const s2 = this.promptAssembler.assemble(step2Flow, step2Vars, chatHistory);
        messages = s1.messages;
        messageSources = s1.messageSources;
        splitStep2Messages = s2.messages;
        splitStep2Sources = s2.messageSources;
      } else {
        const flow = this.pack.promptFlows['mainRound'];
        if (!flow) {
          throw new Error('Missing required prompt flow "mainRound" in Game Pack.');
        }
        const r = this.promptAssembler.assemble(flow, variables, chatHistory);
        messages = r.messages;
        messageSources = r.messageSources;
      }

      // Legacy: short-term memory injection
      if (shortTermText) {
        messages.push({ role: 'assistant', content: shortTermText });
        messageSources.push('short_term_memory');
        if (splitStep2Messages) {
          splitStep2Messages.push({ role: 'assistant', content: shortTermText });
          splitStep2Sources?.push('short_term_memory');
        }
      }

      // Legacy: enforcement + user input
      const enforcement = this.promptAssembler.renderSingle('narratorEnforcement', variables);
      const userMessage: AIMessage = {
        role: 'user',
        content: enforcement
          ? `${enforcement}\n\n<玩家输入>\n${ctx.userInput}\n</玩家输入>`
          : ctx.userInput,
      };
      messages.push(userMessage);
      messageSources.push('current_input');
      if (splitStep2Messages) {
        splitStep2Messages.push({ ...userMessage });
        splitStep2Sources?.push('current_input');
      }

      console.debug('[ContextAssembly][Legacy] Messages:', messages.length);
    }

    // ── §11.2 A: NSFW tag 剥离 ──
    //
    // PromptAssembler 把 raw prompt 内容（带 [私密]...[/私密]）
    // 经过变量替换后放入 messages[].content。根据 nsfwMode 决定是否剥离。
    //
    // CR-R5 修复（2026-04-11）：剥离在 debug 事件发射之前执行。
    // 之前的版本在 debug 事件之后剥离 — 调试面板看到的是"未过滤"的 prompt，
    // 而 AI 实际收到的是"已过滤"的 prompt，两者不一致让开发者调试 NSFW 关闭
    // 场景时很困惑（"为什么 AI 不生成 X"— 因为 AI 根本没看到 X 的指令）。
    // 新顺序：strip → debug emit → send to AI，三者看到的是同一份内容。
    if (!nsfwMode) {
      messages = stripTagFromMessages(messages, NSFW_STRIP_TAG);
      if (splitStep2Messages) {
        splitStep2Messages = stripTagFromMessages(splitStep2Messages, NSFW_STRIP_TAG);
      }
    }

    // ── 发射 ui:debug-prompt 供 PromptAssemblyPanel 调试展示 ──
    // 此处 messages 已经是 strip 后的最终版本（即 AI 实际接收的内容）
    // 2026-04-14：同时携带 messageSources 并行数组，让 PromptAssemblyPanel
    // 能标注每条消息的出处（prompt 模块 / narrative 历史 / 当前输入）。
    //
    // 2026-04-19：split-gen 必须用不同的 generationId 区分 step1/step2，否则
    // `attachResponse` 的 "generationId 匹配" 会错把两次 response 都挂到同一条
    // snapshot 上（由于 unshift，step2 snapshot 永远在前面，step1 永远拿不到）。
    //
    // 2026-04-19 (round 2)：step2 的最终消息在 ai-call.ts 才被拼完整
    // （追加 `step1 thinking 注入` + `{role:assistant, content: rawStep1}` +
    // `{role:user, content: STEP2_FOLLOWUP_USER}`），此处 splitStep2Messages
    // 只是 flow-assembled 部分。如果现在就 emit step2 snapshot，面板看到的
    // 永远是**不完整**的 prompt —— 缺最后 2-3 条关键消息，调试价值大减。
    // 改为只 emit step1；step2 由 ai-call 在拼完整后自己 emit。
    if (splitGen && splitStep2Messages) {
      eventBus.emit('ui:debug-prompt', {
        flow: 'splitGenMainRoundStep1',
        variables,
        messages,
        messageSources,
        generationId: `${ctx.generationId ?? ''}_step1`,
        roundNumber: ctx.roundNumber,
      });
      // step2 emit 延后到 ai-call.ts，见 `executeSplitGen`
    } else {
      eventBus.emit('ui:debug-prompt', {
        flow: 'mainRound',
        variables,
        messages,
        messageSources,
        generationId: ctx.generationId,
        roundNumber: ctx.roundNumber,
      });
    }

    return {
      ...ctx,
      stateSnapshot,
      chatHistory,
      messages,
      worldEventTriggered,
      meta: {
        ...ctx.meta,
        ...(splitStep2Messages
          ? {
              splitStep2Messages,
              // ai-call 需要这些字段才能 emit 完整的 step2 snapshot
              splitStep2Sources,
              debugVariables: variables,
              debugRoundNumber: ctx.roundNumber,
            }
          : {}),
        cotEnabled,
        cotJudgeEnabled,
        cotInjectStep2,
        // P2 env-tags port: forward to BodyPolishStage so it can prepend the
        // same context block as a read-only reference when polishing narrative.
        environmentBlock,
      },
    };
  }

  /**
   * 根据 Engram 配置选择检索路径（E.2 新增）
   *
   * - engram.enabled && retrievalMode='hybrid' → UnifiedRetriever（向量+图+三元组+NPC规则）
   * - 其他情况 → legacy MemoryRetriever（传统关键词+时间衰减）
   */
  private async retrieveMemory(userInput: string, ctx?: PipelineContext): Promise<string> {
    const engramConfig = this.engramManager?.getConfig();

    const useHybrid =
      engramConfig?.enabled === true &&
      engramConfig?.retrievalMode === 'hybrid' &&
      this.unifiedRetriever != null;

    if (useHybrid && this.unifiedRetriever) {
      const playerName = this.stateManager.get<string>(this.paths.playerName) ?? '';
      const locationDesc = this.stateManager.get<string>(this.paths.playerLocation) ?? '';

      try {
        const result = await this.unifiedRetriever.retrieve(
          userInput,
          {
            playerName,
            locationDesc,
            recentNpcNames: this.extractRecentNpcNames(),
            maxLines: 20,
          },
          this.stateManager,
        );
        if (ctx && this.unifiedRetriever.lastReadSnapshot) {
          ctx.meta['engramRead'] = this.unifiedRetriever.lastReadSnapshot;
        }
        return result;
      } catch (err) {
        console.warn('[ContextAssembly] UnifiedRetriever failed, falling back to legacy:', err);
      }
    }

    const playerName = this.stateManager.get<string>(this.paths.playerName) ?? '';
    return this.memoryRetriever.retrieve(this.stateManager, {
      playerName,
      recentNpcNames: this.extractRecentNpcNames(),
    });
  }

  /**
   * 从 Engram 实体列表中提取最近活跃的 NPC 名称。
   *
   * 读取状态树中 `系统.扩展.engramMemory.entities`，筛选 type='npc' 的节点，
   * 按 lastSeen 降序排列，取最近 10 个名称，供 UnifiedRetriever 的 NPC 规则分支使用。
   *
   * 此处不依赖 EngramManager 接口（避免循环依赖），直接从 StateManager 读取已持久化的数据。
   */
  private extractRecentNpcNames(): string[] {
    try {
      const engramData = this.stateManager.get<{
        entities?: Array<{ name: string; type: string; lastSeen?: number }>;
      }>(this.paths.engramMemory);
      if (!engramData?.entities) return [];

      return engramData.entities
        .filter((e) => e.type === 'npc')
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
        .slice(0, 10)
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
