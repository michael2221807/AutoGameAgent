// App doc: docs/user-guide/pages/game-main.md §3.13 (配音 · CosyVoice)
/**
 * TtsService — 配音编排核心。
 *
 * 职责:
 *   - 从 AIService 取 tts 类 APIConfig(getTtsConfigForBackend),经 registry
 *     解析出 CosyVoiceProvider。
 *   - speak():按 transmissionMode 走「分句流式」或「整段非流式」。
 *       · stream(默认): splitSentences 把正文切句 → 逐句 provider.getStreamUrl()
 *         (CosyVoice streaming=1)→ 服务端 chunked ogg,`<audio crossOrigin>` 原生
 *         边下边播;当前句播放时 preload 下一句 → 首句快出声、句间近无缝。每句独立
 *         回落:某句流式失败 → 该句改整段 synthesize,不牵连后续句(可靠可控)。
 *       · full:        provider.synthesize() 整段 WAV → 一次播放,最稳。
 *     stream 若不受支持(getStreamUrl 首句返回 null)整体回落 full。
 *   - 播放态经 eventBus 'tts:state' 广播给 UI(播放键/状态栏 chip)。
 *   - 失败逐级回落,永远有声音或明确 toast;不抛给调用方(fire-and-forget 安全)。
 *
 * 镜像 ImageService,但音频瞬时播放不落盘(设计文档 §5)。
 * 引擎铁律:不 import vue-i18n;toast 走 i18nKey + message 兜底。
 */
import { eventBus } from '../core/event-bus';
import type { AIService } from '../ai/ai-service';
import type { TtsProviderRegistry } from './provider-registry';
import type { TtsProvider, TtsSettings, TtsStatus, TtsStateEvent, TtsBackendType, TtsSpeaker } from './types';
import { DEFAULT_TTS_SETTINGS } from './types';
import { loadTtsSettings } from './tts-settings';
import { stripMarkersForSpeech, splitSentences } from './sentence-splitter';
import { HtmlAudioPlayer, type TtsAudioPlayer } from './audio-player';

const DEFAULT_BACKEND: TtsBackendType = 'cosyvoice';

export class TtsService {
  private settings: TtsSettings;
  private player: TtsAudioPlayer;

  // 播放态
  private status: TtsStatus = 'idle';
  private currentRoundKey: string | null = null;
  private playAbort: AbortController | null = null;

  constructor(
    private aiService: Pick<AIService, 'getTtsConfigForBackend'>,
    private registry: TtsProviderRegistry,
    opts?: { player?: TtsAudioPlayer; settings?: TtsSettings },
  ) {
    this.settings = opts?.settings ?? loadTtsSettings();
    this.player = opts?.player ?? new HtmlAudioPlayer();
  }

  // ─── settings ───

  getSettings(): TtsSettings {
    return this.settings;
  }

  setSettings(next: TtsSettings): void {
    this.settings = next;
    // Re-broadcast current state so UI subscribers (play-button visibility,
    // quick-switch chip) refresh their derived readiness when settings change.
    eventBus.emit('tts:state', this.getState());
  }

  /**
   * Re-read settings from localStorage. Call on cold-start (done in ctor) and
   * after a full-backup import restores aga_tts_settings, so the live service
   * (and orchestrator auto-narrate) don't run on a stale in-memory copy.
   * Mirrors applyPersistedAISettings for AI settings.
   */
  reloadSettings(): void {
    this.settings = loadTtsSettings();
    // Broadcast so all live UI copies (settings section, quick-switch chip,
    // play-button readiness) re-sync after a backup import re-wrote localStorage.
    eventBus.emit('tts:state', this.getState());
  }

  /** 是否具备可用配置(总开关开 + 有 tts 类 API)。UI 用于禁用播放键。 */
  isReady(): boolean {
    return this.settings.enabled && !!this.aiService.getTtsConfigForBackend(DEFAULT_BACKEND);
  }

  // ─── provider ───

  private resolveProvider(): TtsProvider | null {
    const config = this.aiService.getTtsConfigForBackend(DEFAULT_BACKEND);
    if (!config) return null;
    try {
      return this.registry.resolve({
        backend: DEFAULT_BACKEND,
        endpoint: config.url,
        apiKey: config.apiKey,
        model: config.model,
        routingPath: config.useCustomRouting ? config.customRoutingPath : undefined,
      });
    } catch {
      return null;
    }
  }

  /** 拉取服务端音色列表(设置区/ popover 用)。无配置或失败返回 []。 */
  async listSpeakers(): Promise<TtsSpeaker[]> {
    const provider = this.resolveProvider();
    if (!provider) return [];
    return provider.listSpeakers();
  }

  // ─── 播放态广播 ───

  private emitState(status: TtsStatus): void {
    this.status = status;
    eventBus.emit('tts:state', this.getState());
  }

  getState(): TtsStateEvent {
    return {
      status: this.status,
      roundKey: this.status === 'idle' ? null : this.currentRoundKey,
    };
  }

  // ─── 控制 ───

  /** 打断当前朗读并复位到 idle。 */
  stop(): void {
    this.playAbort?.abort();
    this.playAbort = null;
    this.player.stop();
    this.currentRoundKey = null;
    this.emitState('idle');
  }

  pause(): void {
    if (this.status === 'playing') {
      this.player.pause();
      this.emitState('paused');
    }
  }

  resume(): void {
    if (this.status === 'paused') {
      this.player.resume();
      this.emitState('playing');
    }
  }

  /**
   * 朗读一段文本。fire-and-forget 安全:内部吞掉错误(转 toast),不 reject。
   * @param roundKey — UI 用于标识「哪个回合在播」(如 `round-12` 或消息 idx)。
   */
  async speak(rawText: string, roundKey: string): Promise<void> {
    if (!this.settings.enabled) return;

    const provider = this.resolveProvider();
    if (!provider) {
      eventBus.emit('ui:toast', {
        type: 'warning',
        i18nKey: 'engine.toast.ttsNoConfig',
        message: '未配置可用的配音(TTS)API',
        id: 'tts-no-config',
      });
      return;
    }

    const text = stripMarkersForSpeech(rawText);
    if (!text) return;

    // 新一次朗读打断上一次
    this.stop();
    const abort = new AbortController();
    this.playAbort = abort;
    this.currentRoundKey = roundKey;

    const speaker = this.settings.defaultSpeaker;
    const instruct = this.settings.defaultInstruct || undefined;

    try {
      if (this.settings.transmissionMode === 'full') {
        await this.playFull(provider, text, speaker, instruct, abort);
      } else {
        await this.playSentenceStream(provider, text, speaker, instruct, abort);
      }
    } catch (err) {
      if (!isAbort(err)) {
        eventBus.emit('ui:toast', {
          type: 'error',
          i18nKey: 'engine.toast.ttsFailed',
          message: '配音生成失败',
          id: 'tts-failed',
        });
      }
    } finally {
      // Only reset if THIS call still owns the abort controller. If stop()/a new
      // speak() ran during the await, it reassigned this.playAbort (and already
      // emitted idle/playing), so we must not clobber the newer call's state.
      if (this.playAbort === abort) {
        this.playAbort = null;
        this.currentRoundKey = null;
        this.emitState('idle');
      }
    }
  }

  /**
   * 分句流式:切句 → 逐句 streaming=1 播放,当前句播放时 preload 下一句(近无缝)。
   * 每句独立回落:该句流式失败 → 改整段 synthesize,不牵连后续句。
   * 首句 getStreamUrl 返回 null(provider 不支持流式)→ 整体回落整段 full。
   */
  private async playSentenceStream(
    provider: TtsProvider,
    text: string,
    speaker: string,
    instruct: string | undefined,
    abort: AbortController,
  ): Promise<void> {
    const segments = splitSentences(text);
    if (segments.length === 0) return;

    // 一次性算出每句的流式 URL(纯函数,便于测试断言调用次数 == 句数)。
    const urls = segments.map((seg) => provider.getStreamUrl(seg, { speaker, instruct }));
    if (urls[0] === null) {
      // provider 不支持传输级流式 → 整体回落整段合成,避免逐句都失败。
      await this.playFull(provider, text, speaker, instruct, abort);
      return;
    }

    this.emitState('playing');
    for (let i = 0; i < segments.length; i++) {
      if (abort.signal.aborted) return;
      // 预取下一句:当前句播放期间浏览器已在后台缓冲下一句 → 句间近无缝。
      const nextUrl = urls[i + 1];
      if (nextUrl) this.player.preload?.(nextUrl);
      await this.playSegment(provider, segments[i], urls[i], speaker, instruct, abort);
    }
  }

  /** 播放单句:优先流式 URL;非取消失败 → 该句回落整段 synthesize。 */
  private async playSegment(
    provider: TtsProvider,
    seg: string,
    streamUrl: string | null,
    speaker: string,
    instruct: string | undefined,
    abort: AbortController,
  ): Promise<void> {
    const playOpts = { rate: this.settings.rate, volume: this.settings.volume, signal: abort.signal };
    if (streamUrl) {
      try {
        await this.player.playUrl(streamUrl, playOpts);
        return;
      } catch (streamErr) {
        if (isAbort(streamErr)) throw streamErr; // 真取消 → 上抛,不回落
        // 该句流式失败(CORS/5xx/编码)→ 落该句整段 synthesize。
      }
    }
    if (abort.signal.aborted) return;
    const blob = await provider.synthesize(seg, { speaker, instruct, signal: abort.signal });
    if (abort.signal.aborted) return;
    await this.player.play(blob, playOpts);
  }

  /** 整段非流式:一次 synthesize 整段 → 一次播放。最稳,无句间处理。 */
  private async playFull(
    provider: TtsProvider,
    text: string,
    speaker: string,
    instruct: string | undefined,
    abort: AbortController,
  ): Promise<void> {
    this.emitState('synthesizing');
    const blob = await provider.synthesize(text, { speaker, instruct, signal: abort.signal });
    if (abort.signal.aborted) return;
    this.emitState('playing');
    await this.player.play(blob, { rate: this.settings.rate, volume: this.settings.volume, signal: abort.signal });
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError'
    : err instanceof Error ? /abort|signal/i.test(err.message)
    : false;
}

export { DEFAULT_TTS_SETTINGS };
