/**
 * Transformer Preset System — MRJH apiConfig.ts:87-419
 *
 * Provides default transformer prompt presets for 3 backends (NAI, Gemini, Grok)
 * × 3 scopes (NPC, Scene, SceneJudge) = 9 presets, plus 3 model bundles
 * that link presets to serialization strategies.
 *
 * Preset resolution: `getTransformerPresetContext(scope, mode)` returns
 * the assembled prompt context (AI role prompt + task-specific prompt +
 * serialization strategy) for the active model bundle.
 *
 * Prompt text is verbatim from MRJH with wuxia-specific terms generalized:
 *   境界 → 等级, 武侠/仙侠 → 特定风格/奇幻, 气机 → 能量效果
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ FRONTEND TODO (Phase 6: Rules Center + Phase 7: Settings Tab)  │
 * │                                                                 │
 * │ These defaults ship with the engine. User customization needs:  │
 * │ - Settings Tab 4 "转化器": edit/add/delete presets + bundles    │
 * │ - Rules Center: select active model ruleset, edit rule fields   │
 * │ - State persistence: save customized presets to state tree      │
 * │ MRJH ref: MRJH-USER-EXPERIENCE.md §J-2 + §K Tab 4             │
 * └─────────────────────────────────────────────────────────────────┘
 */
import type { SerializationStrategy } from './output-processor';

// ═══════════════════════════════════════════════════════════
// §1 — Types
// ═══════════════════════════════════════════════════════════

export type TransformerPresetScope = 'npc' | 'scene' | 'scene_judge';

export interface TransformerPromptPreset {
  id: string;
  name: string;
  scope: TransformerPresetScope;
  /** Main transformer behavior prompt */
  prompt: string;
  /** Prompt additions when character anchor is active */
  anchorModePrompt?: string;
  /** Scene-specific anchor mode prompt (scene presets only) */
  sceneAnchorModePrompt?: string;
  /** Prompt additions when no anchor exists */
  noAnchorFallbackPrompt?: string;
  /** Output format constraints */
  outputFormatPrompt?: string;
}

export interface ModelTransformerBundle {
  id: string;
  name: string;
  enabled: boolean;
  /** Model-specific behavior prompt (default mode) */
  modelPrompt: string;
  /** Model-specific prompt for anchor mode */
  anchorModeModelPrompt: string;
  /** How to serialize structured output */
  serializationStrategy: SerializationStrategy;
  /** Linked preset IDs */
  npcPresetId: string;
  scenePresetId: string;
  sceneJudgePresetId: string;
}

export interface TransformerPresetContext {
  /** Model bundle's role prompt (system-level AI role) */
  aiRolePrompt: string;
  /** Task-specific prompt (scope + mode combined) */
  taskPrompt: string;
  /** Serialization strategy */
  serializationStrategy: SerializationStrategy;
}

// ═══════════════════════════════════════════════════════════
// §2 — Structured output format hint builder (MRJH apiConfig.ts:60-85)
// ═══════════════════════════════════════════════════════════

function buildStructuredOutputFormatHint(strategy: SerializationStrategy, scope: 'npc' | 'scene'): string {
  if (scope === 'npc') {
    // NPC single-character: use <提示词> wrapper, NOT <提示词结构> (MRJH apiConfig.ts:48-62)
    const npcHint = strategy === 'nai_character_segments'
      ? 'NovelAI 最终会直接使用这一条单角色 tags；如需要人数标签或权重分组，可直接写在同一个 <提示词> 中。'
      : strategy === 'gemini_structured'
        ? 'Gemini 最终会把这条单角色 tags 转成清晰、可执行的英文短语。'
        : strategy === 'grok_structured'
          ? 'Grok 最终会把这条单角色 tags 转成更电影化的描述式提示词。'
          : '输出必须可被后续解析成单角色提示词。';
    return [
      '请使用以下结构输出：',
      '<提示词>...</提示词>',
      '只输出当前单个角色最终用于生图的 tags。',
      npcHint,
      '输出内容只保留这个结构本身。',
    ].filter(Boolean).join('\n');
  }

  // Scene: use <提示词结构><基础><角色> structure (MRJH apiConfig.ts:64-85)
  const sceneHint = strategy === 'nai_character_segments'
    ? 'NovelAI 多角色会按基础段 + 角色段序列化，并使用 | 连接。<基础> 负责全局环境、镜头、天气、布局和光影；<角色> 内每条 [序号] 内容负责该角色当前镜头需要的最小必要 tags。'
    : strategy === 'gemini_structured'
      ? 'Gemini 最终会把这些段落转成清晰的描述式提示词；<角色> 内每条 [序号] 写成完整、可执行的英文短语。'
      : strategy === 'grok_structured'
        ? 'Grok 最终会把这些段落转成更电影化的描述式提示词；<角色> 内每条 [序号] 仍只写对应角色的动作、姿态、视线和镜头关系。'
        : '输出必须可被后续解析成基础段与 [序号] 角色段。';

  return [
    '请使用以下结构输出：',
    '<提示词结构>',
    '<基础>...</基础>',
    '<角色>',
    '[1]角色名称|...',
    '[2]角色名称|...',
    '</角色>',
    '</提示词结构>',
    '至少输出一个 <基础> 段；纯场景时可以不输出 <角色>。',
    '场景里每个主要角色都写进同一个 <角色> 块，并用 [序号] 逐条区分。',
    sceneHint,
    '输出内容只保留这个结构本身。',
  ].filter(Boolean).join('\n');
}

// ═══════════════════════════════════════════════════════════
// §3 — Default presets (verbatim from MRJH, wuxia terms generalized)
// ═══════════════════════════════════════════════════════════

const DEFAULT_PRESETS: TransformerPromptPreset[] = [
  // ── NAI · NPC (MRJH apiConfig.ts:87-126) ──
  {
    id: 'transformer_nai_npc',
    name: 'NAI · NPC角色生成',
    scope: 'npc',
    prompt: [
      '你是 NovelAI V4/V4.5 角色提示词整理器。',
      '你的任务是把 NPC 资料整理成可直接用于角色生图的英文 tags，并保持稳定、统一、可复用。',
      '请按 NovelAI 更易执行的单角色提示词思路组织内容：在同一条 tags 里先放稳定身份、外观、服饰，再补镜头、光影与动作。',
      '若输入没有明确指定画风介质，不要擅自锁定二次元、写实、国风或摄影风格；只整理并强化输入中已经存在的风格信息。',
      '建议信息顺序：主体身份与年龄感 > 外貌与面部辨识 > 身材体态 > 常驻服饰 > 手持物或身份道具 > 姿态表情 > 镜头构图 > 光影环境。',
      '质量串、画风串、主体身份可以使用权重分组；动作、景别、环境关系和临时状态更适合自然 tags。',
      '请把身份、等级、性格转换成 gaze, posture, silhouette, expression, lighting, fabric detail 这类可见结果。',
      '单次输出只服务一个清晰镜头、一个主姿态、一个主光源，避免互相冲突的多视角、多动作、多光线。',
      '用词少而准，避免同义重复、避免堆砌空泛质量词、避免把同一外观信息在多个分组里反复重写。',
      '资料缺口只做低冲突、可长期复用的保守补全。',
      '当资料有限时，可根据身份、等级、年龄、性别补全年龄感、脸部气质、体态、常驻衣着材质、配饰、身份道具与可见气场。',
    ].join('\n'),
    anchorModePrompt: [
      '请直接沿用锚点中的稳定外观，不要重复改写已经确定的五官、体型、常驻衣着和主要配饰。',
      '请直接沿用锚点中的稳定外观，只在最终 tags 里补当前镜头中的动作、姿态、表情、景别、构图、光影、临时服装变化、环境关系和道具。',
      '若正文与锚点一致，可直接吸收为动态补充；若正文与锚点冲突，以锚点中的稳定外观为主。',
      '避免把基础段里的全局镜头、天气、环境和特效平均复制到每个角色段。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请根据输入的角色设定完成完整角色生成，不能只输出镜头、姿态、光影或空泛气质词。',
      '请优先完整提炼年龄感、身份、等级、外貌、身材、常驻衣着和其他稳定辨识特征。',
      '请先完成稳定外观和身份辨识，再补动作、姿态、镜头、光影和环境。',
      '请在补全时选择稳妥、低冲突、容易长期保持一致的视觉表达，但对输入中已经明确给出的设定不得省略。',
      '当资料只给出身份、等级、年龄、性别等少量字段时，也要据此补全最稳妥的外观、体态、衣着层次、配饰、武器或身份道具。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('nai_character_segments', 'npc'),
      '单角色图直接输出 <提示词>，不要再拆 <基础>/<角色>。',
      '请先写稳定主体，再补镜头、动作、光影和少量环境。',
      '有锚点时，只补动态动作、姿态、表情、临时服装变化和道具。',
    ].join('\n'),
  },

  // ── NAI · Scene (MRJH apiConfig.ts:127-161) ──
  {
    id: 'transformer_nai_scene',
    name: 'NAI · 场景生成',
    scope: 'scene',
    prompt: [
      '你是 NovelAI V4/V4.5 场景提示词整理器。',
      '你的任务是把场景描述整理成可直接用于场景生图的英文 tags，并保持空间清晰、层次稳定、单帧可执行。',
      '请按 NovelAI 更易执行的场景结构组织内容：基础段负责地点、时间、天气、空间结构、镜头、光影与整体氛围；角色信息统一写进 <角色> 块并用 [序号] 区分。',
      '若输入没有明确指定画风介质，不要擅自锁定二次元、写实、国风或摄影风格；只整理输入里已有的风格线索。',
      '提示词顺序建议为：大地点 > 具体地点 > 空间结构 > 时间天气 > 环境材质与细节 > 人物站位与互动 > 镜头构图 > 氛围特效。',
      '纯场景时让环境作为第一主体；故事快照时也必须保留地点、前中后景、地面关系和空间尺度。',
      '请明确前景、中景、远景、地面接触点、建筑或山水层级，形成单一清晰视角。',
      '单次输出只服务一个稳定时刻、一个主镜头、一个主光源、一个主要叙事焦点，避免多视角、多时间切片和多事件并列。',
      '环境细节要为焦点服务，不要把每一层都写成同等密度，避免画面容量失衡。',
      '特定风格场景可主动整理山、水、雾、风、树影、檐角、石阶、灯火、云气、雨雪、花叶、纹理、材质与气氛粒子。',
    ].join('\n'),
    sceneAnchorModePrompt: [
      '请沿用角色锚点中的稳定外观，把场景输出重点放在空间、角色站位、互动关系、动作调度、镜头构图、天气、光影、环境细节和气氛特效。',
      '<角色> 块里每条 [序号] 只补当前场景需要的识别外观、动作和站位，不要把完整角色设定重新灌入场景。',
      '多人场景时优先表达关系、位置、视线和调度，让环境层级与人物关系一起成立。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请为主要角色补少量辨识外观。',
      '多人画面里优先保留位置、动作、关系和少数识别标签，让环境与人物容量保持平衡。',
      '不要把场景图写成多个完整角色立绘的拼贴。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('nai_character_segments', 'scene'),
      '纯场景时可以只输出 <基础>；故事快照或多人画面时，主要角色必须写进 <角色> 块。',
      'NovelAI 最终会用 | 连接基础段和角色段；<角色> 内每条 [序号] 内容开头优先写 1girl、1boy、1woman 或 1man。',
      '基础段负责地点、空间、天气、镜头、光影与整体特效；<角色> 内每条 [序号] 只写该角色自身的外观锚点补充、动作、姿态、视线、手部状态和与环境或他人的关系。',
    ].join('\n'),
  },

  // ── NAI · Scene Judge (MRJH apiConfig.ts:162-179) ──
  {
    id: 'transformer_nai_scene_judge',
    name: 'NAI · 场景判定',
    scope: 'scene_judge',
    prompt: [
      '你负责判断当前文本更适合生成"风景场景"还是"故事快照"。',
      '判定保持保守，优先选择稳定、易读、可执行的画面类型。',
      '只有在文本能够稳定对应到一个单一时刻、一个清晰地点、一个主要事件时，才可判为故事快照。',
      '故事快照通常至少满足以下四项：明确地点、可见环境细节、在场人物、稳定姿态、明确动作、道具交互、空间方向、单一时刻感。',
      '如果文本主要是对话、心理活动、设定说明、回忆叙述、抽象氛围、身份介绍或长段内心描写，则默认判为风景场景。',
      '若存在多人混战、频繁动作切换、连续剧情变化、复杂视角切换，也优先回退为风景场景。',
      '若文本能稳定对应到"门前对峙、亭中交谈、桥上回首、崖边停步、举剑相向、递物瞬间"这类单帧事件，可提高故事快照优先级。',
      '即使判为故事快照，也必须保证地点和环境仍然清晰可读，不允许变成拥挤人物拼贴。',
      '只输出"风景场景"或"故事快照"其中之一。',
    ].join('\n'),
  },

  // ── Gemini · NPC (MRJH apiConfig.ts:180-212) ──
  {
    id: 'transformer_gemini_npc',
    name: 'Gemini · NPC角色生成',
    scope: 'npc',
    prompt: [
      '你是 Gemini Banana 角色提示词整理器。',
      '你的任务是把 NPC 资料整理成清晰、可执行、偏描述式的英文角色图提示词。',
      '请优先输出短英文短语或短句，不要写 NovelAI 权重语法，不要堆砌过碎的 Danbooru 风格碎标签。',
      '若输入没有明确指定画风介质，不要擅自锁定二次元、写实、国风或摄影风格；只整理输入中已有的风格线索。',
      '提示词顺序：角色身份与主体 > 稳定外观 > 身材体态 > 常驻服装 > 道具 > 动作表情 > 镜头构图 > 光影环境。',
      '请把性格转换成表情、姿态、镜头和光线，把身份与等级转换成服装细节、气场和主体姿态。',
      '请保持一个清晰镜头、一个主姿态、一个主光源，避免互相冲突的多动作与多镜头描述。',
      '用词尽量具体、可画、可执行，避免空泛质量词和同义重复。',
      '当资料有限时，可根据身份、等级、年龄、性别补全年龄感、面部气质、体态、常驻服饰、配饰与身份道具。',
    ].join('\n'),
    anchorModePrompt: [
      '请沿用锚点中的稳定外观，把输出重点放在镜头、动作、姿态、表情、景别、光影、临时服装变化、道具和环境。',
      '不要把锚点已确定的稳定外观重新展开成冗长描述。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请根据人物设定补出稳定外观。',
      '请优先保证角色形象稳定、自然、容易长期保持一致。',
      '请先补足身份辨识、外貌、身材与常驻衣着，再补动作、镜头和环境。',
      '当资料只给出身份、等级、年龄、性别时，也要据此补出最稳妥的脸部气质、体态、衣着层次、配饰与身份道具。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('gemini_structured', 'npc'),
      'Gemini 的基础段与角色段内容都以清晰英文短语表达。',
      '基础段负责全局镜头、光影、环境；角色段负责单个角色的身份、外观、服饰、动作。',
    ].join('\n'),
  },

  // ── Gemini · Scene (MRJH apiConfig.ts:213-242) ──
  {
    id: 'transformer_gemini_scene',
    name: 'Gemini · 场景生成',
    scope: 'scene',
    prompt: [
      '你是 Gemini Banana 场景提示词整理器。',
      '你的任务是把场景信息整理成适合 Gemini Banana 的英文场景提示词。',
      '请优先输出清晰、可执行的英文短语，不要使用 NovelAI 权重语法，也不要堆砌过度碎片化标签。',
      '先建立地点、空间、时间、天气和主要材质，再写人物位置与互动，最后写镜头和氛围。',
      '请保持一个清晰焦点、一个主要镜头、一个稳定时刻，避免把多段剧情折叠进同一张图。',
      '历史或奇幻场景里主动写清建筑风格、山水层次、树影灯火、雾气风向、天气、地面材质与环境粒子。',
    ].join('\n'),
    sceneAnchorModePrompt: [
      '角色外观来自锚点，请生成他们在场景中的位置、互动、动作、镜头设计与环境关系。',
      '环境继续作为主要主体。',
      '如果角色较多，优先表达站位、视线与关系。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请用少量角色外观词帮助辨识人物，但要避免角色喧宾夺主。',
      '多人场景时优先保空间清晰度和镜头可读性。',
      '请避免把场景提示词写成多个人物单独肖像的并列清单。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('gemini_structured', 'scene'),
      'Gemini 场景图中，基础段先给地点、空间、天气和镜头，角色段再补每个角色的动作与位置。',
      '角色段只写与当前镜头相关的最小必要外观识别和动作关系。',
    ].join('\n'),
  },

  // ── Gemini · Scene Judge (MRJH apiConfig.ts:243-257) ──
  {
    id: 'transformer_gemini_scene_judge',
    name: 'Gemini · 场景判定',
    scope: 'scene_judge',
    prompt: [
      '判断当前文本更适合风景场景还是故事快照。',
      '优先判断是否存在足够稳定的单帧视觉证据。',
      '如果地点、动作、在场人物、道具和空间关系至少有三项明确可见，且能归并成一个清晰瞬间，可考虑故事快照；否则改为风景场景。',
      '若文本更偏对话、回忆、情绪或抽象说明，一律回退为风景场景。',
      '即使判定通过，也要保持环境优先，避免人物占满画面。',
      '只输出"风景场景"或"故事快照"其中之一。',
    ].join('\n'),
  },

  // ── Grok · NPC (MRJH apiConfig.ts:258-291) ──
  {
    id: 'transformer_grok_npc',
    name: 'Grok · NPC角色生成',
    scope: 'npc',
    prompt: [
      '你是 Grok 2D cinematic 角色提示词整理器。',
      '你的任务是把 NPC 资料整理成适合 Grok 的英文角色提示词。',
      '可使用更具电影感的描述式短语，但仍需保持可执行、可画、单帧稳定。',
      '若输入没有明确指定画风介质，不要擅自锁定二次元、写实、国风或摄影风格；只整理输入里已有的风格倾向。',
      '推荐顺序：角色主体 > 稳定外观 > 身材体态 > 服装与身份标志 > 道具 > 姿态动作 > 镜头景别 > 光影氛围 > 背景补充。',
      '请把性格、身份、压迫感、危险感转换成眼神、站姿、镜头角度、光源方向、轮廓对比和环境张力。',
      '保持人物辨识度，让电影感服务于角色识别和镜头清晰度。',
      '避免把多个镜头语法、多个动作重心和多个光源结构同时写入同一角色图。',
      '当资料有限时，可根据身份、等级、年龄、性别补全年龄感、轮廓气质、体态、常驻服饰、配饰与身份道具。',
    ].join('\n'),
    anchorModePrompt: [
      '角色稳定外观已经由锚点给定。',
      '请把输出重点放在镜头、姿态、表情、动作、光影张力、背景氛围、环境叙事和临时状态。',
      '不要重新发明锚点已经固定的外观基线。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请根据人物设定构建稳定外观，并保持克制、稳定、易识别。',
      '缺失信息请用稳妥外观补足，让电影感服务于角色一致性。',
      '请先稳住身份、外貌、身材、衣着，再补电影化镜头和光影。',
      '当资料只给出身份、等级、年龄、性别时，也要据此补出最稳妥的年龄感、轮廓、体态、衣着层次、配饰与身份道具。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('grok_structured', 'npc'),
      'Grok 角色段应强化镜头、姿态、光源方向和情绪张力，但仍保持单一清晰动作。',
      '基础段负责整体镜头与环境倾向，角色段负责单体身份、外观、动作和与环境的关系。',
    ].join('\n'),
  },

  // ── Grok · Scene (MRJH apiConfig.ts:292-323) ──
  {
    id: 'transformer_grok_scene',
    name: 'Grok · 场景生成',
    scope: 'scene',
    prompt: [
      '你是 Grok 2D cinematic 场景提示词整理器。',
      '你的任务是把场景信息整理成适合 Grok 的英文场景提示词。',
      '目标是生成带有电影叙事感、但仍然单帧稳定、可执行的场景图或故事快照。',
      '优先构建世界层级、景深、动作焦点和光源结构，让地点本身具有叙事性。',
      '人物服务于场景事件，环境层级与事件调度一起推进画面叙事。',
      '请保持一个主镜头、一个主要叙事焦点、一个主光源结构，避免同时塞入多个互斥场面。',
      '奇幻或历史题材可以主动加入风、雾、能量效果、云层、碎叶、灯火、雨雪、余波等动态环境元素。',
    ].join('\n'),
    sceneAnchorModePrompt: [
      '角色基础外观由锚点提供。',
      '你应集中生成场景调度、人物站位、互动关系、镜头、天气、光影和史诗氛围。',
      '多人情况下优先表达关系、距离、方向、冲突感和环境张力。',
      '不要把完整角色肖像信息重复写进场景段。',
    ].join('\n'),
    noAnchorFallbackPrompt: [
      '请用少量人物外观帮助区分角色，但要继续保持大场景优先。',
      '复杂多人时优先降低人物细节密度，把容量留给环境和构图。',
      '请避免把场景图整理成多个人物海报元素的拼贴。',
    ].join('\n'),
    outputFormatPrompt: [
      buildStructuredOutputFormatHint('grok_structured', 'scene'),
      'Grok 场景图的基础段负责世界层级、景深和整体调度，角色段负责单个角色的电影化动作关系。',
      '角色段只写当前镜头需要的最小必要外观识别、站位和动作。',
    ].join('\n'),
  },

  // ── Grok · Scene Judge (MRJH apiConfig.ts:324-338) ──
  {
    id: 'transformer_grok_scene_judge',
    name: 'Grok · 场景判定',
    scope: 'scene_judge',
    prompt: [
      '判断当前文本更适合生成风景场景还是故事快照。',
      '优先寻找带有明确动作方向、人物站位、道具交互和环境细节的单一时刻。',
      '若正文更像情绪描写、纯对话、设定说明、回忆总结或多段连续动作，直接回退到风景场景。',
      '即使允许场景快照，也要确保环境和地点仍然是第一主体。',
      '优先选择稳定、可读、可执行的剧情瞬间。',
      '只输出"风景场景"或"故事快照"其中之一。',
    ].join('\n'),
  },
];

// ═══════════════════════════════════════════════════════════
// §4 — Default model bundles (MRJH apiConfig.ts:341-418)
// ═══════════════════════════════════════════════════════════

const DEFAULT_MODEL_BUNDLES: ModelTransformerBundle[] = [
  {
    id: 'transformer_model_bundle_nai',
    name: 'NAI',
    enabled: true,
    modelPrompt: [
      '目标模型为 NovelAI V4/V4.5。',
      '输出采用 NovelAI 常用的英文 tags 习惯。',
      '若任务要求单角色图，则直接输出单个角色最终 tags；若任务要求场景图，则按基础段 + [序号]角色段组织。',
      '质量串、画风串、主体身份可以使用权重分组；动作、镜头、环境和临时状态保持自然标签表达，让画面更稳。',
      '若输入没有明确要求，不要擅自锁定二次元、写实、国风或摄影风格；只整理并强化已有风格线索。',
      '标签顺序保持稳定，信息容量均衡，避免同义重复，以及把多个镜头语法堆到一起。',
      '必须严格跟随任务要求给出的输出标签结构，不要自行改成带属性的 XML 角色标签。',
      '若 NPC 资料较少，可以根据身份、等级、年龄、性别做保守补全，但补全内容必须长期稳定、低冲突、易复用。',
    ].join('\n'),
    anchorModeModelPrompt: [
      '目标模型为 NovelAI V4/V4.5。',
      '请沿用锚点中的稳定外观，把输出重点放在镜头、动作、姿态、构图、光影、环境和临时状态补充。',
      '不要把锚点已经固定的稳定外观重复展开成冗长角色段。',
    ].join('\n'),
    serializationStrategy: 'nai_character_segments',
    npcPresetId: 'transformer_nai_npc',
    scenePresetId: 'transformer_nai_scene',
    sceneJudgePresetId: 'transformer_nai_scene_judge',
  },
  {
    id: 'transformer_model_bundle_gemini',
    name: 'Gemini',
    enabled: false,
    modelPrompt: [
      '目标模型为 Gemini Banana。',
      '输出更适合清晰、具体、可执行的英文描述式提示词，而不是纯 Danbooru 标签堆叠。',
      '请优先使用短英文短语或短句，不要使用 NovelAI 权重语法，不要堆砌过碎标签。',
      '若输入没有明确要求，不要擅自锁定二次元、写实、国风或摄影风格；只整理已有风格线索。',
      '描述要明确主体、服装、动作、镜头和环境，保持具体、可执行。',
      '基础段负责整体场景和镜头，角色段负责每个角色的完整可执行短语，并保持单镜头、单主动作、单主光源。',
      '若 NPC 资料较少，可以根据身份、等级、年龄、性别做保守补全，但补全内容必须长期稳定、低冲突、易复用。',
    ].join('\n'),
    anchorModeModelPrompt: [
      '目标模型为 Gemini Banana。',
      '请沿用锚点中的稳定外观，把输出重点放在镜头、动作、姿态、表情、场景、气氛和临时变化补充。',
      '不要把锚点已确定的外观再次膨胀成大段重复描述。',
    ].join('\n'),
    serializationStrategy: 'gemini_structured',
    npcPresetId: 'transformer_gemini_npc',
    scenePresetId: 'transformer_gemini_scene',
    sceneJudgePresetId: 'transformer_gemini_scene_judge',
  },
  {
    id: 'transformer_model_bundle_grok',
    name: 'Grok',
    enabled: false,
    modelPrompt: [
      '目标模型为 Grok 的 2D cinematic 风格图像模型。',
      '允许更强的电影镜头感，但成图仍需保持单帧稳定、可执行、主体清晰。',
      '提示词需要兼顾叙事张力与可执行性，保持 cinematic illustration 的组织方式，而不是杂乱堆叠。',
      '若输入没有明确要求，不要擅自锁定二次元、写实、国风或摄影风格；只整理已有风格线索。',
      '在构图、光影和环境上可以更大胆，但仍要保持一个主镜头、一个主动作、一个主光源结构。',
      '让气势服务于主体识别度和镜头稳定性。',
      '基础段负责整体调度与光影，角色段负责每个角色的姿态、动作和镜头关系。',
      '若 NPC 资料较少，可以根据身份、等级、年龄、性别做保守补全，但补全内容必须长期稳定、低冲突、易复用。',
    ].join('\n'),
    anchorModeModelPrompt: [
      '目标模型为 Grok 的 2D cinematic 风格图像模型。',
      '请沿用锚点中的稳定外观，把输出重点放在电影镜头、动作调度、姿态、光影和环境叙事。',
      '不要重复扩写锚点已经固定的核心外观。',
    ].join('\n'),
    serializationStrategy: 'grok_structured',
    npcPresetId: 'transformer_grok_npc',
    scenePresetId: 'transformer_grok_scene',
    sceneJudgePresetId: 'transformer_grok_scene_judge',
  },
];

// ═══════════════════════════════════════════════════════════
// §5 — Preset resolution (MRJH apiConfig.ts:1289-1339)
// ═══════════════════════════════════════════════════════════

/**
 * Resolve the transformer preset context for a given scope and mode.
 *
 * MRJH 获取词组转化器预设上下文 (apiConfig.ts:1289-1339)
 *
 * @param scope - 'npc' | 'scene' | 'scene_judge'
 * @param mode - 'default' (no anchor) or 'anchor' (anchor active)
 * @param activeBundleId - ID of the active model bundle (optional; defaults to first enabled)
 * @param customPresets - User-customized presets (overrides defaults)
 * @param customBundles - User-customized model bundles (overrides defaults)
 */
export function getTransformerPresetContext(
  scope: TransformerPresetScope,
  mode: 'default' | 'anchor' = 'default',
  options?: {
    activeBundleId?: string;
    customPresets?: TransformerPromptPreset[];
    customBundles?: ModelTransformerBundle[];
    includeOutputFormat?: boolean;
  },
): TransformerPresetContext {
  const presets = options?.customPresets ?? DEFAULT_PRESETS;
  const bundles = options?.customBundles ?? DEFAULT_MODEL_BUNDLES;
  const includeOutputFormat = options?.includeOutputFormat !== false;

  // Find active model bundle
  const activeBundle = options?.activeBundleId
    ? bundles.find((b) => b.id === options.activeBundleId) ?? bundles.find((b) => b.enabled)
    : bundles.find((b) => b.enabled);

  if (!activeBundle) {
    return { aiRolePrompt: '', taskPrompt: '', serializationStrategy: 'flat' };
  }

  // Resolve preset ID for scope
  const presetId = scope === 'scene'
    ? activeBundle.scenePresetId
    : scope === 'scene_judge'
      ? activeBundle.sceneJudgePresetId
      : activeBundle.npcPresetId;

  const matchedPreset = presets.find((p) => p.id === presetId && p.scope === scope);

  // Build AI role prompt from model bundle
  const aiRolePrompt = mode === 'anchor'
    ? (activeBundle.anchorModeModelPrompt || activeBundle.modelPrompt).trim()
    : activeBundle.modelPrompt.trim();

  // Build task prompt from preset
  const taskPromptParts: string[] = [];
  if (matchedPreset) {
    if (mode === 'anchor') {
      const anchorPrompt = scope === 'scene'
        ? (matchedPreset.sceneAnchorModePrompt ?? matchedPreset.anchorModePrompt ?? matchedPreset.prompt)
        : (matchedPreset.anchorModePrompt ?? matchedPreset.prompt);
      taskPromptParts.push(anchorPrompt.trim());
    } else {
      taskPromptParts.push(matchedPreset.prompt.trim());
      if (matchedPreset.noAnchorFallbackPrompt) {
        taskPromptParts.push(matchedPreset.noAnchorFallbackPrompt.trim());
      }
    }
    if (includeOutputFormat && matchedPreset.outputFormatPrompt) {
      taskPromptParts.push(matchedPreset.outputFormatPrompt.trim());
    }
  }

  return {
    aiRolePrompt,
    taskPrompt: taskPromptParts.filter(Boolean).join('\n\n'),
    serializationStrategy: activeBundle.serializationStrategy,
  };
}

/** Get the list of default presets (for UI display / editing) */
export function getDefaultPresets(): TransformerPromptPreset[] {
  return DEFAULT_PRESETS;
}

/** Get the list of default model bundles (for UI display / editing) */
export function getDefaultModelBundles(): ModelTransformerBundle[] {
  return DEFAULT_MODEL_BUNDLES;
}
