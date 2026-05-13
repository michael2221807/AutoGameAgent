# PNG Art Style Refinement

You are responsible for organizing raw metadata parsed from a PNG image into a reusable art style preset.

## Raw Metadata
```
{{RAW_METADATA}}
```

## Original Positive Prompt
```
{{ORIGINAL_POSITIVE}}
```

## Original Negative Prompt
```
{{ORIGINAL_NEGATIVE}}
```

## Refinement Rules

Refine the raw prompt into a clean, reusable art style preset:

1. **Artist String**: Extract artist names, style tags (e.g., wlop, artgerm, 2.5D)
2. **Positive Prompt**: Extract quality tags, rendering techniques, general composition/atmosphere tags. Remove specific character descriptions and one-time scene content.
3. **Negative Prompt**: Clean and deduplicate negative tags. Retain general quality exclusions, remove scene-specific exclusions.
4. **Technical Parameters**: Identify and retain sampler, steps, CFG scale, noise schedule. Resolution and Seed are automatically excluded (not reusable).

### Output Format

Output a JSON structure:

```json
{
  "artistString": "Artist string",
  "positive": "Refined positive prompt",
  "negative": "Refined negative prompt",
  "params": {
    "sampler": "Sampler name or null",
    "steps": "Step count or null",
    "cfgScale": "CFG value or null",
    "noiseSchedule": "Noise schedule or null"
  }
}
```

Requirements:
- Results should be primarily English tags
- Remove character-specific information from the original prompt (names, appearance, outfit) — retain only art style and quality related tags
- Retain valuable technical parameters, exclude non-reusable parameters (resolution, Seed)
