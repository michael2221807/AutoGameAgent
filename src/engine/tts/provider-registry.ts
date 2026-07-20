/**
 * TTS provider registry — maps `TtsBackendType` → factory function.
 * `resolve()` creates the right provider for a given API configuration.
 *
 * Mirrors ImageProviderRegistry (src/engine/image/provider-registry.ts).
 *
 * Usage:
 *   const registry = new TtsProviderRegistry();
 *   registry.register('cosyvoice', (c) => new CosyVoiceProvider(c.endpoint, c.apiKey, c.routingPath));
 *   const provider = registry.resolve({ backend: 'cosyvoice', endpoint: '...', apiKey: '' });
 */
import type { TtsBackendType, TtsProvider, TtsProviderFactory } from './types';

export class TtsProviderRegistry {
  private factories = new Map<TtsBackendType, TtsProviderFactory>();

  register(backend: TtsBackendType, factory: TtsProviderFactory): void {
    this.factories.set(backend, factory);
  }

  resolve(config: {
    backend: TtsBackendType;
    endpoint: string;
    apiKey: string;
    model?: string;
    routingPath?: string;
  }): TtsProvider {
    const factory = this.factories.get(config.backend);
    if (!factory) {
      throw new Error(
        `[TtsProviderRegistry] No provider registered for backend "${config.backend}". ` +
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

  has(backend: TtsBackendType): boolean {
    return this.factories.has(backend);
  }

  get registeredBackends(): TtsBackendType[] {
    return [...this.factories.keys()];
  }
}
