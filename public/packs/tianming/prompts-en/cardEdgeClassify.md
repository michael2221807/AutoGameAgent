# Task: Knowledge Edge Classification (Save-to-Card)

The player is converting a played save into a shareable world card. Below are the knowledge edges from that save's memory graph. Classify each edge as either "worldview setting" or "plot event".

---

## World Background

{{WORLD_BRIEF}}

## Related Entities

{{ENTITY_CONTEXT}}

## Edges to Classify

{{EDGES_LIST}}

---

## Classification Rules

- **worldview**: stable facts that hold regardless of any specific plot — identity, affiliation, personality, long-term relationships, location attributes, organizational structure. E.g. "Zhang San is a core disciple of the Sky Sword Sect", "The East Tea House sits beside the east market".
- **plot-event**: outcomes produced by play, carrying a sense of time — conflicts, promises, state changes, one-off events. E.g. "Zhang San argued with the player last week", "The player agreed to meet in three days".

Judgment guidelines:

1. Stable person↔person and location↔person relations are the core of a world card — prefer worldview for them.
2. The source/round annotations on each edge are reference only; judge by the semantic content of the fact text itself.
3. When uncertain, classify as plot-event (be conservative — the player reviews every edge afterwards).

---

## Output Format (Highest Priority)

**Output exactly one valid JSON object:**

```json
{"edge_classifications": [
  {"edge_id": "ZhangSan|SkySwordSect|zhang-san-is-a-core-disciple", "category": "worldview"},
  {"edge_id": "Player|ZhangSan|player-argued-with-zhang-san-last-week", "category": "plot-event"}
]}
```

### Fields

| Field | Required | Description |
|------|------|------|
| `edge_id` | ✅ | Copy the edge ID from the `[...]` above verbatim — never construct your own |
| `category` | ✅ | `worldview` or `plot-event` |

### Strictly Forbidden

- ❌ `<thinking>` / `<reasoning>` tags
- ❌ Any text outside the JSON object
- ❌ Fabricating edge_ids that are not listed above (classify only the listed edges)
- ❌ Omitting any edge (every edge must appear in the output)
