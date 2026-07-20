/**
 * TtsService — 配音编排核心。
 *
 * 职责:
 *   - 从 AIService 取 tts 类 APIConfig(getTtsConfigForBackend),经 registry
 *     解析出 CosyVoiceProvider。
 *   - speak():按 transmissionMode 走「分段流水线」或「整段非流式」;分段模式
 *     逐句合成 + 队列播放,合成第 N 段时预取第 N+1 段(首句秒出声)。
 *   - 播放态经 eventBus 'tts:state' 广播给 UI(播放键/高亮/状态栏 chip)。
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
import { splitSentences, stripMarkersForSpeech } from './sentence-splitter';
import { HtmlAudioPlayer, type TtsAudioPlayer } from './audio-player';

const DEFAULT_BACKEND: TtsBackendType = 'cosyvoice';

export class TtsService {
  private settings: TtsSettings;
  private player: TtsAudioPlayer;

  // 播放态
  private status: TtsStatus = 'idle';
  private currentRoundKey: string | null = null;
  private segmentIndex = -1;
  private totalSegments = 0;
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
    const payload: TtsStateEvent = {
      status,
      roundKey: status === 'idle' ? null : this.currentRoundKey,
      segmentIndex: this.segmentIndex,
      totalSegments: this.totalSegments,
    };
    eventBus.emit('tts:state', payload);
  }

  getState(): TtsStateEvent {
    return {
      status: this.status,
      roundKey: this.status === 'idle' ? null : this.currentRoundKey,
      segmentIndex: this.segmentIndex,
      totalSegments: this.totalSegments,
    };
  }

  // ─── 控制 ───

  /** 打断当前朗读并复位到 idle。 */
  stop(): void {
    this.playAbort?.abort();
    this.playAbort = null;
    this.player.stop();
    this.segmentIndex = -1;
    this.totalSegments = 0;
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

    // 新一次朗读打断上一次
    this.stop();
    const abort = new AbortController();
    this.playAbort = abort;
    this.currentRoundKey = roundKey;

    const speaker = this.settings.defaultSpeaker;
    const instruct = this.settings.defaultInstruct || undefined;

    try {
      if (this.settings.transmissionMode === 'full') {
        await this.speakFull(provider, rawText, speaker, instruct, abort.signal);
      } else {
        await this.speakSegmented(provider, rawText, speaker, instruct, abort.signal);
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
      // When we still own it, abort.signal is necessarily not aborted (stop()
      // reassigns playAbort in the same synchronous call that aborts) → reset.
      if (this.playAbort === abort) {
        this.playAbort = null;
        this.segmentIndex = -1;
        this.totalSegments = 0;
        this.currentRoundKey = null;
        this.emitState('idle');
      }
    }
  }

  private async speakFull(
    provider: TtsProvider, rawText: string, speaker: string,
    instruct: string | undefined, signal: AbortSignal,
  ): Promise<void> {
    const text = stripMarkersForSpeech(rawText);
    if (!text) return;
    this.segmentIndex = -1;
    this.totalSegments = 0;
    this.emitState('synthesizing');
    const blob = await provider.synthesize(text, { speaker, instruct, signal });
    if (signal.aborted) return;
    this.emitState('playing');
    await this.player.play(blob, { rate: this.settings.rate, volume: this.settings.volume, signal });
  }

  private async speakSegmented(
    provider: TtsProvider, rawText: string, speaker: string,
    instruct: string | undefined, signal: AbortSignal,
  ): Promise<void> {
    const segments = splitSentences(rawText);
    if (segments.length === 0) return;
    this.totalSegments = segments.length;

    // synth() NEVER rejects — swallows every error (abort included) to null.
    // This is deliberate: a prefetched segment (nextBlob) may be discarded when
    // the loop returns early on abort; if synth() rethrew, that discarded promise
    // would surface as an unhandled AbortError rejection. Returning null instead
    // keeps termination driven purely by the signal.aborted checks below.
    const synth = (seg: string): Promise<Blob | null> =>
      provider.synthesize(seg, { speaker, instruct, signal }).catch(() => null);

    // 预取第 1 段
    this.segmentIndex = 0;
    this.emitState('synthesizing');
    let nextBlob: Promise<Blob | null> | null = synth(segments[0]);

    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) return;
      const blob = await nextBlob;
      // 播第 i 段前,先启动第 i+1 段的合成(流水线:合成与播放重叠)
      nextBlob = i + 1 < segments.length ? synth(segments[i + 1]) : null;
      if (!blob) continue; // 该段合成失败,跳过
      if (signal.aborted) return;
      this.segmentIndex = i;
      this.emitState('playing');
      await this.player.play(blob, { rate: this.settings.rate, volume: this.settings.volume, signal });
    }
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError'
    : err instanceof Error ? /abort|signal/i.test(err.message)
    : false;
}

export { DEFAULT_TTS_SETTINGS };
