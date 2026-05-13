# World Background Reasoning (Internal Reasoning, Not Final Output)

Based on the following character creation choices, reason about the world background and the character's starting circumstances.

## Character Creation Info

```json
{{CREATION_CHOICES}}
```

## Reasoning Requirements

Output the reasoning result as **plain text** of 200-400 characters, covering the following points:

1. **World-setting keynote**: Based on the selected world-setting/origin, determine the era background, social structure, and power system
2. **Starting location**: What kind of geographical environment corresponds to the character's origin? Use the `Continent·Region·Location` name format
3. **Character circumstances**: Origin + talent tier + trait -> the character's current social standing, living conditions, and the challenges or opportunities they face
4. **NPC seeds**: What important figures might be nearby? What is their relationship to the character? (0-3)
5. **Opening hook**: What event or situation can naturally draw the character into adventure?

## Output Format (Strictly Follow)

- **Plain text**, output the reasoning content directly
- No JSON
- No `commands`, `action_options`, `mid_term_memory`, or other structured fields
- No `<thinking>` tags
- No code fences ` ``` `

Output the reasoning body directly.
