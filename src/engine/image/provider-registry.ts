/**
 * Image provider registry — Sprint Image-1
 *
 * Maps `ImageBackendType` → factory function. `resolve()` creates the right
 * provider for a given API configuration.
 *
 * Usage:
 *   const registry = new ImageProviderRegistry();
 *   registry.register('novelai', (c) => new NovelAIImageProvider(c.endpoint, c.apiKey, c.model));
 *   const provider = registry.resolve({ backend: 'novelai', endpoint: '...', apiKey: '...' });
 */
import type { ImageBackendType, ImageProvider, ImageProviderFactory } from './types';

export class ImageProviderRegistry {
  private factories = new Map<ImageBackendType, ImageProviderFactory>();

  register(backend: ImageBackendType, factory: ImageProviderFactory): void {
    this.factories.set(backend, factory);
  }

  resolve(config: {
    backend: ImageBackendType;
    endpoint: string;
    apiKey: string;
    model?: string;
  }): ImageProvider {
    const factory = this.factories.get(config.backend);
    if (!factory) {
      throw new Error(
        `[ImageProviderRegistry] No provider registered for backend "${config.backend}". ` +
        `Registered: [${[...this.factories.keys()].join(', ')}]`
      );
    }
    return factory({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  has(backend: ImageBackendType): boolean {
    return this.factories.has(backend);
  }

  get registeredBackends(): ImageBackendType[] {
    return [...this.factories.keys()];
  }
}
