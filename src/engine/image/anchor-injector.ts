/**
 * Composition-aware anchor injection — MRJH imageTasks.ts:2161-2239
 *
 * Filters a character anchor's positive prompt based on composition type.
 * Portrait crops to face/hair tags; secret parts allow only body-relevant
 * tags; half-body/full-length/scene pass the full anchor unchanged.
 *
 * Two strategies (in priority order):
 * 1. Structured features — pick from categorized tag arrays
 * 2. Raw prompt parsing — regex allow/deny on comma-split tokens
 *
 * All regex patterns are verbatim from MRJH.
 */
import type { AnchorStructuredFeatures, SecretPartType } from './types';

export type AnchorComposition = 'portrait' | 'half-body' | 'full-length' | 'scene' | 'secret_part' | 'custom';

export interface AnchorInput {
  positive: string;
  structuredFeatures?: AnchorStructuredFeatures;
}

export interface AnchorInjectionOptions {
  composition: AnchorComposition;
  secretPartType?: SecretPartType;
}

// ── MRJH imageTasks.ts:2169-2172 — camera/composition words to always strip ──
const CAMERA_WORDS_RE = /(headshot|portrait|upper body|waist-?up|full body|cowboy shot|close-?up|extreme close-?up|wide shot|mid shot|low angle|high angle|standing|sitting|kneeling|running|framing|character sheet|composition|depth of field|rule of thirds|feet included|floor contact|avatar)/i;

// ── Helpers matching MRJH utility functions ──

/** MRJH 按逗号拆分提示词 (imageTasks.ts:2061-2067) */
function splitByComma(text: string): string[] {
  return (text || '')
    .replace(/\r?\n+/g, ', ')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** MRJH 去重提示词片段 (imageTasks.ts:2120-2132) */
function dedupTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const normalized = token.replace(/^[-*•\s]+/, '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

/** MRJH 去除镜头构图词 (imageTasks.ts:2169-2172) */
function removeCameraWords(tokens: string[]): string[] {
  return tokens.filter((token) => !CAMERA_WORDS_RE.test(token));
}

/**
 * Pick tags from structured feature arrays by key.
 * MRJH 从结构化特征挑选 (imageTasks.ts:2174-2184)
 */
function pickFromFeatures(
  features: AnchorStructuredFeatures | undefined,
  keys: Array<keyof AnchorStructuredFeatures>,
  limit = 24,
): string[] {
  if (!features) return [];
  const fragments = keys
    .flatMap((key) => (Array.isArray(features[key]) ? features[key]! : []))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return removeCameraWords(dedupTokens(fragments)).slice(0, Math.max(0, limit));
}

/**
 * Pick tags from raw positive prompt via allow/deny regex.
 * MRJH 从原始提示词挑选 (imageTasks.ts:2186-2193)
 */
function pickFromRawPrompt(
  positive: string,
  params: { allow: RegExp; deny: RegExp; limit?: number },
): string[] {
  if (!positive) return [];
  // NAI weight syntax → skip injection to avoid breaking grouped syntax
  if (/::/.test(positive)) return [];
  const tokens = removeCameraWords(dedupTokens(splitByComma(positive)));
  const filtered = tokens.filter((token) => params.allow.test(token) && !params.deny.test(token));
  return filtered.slice(0, Math.max(0, params.limit ?? 24));
}

/**
 * Filter a character anchor's positive prompt based on composition.
 *
 * Returns a comma-joined string of composition-appropriate tags,
 * or the full anchor positive prompt for compositions that need
 * the complete visual DNA (half-body, full-length, scene, custom).
 *
 * MRJH 构建角色锚点注入提示词 (imageTasks.ts:2161-2239)
 */
export function injectAnchorByComposition(
  anchor: AnchorInput | null | undefined,
  options: AnchorInjectionOptions,
): string {
  const positive = (anchor?.positive || '').trim();
  const features = anchor?.structuredFeatures;
  const composition = options.composition;

  // ── Portrait (头像): face/hair/eye/skin/age only ──
  // MRJH imageTasks.ts:2195-2209
  if (composition === 'portrait') {
    const tokensFromFeatures = pickFromFeatures(
      features,
      ['appearance', 'hairstyle', 'hairColor', 'eyes', 'skinTone', 'ageAppearance', 'specialTraits'],
      20,
    );
    if (tokensFromFeatures.length > 0) return tokensFromFeatures.join(', ');

    // MRJH imageTasks.ts:2207 — allow regex (verbatim)
    const allow = /(1girl|1boy|girl|boy|woman|man|female|male|young|adult|teen|hair|eyes?|iris|pupil|eyebrow|eyelash|face|lips?|mouth|nose|skin|complexion|freckle|mole|beauty mark|scar|tattoo|makeup|ear|neck)/i;
    // MRJH imageTasks.ts:2208 — deny regex (verbatim)
    const deny = /(breast|bust|cleavage|waist|hip|thigh|leg|feet|nude|dress|robe|hanfu|armor|outfit|clothing|sleeve|glove|stocking|boots|pants|skirt|kimono|cape|cloak|weapon|sword|background|scenery|environment|landscape)/i;
    return pickFromRawPrompt(positive, { allow, deny, limit: 16 }).join(', ');
  }

  // ── Secret part (部位特写) ──
  // MRJH imageTasks.ts:2212-2234
  if (composition === 'secret_part') {
    const part = options.secretPartType;

    // Breast close-up: allow breast/skin/age tags
    // MRJH imageTasks.ts:2214-2223
    if (part === 'breast') {
      const allow = /(breast|breasts|bust|cup|cleavage|nipple|nipples|areola|chest|skin|complexion|pale|fair|tan|young|adult|teen)/i;
      const deny = /(face|eyes?|hair|lips?|mouth|nose|dress|robe|hanfu|armor|outfit|clothing|upper body|waist|portrait|full body)/i;

      const tokens = pickFromFeatures(features, ['bust', 'skinTone', 'ageAppearance'], 14)
        .filter((token) => allow.test(token) && !deny.test(token));
      if (tokens.length > 0) return tokens.join(', ');

      return pickFromRawPrompt(positive, { allow, deny, limit: 10 }).join(', ');
    }

    // Other secret parts (vagina/anus): only safe skin/age tags
    // MRJH imageTasks.ts:2226-2234
    const allow = /(skin|complexion|pale|fair|tan|young|adult|teen)/i;
    const deny = /(face|eyes?|hair|dress|robe|hanfu|armor|outfit|clothing|upper body|waist|portrait|full body|standing|sitting|kneeling|feet)/i;

    const safe = pickFromFeatures(features, ['skinTone', 'ageAppearance'], 8)
      .filter((token) => allow.test(token) && !deny.test(token));
    if (safe.length > 0) return safe.join(', ');

    return pickFromRawPrompt(positive, { allow, deny, limit: 6 }).join(', ');
  }

  // ── Half-body / Full-length / Scene / Custom: full anchor unchanged ──
  // MRJH imageTasks.ts:2237-2238
  return positive;
}
