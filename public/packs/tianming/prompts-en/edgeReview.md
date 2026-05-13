# Task: Knowledge Edge Review

This round's factual changes may have rendered some old knowledge in the memory graph outdated. Review the existing knowledge edges between the flagged entity pairs below and determine whether each edge still holds.

---

## Review Flags

{{REVIEW_EDGES_LIST}}

---

## Existing Knowledge Edges Between These Entity Pairs

{{MATCHED_EDGES}}

---

## Judgement Rules

For each existing knowledge edge, make one of the following determinations:

- **keep**: The fact still holds — no changes
- **invalidate**: The fact no longer holds (e.g., relationship severed, identity changed, item changed hands) — mark as invalid

Basis for judgement: combine the current state from GAME_STATE_JSON above, memory summaries, and events from recent narrative.

---

## Output Format (Highest Priority)

**Output only a single valid JSON object:**

```json
{"edge_updates": [
  {"edge_id": "Zhang San|Heavenly Sword Sect|Zhang San is a direct disciple of the Heavenly Sword Sect", "action": "invalidate", "reason": "Zhang San has been expelled from the Heavenly Sword Sect"},
  {"edge_id": "Player|Qingfeng Sword|The player obtained a Qingfeng Sword at Mount Qingcheng", "action": "keep", "reason": "The player still possesses the Qingfeng Sword"}
]}
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `edge_id` | ✅ | Knowledge edge ID — copy directly from the edge's `[...]` ID listed above; do not construct your own |
| `action` | ✅ | `keep` or `invalidate` |
| `reason` | ✅ | One sentence explaining the reasoning |

### Forbidden

- ❌ `text` / `commands` / `mid_term_memory` / `action_options` fields
- ❌ `<thinking>` / `<reasoning>` tags
- ❌ Any text outside the JSON object
- ❌ Fabricating edge_ids that don't exist (only review edges listed above)
