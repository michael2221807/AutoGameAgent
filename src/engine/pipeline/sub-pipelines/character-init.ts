/**
 * 角色初始化子流水线 — 创角完成后的最终处理
 *
 * 在用户完成创角表单（选择世界观、天赋、分配属性等）后，
 * 本流水线负责将用户选择转化为完整的游戏初始状态：
 *
 * 流程：
 * 1. 构建初始状态树 — 将用户选择合并到 Game Pack 的默认状态模板
 * 2. 加载到 StateManager — 使状态树生效
 * 3. 运行 computed-fields（onCreation） — 计算所有初始衍生值
 * 4. 运行 validation-repair（onCreation） — 校验并修复初始状态
 * 5. 调用 AI 生成世界背景 — 使用 worldGeneration prompt flow
 * 6. 调用 AI 生成开场叙事 — 使用 openingScene prompt flow
 * 7. 创建角色档案 — 通过 ProfileManager 持久化
 * 8. 创建初始存档 — 通过 SaveManager 保存初始状态
 *
 * 与主回合流水线的区别：
 * 本流水线只在创角时执行一次，且不参与常规的 AI 对话循环。
 * 它的 AI 调用使用专用的 prompt flow（worldGeneration/openingScene），
 * 而非主回合使用的 mainRound flow。
 *
 * 对应 STEP-02 §5.1 Character Creation Finalization。
 */
import { set as _set } from 'lodash-es';
import {
  emitPromptAssemblyDebug,
  emitPromptResponseDebug,
  extractThinkingFromRaw,
} from '../../core/prompt-debug';
import type { StateManager } from '../../core/state-manager';
import type { CommandExecutor } from '../../core/command-executor';
import type { AIService } from '../../ai/ai-service';
import type { ResponseParser } from '../../ai/response-parser';
import type { PromptAssembler } from '../../prompt/prompt-assembler';
import type { SaveManager } from '../../persistence/save-manager';
import type { ProfileManager } from '../../persistence/profile-manager';
import type { GamePack, ProfileMeta, PromptFlowConfig } from '../../types';
import type { BehaviorRunner } from '../../behaviors/behavior-runner';
import type { EnginePathConfig } from '../types';
import type { MemoryManager } from '../../memory/memory-manager';

/** 创角结果 — 返回给调用方的完整创建信息 */
export interface CharacterInitResult {
  profileId: string;
  slotId: string;
  worldDescription: string;
  openingScene: string;
  success: boolean;
  error?: string;
}

/** 用户在创角流程中的选择数据 */
export interface CreationChoices {
  /** 各步骤的选择（key = stepId, value = 选择结果） */
  selections: Record<string, unknown>;
  /** 基础属性分配 */
  attributes?: Record<string, number>;
  /** 表单字段值 */
  formValues?: Record<string, unknown>;
}

/** 创角执行选项 — 控制 AI 调用模式等 */
export interface CharacterInitOptions {
  /**
   * §4.1c: 分步生成开局叙事
   *
   * - `false`（默认）: openingScene flow 单次调用，AI 一次产出 text + commands + options
   * - `true`: 两次调用
   *   - 第1步：openingSceneStep1 flow → 只输出正文
   *   - 第2步：openingSceneStep2 flow + 第1步响应注入 → 输出 commands/options/memory
   *
   * 分步模式能减少单次响应的复杂度，提高结构化数据的准确性；
   * 但会消耗 2 倍 API 调用时间和成本。worldGeneration 不分步（prompt 本身就是纯文本）。
   */
  splitGen?: boolean;
}

export class CharacterInitPipeline {
  constructor(
    private stateManager: StateManager,
    private commandExecutor: CommandExecutor,
    private aiService: AIService,
    private responseParser: ResponseParser,
    private promptAssembler: PromptAssembler,
    private saveManager: SaveManager,
    private profileManager: ProfileManager,
    private behaviorRunner: BehaviorRunner,
    private gamePack: GamePack,
    private paths: EnginePathConfig,
    /**
     * §C1 GAP_AUDIT: 可选注入，用于把开场叙事写入短期记忆 → 第一回合的 MEMORY_BLOCK 非空
     * 保持可选的原因是 CharacterInitPipeline 的现有测试/调用点可能没准备 MemoryManager，
     * 传入时才启用；未传入时保持原有行为。
     */
    private memoryManager?: MemoryManager,
  ) {}

  /**
   * 执行角色初始化全流程
   *
   * @param choices 用户在创角步骤中的选择
   * @param options 可选的执行选项（§4.1c: 含 splitGen 分步模式开关）
   */
  async execute(
    choices: CreationChoices,
    options: CharacterInitOptions = {},
  ): Promise<CharacterInitResult> {
    const profileId = `profile_${Date.now()}`;
    const slotId = 'auto';

    try {
      // 步骤 1: 构建初始状态树
      const initialState = this.buildInitialState(choices);
      this.stateManager.loadTree(initialState);

      // 步骤 2: 运行创角阶段的行为模块
      this.behaviorRunner.runOnCreation(this.stateManager);

      // 步骤 3: 调用 AI 生成世界背景（单次调用，worldGen 本身就是纯文本）
      const worldDescription = await this.generateWorldDescription(choices);

      // 步骤 4: 将世界描述写入状态树
      if (worldDescription) {
        this.stateManager.set(this.paths.worldDescription, worldDescription, 'system');
      }

      // 步骤 5: 调用 AI 生成开场叙事（§4.1c: 支持分步模式）
      const openingScene = await this.generateOpeningScene(
        choices,
        worldDescription,
        options.splitGen === true,
      );

      // 将开场叙事写入叙事历史（与 MainGamePanel 读取路径一致）
      if (openingScene) {
        const histPath = this.paths.narrativeHistory;
        const history =
          (this.stateManager.get(histPath) as Array<{ role: string; content: string }> | undefined) ?? [];
        this.stateManager.set(
          histPath,
          [...history, { role: 'assistant', content: openingScene }],
          'system',
        );

        // §C1 GAP_AUDIT: 同步写入短期记忆，让第一回合的 MEMORY_BLOCK 非空
        // 否则玩家首次对话时 AI 看到的记忆块完全空白，失去开场上下文
        // roundNumber 传 0 表示"开局前"，与 PreProcessStage 递增到 1 之前的约定一致
        if (this.memoryManager) {
          this.memoryManager.appendShortTerm(openingScene, 0);
          // 1:1 配对不变量：短期写了一条，隐式中期也必须写一条占位
          this.memoryManager.appendImplicitMidTerm({
            相关角色: ['玩家'],
            事件时间: '',
            记忆主体: '开局场景。',
            _占位: true,
          } as never);
        }
      }

      // 步骤 5.5: 运行 onGameLoad 行为钩子（校验+修复 AI 生成后的状态）
      this.behaviorRunner.runOnGameLoad(this.stateManager);

      // 步骤 6: 创建角色档案
      const characterName = this.extractCharacterName(choices);
      const profile: ProfileMeta = {
        profileId,
        createdAt: new Date().toISOString(),
        packId: this.gamePack.manifest.id,
        characterName,
        slots: {},
        activeSlotId: slotId,
      };
      await this.profileManager.createProfile(profile);

      // 步骤 7: 保存初始存档
      const snapshot = this.stateManager.toSnapshot();
      await this.saveManager.saveGame(profileId, slotId, snapshot, {
        characterName,
        packId: this.gamePack.manifest.id,
        packVersion: this.gamePack.manifest.version,
      });

      // 步骤 8: 设为当前活跃档案
      await this.profileManager.setActiveProfile(profileId, slotId);

      console.log(`[CharacterInit] Created profile "${profileId}" for "${characterName}"`);

      return {
        profileId,
        slotId,
        worldDescription: worldDescription ?? '',
        openingScene: openingScene ?? '',
        success: true,
      };
    } catch (err) {
      console.error('[CharacterInit] Pipeline execution failed:', err);
      return {
        profileId,
        slotId,
        worldDescription: '',
        openingScene: '',
        success: false,
        error: String(err),
      };
    }
  }

  /**
   * 构建初始状态树 — 合并 Game Pack 默认值与用户选择
   *
   * 2026-04-11 重写（Bug fix for creation flow）：
   * - 之前版本 `state[stepId] = value` 把 select-* 选择直接 dump 到状态树根
   *   （`state.talents = [...]`、`state.origin = {...}`），导致它们永远不出现在
   *   schema 定义的 `角色.身份.天赋` 等路径下，玩家看到的 GameVariablePanel 里
   *   「天赋」永远是空数组
   * - 新版本按 `CreationStep.statePath` + `valueField` 指示把选择写到正确路径
   * - 属性分配之前写到 `角色.属性.${attr}`，和 AI 开场场景要写的 "后天六维"
   *   （= 先天六维 + 出身修正 + 天赋修正）路径冲突；新版本写到 statePath
   *   （天命约定为 `角色.身份.先天六维`）作为只读基线，同时**镜像到**
   *   `角色.属性.${attr}` 作为首次显示的 fallback —— AI 开场成功时会覆盖为
   *   带修正值的后天六维，失败时用户至少能看到自己分配的数字
   *
   * 策略顺序：
   * 1. 以 Game Pack stateSchema 中定义的默认值为基础
   * 2. 按 statePath 将 selections 写入正确路径
   * 3. 按 statePath 将 attributes 写入基线路径，再镜像到 `角色.属性`
   * 4. form 字段按 key 写入（form 的 key 本身是 dot-path，不依赖 statePath）
   */
  private buildInitialState(choices: CreationChoices): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    // ── 1. 从 stateSchema 提取默认值 ──
    this.extractDefaultsFromSchema(this.gamePack.stateSchema, state, '');

    // ── 2. 按 statePath + valueField 路由 selections ──
    const stepsById = new Map(this.gamePack.creationFlow.steps.map((s) => [s.id, s]));
    for (const [stepId, value] of Object.entries(choices.selections)) {
      const step = stepsById.get(stepId);

      // 容错：step 找不到时回退到"stepId 是 dot-path 则按路径写入，否则 dump 到根"
      // 这是旧行为，保留给没有声明 statePath 的遗留 pack / dotted stepId 用法
      if (!step || !step.statePath) {
        if (stepId.includes('.')) {
          _set(state, stepId, value);
        } else {
          // 最小惊讶：stepId 是短名且无 statePath 时仍 dump 到根（兼容旧测试）
          state[stepId] = value;
        }
        continue;
      }

      _set(state, step.statePath, this.extractStoredValue(step, value));
    }

    // ── 3. 按 statePath 路由 attributes（天命：角色.身份.先天六维） + 镜像到 角色.属性 ──
    if (choices.attributes) {
      const attrStep = this.gamePack.creationFlow.steps.find(
        (s) => s.type === 'attribute-allocation',
      );
      const baselinePath = attrStep?.statePath ?? null;

      for (const [attr, val] of Object.entries(choices.attributes)) {
        // 基线（只读）：写到 statePath/attr
        if (baselinePath) {
          _set(state, `${baselinePath}.${attr}`, val);
        }
        // 镜像到 `角色.属性.${attr}` 作为首次显示的 fallback 值
        // （AI 开场场景通常会覆盖为带修正值的后天六维；若 AI 失败或跳过此步，
        //  玩家角色面板至少能看到自己分配的数字而不是 schema 默认的 5-5-5-5-5-5）
        _set(state, `角色.属性.${attr}`, val);
      }
    }

    // ── 4. 合并表单值（key 自己是 dot-path） ──
    if (choices.formValues) {
      for (const [key, value] of Object.entries(choices.formValues)) {
        if (key.includes('.')) {
          _set(state, key, value);
        } else {
          state[key] = value;
        }
      }
    }

    return state;
  }

  /**
   * 根据 step 的 `valueField` 从选中的 preset 对象提取要写入状态树的值
   *
   * - select-one + 有 valueField：返回 `preset[valueField]`（通常是 string）
   * - select-one + 无 valueField：返回整个 preset 对象
   * - select-many + 有 valueField：返回 `array.map(p => p[valueField])`（string 数组）
   * - select-many + 无 valueField：返回整个 preset 数组
   * - 任何其他情况：返回原值不做改动
   *
   * 防御：
   * - value 不是 array/object 时原样返回（string/number 直接落地）
   * - valueField 在 preset 上不存在时返回 undefined（lodash `_set` 会写 undefined，
   *   与用户意图不符，所以此处保留原对象作为安全回退）
   */
  private extractStoredValue(
    step: { type: string; valueField?: string },
    value: unknown,
  ): unknown {
    const field = step.valueField;
    if (!field) return value;

    if (step.type === 'select-one') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const extracted = (value as Record<string, unknown>)[field];
        return extracted ?? value;
      }
      return value;
    }

    if (step.type === 'select-many') {
      if (Array.isArray(value)) {
        return value
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
          .map((item) => item[field])
          .filter((v): v is NonNullable<typeof v> => v !== undefined && v !== null);
      }
      return value;
    }

    return value;
  }

  /**
   * 从 JSON Schema 中递归提取默认值
   *
   * §4.1d 修复（2026-04-11）：
   * 原实现遇到 `{ type: 'object', default: {}, properties: {...} }` 时，
   * 只使用顶层 `default`（空对象），**丢弃**嵌套 property 的 default。
   *
   * 例如 tianming schema 里 `角色.身份.先天六维`：
   * ```json
   * "先天六维": {
   *   "type": "object",
   *   "default": {},
   *   "properties": {
   *     "体质": { "type": "number", "default": 5 },
   *     ...
   *   }
   * }
   * ```
   * 旧实现输出 `先天六维: {}`；新实现输出 `先天六维: {体质:5, 直觉:5, ...}`。
   *
   * 算法：
   * 1. 对象字段：先用 `default`（或 `{}`）作为 base，再递归填充 **缺失的** 嵌套属性默认值
   * 2. 非对象字段有 default：用 default（但只在 target 中尚无此 key 时写入，保护父级已填值）
   * 3. 非对象、无 default：跳过（原始行为保持）
   *
   * 这个递归**非破坏性**：如果 target 中已经有某个 key（来自父级 default），
   * 递归不会覆盖它。这保证了"显式父级 default > 子属性 default"的优先级。
   */
  private extractDefaultsFromSchema(
    schema: Record<string, unknown>,
    target: Record<string, unknown>,
    _prefix: string,
  ): void {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return;

    for (const [key, propSchema] of Object.entries(properties)) {
      // CR-R21: 显式检测 $ref 并警告 —— 当前 pack schema 不使用 $ref，
      // 但若将来某字段改用 { "$ref": "#/definitions/X" } 引用，本函数会
      // 静默跳过（因为 type 不是 'object' 且没有 properties），导致该字段
      // 的默认值永远不被写入。此处警告开发者 —— 实现 $ref 解析需要扩展
      // schema resolver，不应被悄悄忽略。
      if ('$ref' in propSchema && typeof propSchema.$ref === 'string') {
        console.warn(
          `[CharacterInit] extractDefaultsFromSchema: field "${key}" uses $ref=${propSchema.$ref} — ` +
          '$ref is not supported; default will not be populated. Inline the definition or implement $ref resolution.',
        );
        continue;
      }

      const hasOwnDefault = propSchema.default !== undefined;
      const isObject = propSchema.type === 'object' && !!propSchema.properties;

      if (isObject) {
        // 对象字段：合并 default + 嵌套属性默认值
        //
        // 若 target 中已有该 key 且是对象（来自父级 default 的预填），就在它之上递归补齐；
        // 否则用 default（或 {}）起步，递归填充缺失项。
        let base: Record<string, unknown>;
        const existing = target[key];
        if (
          key in target &&
          existing !== null &&
          typeof existing === 'object' &&
          !Array.isArray(existing)
        ) {
          base = existing as Record<string, unknown>;
        } else if (hasOwnDefault && propSchema.default !== null && typeof propSchema.default === 'object') {
          base = structuredClone(propSchema.default) as Record<string, unknown>;
        } else {
          base = {};
        }

        this.extractDefaultsFromSchema(propSchema as Record<string, unknown>, base, key);

        // 只有当填充后有内容或本来就有 default 时才写入，避免在 target 上塞空壳
        if (hasOwnDefault || Object.keys(base).length > 0 || key in target) {
          target[key] = base;
        }
      } else if (hasOwnDefault && !(key in target)) {
        // 非对象字段（数字/字符串/数组/布尔）有 default 且 target 中尚无 → 直接写入
        // `!(key in target)` 保护父级已填的值不被覆盖
        target[key] = structuredClone(propSchema.default);
      }
      // 非对象且无 default → 跳过（原始行为保持）
    }
  }

  /** 调用 AI 生成世界背景描述 */
  private async generateWorldDescription(choices: CreationChoices): Promise<string | null> {
    try {
      const flow = this.gamePack.promptFlows['worldGeneration'];
      if (!flow) return null;

      // 与 openingScene 保持一致：注入完整 creation choices（selections + attributes + formValues）
      // 便于 worldGen prompt 根据玩家的天赋档次 / 出身等推导世界观细节
      const creationChoicesPayload: Record<string, unknown> = {
        选择项: choices.selections,
      };
      if (choices.attributes) {
        creationChoicesPayload['先天六维分配'] = choices.attributes;
      }
      if (choices.formValues) {
        creationChoicesPayload['身份信息'] = choices.formValues;
      }
      const variables: Record<string, string> = {
        CREATION_CHOICES: JSON.stringify(creationChoicesPayload, null, 2),
      };

      const assembled = this.promptAssembler.assemble(flow, variables);
      const generationId = `worldGeneration_${Date.now()}`;

      // 发射 prompt 调试事件 — 让 PromptAssemblyPanel 显示创角阶段的组装结果
      emitPromptAssemblyDebug({
        flow: 'worldGeneration',
        variables,
        messages: assembled.messages,
        messageSources: assembled.messageSources,
        generationId,
      });

      const rawResponse = await this.aiService.generate({
        messages: assembled.messages,
        usageType: 'world_generation',
      });

      emitPromptResponseDebug({
        flow: 'worldGeneration',
        generationId,
        thinking: extractThinkingFromRaw(rawResponse),
        rawResponse,
      });

      // worldGen is COT-style pure text — no JSON parsing, no command execution.
      // The raw text is injected into openingSceneStep1 as WORLD_DESCRIPTION context.
      const text = extractThinkingFromRaw(rawResponse)
        ? rawResponse.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
        : rawResponse.trim();

      return text || null;
    } catch (err) {
      console.warn('[CharacterInit] World generation skipped:', err);
      return null;
    }
  }

  /**
   * 调用 AI 生成开场叙事
   *
   * @param choices            创角选择
   * @param worldDescription   前一步 worldGeneration 的产出，作为上下文
   * @param splitGen           §4.1c: true 时分两次调用，false 时单次调用
   *
   * 单次模式（默认）：
   *   openingScene flow → 一次产出 text + commands + action_options + mid_term_memory
   *
   * 分步模式（splitGen=true）：
   *   第1步 openingSceneStep1 flow → 只产出 text（正文叙事）
   *   第2步 openingSceneStep2 flow + 第1步响应注入为 assistant → 产出 commands/options/memory
   *   合并：text 取第1步，结构化数据取第2步
   *   优点：降低单次 AI 响应复杂度，提高结构化数据的格式准确率
   *   缺点：2 倍延迟 + 2 倍 token 消耗
   *
   * 分步模式要求 pack 注册了 openingSceneStep1 和 openingSceneStep2 两个 flow；
   * 任一缺失则自动回退到单次模式（不崩溃）。
   */
  private async generateOpeningScene(
    choices: CreationChoices,
    worldDescription: string | null,
    splitGen: boolean,
  ): Promise<string | null> {
    // 2026-04-11 fix：CREATION_CHOICES 之前只含 selections，AI 看不到玩家分配的
    // 六维基线和姓名，导致 opening.md 里 "值 = 先天六维 + 出身修正 + 天赋修正"
    // 的计算没有输入。新版把三项全量序列化注入：
    //   - selections：玩家选的 world/talentTier/origin/trait/talents（完整 preset 对象）
    //   - attributes：玩家分配的 6 维数值（与 `角色.身份.先天六维` 一一对应）
    //   - formValues：姓名 / 性别 / 年龄
    // JSON 结构对 AI 友好，key 用中文标签让 prompt 里直接可读。
    const creationChoicesPayload: Record<string, unknown> = {
      选择项: choices.selections,
    };
    if (choices.attributes) {
      creationChoicesPayload['先天六维分配'] = choices.attributes;
    }
    if (choices.formValues) {
      creationChoicesPayload['身份信息'] = choices.formValues;
    }

    const variables: Record<string, string> = {
      CREATION_CHOICES: JSON.stringify(creationChoicesPayload, null, 2),
      WORLD_DESCRIPTION: worldDescription ?? '',
      CHARACTER_NAME: this.extractCharacterName(choices),
    };

    // 分步模式：要求两个 flow 都存在，否则回退到单次
    if (splitGen) {
      const step1Flow = this.gamePack.promptFlows['openingSceneStep1'];
      const step2Flow = this.gamePack.promptFlows['openingSceneStep2'];
      if (step1Flow && step2Flow) {
        return this.generateOpeningSceneSplit(variables, step1Flow, step2Flow);
      }
      console.warn(
        '[CharacterInit] splitGen requested but openingSceneStep1/Step2 flow missing — fallback to single-call',
      );
    }

    // 单次模式（默认或 splitGen 回退）
    //
    // CR-R20 修复（2026-04-11）：统一 error handling 的措辞与日志前缀，
    // 让 split/single 两条路径在失败时产出的日志格式一致，便于后续 grep。
    // 所有失败情况都走 logOpeningFailure(stage, err) helper。
    const flow = this.gamePack.promptFlows['openingScene'];
    if (!flow) {
      this.logOpeningFailure('single:missing-flow', new Error('openingScene flow 未注册'));
      return null;
    }
    try {
      const assembled = this.promptAssembler.assemble(flow, variables);
      const generationId = `openingScene_${Date.now()}`;

      emitPromptAssemblyDebug({
        flow: 'openingScene',
        variables,
        messages: assembled.messages,
        messageSources: assembled.messageSources,
        generationId,
      });

      const rawResponse = await this.aiService.generate({
        messages: assembled.messages,
        usageType: 'world_generation',
      });

      emitPromptResponseDebug({
        flow: 'openingScene',
        generationId,
        thinking: extractThinkingFromRaw(rawResponse),
        rawResponse,
      });

      const parsed = this.responseParser.parse(rawResponse);

      if (parsed.commands && parsed.commands.length > 0) {
        this.commandExecutor.executeBatch(parsed.commands);
      }

      return parsed.text || null;
    } catch (err) {
      this.logOpeningFailure('single:generate', err);
      return null;
    }
  }

  /**
   * CR-R20: 统一的开场叙事失败日志工具
   *
   * stage 格式：`<mode>:<step>`
   *   - split:step1      分步模式第1步失败（正文）
   *   - split:step2      分步模式第2步失败（结构化数据）
   *   - single:generate  单次模式 AI 调用失败
   *   - single:missing-flow  单次模式缺少 flow 注册
   *
   * 所有失败都通过 console.warn（非 error）—— 因为开场叙事缺失不是致命问题，
   * CharacterInit 会继续进入主回合，玩家仍然能玩。
   */
  private logOpeningFailure(stage: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[CharacterInit] Opening scene [${stage}] failed: ${msg}`);
  }

  /**
   * §4.1c: 分步模式生成开场叙事
   *
   * 第1步：openingSceneStep1 flow → 仅产出正文
   * 第2步：openingSceneStep2 flow → 产出结构化数据，接受第1步响应为上下文
   *
   * 第2步的 messages 构造：在 step2 flow 组装出的消息列表末尾追加一条
   * `{ role: 'assistant', content: <第1步原始响应> }`，让 AI 知道"你刚才生成的正文是 X"，
   * 然后基于 X 产生对应的 commands。
   *
   * ## Opening init-command merge contract (2026-04-19 fix)
   *
   * splitGenStep1.md 形式上要求"只输出 text"，但 opening.md 在 step1 flow 里
   * 详尽描述了 §1-§11 的完整初始化 commands（时间/位置/属性/背包/地点/环境/NPC）。
   * 因此 AI 在 step1 可靠地返回了包含 init commands 的完整 JSON。step2 看到
   * step1 在 history 里已经"初始化过"，往往只发 scene-specific delta（时间推进、
   * 状态 push、NPC 记忆），不再重发初始化指令。
   *
   * 旧代码只执行 parsed2.commands，导致 step1 的初始化被整体丢弃 —— 玩家进入主
   * 回合时 地图/社交/背包/属性/环境 全是 schema 默认值（空数组 / 空对象 / 默认
   * "晴" / "平日"）。本方法现在执行 step1 的 commands + step2 的 commands 两批，
   * step1 先跑作为初始化基线，step2 后跑覆盖 / 补充 scene 细节。
   *
   * 错误处理：第1步失败 → 直接降级返回 null（不再尝试第2步，避免凭空生成指令）。
   * 第2步失败 → step1 的初始化 commands 已经执行（游戏有完整初始状态），只丢失
   * step2 的 scene delta；仍返回第1步的 text。
   */
  private async generateOpeningSceneSplit(
    variables: Record<string, string>,
    step1Flow: PromptFlowConfig,
    step2Flow: PromptFlowConfig,
  ): Promise<string | null> {
    // ── 第1步：正文 ──
    let step1Raw: string;
    let step1Text: string;
    const step1GenerationId = `openingSceneStep1_${Date.now()}`;
    try {
      const assembled1 = this.promptAssembler.assemble(step1Flow, variables);
      emitPromptAssemblyDebug({
        flow: 'openingSceneStep1',
        variables,
        messages: assembled1.messages,
        messageSources: assembled1.messageSources,
        generationId: step1GenerationId,
      });
      step1Raw = await this.aiService.generate({
        messages: assembled1.messages,
        usageType: 'world_generation',
      });
      emitPromptResponseDebug({
        flow: 'openingSceneStep1',
        generationId: step1GenerationId,
        thinking: extractThinkingFromRaw(step1Raw),
        rawResponse: step1Raw,
      });
      const parsed1 = this.responseParser.parse(step1Raw);
      step1Text = parsed1.text || '';
      if (!step1Text) {
        this.logOpeningFailure('split:step1', new Error('returned empty text'));
        return null;
      }

      // Opening init-command merge (see method JSDoc). Execute step1's commands
      // immediately so that even if step2 fails mid-flight, the game has a
      // complete initial state tree. `normalizeCommands` already returned an
      // array (possibly empty) — Array.isArray stays as a defensive guard.
      //
      // executeBatch is best-effort: individual command failures are logged but
      // never thrown (see CommandExecutor.executeBatch). If a programming error
      // inside executeBatch itself threw, the outer catch would record it as
      // 'split:step1' and abort — which is the right shape (we never half-init
      // then proceed to step2 on a broken state tree).
      const step1Commands = Array.isArray(parsed1.commands) ? parsed1.commands : [];
      if (step1Commands.length > 0) {
        this.commandExecutor.executeBatch(step1Commands);
        console.log(
          `[CharacterInit] Opening split-gen step1: executed ${step1Commands.length} init commands`,
        );
      }
    } catch (err) {
      this.logOpeningFailure('split:step1', err);
      return null;
    }

    // ── 第2步：结构化数据（注入第1步原始响应为 assistant 上下文） ──
    //
    // CR-R12 修复（2026-04-11）：
    // Claude API 严格要求 user/assistant 交替且以 user 结尾，否则最后一条
    // assistant 会被当作 prefill（模型从它的末尾继续生成），而不是"你之前说过这段话"。
    // 旧实现 `[...assembled2.messages, { role: 'assistant', content: step1Raw }]`
    // 的问题：如果 assembled2 的最后一条已经是 user（常见情况），追加一条 assistant
    // 后会结束在 assistant，Claude 把它当 prefill 继续写叙事，而不是产出 commands。
    // 对 OpenAI 兼容端点影响较小（它们更宽容），但 Claude 原生 API 必然出错。
    //
    // 新策略：插入 assistant 正文 + 再追加一条 user 指令（"请基于上面的正文输出
    // 结构化数据"），让 step2 变成标准的 user→assistant→user 多轮结构。
    const STEP2_FOLLOWUP_USER =
      '请基于上面的开场正文，按照 step2 规范输出结构化数据（commands / options / memory），不要重复正文。';
    try {
      const assembled2 = this.promptAssembler.assemble(step2Flow, variables);
      const step2Messages = [
        ...assembled2.messages,
        { role: 'assistant' as const, content: step1Raw },
        { role: 'user' as const, content: STEP2_FOLLOWUP_USER },
      ];
      // Source labels mirror the main-round split-gen emit in ai-call.ts so
      // both openingScene step2 and main-round step2 snapshots read the same
      // way in the debug panel (same badge colors, same tooltips).
      const step2Sources = [
        ...assembled2.messageSources,
        'step1_response',
        'step2_followup',
      ];
      const step2GenerationId = `openingSceneStep2_${Date.now()}`;

      emitPromptAssemblyDebug({
        flow: 'openingSceneStep2',
        variables,
        messages: step2Messages,
        messageSources: step2Sources,
        generationId: step2GenerationId,
      });

      const step2Raw = await this.aiService.generate({
        messages: step2Messages,
        usageType: 'world_generation',
      });
      emitPromptResponseDebug({
        flow: 'openingSceneStep2',
        generationId: step2GenerationId,
        thinking: extractThinkingFromRaw(step2Raw),
        rawResponse: step2Raw,
      });
      const parsed2 = this.responseParser.parse(step2Raw);

      if (parsed2.commands && parsed2.commands.length > 0) {
        this.commandExecutor.executeBatch(parsed2.commands);
      }
      // mid_term_memory / action_options 此处不处理 — CharacterInit 阶段只关心 commands
      // （action_options 是主回合后续由 PostProcess 消费的概念）
    } catch (err) {
      // 第2步失败：step1 的 init commands 已经在上面执行（2026-04-19 fix），
      // 游戏仍然有完整的初始状态树；丢失的只是 step2 的 scene-specific delta
      // （当前回合时间推进、状态 push、NPC 记忆 append）。玩家能正常进入主回合。
      this.logOpeningFailure('split:step2', err);
    }

    return step1Text;
  }

  /**
   * 从用户选择中提取角色名
   * 尝试多个常见字段名，回退到默认值
   */
  private extractCharacterName(choices: CreationChoices): string {
    const candidates = [
      choices.formValues?.['角色.基础信息.姓名'],
      choices.formValues?.['名字'],
      choices.formValues?.['name'],
      choices.formValues?.['角色名'],
      choices.formValues?.['characterName'],
      choices.selections['名字'],
      choices.selections['name'],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '未命名角色';
  }
}
