# Character Initialization Task

## Character Creation Info

```json
{{CREATION_CHOICES}}
```

## World Description

{{WORLD_DESCRIPTION}}

---

## Output Format (Highest Priority)

**Output only a single JSON object -- no explanatory text, no chain-of-thought, no tags!**

```json
{
  "text": "1200-2500 character opening narrative body goes here...",
  "mid_term_memory": {"相关角色":["Player"],"事件时间":"1-01-01-08-00","记忆主体":"50-100 char opening summary"},
  "commands": [
    {"action":"set","path":"世界.时间","value":{"年":1,"月":1,"日":1,"小时":8,"分钟":0}},
    {"action":"set","path":"角色.身份.出生日期","value":{"年":-17,"月":1,"日":1}},
    {"action":"set","path":"角色.基础信息.当前位置","value":"Eastern Wastes·Qingyun Mountains·Small Village"},
    {"action":"set","path":"角色.可变属性.声望","value":0},
    {"action":"set","path":"角色.背包.金钱","value":{"现金":50,"铜":0,"银":0,"金":0}},
    {"action":"push","path":"世界.地点信息","value":{"名称":"Eastern Wastes","描述":"A vast continent"}},
    {"action":"push","path":"世界.地点信息","value":{"名称":"Eastern Wastes·Qingyun Mountains","描述":"Rolling mountain range","上级":"Eastern Wastes"}},
    {"action":"push","path":"世界.地点信息","value":{"名称":"Eastern Wastes·Qingyun Mountains·Small Village","描述":"A small mountain village","上级":"Eastern Wastes·Qingyun Mountains"}},
    {"action":"set","path":"世界.天气","value":"晴"},
    {"action":"set","path":"世界.节日","value":{"名称":"平日","描述":"","效果":""}},
    {"action":"set","path":"世界.环境","value":[]}
  ],
  "action_options": ["Wander around to get familiar with the area","Talk to nearby people","Investigate the surroundings","Ask around for local news","Find a place to settle in"]
}
```

### Key Requirements

1. **text field**: 1200-2500 character opening narrative -- write only the story body, immersive narrative; do not embed any game data, JSON, or variable names; do not use game terminology such as "player", "obtained", etc.
2. **mid_term_memory**: object format (see structure below), required
3. **commands**: must be an array; all paths begin with `元数据/角色/社交/世界/记忆/系统`
4. **action_options**: 5 options, fitting the current scene

**Prohibited**:
- No `<thinking>` or any chain-of-thought tags
- No explanatory text
- No game data embedded in the text field

---

## Initialization Commands (commands) -- Must Execute

### 1. Time

```json
{"action": "set", "path": "世界.时间", "value": {"年": X, "月": 1, "日": 1, "小时": 8, "分钟": 0}}
```

Also set `角色.身份.出生日期 (Character > Identity > Date of Birth)` (birth year = game year - starting age).

### 2. Location

```json
{"action": "set", "path": "角色.基础信息.当前位置", "value": "Continent·Region·Location"}
```

- Format: `Continent·Region·Location` (separated by `·`, at least two levels)
- Must be a **real physical location** only; forbidden: "leaving", "en route to", "somewhere", etc.
- Coordinates (optional): you may also include `"坐标": {"x": 5000, "y": 5000}` when pushing locations

### 3. Reputation

```json
{"action": "set", "path": "角色.可变属性.声望", "value": 0}
```

Common background: 0-10 | Faction/organization background: 10-50 | Noble/prominent: 50-100

### 4. Social Status

```json
{"action": "set", "path": "角色.可变属性.地位", "value": {"名称": "Social status/title", "描述": "Brief description"}}
```

Determined by origin/background: e.g., noble family origin -> `{名称:"Daughter of House XX", 描述:"..."}` ; commoner -> `{名称:"Villager/Apprentice/Shopkeeper", 描述:"..."}` ; if insufficient information -> `{名称:"Not yet revealed", 描述:""}`

### 5. Random Rolls (if origin/trait is "Random")

```json
{"action": "set", "path": "角色.基础信息.特质", "value": "(specific trait, e.g., 「Keen Mind」「Tenacious」「Mysterious Bloodline」)"}
```

### 6. Resources

```json
{"action": "set", "path": "角色.背包.金钱", "value": {"现金": 50, "铜": 0, "银": 0, "金": 0}}
```

Amounts determined by origin (see Resource Control below). If there are starting items:

```json
{"action": "set", "path": "角色.背包.物品.装备_001_a1b2", "value": {"名称":"Old Sword","类型":"装备","品质":{"quality":"普通","grade":1},"数量":1,"描述":"An ordinary iron sword"}}
```

### 7. Stamina and Energy

```json
{"action": "set", "path": "角色.可变属性.体力", "value": {"当前": X, "上限": X}},
{"action": "set", "path": "角色.可变属性.精力", "value": {"当前": X, "上限": X}}
```

- Stamina: 60 + 角色.属性.体质 (Character > Attributes > Constitution) x 4
- Energy: 50 + 角色.属性.悟性 (Character > Attributes > Wisdom) x 3

### 8. Derived Six-Dimensional Attributes

```json
{"action": "set", "path": "角色.属性.体质", "value": X}
```

(Set each of the six attributes in turn; value = innate attribute + origin modifier + talent modifier, clamped to 1-20)

### 8.5 Environment / Weather / Festival (2026-04-19 env-tags contract)

The opening must set these three fields, even if all are default values. This is the starting point for the **mandatory per-round re-emission** contract.

```json
{"action": "set", "path": "世界.天气", "value": "晴"},
{"action": "set", "path": "世界.节日", "value": {"名称": "平日", "描述": "", "效果": ""}},
{"action": "set", "path": "世界.环境", "value": []}
```

You may set non-default initial values based on the plot (e.g., a rainy mountain village opening -> 天气="阴雨"; a festival celebration opening -> 节日={名称:"元宵节", ...}; a dense fog opening -> 环境=[{名称:"Thick fog",...}]). But even if all are default values, you must explicitly write out all 3 set commands.

Format rules:
- **天气** string: 2-4 CJK characters, e.g., `晴 / 小雨 / 暴雨 / 阴霾 / 大雪`
- **节日.名称** string: `平日` or a specific festival name (`元宵节 / 中秋 / 除夕`); leave 描述/效果 as empty strings to indicate no festival atmosphere
- **环境** array: each item `{名称, 描述, 效果}`; max 3 entries; typically an empty array at opening

### 9. NPCs (Only Create Important Figures Explicitly Mentioned in the Narrative, 0-3)

```json
{"action": "push", "path": "社交.关系", "value": {
  "名称": "NPC Name",
  "性别": "男|女|其他",
  "年龄": 35,
  "出生日期": {"年": X, "月": X, "日": X},
  "类型": "重点",
  "好感度": 50,
  "位置": "Current location name",
  "描述": "One-line identity/temperament summary",
  "外貌描述": "Full appearance paragraph: face, hair, eyes, skin, build, expression and aura",
  "身材描写": "Height/build/measurements/muscle-fat distribution/presence",
  "衣着风格": "Daily clothing preferences: material/palette/style/signature accessories",
  "性格特征": ["Trait 1", "Trait 2"],
  "关系状态": "陌生人|血亲|旧识",
  "背景": "Origin and life experience",
  "记忆": [],
  "在做事项": "Brief one-liner"
}}
```

> `描述` and `外貌描述` must not duplicate each other: the former is a one-line identity summary, while the latter is a full physical appearance paragraph. `身材描写` and `衣着风格` serve as independent anchors for the image generation pipeline and must not be left empty.

### 10. Location Info (Required)

After setting `角色.基础信息.当前位置`, you must push `世界.地点信息 (World > Location Info)` to add the starting location and all parent levels:

```json
{"action": "push", "path": "世界.地点信息", "value": {"名称": "Root-level place", "描述": "Brief description"}},
{"action": "push", "path": "世界.地点信息", "value": {"名称": "Root-level place·Second level", "描述": "Brief description", "上级": "Root-level place"}},
{"action": "push", "path": "世界.地点信息", "value": {"名称": "Root-level place·Second level·Third level", "描述": "Brief description", "上级": "Root-level place·Second level"}}
```

Missing parent levels will cause the map to fail to display the hierarchy; when pushing, **a description is required**.

[私密]
### 11. Player Physical Body (Required when `系统.nsfwMode=true`)

**The only legal path**: `角色.身体`. **It is forbidden** to use `角色.身体部位开发` in commands.

You must use `set` to write to `角色.身体`; the value must be a complete object (strictly no placeholders like "to be AI-generated" or "none yet").

#### Required Fields

| Field | Type | Description |
|------|------|------|
| 身高 | number | cm |
| 体重 | number | kg |
| 三围 | object | `{胸围, 腰围, 臀围}` (number) |
| 胸部描述 | string | Textual description of appearance/texture |
| 私处描述 | string | Textual description of appearance/texture |
| 生殖器描述 | string | Textual description of appearance |
| 身体部位 | array | **Fully aligned with the NPC 私密信息.身体部位 structure**, see below |
| 敏感点 | string[] | e.g., `["Nipples","Earlobes","Side of neck"]` |
| 纹身与印记 | string[] | An empty array `[]` is required even if none |

#### Body Parts Array (Must Include At Least 4 Fixed Parts)

Each item structure: `{部位名称, 敏感度(0-100), 开发度(0-100), 特征描述, 特殊印记}`

**Fixed 4 parts** (`部位名称` must match exactly): `嘴`, `胸部`, `小穴`, `屁穴`

Additional parts may be freely added: `乳首`, `臀部`, `子宫口`, `阳具`, etc. Development level is typically 0 at opening (virgin characters).

#### Uterus Field (Optional for Female Characters)

When the character's gender is female, add a `子宫` object: `{状态, 宫口状态, 内射记录: []}`

Opening default: `{状态:"正常", 宫口状态:"闭合", 内射记录:[]}`

#### Example

```json
{"action":"set","path":"角色.身体","value":{
  "身高":165,"体重":52,
  "三围":{"胸围":84,"腰围":62,"臀围":88},
  "胸部描述":"...","私处描述":"...","生殖器描述":"...",
  "身体部位":[
    {"部位名称":"嘴","敏感度":30,"开发度":0,"特征描述":"Thin lips with a slight upturn, pale lip color","特殊印记":""},
    {"部位名称":"胸部","敏感度":45,"开发度":0,"特征描述":"...","特殊印记":""},
    {"部位名称":"小穴","敏感度":50,"开发度":0,"特征描述":"...","特殊印记":""},
    {"部位名称":"屁穴","敏感度":20,"开发度":0,"特征描述":"...","特殊印记":""}
  ],
  "子宫":{"状态":"正常","宫口状态":"闭合","内射记录":[]},
  "敏感点":["Nipples","Earlobes"],
  "纹身与印记":[]
}}
```

Additionally, if NPCs are created and their gender matches `系统.nsfwGenderFilter`, the NPC object must include a complete `私密信息` (see core module Section 16).
[/私密]

---

## Narrative Requirements & Writing Style

### Writing Style Baseline
- **Consistent with the world-setting**: language and atmosphere must match the world the user selected (classical Chinese, modern, Western fantasy, etc.)
- **Immersive**: focus on environment, atmosphere, and the character's sensory experience and circumstances; avoid listing data
- **No game terminology**: the text body must never contain immersion-breaking terms such as "player", "obtained", "equipped", "level up", etc.

### Narrative Structure
- Opening establishes time and place -> middle section reveals the character's origin and circumstances -> ending leaves a hook/suspense
- Visual richness: at least 1 `【环境】` (environment) passage + 3 visible action details + 2 rounds of dialogue (or 1 round of dialogue + 1 passage of NPC inner thoughts)

### Logic & Difficulty
- **Reasonable starting point**: origin determines horizons and starting point, which must match the player's choices; obtaining absurd abilities or resources at the very start is forbidden
- **Character consistency**: age and origin determine behavior and cognition, which must remain consistent throughout

---

## Initial Resource Control (Strictly Enforced)

### Currency (Based on Origin)
- **Destitute/Vagrant**: 0-10
- **Commoner/Ordinary**: 10-50
- **Faction/Organization**: 100-300
- **Wealthy/Noble**: 300-800

### Items & Equipment
- **Quantity**: 1-5 items; less is more
- **Quality**: primarily common/fine; giving rare or higher quality at the start is strictly forbidden (unless top-tier background with narrative justification)
- **Types**: equipment, consumables, materials, miscellaneous

### NPCs & Relationships
- **Quantity**: 0-3 (must be important figures who form bonds in the narrative; do not generate relationships for passersby)
- **Relationships**: initial affinity should not be too high (blood relatives excepted); reflect the warmth and coldness of human connections

---

## mid_term_memory Structure (Required at Opening)

```json
{
  "相关角色": ["Player"],
  "事件时间": "1-01-01-08-00",
  "记忆主体": "50-100 chars: opening core info — character origin/circumstances/starting location/key opening event summary (importance weight 9)"
}
```
