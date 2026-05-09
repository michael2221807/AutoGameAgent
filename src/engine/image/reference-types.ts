import type { ImageBackendType } from './types';

export type ImageReferenceRole =
  | 'source'
  | 'style'
  | 'composition'
  | 'mask'
  | 'control';

export type ImageReferenceSource =
  | 'upload'
  | 'asset'
  | 'url'
  | 'data_url';

export interface ImageReferenceInput {
  id: string;
  role: ImageReferenceRole;
  source: ImageReferenceSource;
  assetId?: string;
  url?: string;
  dataUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  denoiseStrength?: number;
  providerMeta?: Record<string, unknown>;
}

/**
 * Generation mode.
 * MVP uses 'text_to_image' and 'image_to_image' only.
 * @reserved 'inpaint' and 'reference' — not implemented in MVP
 */
export type ImageGenerationMode =
  | 'text_to_image'
  | 'image_to_image'
  | 'inpaint'
  | 'reference';

export interface ImageGenerationReferenceParams {
  mode: ImageGenerationMode;
  references?: ImageReferenceInput[];
}

export interface ImageUnderstandingRequest {
  backend: ImageBackendType;
  image: ImageReferenceInput;
  task: 'caption' | 'tags' | 'both';
  prompt?: string;
  threshold?: number;
  temperature?: number;
  maxNewTokens?: number;
}

export interface ImageUnderstandingTag {
  text: string;
  confidence?: number;
  category?: string;
}

export interface ImageUnderstandingResult {
  provider: ImageBackendType;
  task: 'caption' | 'tags' | 'both';
  caption?: string;
  tags?: ImageUnderstandingTag[];
  /** Always populated: tags joined for 'tags', caption text for 'caption', both merged for 'both'. Empty string if provider returned nothing. */
  positiveDraft: string;
  negativeDraft?: string;
  raw?: unknown;
  createdAt: number;
}

export interface ReferenceLibraryEntry {
  id: string;
  assetId: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  source: 'upload' | 'gallery' | 'scene' | 'player';
  createdAt: number;
  lastUsedAt?: number;
  tags?: string[];
  notes?: string;
}
