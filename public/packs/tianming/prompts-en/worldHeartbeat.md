# Task: World Heartbeat — Update NPC Status from Their Perspective

**Your core task**: For each NPC below, **adopt that character's perspective** and update their location, inner thoughts, and current activity. You may also update appearance description / body description / clothing style (only when long-term changes have occurred).

**Perspective requirement**: For each NPC, you must write from **that NPC's standpoint** — using that character's cognition, motivation, and voice, describe in one sentence what they are currently thinking and doing. No god's-eye view or player perspective; do not write plot summaries, only that character's own state.

---

## NPCs Requiring Status Updates

{{NPC_BLOCKS}}

---

## Reference Information (spatial/temporal constraints only — do not drive the output)

{{CONTEXT_BLOCK}}

{{ENVIRONMENT_BLOCK}}

Note: Current environment information is provided as context for NPC behavior (e.g., "NPC sheltering in a teahouse during a storm," "NPC out enjoying lanterns during the Lantern Festival"), **but this heartbeat does not update weather / festival / environment fields** — those are handled by the main round. This update only covers NPC-specific fields: location / inner thoughts / current activity.

---

## Output Format (output a single JSON object only)

Output only a JSON object — no explanations, no chain-of-thought, no text outside the code fence:

```json
{
  "commands": [
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].位置", "value": "Qingyun Town·Tavern"},
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].内心想法", "value": "Brief one sentence"},
    {"action": "set", "path": "社交.关系[名称=Li Mingyang].在做事项", "value": "Brief one sentence"}
  ]
}
```

### Constraints

- Only `set` the following paths (and only for candidate NPC names):
  - `社交.关系[名称=NPCName].位置` (value is a string — specific location name)
  - `社交.关系[名称=NPCName].内心想法` (value is a string — one sentence)
  - `社交.关系[名称=NPCName].在做事项` (value is a string — brief one sentence)
  - `社交.关系[名称=NPCName].外貌描述` (value is a string; **only when long-term appearance changes occur** — e.g., aging, scars, shaved head, dyed hair, tattoos, significant weight change)
  - `社交.关系[名称=NPCName].身材描写` (value is a string; **only when long-term physique changes occur** — e.g., cultivation breakthrough, pregnancy, injury/disability, long-term training causing muscle/build changes)
  - `社交.关系[名称=NPCName].衣着风格` (value is a string; **only when everyday clothing preferences shift** — e.g., identity change, class transition, seasonal transition)
- Note: use the `path` field (not `key`), formatted as `社交.关系[名称=NPCName].fieldName`
- Each NPC may have only some fields updated — not all need to be set; unchanged fields may be omitted
- **Appearance description / body description / clothing style default to no changes**: these 3 fields represent the NPC's long-term visual archive, and the image generation pipeline depends on their stability. Only update when the plot/time span is sufficient for actual appearance changes — do not refresh every round.
- Setting other paths (such as affinity, memories, description, personality traits, etc.) is forbidden
- **Location descriptions** must be **specific** place names (matching or at the same level as the known location list) — generic terms like "some city," "some location," "abroad" are forbidden
- If an NPC requires no changes, do not output for them; do not fabricate NPCs outside the candidate list
