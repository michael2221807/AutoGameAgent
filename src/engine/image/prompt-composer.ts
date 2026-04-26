/**
 * Image Prompt Composer — aligned with MRJH 构建最终图片提示词
 *
 * Assembles final positive/negative prompts from tokenized tags + style presets
 * + character anchors. Handles:
 * - Composition-aware default sizing (MRJH imageTasks.ts:1397-1407)
 * - Artist preset injection as prefix
 * - Negative prompt merging (custom + composition-specific + auto watermark)
 * - NAI character segment (| separator) support
 * - Inline negative for backends without separate negative field
 */

/** MRJH imageTasks.ts:78 — always appended to final negative */
const DEFAULT_NEGATIVE_WATERMARK = 'text, watermark, signature, username, logo, artist name, web address, url, copyright, subtitle';

/** MRJH imageTasks.ts:79 — NovelAI backend default negative */
export const DEFAULT_NOVELAI_NEGATIVE = 'photorealistic, realistic, 3d, rendering, unreal engine, octane render, real life, photography, bokeh, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, border, out of frame';

/** MRJH npcSecretImageWorkflow.ts:67 — secret part close-up exclusion */
export const DEFAULT_SECRET_PART_NEGATIVE = 'face, eyes, portrait, headshot, upper body, half body, full body, torso, abdomen, legs, arm, feet, hands, multiple people, extra legs, extra arms, extra breasts, extra nipples, extra fingers, three legs, three breasts, merged body parts, room focus, scenery focus, environment focus, background focus, wide shot, mid shot, text, watermark, speech bubble, dialogue box, blurry, low quality, bad anatomy';

/** MRJH imageTasks.ts:1379-1381 — composition-specific negative */
const COMPOSITION_NEGATIVE: Partial<Record<string, string>> = {
  secret_part: 'multiple views, split screen, panel layout, comic panel, comic page, collage, contact sheet, reference sheet, character sheet, turnaround, comparison sheet, montage, triptych, diptych, quadriptych, grid layout, tiled composition',
};

/** Composition → default size fallback (MRJH imageTasks.ts:1397-1407) */
const COMPOSITION_SIZE: Record<string, { w: number; h: number }> = {
  portrait: { w: 1024, h: 1024 },
  'half-body': { w: 768, h: 1024 },
  'full-length': { w: 832, h: 1216 },
  scene: { w: 1024, h: 576 },
  secret_part: { w: 1024, h: 1024 },
};

export interface ComposeInput {
  /** Tokenizer output — main subject tags */
  subjectTokens: string[];
  /** Tokenizer output — negative tags */
  subjectNegative?: string[];
  /** Composition type */
  composition?: 'portrait' | 'half-body' | 'full-length' | 'scene' | 'secret_part' | 'custom';
  /** Artist preset — prepended to positive prompt */
  artistPrefix?: string;
  /** Extra negative from artist/PNG presets */
  extraNegative?: string;
  /** Explicit width override */
  width?: number;
  /** Explicit height override */
  height?: number;
  /** Whether the tokenizer used NAI character segments (| separator) */
  useNaiSegments?: boolean;
}

export interface ComposedPrompt {
  positive: string;
  negative: string;
  width: number;
  height: number;
}

function dedup(parts: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of parts) {
    for (const t of p.split(',').map((s) => s.trim()).filter(Boolean)) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(t);
      }
    }
  }
  return result.join(', ');
}

export class ImagePromptComposer {
  compose(input: ComposeInput): ComposedPrompt {
    const comp = input.composition ?? 'portrait';

    // ── Size resolution (MRJH: explicit → composition default → 1024²) ──
    const defaultSize = COMPOSITION_SIZE[comp] ?? COMPOSITION_SIZE.portrait;
    let w = input.width && input.width > 0 ? input.width : defaultSize.w;
    let h = input.height && input.height > 0 ? input.height : defaultSize.h;

    // Portrait (头像) forces square (MRJH imageTasks.ts:1409-1413)
    if (comp === 'portrait' && w !== h) {
      w = 1024;
      h = 1024;
    }

    // ── Positive prompt assembly ──
    const mainPrompt = input.subjectTokens.filter(Boolean).join(', ');

    let positive: string;
    if (input.useNaiSegments && mainPrompt.includes('|')) {
      // NAI character segments: artist prefix merges into base segment only
      const segments = mainPrompt.split('|').map((s) => s.trim()).filter(Boolean);
      const [base, ...roles] = segments;
      const mergedBase = [input.artistPrefix, base].filter(Boolean).join(', ');
      positive = [mergedBase, ...roles].filter(Boolean).join(' | ');
    } else {
      positive = [input.artistPrefix, mainPrompt].filter(Boolean).join(', ');
    }

    // ── Negative prompt assembly (custom + composition-specific + watermark) ──
    const negativeParts: string[] = [];
    if (input.subjectNegative?.length) negativeParts.push(input.subjectNegative.join(', '));
    if (input.extraNegative) negativeParts.push(input.extraNegative);
    if (COMPOSITION_NEGATIVE[comp]) negativeParts.push(COMPOSITION_NEGATIVE[comp]!);
    negativeParts.push(DEFAULT_NEGATIVE_WATERMARK);

    const negative = dedup(negativeParts);

    return { positive, negative, width: w, height: h };
  }
}
