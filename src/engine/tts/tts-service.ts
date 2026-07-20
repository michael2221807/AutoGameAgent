/**
 * TtsService — 配音编排核心。
 *
 * 职责:
 *   - 从 AIService 取 tts 类 APIConfig(getTtsConfigForBackend),经 registry
 *     解析出 CosyVoiceProvider。
 *   - speak():按 transmissionMode 走「真流式」或「整段非流式」。
 *       · stream(默认): provider.getStreamUrl()(CosyVoice streaming=1)→ 服务端
 *         chunked ogg,`<audio>` 原生边下边播,首字节即出声。
 *       · full:        provider.synthesize() 整段 WAV → 一次播放,更稳。
 *     stream 若不受支持(getStreamUrl 返回 null)自动回落 full。
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
import { stripMarkersForSpeech } from './sentence-splitter';
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

    const playOpts = { rate: this.settings.rate, volume: this.settings.volume, signal: abort.signal };
    try {
      // stream 模式优先走真·传输级流式;失败(非取消)自动回落 full,保证有声音。
      const streamUrl = this.settings.transmissionMode === 'stream'
        ? provider.getStreamUrl(text, { speaker, instruct })
        : null;
      let streamFailed = false;
      if (streamUrl) {
        try {
          this.emitState('playing');
          await this.player.playUrl(streamUrl, playOpts);
        } catch (streamErr) {
          if (isAbort(streamErr)) throw streamErr; // 真取消 → 上抛,不回落
          streamFailed = true; // 流式路径失败(CORS/服务端 5xx/编码)→ 回落整段
        }
      }
      if ((!streamUrl || streamFailed) && !abort.signal.aborted) {
        this.emitState('synthesizing');
        const blob = await provider.synthesize(text, { speaker, instruct, signal: abort.signal });
        if (abort.signal.aborted) return;
        this.emitState('playing');
        await this.player.play(blob, playOpts);
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
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError'
    : err instanceof Error ? /abort|signal/i.test(err.message)
    : false;
}

export { DEFAULT_TTS_SETTINGS };
