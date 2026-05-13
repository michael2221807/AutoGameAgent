# Task: Fill Missing Entity Fields

After the previous round's execution, the system scan found several entities with missing required fields or placeholder values. Fill in these fields **without changing the current plot direction**.

---

## Missing Fields List

{{MISSING_FIELDS_SUMMARY}}

---

## Fill-in Requirements (hard constraints)

1. **Only fill, don't modify**: For fields listed in the checklist, generate reasonable content. For fields **not listed**, modification is strictly forbidden (preserve original values).
2. **Match context**: Each entity's fill-in content must be consistent with the `GAME_STATE_JSON`, memory summaries, and recent narrative above. Do not fabricate settings that conflict with the worldview.
3. **No placeholders**: Outputting "TBD", "N/A", "None", "Unknown", "To be filled", or empty strings is forbidden.
4. **Respect field semantics**:
   - `外貌描述`: Full visual paragraph (facial features, hairstyle & hair color, eye color, skin tone, build baseline, expression & demeanor) 50-200 words
   - `身材描写`: Height / physique / bust-waist-hip / muscle-fat distribution / presence, 30-120 words
   - `衣着风格`: Everyday clothing preferences (materials, color palette, style, habitual accessories), 30-100 words
   - `描述`: One-sentence identity/aura summary, ≤30 characters
   - `性格特征`: Array of 2-4 personality trait labels — not a long sentence
   - `背景`: Origin and life history, 50-200 words
   - Other fields follow the NPC structure specification in `core.md` §V
5. **NPC names must match exactly**: The `[名称=X]` in command paths must exactly match the `entityName` in the checklist.

## Player Entity

If the checklist includes player paths like `角色.身体`, use `set` to write the corresponding object; structure per `opening.md` Section 11 / `privacyRepair.md` Section II.

---

## Output Format (Highest Priority)

**Output only a single valid JSON object, in the following format:**

```json
{
  "commands": [
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].外貌描述", "value": "..."},
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].身材描写", "value": "..."},
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].衣着风格", "value": "..."}
  ]
}
```

### Forbidden

- ❌ `text` field (this task produces no narrative)
- ❌ `mid_term_memory` field
- ❌ `action_options` field
- ❌ `<thinking>` / `<reasoning>` tags
- ❌ Any text outside the JSON object, comments, or markdown outside the code fence
- ❌ Modifying fields not listed in the checklist (even if you think they could be improved)

### Final Emphasis

Output only the `commands` array; only fill in the entities and fields listed in this task; do not modify other fields; do not truncate; do not omit.
