/**
 * Image subsystem type definitions — Sprint Image-1
 *
 * Defines the core interfaces for the pluggable image generation system.
 * All types are engine-generic (no game-specific content — PRINCIPLES §3.3).
 * Provider-specific request/response shapes are encapsulated inside each
 * provider implementation.
 */

/** Supported image backend types — matches the `imageBackend` field on APIConfig */
export type ImageBackendType = 'openai' | 'novelai' | 'sd_webui' | 'comfyui';

/** Image task status lifecycle */
export type ImageTaskStatus = 'pending' | 'tokenizing' | 'generating' | 'complete' | 'failed';

/** What kind of subject is being generated */
export type ImageSubjectType = 'scene' | 'character' | 'secret_part';

/** Secret part sub-type — matches MRJH 香闺秘档部位类型 */
export type SecretPartType = 'breast' | 'vagina' | 'anus';

/**
 * Structured feature tags extracted from an anchor by the AI.
 * Each field is an optional array of English image-gen tags.
 * Mirrors MRJH 角色锚点特征结构 (models/system.ts:60-71).
 */
export interface AnchorStructuredFeatures {
  appearance?: string[];
  figure?: string[];
  bust?: string[];
  hairstyle?: string[];
  hairColor?: string[];
  eyes?: string[];
  skinTone?: string[];
  ageAppearance?: string[];
  baseOutfit?: string[];
  specialTraits?: string[];
}

/**
 * Character anchor — reusable visual DNA for a character.
 *
 * Per PRINCIPLES §3.16: anchor references an Engram entity (unidirectional);
 * visual DNA lives only in the anchor record; Engram entity schema stays pure.
 */
export interface CharacterAnchor {
  /** Unique anchor ID */
  id: string;
  /** Optional reference to an Engram entity ID (unidirectional per §3.16) */
  entityRef: string | null;
  /** Character name this anchor describes */
  characterName: string;
  /** Tokenized visual description tags (populated by tokenizer CoT in Image-2) */
  tokens: string[];
  /** Artist/style tags to include when generating this character */
  styleTags: string[];
  /** Structured feature tags for composition-aware anchor injection */
  structuredFeatures?: AnchorStructuredFeatures;
  /** Optional seed for reproducibility */
  seed?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Style preset — extracted from PNG metadata or user-defined.
 *
 * Contains the "how to render" parameters without the "what to render" content.
 */
export interface StylePreset {
  id: string;
  name: string;
  /** Positive prompt prefix (style, quality, artist) */
  positivePrefix: string;
  /** Positive prompt suffix */
  positiveSuffix: string;
  /** Negative prompt */
  negative: string;
  /** Preferred image dimensions */
  width: number;
  height: number;
  /** Sampler name (provider-specific string) */
  sampler?: string;
  /** Noise schedule (provider-specific) */
  noiseSchedule?: string;
  /** Steps */
  steps?: number;
  /** CFG scale */
  cfgScale?: number;
  /** Source: 'png_import' | 'user_defined' | 'pack_default' */
  source: string;
}

/**
 * Image generation task — represents a single generation request.
 *
 * Lifecycle: pending → tokenizing → generating → complete/failed
 */
export interface ImageTask {
  id: string;
  status: ImageTaskStatus;
  subjectType: ImageSubjectType;
  /** Target character name (for character/secret_part types) */
  targetCharacter?: string;
  /** Anchor ID used for character consistency */
  anchorId?: string;
  /** Style preset ID */
  presetId?: string;
  /** Final composed positive prompt (populated after tokenization) */
  positivePrompt?: string;
  /** Final composed negative prompt */
  negativePrompt?: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Result asset ID (populated on completion) */
  resultAssetId?: string;
  /** Error message (populated on failure) */
  error?: string;
  /** Backend type used */
  backend: ImageBackendType;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
}

/**
 * Stored image asset — the actual generated image reference.
 */
export interface ImageAsset {
  id: string;
  /** The task that produced this asset */
  taskId: string;
  /** Storage key (IndexedDB key or URL) */
  storageKey: string;
  /** MIME type (image/png, image/webp, etc.) */
  mimeType: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Backend that generated it */
  backend: ImageBackendType;
  /** Generation timestamp */
  createdAt: number;
}

/**
 * Image provider interface — each backend implements this.
 *
 * Implementations live in `providers/{backend}.ts`. Sprint Image-1 provides
 * stubs that throw; real implementations land in Sprint Image-5.
 */
export interface ImageProvider {
  /** Backend identifier */
  readonly backend: ImageBackendType;

  /**
   * Generate an image from a composed prompt.
   *
   * @param prompt Positive prompt (fully composed — tokens + style + artist tags)
   * @param negative Negative prompt
   * @param width Image width in pixels
   * @param height Image height in pixels
   * @param options Provider-specific options (model, sampler, steps, seed, etc.)
   * @returns Raw image data as a Blob
   */
  generate(
    prompt: string,
    negative: string,
    width: number,
    height: number,
    options?: Record<string, unknown>,
  ): Promise<Blob>;

  /**
   * Test connectivity to this provider's endpoint.
   * @returns true if reachable and authenticated
   */
  testConnection(): Promise<boolean>;
}

/**
 * Provider constructor signature — used by the provider registry.
 */
export type ImageProviderFactory = (config: {
  endpoint: string;
  apiKey: string;
  model?: string;
}) => ImageProvider;
