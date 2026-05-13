# Task: Entity Description Enrichment

The following entities in the knowledge graph participate in fact-edge connections, but the system lacks descriptions for them. Based on the current game state, memory summaries, and recent narrative, provide a short, accurate description for each entity.

---

## Entities to Enrich

{{MISSING_ENTITIES}}

---

## Output Format (Highest Priority)

**Output only a single valid JSON object:**

```json
{"entity_descriptions": [
  {"name": "Project Stardust", "summary": "Secret research documents left by Su Yunhan, involving dimensional gateway technology"},
  {"name": "Jade Pendant", "summary": "Mother's keepsake — ordinary in appearance but concealing a miniature encrypted chip"}
]}
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Entity name (must exactly match the list above) |
| `summary` | ✅ | One-sentence description (15-50 words, fitting the current worldview) |

### Requirements

- Every entity in the enrichment list must have a corresponding entry
- summary must be based on real information from GAME_STATE_JSON and memory summaries
- Characters: describe appearance / identity / relationship with the player
- Items: describe appearance / purpose / origin
- Locations: describe environment / atmosphere / spatial relationship

### Forbidden

- ❌ `text` / `commands` / `mid_term_memory` / `action_options` fields
- ❌ `<thinking>` / `<reasoning>` tags
- ❌ Any text outside the JSON object
