# Task: Fill Missing Extended Fields

[私密]
The system has detected that the following entities are missing required extended fields. Generate field content that fits the character profiles and return a `commands` array to apply the updates.

This repair is attempt **{{ATTEMPT_NUMBER}}**. Current gender filter: **{{GENDER_FILTER}}**.

---

## I. NPCs to Complete ({{NPC_COUNT}} total)

{{NPC_LIST}}

### 1. NPC `私密信息` Required Fields

Each NPC's `私密信息` object **must** contain all of the following fields — none may be missing or use placeholders like "TBD" / "N/A" / "None":

```json
"私密信息": {
  "是否为处女/处男": true,
  "身体部位": [
    {"部位名称": "嘴",   "敏感度": 40, "开发度": 10, "特征描述": "...", "特殊印记": ""},
    {"部位名称": "胸部", "敏感度": 60, "开发度": 20, "特征描述": "...", "特殊印记": ""},
    {"部位名称": "小穴", "敏感度": 50, "开发度": 0,  "特征描述": "...", "特殊印记": ""},
    {"部位名称": "屁穴", "敏感度": 30, "开发度": 0,  "特征描述": "...", "特殊印记": ""}
  ],
  "性格倾向": "...",
  "性取向": "...",
  "性癖好": ["..."],
  "性渴望程度": 30,
  "性交总次数": 0,
  "性伴侣名单": []
}
```

**Body Parts (hard constraint)**: The array must contain at least 4 fixed-part entries with `部位名称` exactly matching `嘴`, `胸部`, `小穴`, `屁穴`. Additional entries may be freely appended after these 4 based on NPC characteristics (e.g., nipples / buttocks / anus / phallus / toes), but the 4 fixed items must not be missing. Each entry's `特征描述` must describe the specific form/texture (50-120 words) — the image generation pipeline uses this for close-up rendering.

**Additional required 3 fields when not virgin**: When `是否为处女/处男 === false`, `私密信息` must also include:

```json
{
  "初夜夺取者": "Specific person name / contextual description like 'kidnapped as a child' / 'sect internal turmoil'",
  "初夜时间": "In-game time or natural description, e.g. 'winter at age 14', 'the night before the arranged marriage'",
  "初夜描述": "50-200 words: location, atmosphere, nature of the relationship, the NPC's feelings at the time"
}
```

When `是否为处女/处男=true`, these 3 fields may be omitted.

### 2. Logical Consistency (hard constraint)

- `是否为处女/处男=true` → `性交总次数=0`, `性伴侣名单=[]`; **`初夜夺取者/初夜时间/初夜描述` must be omitted or empty**
- `是否为处女/处男=false` → `性交总次数>=1`, `性伴侣名单` must not be empty (use specific names or "deceased/missing"); **`初夜夺取者/初夜时间/初夜描述` must all be filled**
- Each body part entry's `敏感度` and `开发度` must be numbers between 0-100
- `初夜夺取者` should appear in `性伴侣名单` (unless "unknown" / early-life untraceable circumstances)

### 3. Plausibility

- Field values should be derived from the NPC's background / type / age to fit the setting
- Using identical template data for all NPCs is forbidden
- Placeholder strings like "TBD", "N/A", "None", "Unknown" are forbidden

---

## II. Player Physical Avatar (PLAYER_BODY_MISSING={{PLAYER_BODY_MISSING}})

If `PLAYER_BODY_MISSING=true`, you **must** additionally generate a `set 角色.身体` command with the following required fields:

```json
{"action": "set", "path": "角色.身体", "value": {
  "身高": 165,
  "体重": 52,
  "三围": {"胸围": 84, "腰围": 62, "臀围": 88},
  "敏感点": ["..."],
  "开发度": {"胸部": 0, "乳头": 0},
  "胸部描述": "...",
  "私处描述": "...",
  "生殖器描述": "...",
  "纹身与印记": []
}}
```

If `PLAYER_BODY_MISSING=false`, do not write `角色.身体` again.

---

## III. Output Format (Highest Priority)

**Output only a single JSON object — no explanatory text, chain-of-thought, tags, or content outside the markdown code fence:**

```json
{
  "commands": [
    {"action": "set", "path": "社交.关系[名称=NPCName].私密信息", "value": { ...complete object... }},
    {"action": "set", "path": "角色.身体", "value": { ...complete object... }}
  ]
}
```

### Forbidden

- ❌ `text` field (this task produces no narrative)
- ❌ `mid_term_memory` field
- ❌ `action_options` field
- ❌ `<thinking>` / `<reasoning>` tags
- ❌ Any text outside the JSON object

---

## IV. Final Emphasis

Output only the `commands` array; only fill in entities listed in this task; do not modify other fields.
[/私密]
