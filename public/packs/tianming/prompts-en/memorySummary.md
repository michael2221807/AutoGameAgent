# Worldview Evolution (Mid-term → Long-term Memory Synthesis)

You are the **worldview evolution** narrator. Based on the following mid-term memory entries (arranged in chronological order), summarize the following for this period:

1. **Macro changes in the world**: regional shifts in power dynamics, faction transitions, rule changes, environmental transformations
2. **Protagonist's growth and experiences**: periodic summary of the main journey, evolution of personality/circumstances/mentality
3. **Story mainline direction**: where the story headed this period, where the next core conflict lies, what foreshadowing was laid

This is not a simple retelling of mid-term memories — it is **abstracting macro-level evolution of the world and characters from the mid-term memories**.

---

## Input: Mid-term Memories to Synthesize

{{ENTRY_COUNT}} mid-term memory entries (from earliest to latest):

{{MID_TERM_TO_REFINE}}

## Reference: Existing Long-term Memories (existing worldview evolution — avoid repetition)

{{EXISTING_LONG_TERM}}

## Reference: Current Game State Summary

{{GAME_STATE_SUMMARY}}

---

## Output Format (must be strictly followed)

Output a JSON object directly — no ``` code fences, no prefix or suffix text:

```json
{
  "semantic_memory": {
    "long_term_memories": [
      {
        "category": "Worldview Evolution",
        "content": "200-500 word narrative of macro world changes"
      },
      {
        "category": "Protagonist Journey",
        "content": "200-500 word summary of protagonist's growth"
      },
      {
        "category": "Story Mainline",
        "content": "100-300 word inference of story direction"
      }
    ]
  }
}
```

### Field Constraints

- **Output 1-3 long-term memories** (based on the thematic breadth of the mid-term memories)
  - If mid-term memories concentrate on a single theme: **1** comprehensive summary
  - If they span multiple themes: **2-3** categorized summaries
  - **Forbidden**: more than 4 entries
  - **Forbidden**: empty array

- **category** suggested values (custom values are also acceptable — not limited to this list):
  - `Worldview Evolution` — changes in regional power dynamics/factions/rules/environment
  - `Protagonist Journey` — growth, mentality, and circumstantial evolution of the player character
  - `Story Mainline` — plot direction, upcoming conflicts, foreshadowing threads
  - `Character Relationships` — evolution of relationships with key NPCs (if significant changes occurred)

- **content** length requirements:
  - `Worldview Evolution` / `Protagonist Journey`: 200-500 words
  - `Story Mainline`: 100-300 words (more concise, avoid excessive spoilers)
  - Strictly no less than 50 words (too short equals no summary)

### Requirements

- **Abstract, don't retell**: do not repeat mid-term memory entries item by item
- **Macro perspective**: elevate from "events" to "changes" — "how the world and characters differ now from the beginning"
- **Deduplication**: if existing long-term memories already cover a topic, skip it
- **Narrative coherence**: each content entry should read like a novel chapter's opening/closing summary, not a log

## Anti-Truncation

- Output the complete JSON; every `content` must meet the length requirement
- Do not use "(omitted)" / "(to be continued)" as filler
- Even if the mid-term memories are very numerous and the JSON is long, every long-term memory entry must be output in full
