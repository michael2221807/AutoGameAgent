/**
 * TTS 层类型定义 — 语音配音子系统
 *
 * 架构镜像自 image 子系统(见 src/engine/image/types.ts):provider 接口 +
 * backend 类型 + registry 工厂 + 独立 fetch(非 LLM 类别,apiCategory='tts')。
 *
 * 引擎铁律:本文件不 import vue-i18n、不含游戏特定内容。所有音色名/风格串
 * 由用户配置或 pack 传入,引擎只按 dot-path/参数操作。
 *
 * 设计文档:docs/design/tts-system-design.md
 */

// ─── Backend / Provider ───

/** TTS 后端类型 — 决定请求格式与端点。首个:CosyVoice。 */
export type TtsBackendType = 'cosyvoice';

/** 单次合成选项 */
export interface TtsSynthesizeOptions {
  /** 音色 → 查询参数 speaker(CosyVoice: voices/*.pt 的名字) */
  speaker: string;
  /** 风格/方言 → 查询参数 instruct(自然语言,可空) */
  instruct?: string;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 服务端可用音色条目(CosyVoice: GET /speakers) */
export interface TtsSpeaker {
  name: string;
  voiceId: string;
}

/**
 * TTS Provider 抽象接口 — 每个 backend 实现一份。
 * 镜像 ImageProvider(image/types.ts)。
 */
export interface TtsProvider {
  readonly backend: TtsBackendType;
  /** 合成整段文本 → 音频 Blob(整段非流式:此 build 为完整 WAV) */
  synthesize(text: string, options: TtsSynthesizeOptions): Promise<Blob>;
  /**
   * 真·传输级流式播放 URL —— 让 `<audio>` 直接渐进播放服务端的 chunked 输出。
   * CosyVoice: `GET {url}?text=&speaker=&instruct=&streaming=1` → chunked audio/ogg，
   * 浏览器原生边下边播（实测 canplay ~4.5s，无需 MSE）。
   * 返回 `null` 表示该 backend 不支持传输级流式（调用方回落整段 synthesize）。
   */
  getStreamUrl(text: string, options: Omit<TtsSynthesizeOptions, 'signal'>): string | null;
  /** 拉取服务端可用音色列表;失败返回 [](UI 降级为自由输入) */
  listSpeakers(signal?: AbortSignal): Promise<TtsSpeaker[]>;
  // NOTE: no testConnection() here — the production "test connection" probe lives
  // in AIService.testConnection (apiCategory='tts' branch), which is what APIPanel
  // calls with a raw config. Keeping a second impl here would only invite drift.
}

/** Provider 工厂签名 — 由 registry 注册 */
export type TtsProviderFactory = (config: {
  endpoint: string;
  apiKey: string;
  model?: string;
  /** 自定义查询路径(默认 '/') */
  routingPath?: string;
}) => TtsProvider;

// ─── 全局配音设置(持久化到 aga_tts_settings) ───

/** 常用音色收藏项 */
export interface TtsVoiceFavorite {
  speaker: string;
  instruct: string;
}

/**
 * 全局配音偏好 — 跨存档统一,存 localStorage `aga_tts_settings`。
 * 经 collectLocalStorageSettings 自动进 engineSettings → 随备份/云同步。
 */
export interface TtsSettings {
  /** 总开关 — 关闭后播放键与自动配音全部失效 */
  enabled: boolean;
  /** 自动配音 — AI 出文后自动朗读正文(post-round fire-and-forget) */
  autoNarrateOnRound: boolean;
  /**
   * 'stream' = 真·传输级流式(streaming=1,服务端 chunked ogg,浏览器边下边播,默认);
   * 'full'   = 整段非流式(完整 WAV 一次播放,更稳)
   */
  transmissionMode: 'stream' | 'full';
  /** 默认音色 → speaker */
  defaultSpeaker: string;
  /** 默认风格/方言 → instruct */
  defaultInstruct: string;
  /** 播放速率(HTMLAudioElement.playbackRate),0.5–2.0 */
  rate: number;
  /** 音量 0–1 */
  volume: number;
  /** 常用音色收藏(主面板 popover 候选) */
  favorites: TtsVoiceFavorite[];
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  enabled: false,
  autoNarrateOnRound: false,
  transmissionMode: 'stream',
  defaultSpeaker: '',
  defaultInstruct: '',
  rate: 1,
  volume: 0.85,
  favorites: [],
};

export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 2;

// ─── 播放态事件(eventBus 'tts:state') ───

export type TtsStatus = 'idle' | 'synthesizing' | 'playing' | 'paused';

/** 'tts:state' 事件负载 — 供 UI 播放键/状态栏 chip 同步 */
export interface TtsStateEvent {
  status: TtsStatus;
  /** 当前朗读的回合标识(UI 用于定位是哪个回合在播),idle 时为 null */
  roundKey: string | null;
}
