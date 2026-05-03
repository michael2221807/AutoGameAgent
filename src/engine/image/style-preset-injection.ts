export interface PromptStyleInjection {
  artistPrefix?: string;
  extraNegative?: string;
}

export interface PromptStylePresetLike {
  id?: string;
  artistString?: unknown;
  positive?: unknown;
  negative?: unknown;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function joinPromptFragments(parts: Array<unknown>): string {
  return parts
    .map(cleanText)
    .filter(Boolean)
    .join(', ');
}

export function buildPromptStyleInjection(
  presets: PromptStylePresetLike[],
  selectedIds: Array<string | undefined | null>,
): PromptStyleInjection {
  const selected: PromptStylePresetLike[] = [];
  const seen = new Set<string>();

  for (const id of selectedIds) {
    const trimmed = cleanText(id);
    if (!trimmed || seen.has(trimmed)) continue;
    const preset = presets.find((p) => cleanText(p.id) === trimmed);
    if (!preset) continue;
    selected.push(preset);
    seen.add(trimmed);
  }

  const artistPrefix = joinPromptFragments(
    selected.flatMap((p) => [p.artistString, p.positive]),
  );
  const extraNegative = joinPromptFragments(selected.map((p) => p.negative));

  return {
    artistPrefix: artistPrefix || undefined,
    extraNegative: extraNegative || undefined,
  };
}
