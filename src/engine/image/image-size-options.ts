/**
 * Image Size Options — MRJH imageSizeOptions.ts
 *
 * Predefined image resolution presets for manual and automatic generation.
 * Exports:
 * - COMMON_SIZE_OPTIONS: 7 common sizes (512x512 to 832x1216)
 * - SCENE_PORTRAIT_SIZE_OPTIONS: 9 portrait scene presets
 * - SCENE_LANDSCAPE_SIZE_OPTIONS: 10 landscape scene presets
 * - Per-composition defaults used by prompt-composer
 */

export type SizeOrientation = 'square' | 'portrait' | 'landscape';

export interface ImageSizeOption {
  value: string;
  label: string;
  width: number;
  height: number;
  orientation: SizeOrientation;
}

function createSizeOption(
  w: number,
  h: number,
  ratio: string,
  desc: string,
  orientation: SizeOrientation,
): ImageSizeOption {
  return {
    value: `${w}x${h}`,
    label: `${w}x${h} (${ratio}, ${desc})`,
    width: w,
    height: h,
    orientation,
  };
}

function dedup(options: ImageSizeOption[]): ImageSizeOption[] {
  const seen = new Set<string>();
  return options.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function indexByValue(options: ImageSizeOption[]): Map<string, ImageSizeOption> {
  return new Map(options.map((item) => [item.value, item]));
}

// ═══════════════════════════════════════════════════════════
// §1 — Common size presets (MRJH: 常用文生图尺寸选项)
// ═══════════════════════════════════════════════════════════

export const COMMON_SIZE_OPTIONS: ImageSizeOption[] = [
  createSizeOption(512, 512, '1:1', '图标', 'square'),
  createSizeOption(640, 640, '1:1', '图标', 'square'),
  createSizeOption(512, 768, '2:3', '竖直', 'portrait'),
  createSizeOption(768, 512, '3:2', '水平', 'landscape'),
  createSizeOption(1024, 1024, '1:1', 'SDXL', 'square'),
  createSizeOption(1216, 832, '19:13', '超高清', 'landscape'),
  createSizeOption(832, 1216, '13:19', '超高清', 'portrait'),
];

// ═══════════════════════════════════════════════════════════
// §2 — Scene size presets (MRJH: 自动场景竖屏/横屏尺寸选项)
// ═══════════════════════════════════════════════════════════

const SCENE_EXTRA_SIZE_OPTIONS: ImageSizeOption[] = [
  createSizeOption(576, 1024, '9:16', '竖屏', 'portrait'),
  createSizeOption(720, 1280, '9:16', '竖屏高清', 'portrait'),
  createSizeOption(864, 1536, '9:16', '竖屏高精', 'portrait'),
  createSizeOption(768, 1024, '3:4', '竖屏', 'portrait'),
  createSizeOption(832, 1216, '13:19', '超高清', 'portrait'),
  createSizeOption(1024, 1280, '4:5', '竖屏', 'portrait'),
  createSizeOption(1024, 1536, '2:3', '竖屏', 'portrait'),
  createSizeOption(1024, 576, '16:9', '横屏', 'landscape'),
  createSizeOption(1216, 832, '19:13', '超高清', 'landscape'),
  createSizeOption(1280, 720, '16:9', '横屏高清', 'landscape'),
  createSizeOption(1536, 864, '16:9', '横屏高精', 'landscape'),
  createSizeOption(1152, 640, '18:10', '横屏', 'landscape'),
  createSizeOption(1024, 640, '8:5', '横屏', 'landscape'),
  createSizeOption(1024, 768, '4:3', '横屏', 'landscape'),
  createSizeOption(1024, 832, '5:4', '横屏', 'landscape'),
];

const ALL_SIZE_OPTIONS_MAP = indexByValue(dedup([
  ...SCENE_EXTRA_SIZE_OPTIONS,
  ...COMMON_SIZE_OPTIONS,
]));

function pickByOrder(values: string[]): ImageSizeOption[] {
  return values
    .map((v) => ALL_SIZE_OPTIONS_MAP.get(v))
    .filter((item): item is ImageSizeOption => Boolean(item));
}

export const SCENE_PORTRAIT_SIZE_OPTIONS: ImageSizeOption[] = pickByOrder([
  '576x1024',
  '720x1280',
  '768x1024',
  '832x1216',
  '864x1536',
  '1024x1024',
  '1024x1280',
  '1024x1536',
  '512x768',
]);

export const SCENE_LANDSCAPE_SIZE_OPTIONS: ImageSizeOption[] = pickByOrder([
  '1024x576',
  '1152x640',
  '1216x832',
  '1280x720',
  '1536x864',
  '1024x640',
  '1024x768',
  '1024x832',
  '1024x1024',
  '768x512',
]);

// ═══════════════════════════════════════════════════════════
// §3 — Per-composition defaults
// ═══════════════════════════════════════════════════════════

export const COMPOSITION_DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
  portrait: { width: 1024, height: 1024 },
  'half-body': { width: 768, height: 1024 },
  'full-length': { width: 832, height: 1216 },
  scene: { width: 1024, height: 576 },
  secret_part: { width: 1024, height: 1024 },
  custom: { width: 1024, height: 1024 },
};

/**
 * Parse a "WxH" string into width/height numbers.
 * Returns null if format is invalid.
 */
export function parseSizeString(value: string): { width: number; height: number } | null {
  const m = value.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w <= 0 || h <= 0 || !isFinite(w) || !isFinite(h)) return null;
  return { width: w, height: h };
}

/**
 * Convert ImageSizeOption[] to SelectOption[] format for AgaSelect.
 */
export function sizeOptionsToSelectOptions(options: ImageSizeOption[]): Array<{ label: string; value: string }> {
  return options.map((o) => ({ label: o.label, value: o.value }));
}
