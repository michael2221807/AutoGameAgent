import type { ImageProvider, ImageBackendType } from './types';
import type { ImageReferenceInput, ImageUnderstandingRequest, ImageUnderstandingResult } from './reference-types';

export interface ImageToImageProvider {
  imageToImage(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    reference: ImageReferenceInput,
    options?: Record<string, unknown>,
  ): Promise<Blob>;
}

export interface ImageUnderstandingProvider {
  describeImage(
    request: ImageUnderstandingRequest,
    options?: Record<string, unknown>,
  ): Promise<ImageUnderstandingResult>;
}

export interface ImageProviderCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  imageCaptioning: boolean;
  imageTagging: boolean;
  inpainting: boolean;
}

export function supportsImageToImage(
  provider: ImageProvider,
): provider is ImageProvider & ImageToImageProvider {
  return 'imageToImage' in provider
    && typeof (provider as Record<string, unknown>)['imageToImage'] === 'function';
}

export function supportsImageUnderstanding(
  provider: ImageProvider,
): provider is ImageProvider & ImageUnderstandingProvider {
  return 'describeImage' in provider
    && typeof (provider as Record<string, unknown>)['describeImage'] === 'function';
}

export const PROVIDER_CAPABILITIES: Record<ImageBackendType, ImageProviderCapabilities> = {
  civitai: { textToImage: true, imageToImage: true, imageCaptioning: true, imageTagging: true, inpainting: false },
  novelai: { textToImage: true, imageToImage: true, imageCaptioning: false, imageTagging: false, inpainting: false },
  openai: { textToImage: true, imageToImage: false, imageCaptioning: false, imageTagging: false, inpainting: false },
  sd_webui: { textToImage: true, imageToImage: false, imageCaptioning: false, imageTagging: false, inpainting: false },
  comfyui: { textToImage: true, imageToImage: false, imageCaptioning: false, imageTagging: false, inpainting: false },
};
