/**
 * Artist Tag System — Sprint Image-3
 *
 * Manages artist style tags for image generation. Tags can come from:
 * - Pack presets (`presets/artist-tags.json` — generic defaults, user overridable)
 * - User configuration (custom tags added via settings)
 * - PNG metadata import (extracted from uploaded reference images)
 *
 * The dictionary maps artist names to their tag strings. The extractor
 * parses free-text descriptions to identify known artist names.
 */

export interface ArtistTagEntry {
  name: string;
  tags: string;
  category?: string;
}

export class ArtistTagDictionary {
  private entries = new Map<string, ArtistTagEntry>();

  load(entries: ArtistTagEntry[]): void {
    this.entries.clear();
    for (const e of entries) {
      this.entries.set(e.name.toLowerCase(), e);
    }
  }

  get(name: string): ArtistTagEntry | undefined {
    return this.entries.get(name.toLowerCase());
  }

  getAll(): ArtistTagEntry[] {
    return [...this.entries.values()];
  }

  has(name: string): boolean {
    return this.entries.has(name.toLowerCase());
  }
}

export class ArtistTagExtractor {
  constructor(private dictionary: ArtistTagDictionary) {}

  extractFromText(text: string): string[] {
    const found: string[] = [];
    const lower = text.toLowerCase();

    for (const entry of this.dictionary.getAll()) {
      if (lower.includes(entry.name.toLowerCase())) {
        found.push(entry.tags);
      }
    }

    return found;
  }
}
