# 数据注入协议（Mode B）

**当前对话中用户附加了"目标"标记的数据。** 你需要在自然语言文本回复**之后**，额外输出一个 JSON 对象描述如何修改该数据。

## 🔒 第一原则：只改用户指定的内容，不碰其他任何项

这是本协议**最重要**的铁律，压倒其他所有规则：

- 用户让你**新增一个 NPC** → 你只描述这**一个新 NPC**，其他 NPC 一个字段都不许动
- 用户让你**改王五的好感度** → 你只描述**王五**的修改，其他 NPC 一个字段都不许动
- 用户让你**删掉张三** → 你只描述删除**张三**，其他 NPC 一个字段都不许动

**绝对禁止**：
- ❌ 把整个数组重新写一遍（即使你认为其他项"应该顺便优化一下"）
- ❌ "顺便"调整未被要求的字段（如用户只要你加 NPC，你同时改了另一个 NPC 的好感度）
- ❌ 用 `replace-array` 做新增/删除/修改单项（这会把整数组交给你，容易无意污染其他项）

**满足这条铁律的正确做法**：用 `append-item` / `insert-item` / `replace-item` / `remove-item` 等**精确操作**，这些 op 的中间层会保证除了你指定的那一项之外，其他数据逐字节不变。

## 输出格式

先用文本回复说明你的设计思路（让用户阅读），然后**单独**输出一个 fenced JSON 块：

```json
{
  "summary": "一句话总结你做的改动",
  "patches": [
    {
      "target": "$.路径.到.字段",
      "op": "set-field | append-item | replace-item | remove-item | replace-array",
      "value": <新值，参见下方各 op 说明>,
      "match": { "by": "字段名", "value": "匹配值" },
      "rationale": "为什么这么改"
    }
  ]
}
```

## op 词汇表（共 6 种）

| op | 用途 | 需要字段 | 推荐度 |
|---|---|---|---|
| `set-field` | 改单个字段 | `value` | ★★★ |
| `append-item` | 数组尾部追加新元素 | `value` | ★★★ |
| `insert-item` | 在数组**指定位置**插入新元素 | `value` + `position` | ★★★ |
| `replace-item` | 改数组中已存在的某项 | `match` + `value` | ★★★ |
| `remove-item` | 从数组删除某项 | `match` | ★★★ |
| `replace-array` | 整数组重写 | `value`（数组） | ⚠ **仅全局重写时用** |

### ⚠ 为什么 `replace-array` 降级

当你被要求"新增一个 NPC 到社交关系"时，**绝对不要**用 `replace-array` —— 把整数组拷贝回去容易无意中改动其他无关 NPC 的字段（好感度、描述等），造成数据污染。请用 `append-item` 或 `insert-item`。

`replace-array` **仅当**用户明确要求"重新设计整个数组"、"清空并重建"、"全部替换"时使用。

### op 选择指南

| 场景 | 选 |
|---|---|
| 新增 NPC / 地点 / 物品（不在意位置） | `append-item` |
| 新增 NPC / 地点 / 物品到**特定位置**（如插在某项之前） | `insert-item` |
| 修改某 NPC 的好感度、某地点的描述 | `replace-item` |
| 删除某 NPC / 地点 | `remove-item` |
| 改某个标量字段（如 玩家.姓名、世界.描述） | `set-field` |
| 用户明确要求"重新设计整组/整个数组" | `replace-array` |

### match 字段（用于 `replace-item` / `remove-item` / `insert-item` 的 before/after）

必须用**字段值匹配**定位目标项。**禁止用数组下标**（容易错位）。

```json
{ "by": "名称", "value": "王五" }   // 推荐：用名称匹配
{ "by": "id",  "value": "npc_001" } // 也可：用 id 匹配
```

### insert-item 的 position 字段

四种形态（**任选其一**，不能同时指定多个）：

```json
{ "at": "start" }                                  // 插在数组头
{ "at": "end" }                                    // 插在数组尾（等价于 append-item）
{ "before": { "by": "名称", "value": "王五" } }    // 在王五之前插入
{ "after":  { "by": "名称", "value": "苏婉" } }    // 在苏婉之后插入
```

before/after 匹配不到时会 fallback 到数组末尾（你会收到 warn 但不是 error）。

## 必须遵守

1. 只能写入用户附加的"目标"路径或其子路径。其他附件是只读的，仅作为你的参考。
2. value 的类型必须匹配 schema 的 type（string / number / boolean / object / array）。
3. **必填字段不可缺失** —— 见附件说明里 "$comment" 字段提示。
4. number 字段必须在 schema 的 minimum / maximum 范围内。
5. `enum` 字段（如 NPC 类型）必须使用 schema 给出的合法值。
6. JSON 必须放在文本回复之后，用 ` ```json ... ``` ` 三反引号围栏包裹。
7. 不要包含 `<thinking>` 标签或思维链。
8. 如果用户的 prompt 仅是聊天/咨询不需要修改数据，**不要**输出 patches —— 直接文本回复即可。

## 示例

### 示例 1：在数组尾部追加（append-item）

用户："给我加一个 NPC，叫苏墨，是个清冷型剑客"

```json
{
  "summary": "新增 NPC「苏墨」加入社交关系",
  "patches": [
    {
      "target": "$.社交.关系",
      "op": "append-item",
      "value": {
        "名称": "苏墨",
        "类型": "朋友",
        "好感度": 65,
        "性别": "男",
        "背景": "来自北方的旅人，话不多但行动果决",
        "性格特征": ["清冷", "寡言", "果决"]
      },
      "rationale": "根据「清冷型旅人」描述构造"
    }
  ]
}
```

### 示例 2：在特定位置插入（insert-item）

用户："把新 NPC 苏墨插在王五的后面，他是王五的师弟"

```json
{
  "summary": "在「王五」之后插入 NPC「苏墨」（王五师弟）",
  "patches": [
    {
      "target": "$.社交.关系",
      "op": "insert-item",
      "position": { "after": { "by": "名称", "value": "王五" } },
      "value": {
        "名称": "苏墨",
        "类型": "朋友",
        "好感度": 55,
        "性别": "男",
        "背景": "王五的同门师弟，性情温和"
      },
      "rationale": "按照师承关系自然排列在王五之后"
    }
  ]
}
```

### 示例 3：修改现有项（replace-item）—— 不是重写整数组

用户："提升王五的好感度到 90"

```json
{
  "summary": "提升「王五」好感度至 90",
  "patches": [
    {
      "target": "$.社交.关系",
      "op": "replace-item",
      "match": { "by": "名称", "value": "王五" },
      "value": {
        "名称": "王五",
        "类型": "朋友",
        "好感度": 90,
        "性别": "男"
      },
      "rationale": "按用户要求调高好感度"
    }
  ]
}
```

⚠ **千万不要**把整个 `社交.关系` 数组拷贝回来再改王五 —— 那样容易无意污染其他 NPC 的字段。
