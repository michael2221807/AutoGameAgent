/**
 * Base image provider — abstract stub for Sprint Image-1.
 *
 * Each concrete provider (NovelAI, OpenAI DALL-E, SD-WebUI, ComfyUI) extends
 * this class. In Image-1 all methods throw NotImplementedError; real
 * implementations arrive in Image-5.
 */
import type { ImageProvider, ImageBackendType } from '../types';

export const IMAGE_GENERATE_TIMEOUT_MS = 180_000;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000;

export class NotImplementedError extends Error {
  constructor(backend: string, method: string) {
    super(`[Image] ${backend}.${method}() is not implemented yet (Sprint Image-5)`);
    this.name = 'NotImplementedError';
  }
}

export abstract class BaseImageProvider implements ImageProvider {
  abstract readonly backend: ImageBackendType;

  constructor(
    protected endpoint: string,
    protected apiKey: string,
    protected model?: string,
  ) {}

  async generate(
    _prompt: string,
    _negative: string,
    _width: number,
    _height: number,
    _options?: Record<string, unknown>,
  ): Promise<Blob> {
    throw new NotImplementedError(this.backend, 'generate');
  }

  async testConnection(): Promise<boolean> {
    throw new NotImplementedError(this.backend, 'testConnection');
  }
}
