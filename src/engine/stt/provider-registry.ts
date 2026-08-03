// App doc: docs/user-guide/pages/game-main.md §3.14 (语音输入 · STT)
/**
 * STT provider registry — maps `SttBackendType` → factory function.
 * `resolve()` creates the right provider for a given API configuration.
 *
 * Mirrors TtsProviderRegistry (src/engine/tts/provider-registry.ts).
 *
 * Usage:
 *   const registry = new SttProviderRegistry();
 *   registry.register('cosyvoice', (c) => new CosyVoiceSttProvider(c.endpoint, c.apiKey, c.routingPath));
 *   const provider = registry.resolve({ backend: 'cosyvoice', endpoint: '...', apiKey: '' });
 */
import type { SttBackendType, SttProvider, SttProviderFactory } from './types';

export class SttProviderRegistry {
  private factories = new Map<SttBackendType, SttProviderFactory>();

  register(backend: SttBackendType, factory: SttProviderFactory): void {
    this.factories.set(backend, factory);
  }

  resolve(config: {
    backend: SttBackendType;
    endpoint: string;
    apiKey: string;
    model?: string;
    routingPath?: string;
  }): SttProvider {
    const factory = this.factories.get(config.backend);
    if (!factory) {
      throw new Error(
        `[SttProviderRegistry] No provider registered for backend "${config.backend}". ` +
        `Registered: [${[...this.factories.keys()].join(', ')}]`,
      );
    }
    return factory({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      routingPath: config.routingPath,
    });
  }

  has(backend: SttBackendType): boolean {
    return this.factories.has(backend);
  }

  get registeredBackends(): SttBackendType[] {
    return [...this.factories.keys()];
  }
}
