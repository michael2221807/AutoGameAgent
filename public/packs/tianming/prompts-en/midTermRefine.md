# Mid-term Memory In-place Refinement (Deduplication & Merging)

You are a mid-term memory refinement assistant. **Deduplicate and merge** the following mid-term memory entries, outputting a refined list.

## Key Principles

**Do not delete any memory point.** Only perform these three operations:

1. **Deduplication**: when multiple entries describe the same event / same relationship change, merge into 1 entry
2. **Merge related events**: detail expansions under the same topic may be merged into a more complete memory entry
3. **Compress redundancy**: remove repeated background descriptions, retaining core plot + event impact + importance weight

**Forbidden**:
- Deleting independent memory points (even if they seem unimportant)
- Changing the "event importance weight" score
- Losing related character information

## Input: Memories to Refine

{{ENTRY_COUNT}} memory entries need refinement:

{{MID_TERM_TO_REFINE}}

---

## Output Format (must be strictly followed)

Output a JSON object directly — no ``` code fences, no prefix or suffix text, no `<thinking>` tags:

```json
{
  "refined": [
    {
      "相关角色": ["Player", "Character Name 1"],
      "事件时间": "year-month-day-hour-minute",
      "记忆主体": "Plot summary + event impact + (event importance, weight 1-10 in parentheses)"
    },
    {
      "相关角色": ["Character Name 2"],
      "事件时间": "year-month-day-hour-minute",
      "记忆主体": "..."
    }
  ]
}
```

### Field Constraints

- **相关角色**: string array of involved character names (include "Player" if relevant)
- **事件时间**: game time string (same format as input entries)
- **记忆主体**: 50-100 words, core format `plot summary + event impact + (Weight X)`, where X is 1-10

### Quantity Constraints

- Output entry count **must be ≤** input entry count (`{{ENTRY_COUNT}}` entries)
- If the input has 25 entries with obvious duplicates, typical output is 15-20 entries
- If every entry is independent (nothing to merge), output matches input count
- **Forbidden**: 0 entries (even if all entries are highly similar, at minimum merge into 1)

## Anti-Truncation

- Output the complete JSON — do not truncate midway
- Do not use "(similar entries follow)" / "(N entries omitted)" as filler
- Even if there are many entries and the JSON is long, every refined result **must** be output in full
