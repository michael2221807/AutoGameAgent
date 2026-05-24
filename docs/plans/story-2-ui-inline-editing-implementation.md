# Story 2 Implementation Plan — 全面 UI 内联编辑

> **Status:** HISTORICAL-EXECUTED — 8 phases shipped 2026-05-23
> **Created:** 2026-05-21
> **Revised:** 2026-05-22 (Round 1→Round 4: C1-C5 + I1-I6 + M1-M7 + NC1 + NM1-NM3 + NN1-NN3)
> **Author:** Claude (plan session)
> **Target output:** `docs/plans/story-2-ui-inline-editing-implementation.md`

---

## 1. 总览

### 1.1 Story 2 在 epic 中的角色

Story 2 是 Game Card epic 的"数据编辑基础"。Story 0 通过增强开局一次性生成丰富的世界初始状态（NPC 档案、地点、背包等），但 AI 生成的内容必然有遗漏或瑕疵。Story 2 让用户能在各专用面板中直接精修这些数据，而不是被迫打开 GameVariablePanel 编辑原始 JSON。与 Story 1（Engram 关系网 CRUD）互补：Story 1 管理 Engram 实体与知识边，Story 2 管理状态树层的 NPC 档案/地点/背包/角色信息。与 Story 3（AI 助手批量注入）协同：AI 注入 + 用户精修 = epic 的主工作流。Story 4/5/6/7 均读取 Story 2 编辑后的状态树作为下游数据源。

### 1.2 实现策略

遵循 D28 复用原则：

- **所有编辑通过 `useGameState().setValue()` → `StateManager.set(path, value, 'user')` 落地**，不发明新状态管理路径
- **复用 SchemaForm / SchemaField** 作为复杂字段的 fallback 编辑器
- **扩展 RelationshipPanel 已有的 NPC CRUD 模态**（7 节表单已覆盖大部分字段），不重做
- **新增 4 个 editor composable**（`useNpcEditor` / `useLocationEditor` / `useInventoryEditor` / `useCharacterEditor`）封装 CRUD + 校验 + cascade，面板组件不直接调用 `setValue`
- **MapPanel / InventoryPanel 从零新增 CRUD**（当前完全只读）
- **CharacterDetailsPanel 补齐缺失的字段编辑**（当前仅 name/age/attributes 可编辑）

### 1.3 各面板现状 vs 目标对比表

| 面板 | 代码行数 | 现有 setValue 调用数 | 现有编辑覆盖率 | Story 2 目标 | 工作量估算 |
|------|---------|---------------------|---------------|-------------|-----------|
| CharacterDetailsPanel | 3201 | 8（name/age/attributes/basic info/player anchor） | ~25%（6 tabs 中仅 basic 部分 + attributes 可编辑） | 全字段可编辑（基础/属性/身份/可变属性/身体信息） | 大 |
| RelationshipPanel | 2774 | 6（toggles + saveNpc + deleteNpc） | ~70%（已有完整 NPC CRUD 模态，但缺少 Social-1 新字段） | 补齐缺失字段 + D26 标注 + Engram 协调 | 中 |
| MapPanel | 1100 | 0 | 0%（完全只读） | 地点 CRUD + 连接管理 + 层级编辑 | 大 |
| InventoryPanel | 610 | 0 | 0%（完全只读，操作走 action queue） | 物品 CRUD + 货币编辑 | 中 |
| PlotPanel | 1103 | 1（行 52，通过局部 persist() → setValue） | ~80%（节点/仪表盘 CRUD 已完整，弧线标题不可编辑） | 补齐弧线标题/概要编辑 + 与 editor composable 模式对齐 | 小 |
| GameVariablePanel | 1448 | 6（全部动态路径） | 100%（通用 JSON 编辑） | 保留作为"高级 fallback"，新增 router query 深链接 | 中 |

### 1.4 工作量估算

| 类别 | 工作量 |
|------|--------|
| Editor composable（5 个，含 usePlotEditor） | 4-5 天 |
| CharacterDetailsPanel 补齐编辑（含 body tab 复杂结构） | 3-4 天 |
| MapPanel CRUD（从零开始） | 3-4 天 |
| InventoryPanel CRUD（从零开始） | 2 天 |
| RelationshipPanel 补齐 + D26 | 1-2 天 |
| PlotPanel 弧线编辑补齐 + composable 对齐 | 1-2 天 |
| GameVariablePanel 深链接（router query + 返回链接） | 1 天 |
| i18n 双语完整覆盖 | 1-2 天 |
| 移动端适配 | 1 天 |
| 测试（单元 + 组件 + 集成 + cascade 边界） | 3-4 天 |
| **合计** | **~20-26 天** |

### 1.5 风险与不确定性

1. **Engram cascade 复杂性**：编辑/删除 NPC 时需与 Story 1 的 Engram 实体协调，但 Story 1 的 `renameEntity` / `deleteEntity` API 尚在 review 阶段
2. **MapPanel 从零开始**：当前无任何编辑基础，且 Cytoscape.js 图形交互与表单编辑需协调
3. **并发**：主回合 AI 运行时用户编辑的冲突处理
4. **大数据量性能**：100+ NPC、50+ 地点时的列表渲染

---

## 2. 架构事实核对

### 2.1 CharacterDetailsPanel 当前编辑覆盖率

**文件：** `src/ui/components/panels/CharacterDetailsPanel.vue`（3201 行）

**所有 setValue 调用：**

| 行号 | 路径 | 功能 | 代码片段 |
|------|------|------|---------|
| 983-986 | `editingField.path`（动态：`P.characterAge` 或其他） | `commitInlineEdit()` 内联编辑提交 | `setValue(path, Number(raw))` / `setValue(path, raw)` |
| 1031 | `schemaModalPath.value`（动态） | `saveSchemaEdit()` SchemaForm 模态保存 | `setValue(schemaModalPath.value, schemaModalData.value)` |
| 469 | `角色.图片档案` | `setPlayerAvatar()` 设置头像 | `setValue('角色.图片档案', { ...archive, 已选头像图片ID: id })` |
| 476 | `角色.图片档案` | `setPlayerPortrait()` 设置立绘 | `setValue('角色.图片档案', { ...archive, 已选立绘图片ID: id })` |
| 339 | `系统.扩展.image.characterAnchors` | `extractPlayerAnchor()` 提取锚点 | `setValue('系统.扩展.image.characterAnchors', [...anchors, newAnchor])` |
| 364 | `系统.扩展.image.characterAnchors` | `savePlayerAnchor()` 保存锚点 | `setValue('系统.扩展.image.characterAnchors', updatedAnchors)` |
| 372 | `系统.扩展.image.characterAnchors` | `deletePlayerAnchor()` 删除锚点 | `setValue('系统.扩展.image.characterAnchors', filteredAnchors)` |

**逐字段编辑覆盖率：**

| Tab | 字段 | Schema 路径 | 当前状态 | 编辑模式 |
|-----|------|------------|---------|---------|
| basic | 姓名 | `角色.基础信息.姓名` | ✅ 可编辑 | 双击内联编辑（行 1189）+ SchemaForm "Edit Basic Info" 按钮（行 1162） |
| basic | 年龄 | `角色.基础信息.年龄` | ✅ 可编辑 | 双击内联编辑（行 1204），`numericPaths` 包含此路径 |
| basic | 性别 | `角色.基础信息.性别` | ❌ 只读展示 | 行 1220：纯文本 `{{ gender }}` |
| basic | 职业/地位 | `角色.可变属性.地位.名称` | ❌ 只读展示 | 行 1226：纯文本 `{{ occupation }}` |
| basic | 当前位置 | `角色.基础信息.当前位置` | ❌ 只读展示 | 行 1232：纯文本 `{{ location }}` |
| basic | 出身 | `角色.身份.出身` | ❌ 只读展示 | 行 1249-1268：展示 `{名称, 描述}` 对象 |
| basic | 特质 | `角色.基础信息.特质` | ❌ 只读展示 | 行 1271-1290：展示 `{名称, 描述}` 对象 |
| basic | 天赋 | `角色.身份.天赋` | ❌ 只读展示 | 行 1293-1315：展示数组 `[{名称, 描述}]` |
| basic | 描述（地位描述） | `角色.可变属性.地位.描述` | ❌ 只读展示 | 行 1318：纯文本 |
| attributes | 先天六维 | `角色.身份.先天六维` | ❌ 只读展示 | 行 1331：进度条，无编辑入口 |
| attributes | 后天属性 | `角色.属性` | ✅ 可编辑 | SchemaForm 模态，通过 "Edit Attributes" 按钮（行 1354）→ `openSchemaEdit(P.characterAttributes)` |
| relations | NPC 关系列表 | `社交.关系` | ❌ 只读展示 | 行 1382-1420：仅展示关系 NPC 列表（头像 + 名字 + 关系状态 + 好感度），无编辑入口 |
| achievements | 成就 | — | ❌ 占位 | 行 1549-1554：占位区域，无数据展示也无编辑 |
| body | 身体数据 | `角色.身体` | ❌ 只读展示 | 行 1423-1546：展示身高/体重/三围/胸部/私处/身体部位等，全部 read-only。仅在 `nsfwEnabled` 时显示 |
| playerImage | 锚点/生图 | `系统.扩展.image.characterAnchors` | ✅ 可编辑 | Textarea + toggles + 保存按钮（行 1664-1716） |

**编辑 UI 模式（现有 2 种）：**

1. **双击内联编辑**（行 971-994）：`startInlineEdit(path, label, currentValue)` → 显示 `.inline-input` → blur/Enter 触发 `commitInlineEdit()` → `setValue(path, value)` + toast
2. **SchemaForm 模态**（行 996-1034）：`openSchemaEdit(path, title)` → Modal 内渲染 SchemaForm → "保存" 按钮触发 `saveSchemaEdit()` → `setValue(schemaModalPath.value, schemaModalData.value)`

**关键代码：** 内联编辑函数（行 976-990）：
```typescript
function commitInlineEdit(): void {
  if (!editingField.value) return;
  const { path } = editingField.value;
  const raw = editInputValue.value.trim();
  const numericPaths: string[] = [P.characterAge];
  if (numericPaths.includes(path) && !isNaN(Number(raw))) {
    setValue(path, Number(raw));
  } else {
    setValue(path, raw);
  }
  editingField.value = null;
  eventBus.emit('ui:toast', { type: 'success', message: t('character.toast.updated'), duration: 1500 });
}
```

### 2.2 RelationshipPanel 当前编辑覆盖率

**文件：** `src/ui/components/panels/RelationshipPanel.vue`（2774 行）

**所有 setValue 调用：**

| 行号 | 路径 | 功能 | 代码片段 |
|------|------|------|---------|
| 210 | `DEFAULT_ENGINE_PATHS.relationships` | `toggleAttention()` | `setValue(P.relationships, list)`（整数组替换，切换 `关注` flag） |
| 219 | `DEFAULT_ENGINE_PATHS.relationships` | `toggleHeartbeatLock()` | `setValue(P.relationships, list)`（切换 `心跳锁定` flag） |
| 251 | `DEFAULT_ENGINE_PATHS.relationships` | `togglePresence()` | `setValue(P.relationships, list)`（切换 `是否在场`） |
| 261 | `DEFAULT_ENGINE_PATHS.relationships` | `toggleMajorRole()` | `setValue(P.relationships, list)`（切换 `是否主要角色`） |
| 547 | `DEFAULT_ENGINE_PATHS.relationships` | `saveNpc()` | `setValue(P.relationships, list)`（新增或更新 NPC 条目） |
| 606 | `DEFAULT_ENGINE_PATHS.relationships` | `deleteNpc()` | `setValue(P.relationships, list)`（删除 NPC 条目） |

**关键发现：所有 6 个 setValue 调用都替换整个 `社交.关系` 数组。**

**内建编辑模态（行 923-1283）已覆盖的字段：**

| 表单节 | 字段 | Schema 对应 | 当前可编辑 |
|--------|------|------------|-----------|
| 基础信息 | 名称 | `名称` | ✅ text input（行 933） |
| 基础信息 | 类型 | `类型` | ✅ select（行 939，选项：关键/同伴/商人/中立/敌对/普通/未分类） |
| 基础信息 | 性别 | `性别` | ✅ select（行 949，选项：未设/男/女/其他） |
| 基础信息 | 年龄 | `年龄` | ✅ number input（行 955） |
| 基础信息 | 好感度 | `好感度` | ✅ range 0-100（行 960） |
| 基础信息 | 位置 | `位置` | ✅ text input（行 968） |
| 外貌与描述 | 描述 | `描述` | ✅ textarea（行 980） |
| 外貌与描述 | 外貌描述 | `外貌描述` | ✅ textarea（行 987） |
| 外貌与描述 | 身材描写 | `身材描写` | ✅ textarea（行 992） |
| 外貌与描述 | 衣着风格 | `衣着风格` | ✅ textarea（行 997） |
| 外貌与描述 | 背景 | `背景` | ✅ textarea（行 1002） |
| 当前状态 | 内心想法 | `内心想法` | ✅ textarea（行 1013） |
| 当前状态 | 在做事项 | `在做事项` | ✅ text input（行 1018） |
| 性格特征 | 性格特征 | `性格特征[]` | ✅ tag list + add input（行 1024-1044） |
| 记忆 | 记忆 | `记忆[]` | ✅ 条目列表 + add input（行 1046-1068） |
| NSFW | 性格倾向/性取向/当前性状态/体液分泌状态/性渴望程度/性交总次数/处女状态/初夜信息/身体部位（4固定+自定义） | `私密信息.*` | ✅ 完整覆盖（行 1070-1259） |
| 标记 | 关注/心跳锁定 | — | ✅ checkbox（行 1261-1275） |

**未覆盖的 Schema 字段（Social-1 新增）：**

| 字段 | Schema 路径 | 状态 |
|------|------------|------|
| 核心性格特征 | `核心性格特征` | ❌ 编辑模态中不存在 |
| 好感度突破条件 | `好感度突破条件` | ❌ 编辑模态中不存在 |
| 关系突破条件 | `关系突破条件` | ❌ 编辑模态中不存在 |
| 关系状态 | `关系状态` | ❌ 仅在详情视图展示，编辑模态中不可编辑 |
| 关系网变量 | `关系网变量[]` | ❌ 完全不存在于编辑 UI |
| 总结记忆 | `总结记忆[]` | ❌ 不在编辑模态中（仅 NpcMemoryTimeline 组件展示） |
| 最后互动时间 | `最后互动时间` | ❌ 系统维护字段，不应手动编辑 |
| 私聊历史 | `私聊历史[]` | ❌ 仅展示，不可编辑（系统维护） |

**NPC 新建逻辑（行 492-519）：**
```typescript
function openAddNew(): void {
  editIndex.value = -1;
  editForm.value = {
    [F.name]: '', [F.type]: '普通', [F.affinity]: 50, [F.age]: 20,
    [F.location]: '', [F.description]: '', [F.appearance]: '',
    [F.bodyDescription]: '', [F.outfitStyle]: '', [F.background]: '',
    [F.innerThought]: '', [F.currentActivity]: '', [F.personalityTraits]: [],
    [F.memory]: [],
  };
  if (nsfwEnabled.value) {
    // Seeds 4 required body parts
    editForm.value[F.privacyProfile] = { 身体部位: [...REQUIRED_BODY_PARTS] };
  }
  showEditModal.value = true;
}
```

**NPC 删除逻辑（行 602-609）：**
```typescript
function deleteNpc(): void {
  const list = [...(get<NpcRelation[]>(P.relationships) ?? [])];
  list.splice(editIndex.value, 1);
  setValue(P.relationships, list);
  showEditModal.value = false;
  selectedNpcIndex.value = -1;
  eventBus.emit('ui:toast', { type: 'success', message: t('relationship.toast.deleted') });
}
```

**无 Engram 集成** — RelationshipPanel 中没有任何对 Engram / 关系网编辑器的引用。

### 2.3 MapPanel 当前编辑覆盖率

**文件：** `src/ui/components/panels/MapPanel.vue`（1100 行）

**setValue 调用：0**

MapPanel 是**完全只读**的 Cytoscape.js 复合节点图可视化。

**数据读取（行 47-49）：**
```typescript
const locations = useValue<LocationEntry[]>(DEFAULT_ENGINE_PATHS.locations);
const playerLocation = useValue<string>(DEFAULT_ENGINE_PATHS.playerLocation);
const explorationRecord = useValue<Record<string, boolean>>(DEFAULT_ENGINE_PATHS.explorationRecord);
```

**LocationEntry 接口（行 36-43）：**
```typescript
interface LocationEntry {
  名称: string;     // required
  描述?: string;
  上级?: string;     // parent location name → builds hierarchy
  NPC?: string[];    // resident NPC names
  类型?: string;
  [key: string]: unknown;
}
```

**注意：** `连接[]`（相邻地点）字段存在于 schema 中，但 MapPanel **未展示也未使用**此字段。

**可视化功能概要：**
- fcose 布局的复合节点图（`上级` 字段 → Cytoscape `parent` 属性，行 280）
- 20 色家族色系（行 60-75）
- 探索状态着色（绿色=已探索/黄色虚线=部分/灰色=未探索，行 434-457）
- 玩家位置红色脉动动画（行 414-424）
- 双击钻入复合节点（行 525-535）
- 悬浮 tooltip 显示描述和 NPC（行 605-639）
- 详情面板展示名称/描述/类型/上级/NPC/子地点（行 885-926）

**Story 2 需要从零新增的能力：** 地点创建、编辑、删除、连接管理。

### 2.4 InventoryPanel 当前编辑覆盖率

**文件：** `src/ui/components/panels/InventoryPanel.vue`（611 行）

**setValue 调用：0**

InventoryPanel 是**完全只读**的列表展示面板。物品交互（使用/装备/丢弃）通过 action queue 触发引擎处理，不直接修改状态树。

**数据读取（行 53, 56）：**
```typescript
const items = useValue<Record<string, InventoryItem>>(DEFAULT_ENGINE_PATHS.inventoryItems);
const currencyMap = useValue<Record<string, number>>(DEFAULT_ENGINE_PATHS.inventoryCurrency);
```

**数据路径确认（行 7-8 注释）：**
- `角色.背包.物品` ← `Record<id, Item>`（set 添加，delete 删除）——非数组
- `角色.背包.金钱` ← 容器对象，子键 `.现金/.铜/.银/.金` 各为 number——非单个数字

**InventoryItem 接口（行 34-43）：**
```typescript
interface InventoryItem {
  名称: string;
  描述?: string;
  数量?: number;
  类型?: string;         // 武器|防具|消耗品|材料|任务|饰品
  可装备?: boolean;
  已装备?: boolean;
  品质?: ItemQuality | string;
  [key: string]: unknown;
}
```

**现有物品操作（行 152-184）：** 全部通过 `useActionQueueStore().addAction()` 进入 action queue：
- `handleUse()` → `type: 'use_item'`
- `handleEquip()` → `type: 'equip_item'` / `'unequip_item'`
- `handleDrop()` → `type: 'drop_item'`

**Story 2 需要从零新增的能力：** 物品创建（直接写入状态树）、物品编辑（字段修改）、物品删除（从 Record 中移除 key）、货币编辑。

### 2.5 GameVariablePanel 当前能力

**文件：** `src/ui/components/panels/GameVariablePanel.vue`（**1448 行**）

GameVariablePanel 是完整的生产级状态树编辑器，远比简单 fallback 复杂：

**6 个 setValue 调用（全部动态路径）：**

| 行号 | 功能 | 路径 |
|------|------|------|
| 255 | `commitEdit()` 内联编辑提交 | `field.path`（动态） |
| 265 | `toggleBoolean()` 布尔切换 | `field.path`（动态） |
| 277 | `executeResetField()` 重置字段 | `pendingResetField.path`（动态） |
| 301 | `saveStringEdit()` 字符串编辑保存 | `stringEditPath.value`（动态） |
| 326 | `saveSchemaEdit()` SchemaForm 保存 | `schemaModalPath.value`（动态） |
| 362 | `saveJsonEditor()` JSON 编辑器保存 | `jsonEditorPath.value`（动态） |

**完整能力清单：**
- 树状导航 + 面包屑回溯（行 122-133）
- 字段列表展示（行 148-167）
- 搜索（浅层 flatten 到深度 6，最多 100 结果，行 169-213）
- 5 种编辑模式：内联编辑（string/number/boolean）、字符串模态（多行 textarea）、SchemaForm 模态（复杂对象）、原始 JSON 编辑器（完整 JSON 文本编辑 + 校验）、重置到 schema 默认值（含确认弹窗）
- JSON 导出下载（行 465-478）
- 统计 Modal（估算大小/叶节点数/树深度/根键数，行 482-516）
- 字段值复制到剪贴板（行 520-541）
- Pack 级 i18n 路径翻译（行 26-34）
- 移动端响应式：master-detail push 模式（行 1393-1447）

**关键发现（C1 修订）：无 router query 支持。**

- 未导入 `useRoute` — 无 `?path=xxx` 查询参数解析
- 导航完全内部化（`navigateTo()` / `navigateBreadcrumb()` / `navigateToSearchResult()`）
- **无法从外部深链接到指定路径**
- **无"返回来源面板"功能**

**Story 2 跳转入口的实现影响：** §5.6 的"各面板添加跳转入口"设计**需要在 GameVariablePanel 中新增 router query 处理逻辑**：
1. 新增 `useRoute()` 导入 + `watch(route.query.path)` → 调用 `navigateTo()`
2. 新增 `route.query.from` 处理 → 显示"返回 [来源面板]"链接
3. 工作量：~1 天（已计入 §1.4）

**为什么用户"被迫"用它：** 因为 MapPanel、InventoryPanel、PlotPanel 的编辑能力有限或缺失，CharacterDetailsPanel 大部分字段只读，用户只能通过 GameVariablePanel 导航到目标路径后手动编辑。

**Story 2 的成功标准**：用户创作卡的完整流程中从不需要打开此面板。Story 2 后它保留作为"高级 fallback"。

### 2.6 NpcEditDialog 现有能力

**文件：** `src/ui/components/editing/NpcEditDialog.vue`（284 行）

NpcEditDialog 是一个**轻量级** NPC 编辑对话框，仅覆盖 5 个硬编码字段：`name, type, location, description, relationshipType`。

**与 RelationshipPanel 内建编辑模态的关系：** RelationshipPanel 有自己的完整 7 节编辑模态（行 923-1283），覆盖远多于 NpcEditDialog 的字段。NpcEditDialog 可能是早期版本的遗留组件。

**Story 2 决策：** 以 RelationshipPanel 内建模态为主体扩展，NpcEditDialog 可被弃用或仅作为其他面板（如 CharacterDetailsPanel 关系 tab）的快速编辑入口。

### 2.7 SchemaForm / SchemaField 能力边界

**SchemaForm（`src/ui/components/editing/SchemaForm.vue`，212 行）：**
- 支持类型：string, number/integer, boolean, enum(string+enum[]), array, object（递归）
- 嵌套支持：object 递归渲染 SchemaField，array 支持增删条目
- Props：`schema: Record<string, unknown>`, `value: unknown`, `defaultValue?: unknown`
- Events：`'update:value'`, `'reset'`
- 深拷贝修复（行 87-90）：`toRaw()` + `JSON.parse/stringify` 规避 Vue Proxy 的 `structuredClone` 报错

**SchemaField（`src/ui/components/editing/SchemaField.vue`）：**
- string → text input
- number/integer → number input（支持 min/max）
- boolean → 自定义 toggle switch
- enum → select dropdown
- array → 条目列表 + 增删按钮（复杂条目 JSON.stringify 为文本）
- object → 递归 SchemaField

**局限性（Story 2 需注意）：**
1. **无自定义校验框架** — SchemaField 仅做 min/max 约束，无 required/regex/custom validator
2. **无字段间依赖** — 不能根据字段 A 的值显示/隐藏字段 B
3. **数组条目仅支持简单文本** — 复杂对象数组条目不能在 SchemaField 内部逐字段编辑

### 2.8 useGameState / StateManager API

**useGameState（`src/ui/composables/useGameState.ts`）：**
```typescript
// 完整 API
isLoaded: ComputedRef<boolean>
tree: ComputedRef<GameStateTree>
get<T>(path: StatePath): T | undefined      // 一次性读取
useValue<T>(path: StatePath): ComputedRef<T | undefined>  // 响应式读取
setValue(path: StatePath, value: unknown): void  // 写入
```

- `setValue` 是**同步的**（行 95-96），委托 `store.setValue(path, value)`
- store 层（`src/engine/stores/engine-state.ts` 行 295-297）：`_linkedStateManager.set(path, value, 'user')` — **source 硬编码为 `'user'`**
- 响应式行为：`useValue` 依赖整个 `store.tree`（行 86），任何 path 变更都会触发所有 `useValue` 的重计算

**StateManager（`src/engine/core/state-manager.ts`，406 行）：**
```typescript
set(path: StatePath, value: unknown, source: ChangeLog['source'] = 'system'): StateChange
get<T>(path: StatePath): T | undefined
has(path: StatePath): boolean
delete(path: StatePath, source = 'system'): StateChange
add(path: StatePath, value: number, source = 'system'): StateChange
push(path: StatePath, value: unknown, source = 'system'): StateChange
pull(path: StatePath, value: unknown, source = 'system'): StateChange
```

- 支持过滤路径语法：`社交.关系[名称=李明阳].好感度`（行 51，FILTER_SEGMENT_RE）
- 每次 `set()` 同步发射 `eventBus.emit('engine:state-changed', { change, source })`（行 398）
- 变更历史上限 200 条（行 74）
- 无内建 auto-save / debounce — 外部调用方负责持久化

### 2.9 DEFAULT_ENGINE_PATHS 关键路径

**来源：** `src/engine/pipeline/types.ts` 行 659-740

| 常量 key | 实际路径 | 数据结构 |
|----------|---------|---------|
| `characterBaseInfo` | `角色.基础信息` | `{姓名, 当前位置, 年龄, 性别, 特质{名称,描述}}` |
| `characterAttributes` | `角色.属性` | `{体质, 直觉, 悟性, 气运, 魅力, 心性}`（all number 0-20） |
| `characterAge` | `角色.基础信息.年龄` | number |
| `characterGender` | `角色.基础信息.性别` | string |
| `characterOccupation` | `角色.可变属性.地位.名称` | string |
| `characterDescription` | `角色.可变属性.地位.描述` | string |
| `characterTraits` | `角色.基础信息.特质` | `{名称, 描述}` |
| `characterOrigin` | `角色.身份.出身` | `{名称, 描述}` |
| `characterTalentTier` | `角色.身份.天赋档次` | string |
| `characterInnateStats` | `角色.身份.先天六维` | `{体质, 直觉, 悟性, 气运, 魅力, 心性}`（all number 1-10） |
| `talents` | `角色.身份.天赋` | `[{名称, 描述}]` |
| `inventoryItems` | `角色.背包.物品` | `Record<id, InventoryItem>` |
| `inventoryCurrency` | `角色.背包.金钱` | `{现金, 铜, 银, 金}` |
| `relationships` | `社交.关系` | `NpcRelation[]` |
| `locations` | `世界.地点信息` | `LocationEntry[]` |
| `statusEffects` | `角色.效果` | `StatusEffect[]` |
| `vitalHealth` | `角色.可变属性.体力` | `{当前, 上限}` |
| `vitalEnergy` | `角色.可变属性.精力` | `{当前, 上限}` |
| `reputation` | `角色.可变属性.声望` | number |

**npcFieldNames 映射（行 710-738）：** 完整的中文字段名 → 英文 key 映射，Story 2 的 editor composable 必须使用此映射而非硬编码中文字段名。

### 2.10 PlotPanel 当前编辑覆盖率（C2 修订新增）

**文件：** `src/ui/components/panels/PlotPanel.vue`（**1103 行**）

**Epic 设计文档确认剧情导向属于卡创作范畴：** §1 line 33（"完整的世界初始状态 — 包括...剧情导向"）、§3.1 line 103（`剧情导向 → 卡导出：完整保留`）、§4.1 line 457（"Step 5: 设置剧情导向"）。

**数据路径：** `DEFAULT_ENGINE_PATHS.plotDirection`（`元数据.剧情导向`）

**写入模式：** PlotPanel 通过 `usePlotStore()` 管理内存状态，由 PlotPanel 的**局部** `persist()` 函数（行 50-54）调用 `plotStore.toStateSnapshot()` + `setValue(DEFAULT_ENGINE_PATHS.plotDirection, snapshot)` + `eventBus.emit('engine:request-save')` 写入状态树。`persist()` 不是 plotStore 的方法，是 PlotPanel.vue 的局部函数。共 **1 个**实际 `setValue` 调用（行 52）；行 18 是 `useGameState()` 解构导入，不计入。

**现有 CRUD 覆盖率：**

| 操作对象 | Create | Read | Update | Delete |
|---------|--------|------|--------|--------|
| 弧线 (Arc) | ✅ 创建弧线模态（行 70-117） | ✅ 弧线标题/概要/状态展示 | ❌ **标题/概要创建后不可编辑** | ✅ 删除弧线（行 139-144） |
| 节点 (Node) | ✅ 添加节点模态（行 152-182） | ✅ 节点链展示 | ✅ 编辑节点模态（行 229-243） | ✅ 删除节点（行 192-197） |
| 仪表盘 (Gauge) | ✅ 添加仪表盘模态（行 309-330） | ✅ 仪表盘条展示 | ✅ 编辑仪表盘模态（行 292-307） | ✅ 删除仪表盘（行 261-266） |
| 弧线激活/放弃 | — | — | ✅ 激活（行 124-129）/ 放弃（行 131-137） | — |

**Node 可编辑字段：** `directive`（指令）, `completionHint`（完成条件）, `narrativeGoal`（叙事目标）, `maxRounds`（最大轮数）, `importance`（重要性）, `completionMode`（完成模式）

**Gauge 可编辑字段：** `name`, `description`, `current`, `min`, `max`, `unit`, `aiUpdatable`, `autoDecrement`

**关键缺失（Story 2 需补齐）：** 弧线创建后标题（`title`）和概要（`synopsis`）不可编辑。卡作者可能需要在创建后修改弧线标题和概要。

**C2 决策：方案 A — 纳入 PlotPanel。** 理由：epic §4.1 line 457 明确将剧情导向编辑列为卡创作攻略步骤，如果不纳入，用户需要通过 GameVariablePanel 编辑剧情导向，违反 Story 2 "从不需要打开 GameVariablePanel" 的成功标准。PlotPanel 已有 ~80% CRUD 覆盖率，补齐弧线编辑的工作量较小（1-2 天）。

### 2.11 面板范围边界审查（M7 修订新增）

**`panels/` 目录全部面板审查（`wc -l` 排序）：**

| 面板 | 行数 | Story 2 范围 | 说明 |
|------|------|-------------|------|
| ImagePanel | 6828 | ❌ 不在范围 | 图像生成系统，非卡创作数据编辑 |
| CharacterDetailsPanel | 3201 | ✅ 在范围 | §3.1 |
| SettingsPanel | 2838 | ❌ 不在范围 | 系统设置，非游戏数据 |
| RelationshipPanel | 2774 | ✅ 在范围 | §3.2 |
| SavePanel | 1944 | ❌ 不在范围 | 存档管理，属 Story 5/6 |
| APIPanel | 1926 | ❌ 不在范围 | API 配置，非游戏数据 |
| MainGamePanel | 1828 | ❌ 不在范围 | 游戏主界面，非编辑 |
| PromptPanel | 1495 | ❌ 不在范围 | Prompt 编辑，属 Story 9 写卡工具箱 |
| GameVariablePanel | 1448 | ✅ 在范围（高级 fallback） | §2.5 / §3.5 |
| MemoryPanel | 1313 | ❌ 不在范围 | 记忆系统展示，非卡创作编辑 |
| EngramDebugPanel | 1312 | ❌ 不在范围 | Engram 调试工具，属 Story 1 |
| PromptAssemblyPanel | 1168 | ❌ 不在范围 | Prompt 组装展示 |
| PlotPanel | 1103 | ✅ 在范围 | §2.10 / §3.6 |
| MapPanel | 1100 | ✅ 在范围 | §3.3 |
| EventPanel | 877 | ❌ 不在范围 | 世界事件展示，只读历史 |
| AssistantPanel | 830 | ❌ 不在范围 | AI 助手，属 Story 3 |
| WorldBookTab | 769 | ❌ 不在范围 | 世界设定手册，非 CRUD |
| EngramRoundViewer | 738 | ❌ 不在范围 | Engram 回合查看器 |
| InventoryPanel | 610 | ✅ 在范围 | §3.4 |

**小型面板组件（非独立面板）：**

| 组件 | Story 2 范围 | 说明 |
|------|-------------|------|
| EnvironmentChips / EnvironmentArrayEditorModal / EnvironmentPopover | ❌ 不在范围 | 环境标签编辑器，已有 CRUD（emit-based，父组件处理 setValue），AI 每回合强制覆盖。卡作者编辑意义不大。 |
| FestivalChip / FestivalEditModal / FestivalPopover | ❌ 不在范围 | 节日编辑器，同上。 |
| HeartbeatPanel | ❌ 不在范围 | 世界心跳配置，系统级设置。 |

---

## 3. 各面板目标设计

### 3.1 CharacterDetailsPanel — 角色详情面板

#### 3.1.a 当前能力 vs 目标能力对比表

| 字段 / 操作 | 当前 | 目标（Story 2 后） | 编辑方式 |
|---|---|---|---|
| **basic tab** | | | |
| 姓名 | ✅ 双击内联 + SchemaForm | ✅ 保持现有 | 不变 |
| 年龄 | ✅ 双击内联 | ✅ 保持现有 | 不变 |
| 性别 | ❌ 只读 | ✅ 可编辑 | 点击 → select dropdown（男/女/其他） |
| 职业/地位名称 | ❌ 只读 | ✅ 可编辑 | 点击 → inline text input |
| 当前位置 | ❌ 只读 | ✅ 可编辑 | 点击 → select（从 `世界.地点信息` 读取选项列表） |
| 出身 | ❌ 只读 | ✅ 可编辑 | 点击 → 展开内联编辑（名称 + 描述两字段） |
| 特质 | ❌ 只读 | ✅ 可编辑 | 点击 → 展开内联编辑（名称 + 描述两字段） |
| 天赋列表 | ❌ 只读 | ✅ 可编辑 | 点击 → 展开编辑，每项 {名称, 描述}，支持增删 |
| 地位描述 | ❌ 只读 | ✅ 可编辑 | 点击 → inline textarea |
| **attributes tab** | | | |
| 先天六维 | ❌ 只读进度条 | ✅ 可编辑 | 每个维度添加 ±1 步进按钮，或点击进度条弹出 number input |
| 后天属性 | ✅ SchemaForm 模态 | ✅ 保持 + 增强 | 在面板中直接显示可调步进器，保留 SchemaForm 作为"高级编辑" |
| 可变属性（体力/精力/声望） | ❌ 不在面板中 | ✅ 可编辑 | 新增 vitals 小节：体力/精力（当前/上限）+ 声望 |
| **relations tab** | | | |
| 关系 NPC 列表 | ❌ 只读展示 | ✅ 跳转入口 | 保持只读展示，每个 NPC 卡片添加"在社交面板中编辑"跳转按钮 |
| **achievements tab** | | | |
| 成就 | ❌ 空占位 | ❌ 不在 Story 2 范围 | 成就是游玩产物，不属于卡创作编辑范畴（见 OQ-F） |
| **body tab (NSFW)** | | | |
| 身高/体重 | ❌ 只读 | ✅ 可编辑 | number input |
| 三围 | ❌ 只读 | ✅ 可编辑 | 三个 number input（胸围/腰围/臀围） |
| 胸部描述/私处描述/生殖器描述 | ❌ 只读 | ✅ 可编辑 | textarea |
| 身体部位数组 | ❌ 只读 | ✅ 可编辑 | 列表编辑（复用 RelationshipPanel NSFW 节的模式）：每项含部位名称/敏感度/开发度/特征描述/特殊印记 |
| 子宫/内射记录 | ❌ 只读 | ✅ 可编辑 | 子对象编辑（状态/宫口状态 text + 内射记录数组增删） |
| 敏感点/纹身与印记 | ❌ 只读 | ✅ 可编辑 | tag list + add input |
| **playerImage tab** | | | |
| 锚点/生图 | ✅ 已完整 | ✅ 保持现有 | 不变 |
| **状态效果** | | | |
| `角色.效果[]` | ❌ 不在面板 | ❌ 不在 Story 2 范围 | 状态效果是游玩产物（buff/debuff），卡作者不应手动编辑 |

#### 3.1.b UI mockup

```
╭─ CharacterDetailsPanel ──────────────────────────────────────╮
│ ┌─ Hero header ────────────────────────────────────────────┐ │
│ │ [Avatar]  Name: 张无忌 ✏   Age: 20 ✏   Gender: [男▾]   │ │
│ │           Occupation: [掌教 ✏]  Location: [光明顶 ▾]     │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ [Basic] [Attributes] [Relations] [Body*] [PlayerImage]        │
│                                                               │
│ ── Basic tab ──────────────────────────────────────────────── │
│ 出身: 武当弟子 ✏ (点击展开 → 名称 + 描述 编辑)               │
│ 特质: 坚毅 ✏ (点击展开 → 名称 + 描述 编辑)                   │
│ 天赋:                                                         │
│   [明玉功 ✏] [九阳神功 ✏] [+ 新增]                           │
│ 描述: 武林中的传奇人物... ✏                                   │
│                                                               │
│ ── Attributes tab ─────────────────────────────────────────── │
│ 先天六维 (创角基线):                                           │
│   体质 ███████░░░ 7  [-][+]                                   │
│   直觉 █████░░░░░ 5  [-][+]                                   │
│   ...                                                         │
│ 后天属性 (当前):                                               │
│   体质 ████████████░░ 12/20  [-][+]  [高级编辑]               │
│   ...                                                         │
│ ── 可变属性 ──                                                 │
│   体力: [85] / [100]   精力: [70] / [100]   声望: [250]       │
│                                                               │
│ ── Body tab (NSFW) ─────────────────────────────────────────  │
│ 身高: [170] cm  体重: [55] kg                                  │
│ 三围: 胸围 [85]  腰围 [60]  臀围 [88]                          │
│ 胸部描述: [textarea ✏]                                         │
│ 身体部位:                                                      │
│   嘴  敏感度:[■■■■■░░░░░ 50] 开发度:[■■░░░░░░░░ 20]           │
│   [特征描述 ✏] [特殊印记 ✏]                                    │
│   ... (胸部 / 小穴 / 屁穴 + 自定义)                            │
│   [+ 添加部位]                                                 │
╰───────────────────────────────────────────────────────────────╯
```

#### 3.1.c 编辑流程描述

**流程 1：内联字段编辑（性别/职业/位置等新增字段）**
1. 用户点击字段值区域（带 ✏ 图标提示可编辑）
2. 字段值变为对应输入控件（text input / select / number input）
3. 用户编辑完成后 blur / Enter → 调用 `useCharacterEditor().updateField(path, value)`
4. Composable 执行校验 → `setValue(path, value)` → toast 确认
5. Escape 取消编辑

**流程 2：复合对象编辑（出身/特质）**
1. 用户点击 `{名称, 描述}` 展示区域
2. 区域展开为两行内联表单：名称 text input + 描述 textarea
3. 自动 focus 到名称输入框
4. 用户编辑两个字段 → 点击 ✓ 确认或 blur 区域外 → 调用 `useCharacterEditor().updateField(path, {名称, 描述})`
5. 折叠回展示模式

**流程 3：数组编辑（天赋列表）**
1. 每个天赋显示为可点击卡片
2. 点击某天赋 → 展开为 {名称, 描述} 内联编辑（同流程 2）
3. 点击 [+ 新增] → 在末尾插入空卡片，自动进入编辑模式
4. 每个卡片有 × 删除按钮 → 确认后删除
5. 调用 `useCharacterEditor().updateField(talentsPath, updatedArray)`

**流程 4：步进器编辑（属性数值）**
1. 每个属性显示为进度条 + 当前值 + [-] [+] 按钮
2. 点击 [-] / [+] → 值 ±1，限制在 schema 的 min/max 范围内
3. 每次点击立即 `useCharacterEditor().updateAttribute(attrName, newValue)`
4. 长按 [-] / [+] → 持续增减（300ms 间隔）
5. 保留 [高级编辑] 按钮 → 打开现有 SchemaForm 模态

**流程 5：位置选择（从地点列表选）**
1. 用户点击当前位置值
2. 展开 select dropdown，选项从 `useValue(DEFAULT_ENGINE_PATHS.locations)` 动态读取
3. 每个选项显示地点名称（已探索的在前，带类型标签）
4. 选择后 → `useCharacterEditor().updateField(playerLocationPath, 选中地点名称)`
5. 也可手动输入（combo box 模式）以输入地点列表外的位置

#### 3.1.d 字段级编辑设计

| 字段类型 | 控件 | 约束 |
|---------|------|------|
| 短文本（姓名/职业/特质名称） | text input, max 50 chars | 非空校验（姓名） |
| 长文本（描述/背景/特征描述） | textarea, 3-5 行，max 500 chars | 可选 |
| 数字（年龄/属性/敏感度） | number input 或 stepper | min/max 从 schema 读取 |
| 枚举（性别） | select dropdown | 选项：男/女/其他 |
| 位置选择 | combo box（select + 手动输入） | 选项从 `世界.地点信息` 动态读取 |
| {名称, 描述} 对象 | 内联双字段展开 | 每字段有独立 label |
| [{名称, 描述}] 数组 | 可折叠卡片列表 + 增删 | 新条目自动 focus |
| NSFW 文本 | textarea | 仅 `nsfwEnabled` 时可见 |
| NSFW 身体部位数组 | 复用 RelationshipPanel 的模式：部位名称 + 敏感度 slider + 开发度 slider + 特征描述 textarea + 印记 text | 4 固定部位不可删除 |

#### 3.1.e 跨字段联动

| 触发 | 联动 |
|------|------|
| 修改姓名 | 需通过 `useCharacterEditor` 通知 Engram 侧 — 但主角的 Engram 实体由 EntityBuilder 扫描 `角色.基础信息.姓名` 自动派生，下次 scan 自然更新。Story 2 不做显式 cascade。 |
| 修改当前位置 | 纯状态树字段修改，无 cascade 需求。MapPanel 的玩家位置标记通过 `useValue(playerLocation)` 自动响应。 |
| 修改性别 | 如果从非男改为男，NSFW body tab 中的某些字段（子宫等）应提示"不适用"。body tab 根据 `gender` computed 动态显示/隐藏。 |

#### 3.1.f i18n key 命名

新增 key 在 `character` 命名空间下：

```
character.edit.gender          → "性别"
character.edit.occupation      → "地位"
character.edit.location        → "当前位置"
character.edit.origin          → "出身"
character.edit.trait           → "特质"
character.edit.talent          → "天赋"
character.edit.description     → "描述"
character.edit.clickToEdit     → "点击编辑"
character.edit.addTalent       → "添加天赋"
character.edit.removeTalent    → "删除天赋"
character.edit.confirmRemove   → "确认删除？"
character.edit.nameRequired    → "姓名不能为空"
character.edit.innateStats     → "先天六维"
character.edit.acquiredStats   → "后天属性"
character.edit.vitals          → "可变属性"
character.edit.health          → "体力"
character.edit.energy          → "精力"
character.edit.reputation      → "声望"
character.edit.advancedEdit    → "高级编辑"
character.edit.genderOption.*  → "男" / "女" / "其他"
character.body.edit.*          → 身体编辑相关（身高/体重/三围/描述/部位/子宫等）
character.toast.fieldUpdated   → "已更新"
character.toast.talentAdded    → "天赋已添加"
character.toast.talentRemoved  → "天赋已删除"
```

---

### 3.2 RelationshipPanel — 社交面板

#### 3.2.a 当前能力 vs 目标能力对比表

| 字段 / 操作 | 当前 | 目标（Story 2 后） | 变更说明 |
|---|---|---|---|
| **NPC CRUD** | | | |
| 创建 NPC | ✅ "+" 按钮 | ✅ 保持 | 不变 |
| 编辑 NPC | ✅ 7 节模态 | ✅ 扩展 | 补齐 Social-1 新字段 |
| 删除 NPC | ✅ 模态内删除按钮 | ✅ 增强 | 添加 cascade 警告（引用此 NPC 的地点 / Engram） |
| **模态字段覆盖** | | | |
| 核心性格特征 | ❌ 无 | ✅ | 在"基础信息"节新增 textarea |
| 关系状态 | ❌ 仅详情展示 | ✅ + D26 标注 | 在"基础信息"节新增 text input + D26 提示条："此为显示标签，权威关系数据在关系网编辑器" |
| 好感度突破条件 | ❌ 无 | ✅ | 在"基础信息"节新增 textarea（AI 参考字段） |
| 关系突破条件 | ❌ 无 | ✅ | 在"基础信息"节新增 textarea（AI 参考字段） |
| 关系网变量 | ❌ 无 | ✅ + D26 标注 | 新增"关系网"节：对象/关系/备注的三列行 + 增删 + D26 提示条 |
| 总结记忆 | ❌ 仅 NpcMemoryTimeline 展示 | ✅ 可编辑 | 在"记忆"节之后新增"总结记忆"子节：摘要 textarea + 涵盖范围 text + 生成时间 text + 增删 |
| **Engram 协调** | | | |
| "在关系网中查看" | ❌ 无 | ✅ | 详情视图顶部添加按钮 → router.push 到关系网编辑器（Story 1 路由） |
| 编辑 NPC 名称 cascade | ❌ 无 | ✅ | `useNpcEditor.rename()` 内部调用 Engram renameEntity API（如果 Story 1 已上线） |
| 删除 NPC cascade | ❌ 无 | ✅ | `useNpcEditor.delete()` 时弹出确认，列出影响的 Engram 实体数 |

#### 3.2.b UI mockup — 编辑模态扩展

```
╭─ 编辑 NPC: 赵敏 ────────────────────────────────────────────╮
│                                                               │
│ ── 基础信息 ──────────────────────────────────────────────── │
│ 名称: [赵敏________]  类型: [关键 ▾]  性别: [女 ▾]           │
│ 年龄: [18]  好感度: [■■■■■■■░░░ 70]  位置: [大都___]         │
│ 关系状态: [恋人___]                                           │
│   ⓘ 此为显示标签；权威关系数据请在关系网编辑器中维护          │
│ 核心性格特征: [外柔内刚，为达目的不择手段________] (textarea)  │
│ 好感度突破条件: [需要展现真诚以消除猜疑______] (textarea)      │
│ 关系突破条件: [需要在大义面前做出抉择______] (textarea)        │
│                                                               │
│ ── 外貌与描述 (现有，保持) ────────────────────────────────── │
│ ...                                                           │
│                                                               │
│ ── 关系网 (新增) ─────────────────────────────────────────── │
│   ⓘ 此为辅助标签；权威关系数据在关系网编辑器中维护            │
│   对象          关系        备注                               │
│   [周芷若___]   [情敌___]   [暗中较劲______]    [×]           │
│   [范遥_____]   [义父部下]  [忠心耿耿______]    [×]           │
│   [+ 添加关系]                                                │
│                                                               │
│ ── 记忆 (现有，保持) ─────────────────────────────────────── │
│ ...                                                           │
│                                                               │
│ ── 总结记忆 (新增) ───────────────────────────────────────── │
│   摘要: [赵敏与主角从敌对到相爱的过程...______] (textarea)     │
│   涵盖范围: [第 1-20 次互动]  生成时间: [天命元年三月]         │
│   [× 删除]                                                    │
│   [+ 添加总结记忆]                                            │
│                                                               │
│ ── NSFW (现有，保持) ──────────────────────────────────────── │
│ ...                                                           │
│                                                               │
│                              [删除 NPC]  [取消]  [保存]        │
╰───────────────────────────────────────────────────────────────╯
```

#### 3.2.c 编辑流程描述

**流程 1：编辑 NPC 名称（含 cascade）**
1. 用户在编辑模态中修改 `名称` 字段
2. 点击"保存" → `useNpcEditor().save(index, formData)` 检测名称是否变更
3. 如果名称变更：
   a. 更新 `社交.关系[index]` 中的所有数据
   b. 扫描 `世界.地点信息[].NPC[]` 中引用旧名称的条目，替换为新名称
   c. 如果 Engram renameEntity API 可用（Story 1 已上线），调用 `engramEditor.renameEntity(oldName, newName)`
   d. 如果 API 不可用，记录 pending rename（EntityBuilder 下次 scan 会自动派生新实体）
4. toast 确认

**流程 2：删除 NPC（含 cascade）**
1. 用户在编辑模态内点击"删除 NPC"
2. `useNpcEditor().confirmDelete(index)` 弹出确认对话框
3. 确认对话框展示影响分析：
   - "将从 NPC 列表中移除 [赵敏]"
   - 如果有地点 NPC 列表引用此名称：显示"以下地点将移除此 NPC 驻留：[大都, 客栈]"
   - 如果 Engram 中有此 NPC 的实体：显示"关系网编辑器中的 [赵敏] 实体将变为孤立"
4. 用户确认 → `useNpcEditor().delete(index)` 执行：
   a. 从 `社交.关系` 数组中 splice
   b. 扫描 `世界.地点信息[].NPC[]` 移除引用
   c. 不自动删除 Engram 实体（让 EntityBuilder 自然 "miss"；用户可在关系网编辑器中手动清理）
5. toast 确认

**流程 3：新增关系网变量条目**
1. 用户点击"+ 添加关系"
2. 新增一行空表单：对象 text input + 关系 text input + 备注 text input
3. 用户填写后 → 保存时随整个 NPC 表单一起写入

#### 3.2.d 字段级编辑设计

新增字段的控件类型：

| 字段 | 控件 | 说明 |
|------|------|------|
| 核心性格特征 | textarea, 2 行 | 一句话锚定；对 AI 的提示参考 |
| 关系状态 | text input | 自由文本（如 陌生/朋友/恋人/敌对） |
| 好感度突破条件 | textarea, 2 行 | AI 参考字段 |
| 关系突破条件 | textarea, 2 行 | AI 参考字段 |
| 关系网变量[].对象 | text input | NPC 名称 |
| 关系网变量[].关系 | text input | 关系标签 |
| 关系网变量[].备注 | text input | 可选 |
| 总结记忆[].摘要 | textarea, 3 行 | 总结文本 |
| 总结记忆[].涵盖范围 | text input | 如 "第 1-20 次互动" |
| 总结记忆[].生成时间 | text input | 游戏时间字符串 |

#### 3.2.e 跨字段联动

| 触发 | 联动 |
|------|------|
| 修改 NPC 名称 | cascade 更新 `世界.地点信息[].NPC[]` 引用 + Engram renameEntity（可选） |
| 删除 NPC | cascade 清理 `世界.地点信息[].NPC[]` 引用 |
| 修改 NPC 位置 | 不自动联动（NPC 的 `位置` 字段是显示信息，`世界.地点信息[].NPC[]` 是驻留信息，两者独立） |

#### 3.2.f i18n key 命名

新增 key 在 `relationship` 命名空间下：

```
relationship.editForm.sectionRelationNetwork  → "关系网"
relationship.editForm.sectionMemorySummary    → "总结记忆"
relationship.editForm.label.corePersonality   → "核心性格特征"
relationship.editForm.label.relationshipStatus → "关系状态"
relationship.editForm.label.affinityBreak     → "好感度突破条件"
relationship.editForm.label.relationBreak     → "关系突破条件"
relationship.editForm.label.networkTarget     → "对象"
relationship.editForm.label.networkRelation   → "关系"
relationship.editForm.label.networkNote       → "备注"
relationship.editForm.label.summaryText       → "摘要"
relationship.editForm.label.summaryRange      → "涵盖范围"
relationship.editForm.label.summaryTime       → "生成时间"
relationship.editForm.d26Hint                 → "此为显示标签；权威关系数据请在关系网编辑器中维护"
relationship.editForm.addNetworkEntry         → "添加关系"
relationship.editForm.addSummary              → "添加总结记忆"
relationship.editForm.placeholder.corePersonality → "一句话描述核心性格..."
relationship.editForm.placeholder.breakCondition  → "描述突破条件..."
relationship.detail.viewInEngram              → "在关系网中查看"
relationship.delete.cascadeWarning            → "以下数据将受影响："
relationship.delete.locationRefs              → "以下地点将移除此 NPC 驻留"
relationship.delete.engramEntity              → "关系网编辑器中的实体将变为孤立"
```

---

### 3.3 MapPanel — 地图面板

#### 3.3.a 当前能力 vs 目标能力对比表

| 字段 / 操作 | 当前 | 目标（Story 2 后） | 工作量 |
|---|---|---|---|
| 查看地点详情 | ✅ 点击节点 → 侧栏 | ✅ 保持 | 不变 |
| 创建地点 | ❌ 无 | ✅ | 新增"+"按钮 → 新建表单 |
| 编辑地点 | ❌ 完全只读 | ✅ | 详情侧栏添加"编辑"按钮 → 编辑表单 |
| 删除地点 | ❌ 无 | ✅ | 详情侧栏添加"删除"按钮 + cascade 确认 |
| 管理连接 | ❌ `连接[]` 字段未展示 | ✅ | 编辑表单中添加连接列表编辑 |
| 修改层级 | ❌ `上级` 字段只读展示 | ✅ | 编辑表单中添加"上级地点"select |
| 修改 NPC 驻留 | ❌ NPC 列表只读 | ✅ | 编辑表单中添加 NPC 多选 tag list |
| 图形中直接操作 | ❌ 无 | ✅ | 右键节点 → 上下文菜单（编辑/删除/新建子地点） |

#### 3.3.b UI mockup

```
╭─ MapPanel ────────────────────────────────────────────────────╮
│ [适应视图] [刷新] [+ 新建地点] [?]                             │
│                                                                │
│ ┌─ Cytoscape 图 ────────────────┐  ┌─ 详情/编辑侧栏 ────────┐│
│ │                                │  │ 光明顶                  ││
│ │    ┌─ 东荒大陆 ─────────┐     │  │ ✅ 已探索  📍 你在这里   ││
│ │    │  (青云城) (客栈)    │     │  │                          ││
│ │    │  ●光明顶 ←玩家     │     │  │ [编辑] [删除]            ││
│ │    │         (密道)     │     │  │                          ││
│ │    └────────────────────┘     │  │ 描述: 明教总坛所在...    ││
│ │                                │  │ 类型: 山峰               ││
│ │                                │  │ 上级: 东荒大陆           ││
│ │                                │  │                          ││
│ │                                │  │ NPC:                     ││
│ │                                │  │  [张无忌] [杨逍] [范遥]  ││
│ │                                │  │                          ││
│ │                                │  │ 连接:                    ││
│ │                                │  │  [青云城] [密道]         ││
│ │                                │  │                          ││
│ │                                │  │ 子地点:                  ││
│ │                                │  │  [圣火厅] [禁地]        ││
│ │ [全部] / 光明顶 / 圣火厅      │  │                          ││
│ └────────────────────────────────┘  └──────────────────────────┘│
╰────────────────────────────────────────────────────────────────╯

── 编辑地点弹窗 ──
╭─ 编辑地点: 光明顶 ──────────────────────────────────╮
│ 名称: [光明顶_____________]                          │
│ 描述: [明教总坛所在的雄伟山峰，海拔千丈..._] (ta)    │
│ 类型: [山峰_______________]                          │
│ 上级地点: [东荒大陆 ▾]                               │
│                                                      │
│ 连接地点:                                            │
│   [青云城 ×] [密道 ×]  [+ 添加连接 ▾]               │
│   ⓘ 连接为双向：添加 A→B 时自动添加 B→A             │
│                                                      │
│ 驻留 NPC:                                            │
│   [张无忌 ×] [杨逍 ×] [范遥 ×]  [+ 添加 NPC ▾]      │
│                                                      │
│                         [取消]  [保存]                │
╰──────────────────────────────────────────────────────╯
```

#### 3.3.c 编辑流程描述

**流程 1：新建地点**
1. 用户点击工具栏 [+ 新建地点] 按钮
2. 弹出编辑模态，字段为空，"上级地点"预填当前 drill 路径的父级（如正在查看"东荒大陆"内部，则预填"东荒大陆"）
3. 用户填写名称（必填）+ 可选字段
4. 点击"保存" → `useLocationEditor().create(formData)` 执行：
   a. 校验名称非空 + 在现有地点中唯一
   b. `stateManager.push('世界.地点信息', newLocation)`
   c. 如果添加了连接，对每个连接目标地点也添加反向连接
   d. 如果添加了 NPC 驻留，不联动 NPC 的 `位置` 字段（两者独立）
5. Cytoscape 图自动更新（通过 `useValue` reactive watch）

**流程 2：编辑地点**
1. 用户在详情侧栏点击 [编辑] → 弹出编辑模态（预填现有数据）
2. 或右键图中节点 → 上下文菜单 → "编辑"
3. 用户修改字段
4. 点击"保存" → `useLocationEditor().update(index, formData)` 执行：
   a. 如果名称变更：扫描 `社交.关系[].位置` 中引用旧名称的 NPC 更新为新名称；扫描其他地点的 `连接[]` 和 `上级` 更新引用
   b. 如果连接变更：维护双向一致性
   c. `setValue('世界.地点信息', updatedList)`

**流程 3：删除地点**
1. 用户在详情侧栏点击 [删除] 或右键菜单 → "删除"
2. `useLocationEditor().confirmDelete(index)` 弹出确认对话框，展示影响分析：
   - "将删除地点 [光明顶]"
   - 如果有子地点："以下子地点的上级将被清空：[圣火厅, 禁地]"
   - 如果有 NPC 驻留引用此地点名称（`社交.关系[].位置`）："以下 NPC 的位置将改为'未知'：[张无忌, 杨逍]"
   - 如果有其他地点的 `连接[]` 引用此地点："以下地点的连接将移除此地点：[青云城, 密道]"
3. 用户确认 → `useLocationEditor().delete(index)` 执行：
   a. 子地点的 `上级` 清空（变成顶级地点）
   b. 引用此地点名称的 NPC `位置` 字段改为 `''`（空字符串，UI 显示为"未知"）
   c. 其他地点 `连接[]` 中移除此地点名称
   d. 从 `世界.地点信息` 数组中 splice
4. toast 确认

**流程 4：图中右键上下文菜单**
1. 用户在 Cytoscape 图中右键（长按 on mobile）某节点
2. 弹出上下文菜单：[编辑] [删除] [新建子地点]
3. "新建子地点" → 弹出新建表单，`上级` 预填此节点名称

#### 3.3.d 字段级编辑设计

| 字段 | 控件 | 约束 |
|------|------|------|
| 名称 | text input | 必填，在现有地点中唯一 |
| 描述 | textarea, 3 行 | 可选 |
| 类型 | text input（或 combo box，建议保留自由输入） | 可选 |
| 上级地点 | select（从现有地点列表读取，排除自身及自身子地点） | 可选 |
| 连接 | tag list + select 添加器（从现有地点列表读取，排除自身） | 双向自动维护 |
| NPC 驻留 | tag list + select 添加器（从 `社交.关系` 读取 NPC 名称列表） | 可选 |

#### 3.3.e 跨字段联动

| 触发 | 联动 |
|------|------|
| 修改地点名称 | cascade 更新：(1) 子地点的 `上级` 字段 (2) 其他地点的 `连接[]` 引用 (3) `社交.关系[].位置` 中引用旧名称的 NPC |
| 删除地点 | cascade 处理：(1) 子地点 `上级` 清空 (2) NPC `位置` 清空 (3) 其他地点 `连接[]` 移除引用 |
| 修改连接 | 双向维护：添加 A→B 连接时自动添加 B→A；删除 A→B 时自动删除 B→A |
| 修改上级 | 不允许循环引用（A 的上级是 B，B 的上级是 A） |

#### 3.3.f i18n key 命名

新增 key 在 `map` 命名空间下：

```
map.action.create               → "新建地点"
map.action.edit                 → "编辑"
map.action.delete               → "删除"
map.action.createChild          → "新建子地点"
map.edit.title                  → "编辑地点"
map.edit.titleCreate            → "新建地点"
map.edit.label.name             → "名称"
map.edit.label.description      → "描述"
map.edit.label.type             → "类型"
map.edit.label.parent           → "上级地点"
map.edit.label.connections      → "连接地点"
map.edit.label.npcs             → "驻留 NPC"
map.edit.connectionHint         → "连接为双向：添加 A→B 时自动添加 B→A"
map.edit.placeholder.name       → "输入地点名称..."
map.edit.placeholder.description → "描述此地点..."
map.edit.addConnection          → "添加连接"
map.edit.addNpc                 → "添加 NPC"
map.edit.noParent               → "无（顶级地点）"
map.delete.confirm              → "确认删除地点？"
map.delete.cascadeChildren      → "以下子地点的上级将被清空"
map.delete.cascadeNpcs          → "以下 NPC 的位置将改为未知"
map.delete.cascadeConnections   → "以下地点的连接将移除此地点"
map.toast.created               → "地点已创建"
map.toast.updated               → "地点已更新"
map.toast.deleted               → "地点已删除"
map.validate.nameRequired       → "名称不能为空"
map.validate.nameDuplicate      → "地点名称已存在"
map.validate.circularParent     → "不允许循环层级关系"
```

---

### 3.4 InventoryPanel — 背包面板

#### 3.4.a 当前能力 vs 目标能力对比表

| 字段 / 操作 | 当前 | 目标（Story 2 后） | 变更说明 |
|---|---|---|---|
| 物品列表展示 | ✅ 搜索/筛选/分类 | ✅ 保持 | 不变 |
| 创建物品 | ❌ 无 | ✅ | 工具栏新增"+"按钮 → 新建表单 |
| 编辑物品 | ❌ 无 | ✅ | 物品卡片添加"编辑"按钮 → 编辑表单 |
| 删除物品 | ❌ 无（丢弃走 action queue） | ✅ | 物品卡片添加"删除"按钮（直接从状态树移除 vs action queue 的丢弃） |
| 使用/装备/丢弃 | ✅ action queue | ✅ 保持 | 不变（游玩操作保留） |
| 货币编辑 | ❌ 只读展示 | ✅ | 货币栏每个币种添加编辑入口 |

**关键区分：** Story 2 的"删除"是卡创作的数据编辑（直接从状态树移除物品 key），与现有的"丢弃"（通过 action queue 提交给 AI 处理）是不同的操作。

#### 3.4.b UI mockup

```
╭─ InventoryPanel ──────────────────────────────────────────────╮
│ 背包                                    [+ 新增物品] [编辑货币]│
│                                                                │
│ ── 货币 ────────────────────────────────────────────────────── │
│ 💰 现金: 500  🪙 铜: 200  🥈 银: 15  🥇 金: 3               │
│                                                                │
│ [搜索物品...]  [类型筛选 ▾]  共 12 件物品                      │
│                                                                │
│ ┌─ 倚天剑 ★★★★ ──────────────────────── ⚔ 武器 ────────────┐ │
│ │ 削铁如泥的传世神兵                                          │ │
│ │ 数量: 1  品质: 传说                                        │ │
│ │ [使用] [装备] [丢弃]         [✏ 编辑] [🗑 删除]            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                │
│ ┌─ 金创药 ─────────────────────────────── 🧪 消耗品 ─────────┐ │
│ │ 疗伤圣药，恢复体力                                          │ │
│ │ 数量: 5  品质: 优良                                        │ │
│ │ [使用] [丢弃]                [✏ 编辑] [🗑 删除]            │ │
│ └─────────────────────────────────────────────────────────────┘ │
╰────────────────────────────────────────────────────────────────╯

── 编辑物品弹窗 ──
╭─ 编辑物品 ──────────────────────────────────────────╮
│ 名称: [倚天剑_____________]                          │
│ 类型: [武器 ▾]  (武器|防具|消耗品|材料|任务|饰品)    │
│ 数量: [1____]                                        │
│ 品质: [传说 ▾]  (普通|优良|稀有|史诗|传说|神话)       │
│ 描述: [削铁如泥的传世神兵...________] (textarea)      │
│ 可装备: [✓]  已装备: [✓]                             │
│                                                      │
│                         [取消]  [保存]                │
╰──────────────────────────────────────────────────────╯

── 编辑货币弹窗 ──
╭─ 编辑货币 ──────────────────────────────────────────╮
│ 现金: [500____]                                      │
│ 铜:   [200____]                                      │
│ 银:   [15_____]                                      │
│ 金:   [3______]                                      │
│                         [取消]  [保存]                │
╰──────────────────────────────────────────────────────╯
```

#### 3.4.c 编辑流程描述

**流程 1：新建物品**
1. 用户点击 [+ 新增物品]
2. 弹出编辑模态，字段为空。名称必填，类型默认"其他"，数量默认 1
3. 用户填写表单 → 点击"保存"
4. `useInventoryEditor().create(formData)` 执行：
   a. 生成 ID：`${类型}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
   b. `setValue('角色.背包.物品.${id}', itemData)`（注意：物品是 Record，用 set 添加 key）
5. toast 确认

**流程 2：编辑物品**
1. 用户点击物品卡片的 [✏ 编辑] 按钮
2. 弹出编辑模态，预填现有数据
3. 用户修改字段 → 点击"保存"
4. `useInventoryEditor().update(itemId, formData)` → `setValue('角色.背包.物品.${id}', mergedData)`
5. toast 确认

**流程 3：删除物品（卡创作级）**
1. 用户点击物品卡片的 [🗑 删除] 按钮
2. 确认对话框："确认从背包中永久删除 [倚天剑]？此操作不可撤销。"
3. 用户确认 → `useInventoryEditor().delete(itemId)` → 整 Record 替换（从 Record 副本中 delete key → `setValue(inventoryItems, updated)`）
4. toast 确认

**流程 4：编辑货币**
1. 用户点击 [编辑货币] 按钮
2. 弹出编辑模态，4 个 number input
3. 用户修改 → 点击"保存"
4. `useInventoryEditor().updateCurrency({ 现金, 铜, 银, 金 })` → `setValue('角色.背包.金钱', currencyObj)`

#### 3.4.d 字段级编辑设计

| 字段 | 控件 | 约束 |
|------|------|------|
| 名称 | text input | 必填 |
| 类型 | select | 选项：武器/防具/消耗品/材料/任务/饰品/其他 |
| 数量 | number input, min=1 | 必须 ≥ 1 |
| 品质 | select | 选项：普通/优良/稀有/史诗/传说/神话 |
| 描述 | textarea, 2 行 | 可选 |
| 可装备 | checkbox | 默认 false |
| 已装备 | checkbox | 仅在 可装备=true 时可见 |
| 货币 | 4 个 number input, min=0 | 不可为负 |

#### 3.4.e 跨字段联动

| 触发 | 联动 |
|------|------|
| 可装备 → false | 自动清除 已装备 标记 |
| 删除已装备的物品 | 无自动属性联动（装备属性影响由 AI 在下次回合处理） |

Story 2 **不处理**装备对 `角色.属性` 的联动。装备系统通过 AI + action queue 运作，Story 2 仅做数据层 CRUD。

#### 3.4.f i18n key 命名

新增 key 在 `inventory` 命名空间下：

```
inventory.action.create         → "新增物品"
inventory.action.editItem       → "编辑"
inventory.action.deleteItem     → "删除"
inventory.action.editCurrency   → "编辑货币"
inventory.edit.titleCreate      → "新增物品"
inventory.edit.titleEdit        → "编辑物品"
inventory.edit.titleCurrency    → "编辑货币"
inventory.edit.label.name       → "名称"
inventory.edit.label.type       → "类型"
inventory.edit.label.quantity   → "数量"
inventory.edit.label.quality    → "品质"
inventory.edit.label.description → "描述"
inventory.edit.label.equippable → "可装备"
inventory.edit.label.equipped   → "已装备"
inventory.edit.typeOption.*     → 武器/防具/消耗品/材料/任务/饰品/其他
inventory.edit.qualityOption.*  → 普通/优良/稀有/史诗/传说/神话
inventory.edit.placeholder.name → "输入物品名称..."
inventory.edit.placeholder.desc → "描述此物品..."
inventory.delete.confirm        → "确认从背包中永久删除此物品？"
inventory.delete.irreversible   → "此操作不可撤销"
inventory.validate.nameRequired → "名称不能为空"
inventory.validate.quantityMin  → "数量至少为 1"
inventory.toast.created         → "物品已创建"
inventory.toast.updated         → "物品已更新"
inventory.toast.deleted         → "物品已删除"
inventory.toast.currencyUpdated → "货币已更新"
```

---

### 3.5 GameVariablePanel — 通用编辑器（保留为高级 fallback）

#### 3.5.a 变更范围

GameVariablePanel 在 Story 2 中**不做功能变更**。仅做以下小调整：

1. **各专用面板添加"打开高级编辑器"链接**
   - CharacterDetailsPanel → 各 tab 右上角添加小型链接图标，点击跳转到 GameVariablePanel 并导航到对应路径（如 `角色.基础信息`）
   - MapPanel → 详情侧栏底部添加"在高级编辑器中查看"
   - InventoryPanel → 工具栏添加"高级编辑器"入口
   - RelationshipPanel → 编辑模态底部添加"在高级编辑器中查看此 NPC"

2. **GameVariablePanel 添加返回面板的链接**
   - 当用户从专用面板跳转过来时，显示"返回 [角色详情]"链接

实现方式：需要在 GameVariablePanel 中**新增 router query 处理**（当前无 `useRoute` 导入，无深链接支持）：

```typescript
// GameVariablePanel.vue 新增：
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();

// 监听 route query 变化 → 导航到目标路径
watch(() => route.query.path as string, (path) => {
  if (path) navigateTo(path);
}, { immediate: true });

// 显示"返回来源面板"链接
const returnPanel = computed(() => route.query.from as string ?? '');
```

---

### 3.6 PlotPanel — 剧情导向面板（C2 修订新增）

#### 3.6.a 当前能力 vs 目标能力对比表

| 字段 / 操作 | 当前 | 目标（Story 2 后） | 变更说明 |
|---|---|---|---|
| 创建弧线 | ✅ 模态（标题+概要+节点） | ✅ 保持 | 不变 |
| **编辑弧线标题/概要** | ❌ 创建后不可编辑 | ✅ 可编辑 | 弧线 header 区域添加编辑入口 |
| 删除弧线 | ✅ 已实现 | ✅ 保持 | 不变 |
| 激活/放弃弧线 | ✅ 已实现 | ✅ 保持 | 不变 |
| 节点 CRUD | ✅ 完整（创建/编辑/删除） | ✅ 保持 | 不变 |
| 仪表盘 CRUD | ✅ 完整（创建/编辑/删除） | ✅ 保持 | 不变 |

#### 3.6.b UI mockup — 弧线编辑

```
╭─ PlotPanel ───────────────────────────────────────────╮
│ 剧情导向                               [+ 创建弧线]   │
│                                                        │
│ ── 当前弧线 ────────────────────────────────────────── │
│ 🎭 复仇之路 ✏                    [状态: 进行中]        │
│ 概要: 主角发现师门灭亡的真相... ✏                      │
│                                                        │
│ [激活] [放弃] [删除]                                   │
│ ...                                                    │
╰────────────────────────────────────────────────────────╯
```

点击弧线标题旁的 ✏ → 内联编辑（text input）。
点击概要旁的 ✏ → 内联编辑（textarea）。

#### 3.6.c 编辑流程

1. 用户点击弧线标题/概要的 ✏ 图标
2. 字段变为对应输入控件
3. blur / Enter → `usePlotEditor().updateArc(arcId, { title?, synopsis? })`
4. `usePlotEditor.updateArc()` 内部完成：`plotStore.updateArc()` 更新内存 → `setValue(plotDirection, plotStore.toStateSnapshot())` 持久化 → `eventBus.emit('engine:request-save')` 触发自动保存（见 §4.6）
5. toast 确认

#### 3.6.d i18n key 命名

```
plot.arc.editTitle       → "编辑标题"
plot.arc.editSynopsis    → "编辑概要"
plot.toast.arcUpdated    → "弧线已更新"
plot.validate.titleRequired → "标题不能为空"
```

---

### 3.7 已审查但不在范围的面板（M7 修订）

详见 §2.11 面板范围边界审查。Environment/Festival 编辑组件已有独立 CRUD（emit-based），且这些字段由 AI 每回合强制覆盖（env-tags force-update contract），卡作者手动编辑后下一回合就会被 AI 覆盖，不属于 Story 2 范畴。

---

## 4. 编辑中间层 API 设计

> **D28 复用原则 + Story 1 C2 教训：** UI 组件不应直接调用 `useGameState().setValue()`。所有编辑操作必须通过 editor composable 层，由 composable 负责校验、cascade、错误码和 source 标记。

### 4.1 公共基础设施

#### 4.1.1 EditorResult 统一返回类型

```typescript
// src/ui/composables/editors/types.ts

interface EditorResult<T = void> {
  ok: boolean;
  data?: T;
  error?: EditorError;
}

interface EditorError {
  code: EditorErrorCode;
  i18nKey: string;        // 对应 i18n 翻译 key
  i18nParams?: Record<string, unknown>;  // 翻译参数
  message: string;        // fallback 英文消息
}

type EditorErrorCode =
  // 通用
  | 'FIELD_REQUIRED'      // 必填字段为空
  | 'FIELD_INVALID'       // 字段值无效（超范围/格式错）
  | 'NAME_DUPLICATE'      // 名称重复
  // NPC
  | 'NPC_NOT_FOUND'       // 目标 NPC 不存在（index 越界）
  | 'NPC_NAME_CONFLICT'   // NPC 名称与现有重复
  // 地点
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_NAME_CONFLICT'
  | 'LOCATION_CIRCULAR_PARENT'  // 循环层级
  // 物品
  | 'ITEM_NOT_FOUND'
  | 'ITEM_QUANTITY_INVALID';    // 数量 < 1
```

#### 4.1.2 公共 toast 工具

```typescript
// 所有 editor 使用统一的 toast 发射模式
function emitToast(type: 'success' | 'warning' | 'error', i18nKey: string, params?: Record<string, unknown>): void {
  eventBus.emit('ui:toast', { type, i18nKey, message: i18nKey, i18nParams: params, duration: 2000 });
}
```

### 4.2 useCharacterEditor

**文件：** `src/ui/composables/editors/useCharacterEditor.ts`

```typescript
interface UseCharacterEditor {
  // 通用字段更新（单字段）
  updateField(path: string, value: unknown): EditorResult;

  // 属性步进
  updateAttribute(attrPath: string, delta: number): EditorResult;

  // 可变属性（体力/精力/声望）
  updateVitals(vitalsData: { health?: { current: number; max: number }; energy?: { current: number; max: number }; reputation?: number }): EditorResult;

  // 天赋列表操作
  addTalent(talent: { 名称: string; 描述: string }): EditorResult;
  removeTalent(index: number): EditorResult;
  updateTalent(index: number, talent: { 名称: string; 描述: string }): EditorResult;

  // 身体信息编辑（NSFW）
  updateBody(bodyData: Record<string, unknown>): EditorResult;
  addBodyPart(part: BodyPartEntry): EditorResult;
  removeBodyPart(index: number): EditorResult;  // 4 固定部位不可删除
  updateBodyPart(index: number, part: BodyPartEntry): EditorResult;
}

function useCharacterEditor(): UseCharacterEditor {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;

  function updateField(path: string, value: unknown): EditorResult {
    // 1. 校验：必填字段检查（姓名不可为空）
    if (path === P.playerName && (!value || String(value).trim() === '')) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'character.edit.nameRequired', message: 'Name is required' } };
    }
    // 2. (I2 修订) 玩家姓名不得与 NPC 名称冲突
    if (path === P.playerName) {
      const npcs = get<NpcRelation[]>(P.relationships) ?? [];
      const F = P.npcFieldNames;
      if (npcs.some(npc => npc[F.name] === String(value).trim())) {
        return { ok: false, error: { code: 'NPC_NAME_CONFLICT', i18nKey: 'character.edit.nameConflictNpc', message: 'Player name conflicts with NPC name' } };
      }
    }
    // 3. 类型校验：数字字段（年龄 ≥ 0）
    if (path === P.characterAge && (typeof value !== 'number' || value < 0)) {
      return { ok: false, error: { code: 'FIELD_INVALID', i18nKey: 'character.edit.invalidAge', message: 'Invalid age' } };
    }
    // 4. 写入
    setValue(path, value);
    emitToast('success', 'character.toast.fieldUpdated');
    return { ok: true };
  }

  function updateAttribute(attrPath: string, delta: number): EditorResult {
    const current = get<number>(attrPath) ?? 0;
    const schema = getSubSchema(attrPath);  // 读取 x-max
    const max = (schema?.['x-max'] as number) ?? 20;
    const min = 0;
    const newVal = Math.max(min, Math.min(max, current + delta));
    setValue(attrPath, newVal);
    return { ok: true };
  }

  // ... (其他方法实现类似)
  return { updateField, updateAttribute, updateVitals, addTalent, removeTalent, updateTalent, updateBody, addBodyPart, removeBodyPart, updateBodyPart };
}
```

**副作用：**
- 所有写入通过 `setValue()` → `StateManager.set(path, value, 'user')`（source = `'user'`）
- 无跨面板 cascade（角色数据独立于其他面板）
- 修改姓名不 cascade Engram（EntityBuilder 是 scanner，下次自动派生）

### 4.3 useNpcEditor

**文件：** `src/ui/composables/editors/useNpcEditor.ts`

```typescript
interface UseNpcEditor {
  // 保存 NPC（新建或更新）
  save(index: number, formData: NpcFormData): EditorResult;

  // 删除 NPC + cascade
  delete(index: number): EditorResult;

  // 检查删除影响（用于确认对话框）
  analyzeDeleteImpact(index: number): DeleteImpact;

  // 切换布尔标记（attention/heartbeatLock/presence/majorRole）
  toggleFlag(index: number, flag: NpcFlag): EditorResult;
}

interface NpcFormData extends Record<string, unknown> {
  名称: string;           // 必填
  [key: string]: unknown;  // 其余字段灵活
}

interface DeleteImpact {
  npcName: string;
  locationRefs: string[];   // 引用此 NPC 的地点名称列表
  hasEngramEntity: boolean; // Engram 中是否有此 NPC 的实体
}

type NpcFlag = '关注' | '心跳锁定' | '是否在场' | '是否主要角色';

function useNpcEditor(): UseNpcEditor {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;
  const F = P.npcFieldNames;

  // (C3 修订) 尝试获取 EngramEditor（如果 Story 1 已上线，通过 inject 或 import）
  const _engramEditor = inject<{ renameEntity: (old: string, n: string) => void; deleteEntity: (name: string) => void } | null>('engramEditor', null);

  function save(index: number, formData: NpcFormData): EditorResult {
    const list = [...(get<NpcRelation[]>(P.relationships) ?? [])];
    const name = formData[F.name] as string;

    // 1. 校验名称非空
    if (!name || name.trim() === '') {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'relationship.toast.nameRequired', message: 'NPC name is required' } };
    }

    // 2. 校验名称唯一（排除自身）（I2 修订：含玩家姓名冲突检查）
    const dupIdx = list.findIndex((npc, i) => i !== index && npc[F.name] === name.trim());
    if (dupIdx >= 0) {
      return { ok: false, error: { code: 'NPC_NAME_CONFLICT', i18nKey: 'relationship.validate.nameDuplicate', message: 'NPC name already exists' } };
    }
    const playerName = get<string>(P.playerName);
    if (playerName && name.trim() === playerName) {
      return { ok: false, error: { code: 'NPC_NAME_CONFLICT', i18nKey: 'relationship.validate.nameConflictPlayer', message: 'NPC name conflicts with player name' } };
    }

    // 3. 检测重命名 → cascade
    if (index >= 0 && index < list.length) {
      const oldName = list[index][F.name] as string;
      if (oldName && oldName !== name.trim()) {
        cascadeNpcRename(oldName, name.trim());
      }
      // 更新：保留原有未编辑字段
      list[index] = { ...list[index], ...formData, [F.name]: name.trim() };
    } else {
      // 新建
      list.push({ ...formData, [F.name]: name.trim() });
    }

    // 4. 写入
    setValue(P.relationships, list);
    emitToast('success', index >= 0 ? 'relationship.toast.updated' : 'relationship.toast.added');
    return { ok: true };
  }

  function cascadeNpcRename(oldName: string, newName: string): void {
    // Cascade 1: 更新地点的 NPC 驻留列表
    const locations = [...(get<LocationEntry[]>(P.locations) ?? [])];
    let locChanged = false;
    for (const loc of locations) {
      if (loc.NPC?.includes(oldName)) {
        loc.NPC = loc.NPC.map(n => n === oldName ? newName : n);
        locChanged = true;
      }
    }
    if (locChanged) setValue(P.locations, locations);

    // Cascade 2 (I1 修订): 更新其他 NPC 的 关系网变量[].对象 引用
    const allNpcs = [...(get<NpcRelation[]>(P.relationships) ?? [])];
    let networkChanged = false;
    for (const npc of allNpcs) {
      const network = npc[F.relationshipNetwork] as Array<{ 对象: string; 关系: string; 备注?: string }> | undefined;
      if (network) {
        for (const entry of network) {
          if (entry.对象 === oldName) {
            entry.对象 = newName;
            networkChanged = true;
          }
        }
      }
    }
    // 注意：allNpcs 的写入在 save() 中统一做（cascadeNpcRename 在 save 写入前调用）
    // 如果 networkChanged 且不在 save 上下文中，需要单独写入
    if (networkChanged) setValue(P.relationships, allNpcs);

    // Cascade 3 (C3 修订): Engram 协调 — 诚实说明
    // 当前阶段的真实情况：
    // - EntityBuilder 是 upsert-only scanner：下次 scan 会派生 name=newName 的新 entity
    // - 但 name=oldName 的旧 entity 不会被自动删除（EntityBuilder 不删除 "miss" 的 entity）
    // - 已有的 v2Edges 中 sourceEntity/targetEntity 引用旧名仍然悬挂
    // - Story 1 的 renameEntity API 可以处理完整 cascade（entity rename + edge rewrite + vector cleanup）
    //   但 Story 1 可能未上线
    //
    // 策略：fire-and-forget audit event + 如果 engramEditor inject 可用则调用
    eventBus.emit('editor:npc-renamed', { oldName, newName });
    // 如果 Story 1 EngramEditor API 可用（inject），调用 renameEntity
    if (_engramEditor) {
      _engramEditor.renameEntity(oldName, newName);
    }
    // 如果不可用：接受 Engram 状态短期不一致。
    // 旧 entity 残留 + 边引用悬挂，待 Story 1 上线后用户在关系网编辑器中手动修复。
    // 这是明确的 trade-off：Story 2 不阻塞 Story 1 的开发节奏。
  }

  function delete_(index: number): EditorResult {
    const list = [...(get<NpcRelation[]>(P.relationships) ?? [])];
    if (index < 0 || index >= list.length) {
      return { ok: false, error: { code: 'NPC_NOT_FOUND', i18nKey: 'relationship.validate.npcNotFound', message: 'NPC not found' } };
    }
    const name = list[index][F.name] as string;

    // Cascade: 从地点 NPC 列表中移除
    const locations = [...(get<LocationEntry[]>(P.locations) ?? [])];
    let locChanged = false;
    for (const loc of locations) {
      if (loc.NPC?.includes(name)) {
        loc.NPC = loc.NPC.filter(n => n !== name);
        locChanged = true;
      }
    }
    if (locChanged) setValue(P.locations, locations);

    // (C3 修订) Engram 协调 — 诚实说明
    // EntityBuilder 是 upsert-only：不会自动删除 "miss" 的 entity。
    // 删除 NPC 后旧 entity 会残留在 engram.entities 中，直到 trim 策略触发。
    // 如果 EngramEditor API 可用，调用 deleteEntity 做完整清理。
    // 否则接受残留 — 这是明确的 trade-off。
    eventBus.emit('editor:npc-deleted', { name });
    if (_engramEditor) {
      _engramEditor.deleteEntity(name);
    }

    // 从列表移除
    list.splice(index, 1);
    setValue(P.relationships, list);
    emitToast('success', 'relationship.toast.deleted');
    return { ok: true };
  }

  function analyzeDeleteImpact(index: number): DeleteImpact {
    const list = get<NpcRelation[]>(P.relationships) ?? [];
    const npc = list[index];
    const name = npc?.[F.name] as string ?? '';
    const locations = get<LocationEntry[]>(P.locations) ?? [];
    const locationRefs = locations.filter(l => l.NPC?.includes(name)).map(l => l.名称);
    // Engram 实体检查：读取 engramMemory，检查是否有此名称的实体
    const engram = get<Record<string, unknown>>(P.engramMemory);
    const entities = (engram as { entities?: Array<{ name: string }> })?.entities ?? [];
    const hasEngramEntity = entities.some(e => e.name === name);
    return { npcName: name, locationRefs, hasEngramEntity };
  }

  // ... toggleFlag 实现（同现有 RelationshipPanel 的 toggle 函数）

  return { save, delete: delete_, analyzeDeleteImpact, toggleFlag };
}
```

**副作用：**
- 写入 `社交.关系` 数组（整数组替换，同现有模式）
- Cascade：rename 时更新 `世界.地点信息[].NPC[]`
- Cascade：delete 时清理 `世界.地点信息[].NPC[]`
- Engram 协调：通过 `eventBus.emit('editor:npc-renamed'/'editor:npc-deleted')` 通知 Story 1

### 4.4 useLocationEditor

**文件：** `src/ui/composables/editors/useLocationEditor.ts`

```typescript
interface UseLocationEditor {
  create(formData: LocationFormData): EditorResult;
  update(index: number, formData: LocationFormData): EditorResult;
  delete(index: number): EditorResult;
  analyzeDeleteImpact(index: number): LocationDeleteImpact;
}

interface LocationFormData {
  名称: string;       // 必填
  描述?: string;
  类型?: string;
  上级?: string;
  连接?: string[];
  NPC?: string[];
}

interface LocationDeleteImpact {
  locationName: string;
  childLocations: string[];    // 子地点名称
  npcRefs: string[];          // 位置引用此地点的 NPC 名称
  connectionRefs: string[];   // 连接引用此地点的其他地点名称
}

function useLocationEditor(): UseLocationEditor {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;
  // (C5 修订) 删除未使用的 inject<StateManager> — 全部操作通过 setValue 整数组替换

  function create(formData: LocationFormData): EditorResult {
    const locations = get<LocationEntry[]>(P.locations) ?? [];
    const name = formData.名称?.trim();

    // 1. 校验名称非空
    if (!name) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'map.validate.nameRequired', message: 'Location name is required' } };
    }
    // 2. 校验名称唯一
    if (locations.some(l => l.名称 === name)) {
      return { ok: false, error: { code: 'LOCATION_NAME_CONFLICT', i18nKey: 'map.validate.nameDuplicate', message: 'Location name already exists' } };
    }
    // 3. 校验循环层级
    if (formData.上级 && wouldCreateCycle(name, formData.上级, locations)) {
      return { ok: false, error: { code: 'LOCATION_CIRCULAR_PARENT', i18nKey: 'map.validate.circularParent', message: 'Circular parent' } };
    }

    // 4. 写入
    const newLoc: LocationEntry = { 名称: name, ...formData };
    const updatedList = [...locations, newLoc];

    // 5. 双向连接维护
    if (formData.连接?.length) {
      for (const target of formData.连接) {
        const targetLoc = updatedList.find(l => l.名称 === target);
        if (targetLoc && !(targetLoc.连接 ?? []).includes(name)) {
          targetLoc.连接 = [...(targetLoc.连接 ?? []), name];
        }
      }
    }

    setValue(P.locations, updatedList);
    emitToast('success', 'map.toast.created');
    return { ok: true };
  }

  function update(index: number, formData: LocationFormData): EditorResult {
    const locations = [...(get<LocationEntry[]>(P.locations) ?? [])];
    if (index < 0 || index >= locations.length) {
      return { ok: false, error: { code: 'LOCATION_NOT_FOUND', i18nKey: 'map.validate.notFound', message: 'Location not found' } };
    }

    const oldName = locations[index].名称;
    const newName = formData.名称?.trim();
    if (!newName) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'map.validate.nameRequired', message: 'Name required' } };
    }

    // 唯一性校验（排除自身）
    if (newName !== oldName && locations.some((l, i) => i !== index && l.名称 === newName)) {
      return { ok: false, error: { code: 'LOCATION_NAME_CONFLICT', i18nKey: 'map.validate.nameDuplicate', message: 'Duplicate' } };
    }

    // 循环层级校验
    if (formData.上级 && wouldCreateCycle(newName, formData.上级, locations, index)) {
      return { ok: false, error: { code: 'LOCATION_CIRCULAR_PARENT', i18nKey: 'map.validate.circularParent', message: 'Circular' } };
    }

    // 如果重命名 → cascade
    if (oldName !== newName) {
      cascadeLocationRename(oldName, newName, locations, index);
    }

    // 双向连接维护（diff 旧连接 vs 新连接）
    const oldConnections = new Set(locations[index].连接 ?? []);
    const newConnections = new Set(formData.连接 ?? []);
    // 移除的连接：从目标地点的连接列表中移除 oldName/newName
    for (const removed of oldConnections) {
      if (!newConnections.has(removed)) {
        const target = locations.find(l => l.名称 === removed);
        if (target) target.连接 = (target.连接 ?? []).filter(c => c !== oldName && c !== newName);
      }
    }
    // 新增的连接：在目标地点的连接列表中添加 newName
    for (const added of newConnections) {
      if (!oldConnections.has(added)) {
        const target = locations.find(l => l.名称 === added);
        if (target && !(target.连接 ?? []).includes(newName)) {
          target.连接 = [...(target.连接 ?? []), newName];
        }
      }
    }

    // 更新自身
    locations[index] = { ...locations[index], ...formData, 名称: newName };
    setValue(P.locations, locations);
    emitToast('success', 'map.toast.updated');
    return { ok: true };
  }

  function cascadeLocationRename(oldName: string, newName: string, locations: LocationEntry[], selfIndex: number): void {
    // Cascade 1: 子地点的 上级 字段
    for (let i = 0; i < locations.length; i++) {
      if (i !== selfIndex && locations[i].上级 === oldName) {
        locations[i].上级 = newName;
      }
    }
    // Cascade 2: 其他地点的 连接 字段
    for (let i = 0; i < locations.length; i++) {
      if (i !== selfIndex && locations[i].连接?.includes(oldName)) {
        locations[i].连接 = locations[i].连接!.map(c => c === oldName ? newName : c);
      }
    }
    // Cascade 3: NPC 的 位置 字段
    const npcs = get<NpcRelation[]>(P.relationships) ?? [];
    const F = P.npcFieldNames;
    let npcChanged = false;
    const updatedNpcs = npcs.map(npc => {
      if (npc[F.location] === oldName) {
        npcChanged = true;
        return { ...npc, [F.location]: newName };
      }
      return npc;
    });
    if (npcChanged) setValue(P.relationships, updatedNpcs);
  }

  function delete_(index: number): EditorResult {
    const locations = [...(get<LocationEntry[]>(P.locations) ?? [])];
    if (index < 0 || index >= locations.length) {
      return { ok: false, error: { code: 'LOCATION_NOT_FOUND', i18nKey: 'map.validate.notFound', message: 'Not found' } };
    }
    const name = locations[index].名称;

    // Cascade 1: 子地点上级清空
    for (const loc of locations) {
      if (loc.上级 === name) loc.上级 = undefined;
    }
    // Cascade 2: 其他地点连接移除
    for (const loc of locations) {
      if (loc.连接?.includes(name)) loc.连接 = loc.连接.filter(c => c !== name);
    }
    // Cascade 3: NPC 位置清空
    const npcs = get<NpcRelation[]>(P.relationships) ?? [];
    const F = P.npcFieldNames;
    let npcChanged = false;
    const updatedNpcs = npcs.map(npc => {
      if (npc[F.location] === name) {
        npcChanged = true;
        return { ...npc, [F.location]: '' };
      }
      return npc;
    });
    if (npcChanged) setValue(P.relationships, updatedNpcs);

    // 删除自身
    locations.splice(index, 1);
    setValue(P.locations, locations);
    emitToast('success', 'map.toast.deleted');
    return { ok: true };
  }

  function analyzeDeleteImpact(index: number): LocationDeleteImpact {
    const locations = get<LocationEntry[]>(P.locations) ?? [];
    const loc = locations[index];
    const name = loc?.名称 ?? '';
    const childLocations = locations.filter(l => l.上级 === name).map(l => l.名称);
    const connectionRefs = locations.filter(l => l.连接?.includes(name)).map(l => l.名称);
    const npcs = get<NpcRelation[]>(P.relationships) ?? [];
    const F = P.npcFieldNames;
    const npcRefs = npcs.filter(n => n[F.location] === name).map(n => n[F.name] as string);
    return { locationName: name, childLocations, npcRefs, connectionRefs };
  }

  // 辅助：检测循环层级
  function wouldCreateCycle(name: string, parent: string, locations: LocationEntry[], selfIndex?: number): boolean {
    let current = parent;
    const visited = new Set<string>([name]);
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      const parentLoc = locations.find((l, i) => l.名称 === current && i !== selfIndex);
      current = parentLoc?.上级 ?? '';
    }
    return false;
  }

  return { create, update, delete: delete_, analyzeDeleteImpact };
}
```

**副作用：**
- 写入 `世界.地点信息` 数组（整数组替换）
- Cascade rename → 子地点 `上级` + 其他地点 `连接` + NPC `位置`
- Cascade delete → 子地点 `上级` 清空 + 其他地点 `连接` 移除 + NPC `位置` 清空
- 双向连接自动维护

### 4.5 useInventoryEditor

**文件：** `src/ui/composables/editors/useInventoryEditor.ts`

```typescript
interface UseInventoryEditor {
  create(formData: InventoryItemFormData): EditorResult<{ id: string }>;
  update(itemId: string, formData: InventoryItemFormData): EditorResult;
  delete(itemId: string): EditorResult;
  updateCurrency(currency: CurrencyData): EditorResult;
}

interface InventoryItemFormData {
  名称: string;        // 必填
  类型?: string;
  数量?: number;        // ≥ 1
  品质?: unknown;
  描述?: string;
  可装备?: boolean;
  已装备?: boolean;
}

interface CurrencyData {
  现金: number;
  铜: number;
  银: number;
  金: number;
}

function useInventoryEditor(): UseInventoryEditor {
  const { setValue, get } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;

  function create(formData: InventoryItemFormData): EditorResult<{ id: string }> {
    if (!formData.名称?.trim()) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'inventory.validate.nameRequired', message: 'Name required' } };
    }
    if (formData.数量 !== undefined && formData.数量 < 1) {
      return { ok: false, error: { code: 'ITEM_QUANTITY_INVALID', i18nKey: 'inventory.validate.quantityMin', message: 'Quantity must be ≥ 1' } };
    }

    const type = formData.类型 ?? '其他';
    const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const item = { ...formData, 名称: formData.名称.trim(), 数量: formData.数量 ?? 1 };

    setValue(`${P.inventoryItems}.${id}`, item);
    emitToast('success', 'inventory.toast.created');
    return { ok: true, data: { id } };
  }

  function update(itemId: string, formData: InventoryItemFormData): EditorResult {
    const items = get<Record<string, InventoryItem>>(P.inventoryItems) ?? {};
    if (!items[itemId]) {
      return { ok: false, error: { code: 'ITEM_NOT_FOUND', i18nKey: 'inventory.validate.notFound', message: 'Item not found' } };
    }
    if (!formData.名称?.trim()) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'inventory.validate.nameRequired', message: 'Name required' } };
    }

    // 如果 可装备 关闭，自动清除 已装备
    if (formData.可装备 === false) formData.已装备 = false;

    const merged = { ...items[itemId], ...formData, 名称: formData.名称.trim() };
    setValue(`${P.inventoryItems}.${itemId}`, merged);
    emitToast('success', 'inventory.toast.updated');
    return { ok: true };
  }

  function delete_(itemId: string): EditorResult {
    const items = get<Record<string, InventoryItem>>(P.inventoryItems) ?? {};
    if (!items[itemId]) {
      return { ok: false, error: { code: 'ITEM_NOT_FOUND', i18nKey: 'inventory.validate.notFound', message: 'Item not found' } };
    }

    // (C4 修订) 整 Record 替换删除 — 与 §3.4.c 文字和注释保持一致
    // 不使用 StateManager.delete 单 key 路径删除，因为 useGameState.setValue
    // 不暴露 StateManager.delete API。整 Record 替换行为等价且更简单。
    const updated = { ...items };
    delete updated[itemId];
    setValue(P.inventoryItems, updated);
    emitToast('success', 'inventory.toast.deleted');
    return { ok: true };
  }

  function updateCurrency(currency: CurrencyData): EditorResult {
    // 校验：所有值 ≥ 0
    for (const [key, val] of Object.entries(currency)) {
      if (val < 0) {
        return { ok: false, error: { code: 'FIELD_INVALID', i18nKey: 'inventory.validate.currencyNonNegative', message: `${key} must be ≥ 0` } };
      }
    }
    setValue(P.inventoryCurrency, currency);
    emitToast('success', 'inventory.toast.currencyUpdated');
    return { ok: true };
  }

  return { create, update, delete: delete_, updateCurrency };
}
```

**副作用：**
- 写入 `角色.背包.物品.${id}`（单 key set）或整个 `角色.背包.物品`（delete 时）
- 写入 `角色.背包.金钱`（货币编辑时）
- 无跨面板 cascade（装备对属性的影响由 AI 处理）

### 4.6 usePlotEditor（C2 修订新增 → NC1 修订重写）

**文件：** `src/ui/composables/editors/usePlotEditor.ts`

**NC1 修订说明：** Round 2 review 指出 §4.6 调用了不存在的 `plotStore.getArc()` + 直接 mutate arc 属性（绕过 `_withMutex`）+ 引用不存在的 `plotStore.persist()`。以下按**方案 A**修正：在 `plot-store.ts` 中新增 `updateArc` 方法。

**步骤 1：在 `src/engine/plot/plot-store.ts` 中新增 `updateArc` 方法**

参照 `updateNode`（行 265-273）/ `updateGauge` 的模式：部分字段更新直接 find + mutate，不走 `_withMutex`（该机制用于评估期排队节点链结构性增删 — insertNode/removeNode/moveNode）：

```typescript
// plot-store.ts 新增，在 reviseArc 之后（约 line 159 处）
function updateArc(arcId: string, updates: { title?: string; synopsis?: string }): boolean {
  const arc = arcs.value.find(a => a.id === arcId);
  if (!arc) return false;
  if (updates.title !== undefined) arc.title = updates.title;
  if (updates.synopsis !== undefined) arc.synopsis = updates.synopsis;
  return true;
}
```

并在 `return { ... }` 块（行 376-414）中导出 `updateArc`。

**步骤 2：usePlotEditor composable**

```typescript
interface UsePlotEditor {
  updateArc(arcId: string, data: { title?: string; synopsis?: string }): EditorResult;
}

function usePlotEditor(): UsePlotEditor {
  const plotStore = usePlotStore();
  const { setValue } = useGameState();
  const P = DEFAULT_ENGINE_PATHS;

  function updateArc(arcId: string, data: { title?: string; synopsis?: string }): EditorResult {
    // 1. 校验标题非空
    if (data.title !== undefined && !data.title.trim()) {
      return { ok: false, error: { code: 'FIELD_REQUIRED', i18nKey: 'plot.validate.titleRequired', message: 'Title required' } };
    }

    // 2. 通过 plotStore.updateArc 更新内存状态（NC1 修订：使用真实存在的 API）
    const ok = plotStore.updateArc(arcId, {
      title: data.title?.trim(),
      synopsis: data.synopsis,
    });
    if (!ok) {
      return { ok: false, error: { code: 'FIELD_INVALID', i18nKey: 'plot.validate.arcNotFound', message: 'Arc not found' } };
    }

    // 3. 持久化（复用 PlotPanel.vue:50-54 的 persist() 模式，但在 composable 层自行实现）
    setValue(P.plotDirection, plotStore.toStateSnapshot());
    eventBus.emit('engine:request-save');
    emitToast('success', 'plot.toast.arcUpdated');
    return { ok: true };
  }

  return { updateArc };
}
```

**副作用：**
- 调用 `plotStore.updateArc()` 更新内存状态（需 Story 2 新增此方法到 plot-store.ts）
- 调用 `plotStore.toStateSnapshot()` → `setValue(plotDirection, snapshot)` 持久化
- 调用 `eventBus.emit('engine:request-save')` 触发自动保存（与 PlotPanel 局部 `persist()` 等效）
- 无跨面板 cascade

### 4.7 Source 字段策略

根据 `src/engine/stores/engine-state.ts` 行 297：`_linkedStateManager.set(path, value, 'user')`

**所有通过 `useGameState().setValue()` 的调用都已经使用 `source: 'user'`。** Story 2 的 editor composable 无需额外处理 source 字段。

Story 1 OQ-3 的 `source` 标记（在 NPC 档案级别标注数据来源：`'opening'` / `'user'` / `'ai'`）是 NPC 数据内部的业务字段，不是 StateManager API 层面的 source。如果 Story 1 确认需要此标记，Story 2 的 `useNpcEditor().save()` 可在写入时附加 `_source: 'user'` 字段到 NPC 对象上。当前 plan 中预留此位置但不实现（取决于 Story 1 OQ-3 最终决策）。

---

## 5. UI 实现细节

### 5.1 视觉风格

**Glassmorphism token（CLAUDE.md 强制要求）：**

所有编辑模态和内联编辑区域使用 `tokens.css` 的统一 token：

```css
/* 编辑模态背景 */
.edit-modal .modal-content {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  box-shadow: var(--glass-shadow);
  border: none;
}
.edit-modal .modal-content::before {
  /* glass edge gradient */
  background: var(--glass-edge-gradient);
  mask-composite: exclude;
}

/* 模态背景遮罩 */
.edit-modal .modal-backdrop {
  background: var(--glass-overlay-bg);
  backdrop-filter: var(--glass-overlay-blur);
}
```

**编辑按钮视觉差异：**
- 编辑/保存按钮：使用 `--accent-sage`（主色调），hover 加亮
- 删除按钮：使用 `rgba(220, 80, 60, 0.15)` 背景 + `rgba(220, 80, 60, 0.8)` 文字，hover 时背景加深 → 红色暗示危险操作
- 取消按钮：使用 `rgba(255, 255, 255, 0.06)` 背景，低调

**表单字段 focus 状态：**
```css
.edit-input:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--accent-sage-rgb), 0.4);
  border-color: rgba(var(--accent-sage-rgb), 0.6);
}
```

**错误提示：** 使用 toast（`eventBus.emit('ui:toast')`），不用 alert 或内联错误标签。Toast 使用现有 `Toast.vue` 组件，通过 `i18nKey` 模式支持双语。

**加载状态：** 编辑保存时按钮 disabled + 添加 `.saving` class（opacity 0.6 + pointer-events: none）。由于 `setValue` 是同步的，加载状态实际只是视觉防抖（prevent double-click）。

### 5.2 Polanyi 原则验证

| 原则 | 如何满足 |
|------|---------|
| **Chopsticks test**（3 秒内理解） | 所有可编辑字段带 ✏ 图标或微妙的 hover 边框暗示；删除按钮用红色调；新建按钮用 + 符号。用户无需阅读说明即可识别。 |
| **Glasses test**（注意力在内容） | 编辑控件在非 focus 时视觉低调（与只读文本几乎无差别），仅在 hover/focus 时浮现编辑状态。编辑完成后控件立即收回。 |
| **Mute test**（移除文字仍可用） | 删除用 🗑 图标，编辑用 ✏ 图标，新增用 + 图标。图标足以传达操作意义。 |
| **Trace test**（用户感受到改动） | 编辑保存后：(1) 字段值立即更新（reactive） (2) toast 确认 (3) 被修改字段短暂闪烁 sage 色高亮（300ms transition） |
| **Breathing test**（足够留白） | 编辑表单使用 `gap: var(--space-md)` 间距，每节之间有分隔线 + `var(--space-lg)` 间距。不拥挤。 |

### 5.3 内联编辑交互规范

Story 2 大量使用"点击→内联编辑"模式。统一规范如下：

**进入编辑：**
- 单击可编辑字段值区域（不是双击 — CharacterDetailsPanel 现有的双击模式是例外，保持向后兼容但新字段统一用单击）
- 或点击字段旁的 ✏ 图标
- ✏ 图标默认 opacity: 0.3，hover 时 opacity: 0.8

**编辑态：**
- 原始值显示为对应 input 控件，自动全选文本
- input 控件宽度与原始展示区域一致（不跳动）
- 四周添加微妙的 sage 色 focus ring

**退出编辑：**
- Enter 或 blur → 提交（调用 editor composable）
- Escape → 取消（恢复原值）
- 如果校验失败 → 保持编辑态 + toast 错误

**确认反馈：**
- 成功：字段值更新 + 短暂 sage 色高亮 + toast
- 失败：toast 错误 + 保持编辑态

### 5.4 移动端适配

**触摸目标：**
- 所有按钮（编辑/删除/新增/步进 ±）≥ 44×44px
- 表单 input 高度 ≥ 44px
- tag 删除按钮（×）≥ 36×36px（在 tag 内部）

**布局：**
- 编辑模态在 `@media (max-width: 767px)` 下：
  - 改为近全屏（`width: 100%; max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 40px)`）
  - 使用 `overflow-y: auto` 滚动
  - 底部操作栏固定在可视区域底部
- MapPanel 的右键上下文菜单在移动端改为长按触发
- 表单字段在移动端单列排列（不并排）

**键盘：**
- number input 使用 `inputmode="numeric"` 以弹出数字键盘
- textarea 在移动端不自动展开（固定高度 + 滚动）

**触摸交互：**
```css
@media (hover: none) and (pointer: coarse) {
  .editable-field .edit-icon { opacity: 0.5; }  /* 触摸设备始终显示编辑图标 */
  .editable-field:hover { /* 不变化 — 触摸设备无 hover */ }
  .editable-field:active { background: rgba(var(--accent-sage-rgb), 0.08); }
}
```

### 5.5 i18n 完整覆盖

**新增翻译文件分工：**

| 文件 | 新增 key 数量（估算） | 覆盖内容 |
|------|---------------------|---------|
| `zh-CN/character.json` | ~30 | 角色编辑标签/按钮/toast/校验错误 |
| `en/character.json` | ~30 | 英文对应 |
| `zh-CN/relationship.json` | ~25 | NPC 编辑新增字段/D26 提示/cascade 警告 |
| `en/relationship.json` | ~25 | 英文对应 |
| `zh-CN/map.json` | ~35 | 地点 CRUD 全套 |
| `en/map.json` | ~35 | 英文对应 |
| `zh-CN/inventory.json` | ~30 | 物品 CRUD + 货币编辑 |
| `en/inventory.json` | ~30 | 英文对应 |

**Toast 消息模式：** 统一使用 `ToastPayload` 的 `{ i18nKey, message, i18nParams }` 三字段模式。Engine 层不导入 vue-i18n，Toast 组件在渲染时解析 i18nKey。

**字段标签：** 使用人话标签而非 schema 路径。例如：
- ✅ "核心性格特征" / "Core Personality"
- ❌ "社交.关系[i].核心性格特征"

### 5.6 与 GameVariablePanel 的关系

Story 2 后 GameVariablePanel 保留为"高级 fallback"，面向想直接编辑原始 JSON 的高级用户。

**改动 1：GameVariablePanel 新增 router query 深链接（C1 修订）**

当前 GameVariablePanel（1448 行）**不导入 `useRoute`，无 query 参数处理，无法从外部深链接到指定路径。**

需要新增：
```typescript
// GameVariablePanel.vue 新增
import { useRoute } from 'vue-router';
const route = useRoute();

// 监听 ?path=xxx 导航到目标路径
watch(() => route.query.path as string, (path) => {
  if (path) navigateTo(path);
}, { immediate: true });

// 显示"返回来源面板"链接（当 ?from=xxx 存在时）
const returnPanel = computed(() => route.query.from as string ?? '');
```

**改动 2：各面板添加跳转入口**

```typescript
// 通用跳转函数（各面板共用）
function openInAdvancedEditor(targetPath: string, returnPanel: string): void {
  router.push({
    name: 'game-variables',
    query: { path: targetPath, from: returnPanel }
  });
}
```

不强行废弃 GameVariablePanel — 它在 Story 2 后的定位是"power user 工具"。

---

## 6. 测试计划

### 6.1 单元测试

**每个 editor composable 的完整测试：**

| Composable | 测试文件 | 关键测试用例 |
|-----------|---------|-------------|
| `useCharacterEditor` | `src/ui/composables/editors/__tests__/useCharacterEditor.test.ts` | - updateField 正常写入<br>- updateField 姓名为空 → FIELD_REQUIRED<br>- updateField 年龄为负 → FIELD_INVALID<br>- updateAttribute ±1 含 min/max 边界<br>- addTalent / removeTalent<br>- updateBody NSFW 字段<br>- addBodyPart / removeBodyPart（4 固定部位不可删） |
| `useNpcEditor` | `src/ui/composables/editors/__tests__/useNpcEditor.test.ts` | - save 新建 NPC<br>- save 编辑 NPC（含保留未编辑字段）<br>- save 名称为空 → FIELD_REQUIRED<br>- save 名称重复 → NPC_NAME_CONFLICT<br>- save 名称与玩家姓名冲突 → NPC_NAME_CONFLICT（I2）<br>- save 重命名 → cascade 地点 NPC 列表 + cascade 关系网变量[].对象（I1）<br>- delete → cascade 地点 NPC 列表<br>- analyzeDeleteImpact 正确计算<br>- toggleFlag 各标记 |
| `useLocationEditor` | `src/ui/composables/editors/__tests__/useLocationEditor.test.ts` | - create 正常<br>- create 名称为空 → FIELD_REQUIRED<br>- create 名称重复 → LOCATION_NAME_CONFLICT<br>- create 带连接 → 双向自动维护<br>- update 重命名 → cascade 子地点/连接/NPC位置<br>- update 修改连接 → diff + 双向维护<br>- update 循环层级 → LOCATION_CIRCULAR_PARENT<br>- delete → cascade 子地点上级/连接/NPC位置<br>- analyzeDeleteImpact 正确计算 |
| `usePlotEditor` | `src/ui/composables/editors/__tests__/usePlotEditor.test.ts` | - updateArc 标题正常 → plotStore.updateArc 被调用 + toStateSnapshot + setValue<br>- updateArc 标题为空 → FIELD_REQUIRED（不调用 plotStore）<br>- updateArc 概要正常<br>- updateArc 弧线不存在 → plotStore.updateArc 返回 false → FIELD_INVALID |
| `plotStore.updateArc`（NC1 新增） | `src/engine/plot/__tests__/plot-store.test.ts`（追加） | - updateArc 正常 mutate title/synopsis<br>- updateArc arcId 不存在 → 返回 false<br>- updateArc 后 toStateSnapshot 包含新值<br>- updateArc 不影响节点/仪表盘/状态 |
| `useInventoryEditor` | `src/ui/composables/editors/__tests__/useInventoryEditor.test.ts` | - create 正常 + ID 生成格式<br>- create 名称为空 → FIELD_REQUIRED<br>- create 数量 < 1 → ITEM_QUANTITY_INVALID<br>- update 正常<br>- update 可装备=false → 清除已装备<br>- delete 正常<br>- delete 不存在的 ID → ITEM_NOT_FOUND<br>- updateCurrency 正常<br>- updateCurrency 负值 → FIELD_INVALID |

**测试基础设施（M6 修订）：** 使用 Vitest。新建 `src/ui/composables/editors/__tests__/test-utils/mock-game-state.ts` 提供 `createMockGameState(initialTree)` 工厂函数，返回可控的 `get` / `setValue` / `useValue` mock。所有 editor composable 测试统一使用此 utility，避免重复 mock 代码。

```typescript
// test-utils/mock-game-state.ts
export function createMockGameState(initialTree: Record<string, unknown>) {
  const tree = reactive(structuredClone(initialTree));
  return {
    get: <T>(path: string): T | undefined => lodashGet(tree, path),
    setValue: (path: string, value: unknown) => lodashSet(tree, path, structuredClone(value)),
    useValue: <T>(path: string) => computed(() => lodashGet(tree, path) as T),
    tree: computed(() => tree),
    isLoaded: computed(() => true),
  };
}
```

### 6.2 组件测试

| 面板 | 测试文件 | 关键测试用例 |
|------|---------|-------------|
| CharacterDetailsPanel | `__tests__/CharacterDetailsPanel.edit.test.ts` | - 渲染各 tab（空状态/有数据）<br>- 内联编辑触发 + 提交<br>- 性别 select 编辑<br>- 位置 combo box 编辑<br>- 天赋增删<br>- 步进器 ±1<br>- body tab NSFW 编辑 |
| RelationshipPanel | `__tests__/RelationshipPanel.edit.test.ts` | - 新增字段（核心性格特征等）在编辑模态中渲染<br>- D26 提示条显示<br>- 关系网变量行增删<br>- 总结记忆增删<br>- 删除 NPC cascade 确认对话框 |
| MapPanel | `__tests__/MapPanel.edit.test.ts` | - 新建地点按钮 + 模态<br>- 编辑地点按钮 + 模态<br>- 删除地点 cascade 确认对话框<br>- 连接 tag list 编辑<br>- NPC 驻留 tag list 编辑<br>- 上级地点 select |
| InventoryPanel | `__tests__/InventoryPanel.edit.test.ts` | - 新建物品按钮 + 模态<br>- 编辑物品按钮 + 模态<br>- 删除物品确认<br>- 编辑货币按钮 + 模态<br>- 物品类型 select<br>- 品质 select |

### 6.3 集成测试

| 场景 | 验证点 |
|------|--------|
| 编辑 NPC 名称 → 地点面板响应 | setValue 后 MapPanel 的 `useValue(locations)` 自动更新，NPC 列表中的名称变更 |
| 删除地点 → NPC 位置清空 | NPC 的 `位置` 字段变为空字符串，RelationshipPanel 展示更新 |
| 编辑 NPC 名称 → Engram 状态（I6 修订） | 如果 EngramEditor inject 可用：验证旧 entity 被重命名 + edge 引用更新。如果不可用：验证 eventBus emit 被调用（audit），并标注 `// TODO: Story 1 上线后改为验证 Engram 最终状态一致性` |
| 新建物品 → InventoryPanel 列表更新 | 新物品出现在列表中，搜索/筛选可找到 |
| 编辑期间 auto-save 不冲突 | 模拟 auto-save 定时器在编辑过程中触发，验证编辑数据不被覆盖 |

### 6.4 E2E 测试

| 场景 | 步骤 |
|------|------|
| 完整卡创作微调流程 | 1. 打开游戏（有 Story 0 生成的初始数据）<br>2. 进入角色详情 → 修改姓名/性别/属性<br>3. 进入社交面板 → 编辑 NPC 名称/添加新 NPC<br>4. 进入地图面板 → 新建地点/编辑连接/删除地点<br>5. 进入背包面板 → 新建物品/编辑物品/删除物品/编辑货币<br>6. 验证：**从未打开 GameVariablePanel** |
| 移动端关键交互 | 1. 在 375px 宽度下重复上述流程<br>2. 验证模态全屏化 + 触摸目标 ≥ 44px + 键盘不遮挡输入 |
| Cascade 完整性 | 1. 创建地点 A（驻留 NPC X）<br>2. 重命名 NPC X → Y<br>3. 验证地点 A 的 NPC 列表显示 Y<br>4. 删除地点 A<br>5. 验证 NPC Y 的位置变为空 |

### 6.5 验证标准 checklist

- [ ] 用户可在角色详情面板中编辑所有字段（基础信息/属性/身份/可变属性/身体信息）
- [ ] 用户可在地图面板中 CRUD 地点 + 管理连接关系 + 管理 NPC 驻留
- [ ] 用户可在社交面板中编辑 NPC 全部字段（含 Social-1 新字段 + 关系网变量 + 总结记忆）
- [ ] 用户可在社交面板中新增/删除 NPC
- [ ] 用户可在背包面板中 CRUD 物品 + 编辑货币
- [ ] 用户可在剧情面板中编辑弧线标题/概要
- [ ] D26 标注：关系状态/关系网变量编辑处有明确"显示标签，权威数据在关系网编辑器"提示
- [ ] 所有编辑通过 editor composable 层（5 个：character/npc/location/inventory/plot），面板组件不直接调用 setValue
- [ ] Cascade 正确：删地点→NPC 位置清空；删 NPC→地点 NPC 列表清理；改名→引用更新
- [ ] i18n 双语完整覆盖（中英）
- [ ] 移动端适配（触摸目标 ≥ 44px，模态近全屏，单列布局）
- [ ] 所有编辑 UI 使用 Glassmorphism token
- [ ] **核心验证：完成一张卡的创作过程中，用户从未需要打开 GameVariablePanel**

---

## 7. 风险与边界情况

### 7.1 数据一致性

**风险：** `setValue` 是同步的，但 `useValue` 依赖整个 `store.tree`（broad reactivity）。大量快速编辑可能导致不必要的全面重渲染。

**缓解：** Story 2 的编辑是低频操作（用户手动逐字段修改），不会触发高频 setValue。如果后续出现性能问题，可在 `useValue` 层引入 per-path 细粒度 watcher（useGameState.ts 行 86 注释已提及此优化方向）。

### 7.2 并发：AI 运行时的用户编辑

**风险：** 主回合 AI 运行期间，AI 的 command execution 会 `setValue` 写入 NPC/地点/背包数据，可能与用户正在编辑的数据冲突。

**策略：**
- 编辑模态打开时检查 `isRoundRunning` 状态（通过 `eventBus` 或 store flag）
- 如果 AI 正在运行：模态顶部显示警告条 "AI 正在思考中，编辑可能被覆盖"
- 不强制禁止编辑（卡创作场景下 AI 不应该同时运行，但不做 hard block）
- Story 2 **不实现**乐观锁或冲突合并（复杂度高，收益低）

### 7.3 性能：大量数据

**风险：** 100+ NPC 或 50+ 地点时，列表渲染和 cascade 扫描可能卡顿。

**策略：**
- RelationshipPanel 已有虚拟列表优化？否。当前是完整渲染。但 NPC 数量通常 < 30，暂不引入虚拟滚动。
- MapPanel 的 Cytoscape.js 在 100+ 节点时性能取决于 fcose 布局计算，已有 `quality: 'default'`（非 proof）的快速模式。
- 地点 cascade 扫描（rename/delete）是 O(n) 遍历，50 个地点的性能无问题。
- **如果后续用户反馈大数据量卡顿，再引入虚拟滚动和 cascade 优化（不在 Story 2 范围内预先实现）。**

### 7.4 Cascade 复杂性

**风险：** 删 NPC 时需要清理地点 NPC 列表 + 通知 Engram；删地点时需要清理子地点/连接/NPC 位置。cascade 链过长可能有遗漏。

**策略：**
- 每个 cascade 在 editor composable 中 **显式列出并测试**
- `analyzeDeleteImpact()` 函数让用户在确认对话框中 **预览所有影响**
- cascade 后立即验证状态一致性（测试覆盖）
- Story 2 的 cascade 是**单层**的（不会出现 A→B→C 的链式 cascade）

### 7.5 撤销

**风险：** 用户误删 NPC/地点/物品后无法撤销。

**策略：**
- 现有系统有 round-level undo（`preRoundSnapshot`），但 Story 2 的编辑不属于"回合"上下文
- Story 2 **不实现**编辑级 undo/redo（复杂度高，不在范围内）
- 通过 **确认对话框**（删除操作必须二次确认）降低误操作风险
- 用户可通过 GameVariablePanel 的"重置到默认值"功能恢复 schema 默认值
- 存档系统（备份/云同步）提供最终恢复手段

### 7.6 Schema 漂移

**风险：** Game Pack 升级 schema 后，旧存档的数据可能缺少新字段或有已废弃字段。

**策略：**
- editor composable 读写时使用 optional chaining（`npc[F.corePersonality] ?? ''`）
- SchemaForm 在渲染时对缺失字段使用 schema default
- 不强制迁移旧存档的数据结构（FieldRepair 子管线已负责运行时字段补全）

### 7.7 NSFW 切换（I4 修订）

**风险：** 用户在编辑 NPC 私密信息或角色身体信息期间切换 NSFW 模式。

**策略：**
- 编辑模态内的 NSFW 节可见性绑定 `nsfwEnabled` computed
- **CharacterDetailsPanel body tab（I4 修订）：** 整个 body tab **隐藏**（`nsfwEnabled` 为 tab 列表的 v-if 条件，与现有行为一致 — 行 946-958 中 body tab 仅在 nsfwEnabled 时出现）
- **RelationshipPanel 编辑模态 NSFW 节：** NSFW 节整节 v-if 隐藏
- **切换时若有未保存 NSFW 编辑（I4 修订）：** 在 `nsfwEnabled` watcher 中检测模态是否 open + NSFW 节是否有 dirty 字段。如有则弹出 confirm："切换将丢弃未保存的私密字段编辑，确定？" → 确认则丢弃，取消则回滚 NSFW 切换
- NSFW 数据在状态树中保留不变（nsfwEnabled 只控制 UI 可见性，不删除数据）
- Plan 不修改 snapshot-sanitizer（避免数据持久层影响）

---

## 8. Rollout 策略

### 8.1 发布顺序

Story 2 是 MVP Phase 1 的并行任务，可与 Story 0 / Story 1 实现期并行开发。

**推荐顺序：**
1. **先实现 editor composable 层**（5 个 composable + 类型 + 单元测试 + mock-game-state utility）— 这是所有面板的基础
2. **RelationshipPanel 扩展**（最小改动 — 补齐字段 + D26 标注）— 验证 composable 模式可用
3. **InventoryPanel CRUD**（中等改动 — 从零新增但逻辑简单）
4. **PlotPanel 弧线编辑**（小改动 — 补齐标题/概要内联编辑）
5. **CharacterDetailsPanel 补齐**（大改动 — 但复用现有 inline edit 模式）
6. **MapPanel CRUD**（最大改动 — 从零新增 + 图形交互协调）
7. **GameVariablePanel 深链接**（中等改动 — 新增 router query + 返回链接）
8. **i18n + 移动端 + 集成测试**

### 8.2 Feature flag

**不需要。** Story 2 是 UI 渐进增强 — 新增编辑入口不影响现有只读展示功能。所有新增按钮/表单都是增量添加，不替换已有功能。

### 8.3 测试覆盖率

| 类别 | 最低要求 |
|------|---------|
| Editor composable 单元测试 | ≥ 80% 行覆盖 |
| 面板组件测试 | ≥ 70% 关键交互路径 |
| Cascade 逻辑 | 100%（每种 cascade 必须有专门测试） |

### 8.4 文档更新

- [ ] 更新 `docs/INDEX.md` 添加本 plan 条目
- [ ] 各面板的用户指南更新（`docs/user-guide/pages/` 下的对应文件）
- [ ] 更新 `docs/architecture/schema-contract.md` 如果新增了引擎路径常量

### 8.5 与 GameVariablePanel 的过渡

Story 2 后 GameVariablePanel 保留为"高级编辑器"。**不做废弃计划。**

过渡期指标：监测 GameVariablePanel 的使用频率（可通过 eventBus analytics）。如果 Story 2 成功覆盖所有编辑场景，GameVariablePanel 的使用率应自然下降。

---

## 9. Open Questions

### OQ-A：RelationshipPanel 和 CharacterDetailsPanel 的"关系"区域是否合并？

**现状：** CharacterDetailsPanel 的 relations tab 和 RelationshipPanel 都展示 NPC 关系。

**建议：不合并。** CharacterDetailsPanel 的 relations tab 保持为**只读概览**（显示 NPC 列表 + 好感度 + 关系状态），每个 NPC 卡片提供"在社交面板中编辑"跳转按钮。RelationshipPanel 是完整的 NPC 编辑器。两者定位不同：前者是角色视角的关系总览，后者是社交视角的 NPC 管理。

**D26 影响：** 两个面板的关系字段都标注"显示用"提示。

### OQ-B：新增 NPC 时的最小必填字段集 + 默认值策略

**现状：** RelationshipPanel 的 `openAddNew()`（行 492-519）预填：
- 名称: ''（必填，保存时校验非空）
- 类型: '普通'
- 好感度: 50
- 年龄: 20
- 其他: 空字符串/空数组

**建议：保持现有策略。** 最小必填字段只有 `名称`。其他字段有合理默认值，用户可按需修改。FieldRepair 子管线会在后续回合补全缺失的 AI 参考字段（如核心性格特征、外貌描述等）。

Story 0 Phase C 生成时填写的字段更丰富（名称/类型/位置/好感度/核心性格特征/外貌描述/内心想法等），但用户手动新建时不需要全部填写。

### OQ-C：是否在 Story 2 引入"批量编辑"？

**建议：不引入。推到后续 Story。** 批量编辑（多选 NPC 批量修改某字段）复杂度高，且 Story 2 的核心目标是"每个面板都有 CRUD 入口"，不是效率优化。如果卡作者需要批量操作，Story 3 的 AI 助手更适合（AI 批量注入+修改）。

### OQ-D：是否在各面板嵌入"打开关系网编辑器"快捷入口？

**建议：是。** 在 RelationshipPanel 的 NPC 详情视图顶部添加"在关系网中查看"按钮。

**路由（M4 修订）：** Story 1 Round 2 OQ-2 决策的路由为 `path: '/game/relationship-graph'`，`name: 'RelationshipGraph'`。跳转代码：`router.push({ name: 'RelationshipGraph', query: { entity: npcName } })`。

**实现条件：** 如果 Story 1 尚未上线（路由不存在），按钮灰显 + tooltip "关系网编辑器即将推出"。通过 `router.hasRoute('RelationshipGraph')` 检测。

### OQ-E：Schema 驱动 vs 硬编码的边界

**建议：核心字段硬编码（更好的 UX），罕见字段走 SchemaForm fallback。**

| 硬编码 | SchemaForm fallback |
|--------|-------------------|
| NPC 的名称/类型/性别/年龄/好感度/位置 | NPC 的所有未列出字段（通过"高级编辑器"入口） |
| 地点的名称/描述/类型/上级/连接/NPC | 地点的坐标等罕见字段 |
| 物品的名称/类型/数量/品质/描述 | 物品的自定义扩展字段 |
| 角色的姓名/性别/年龄/位置/属性 | 角色的扩展字段 |

每个面板在编辑表单底部保留"在高级编辑器中查看更多"链接 → 跳转 GameVariablePanel。

### OQ-F：是否处理"状态效果"和"成就"的编辑

**建议：不处理。两者均为游玩产物，不属于卡创作编辑范畴。**

- **状态效果**（`角色.效果[]`）：buff/debuff 由 AI 在游玩过程中产生和清理，卡作者不应手动编辑
- **成就**：同理，是游玩过程中累积的记录

如果未来有需求在卡创作时预设初始状态效果/成就，可在后续 Story 中添加。

---

## 10. 关键决策点总结

| # | 决策 | 理由 |
|---|------|------|
| **KD-1** | 所有编辑通过 editor composable 层，面板不直接 setValue | Story 1 C2 教训：校验/cascade/错误处理应在 composable 层，UI 只负责渲染 |
| **KD-2** | 扩展 RelationshipPanel 内建编辑模态（不重做/不用 NpcEditDialog） | 现有模态已覆盖 ~70% 字段 + 7 节结构完整，扩展成本远低于重做 |
| **KD-3** | MapPanel/InventoryPanel 从零新增 CRUD | 两者当前 0 个 setValue 调用，完全只读，无编辑基础可复用 |
| **KD-4** | 连接为双向自动维护 | 地图直觉：如果 A 连接 B，B 必然连接 A。单向连接对用户无意义。 |
| **KD-5** | 删除操作必须二次确认 + cascade 影响预览 | 不实现 undo，所以确认对话框是防止误操作的唯一防线 |
| **KD-6** | Engram 协调：inject 优先 + eventBus audit fallback（C3 修订） | 如果 Story 1 的 EngramEditor 可通过 inject 获取，调用 renameEntity/deleteEntity 做完整 cascade。如果不可用，发 eventBus audit event + 接受 Engram 短期不一致（旧 entity 残留、边引用悬挂），待 Story 1 上线后用户手动修复。EntityBuilder 是 upsert-only，**不会**自动清理 miss 的 entity。 |
| **KD-7** | D26 标注：关系状态/关系网变量编辑处添加"显示标签"提示条 | 遵守 D26 决策，明确传达数据权威性边界。 |
| **KD-8** | 不引入批量编辑（推到后续） | Story 2 核心是"每个面板有 CRUD 入口"，效率优化属于 Story 3（AI 助手）或更后续。 |
| **KD-9** | 不处理状态效果和成就的编辑 | 游玩产物，不属于卡创作范畴。 |
| **KD-10** | GameVariablePanel 保留为"高级 fallback"，不废弃 | 高级用户仍需要直接编辑原始 JSON 的能力。 |
| **KD-11** | 物品删除是直接状态树移除（非 action queue 丢弃） | Story 2 的"删除"是卡创作级编辑，与游玩级"丢弃"（通过 action queue → AI 处理）是不同操作。两者并存。 |
| **KD-12** | 不实现编辑级 undo/redo | 复杂度高，通过确认对话框 + 备份/云同步已有恢复手段。 |
| **KD-13** | Free text 字段不 cascade rename（I1 修订） | NPC 记忆、总结记忆等 free text 中的名称引用不做自动替换（不可靠 + 可能误伤）。仅结构化引用 cascade（`关系网变量[].对象`、`世界.地点信息[].NPC[]`）。 |
| **KD-14** | NPC 名称唯一性含玩家姓名检查（I2 修订） | NPC 名称不得与玩家姓名相同（避免 Engram entity name 混淆）。反向：useCharacterEditor.updateField 改姓名时也检查不与 NPC 名冲突。 |
| **KD-15** | NpcEditDialog 完全弃用（M1 修订） | RelationshipPanel 内建 7 节模态已覆盖远多于 NpcEditDialog 的 5 字段。CharacterDetailsPanel relations tab 的 NPC 跳转到 RelationshipPanel（router.push），不使用 NpcEditDialog。NpcEditDialog 文件保留不删除，但 Story 2 不新增对它的引用。 |
| **KD-16** | PlotPanel 纳入 Story 2 范围（C2 修订） | Epic §4.1 line 457 明确将剧情导向列为卡创作步骤。PlotPanel 已有 ~80% CRUD，仅需补齐弧线标题/概要编辑。 |

---

---

## 11. 实现验收 Code Review（2026-05-23）

> **Reviewer:** Plan 作者
> **Review 范围：** Story 2 全部实现代码 vs §6.5 验证标准 checklist
> **方法：** 3 个并行 audit agent（composable 层 / 面板层 / i18n+测试+plotStore）+ 手动补充验证（grep + 代码读取 + `npx tsc --noEmit` + `npx vitest run`）

### 11.1 验证标准 checklist 逐项核查

| # | 验证标准 | 状态 | 证据 |
|---|---------|------|------|
| 1 | 用户可在角色详情面板中编辑所有字段（基础/属性/身份/可变属性/身体信息） | ⚠️ **部分通过** | 位置/出身/特质/天赋/描述/先天六维/后天属性/可变属性/身体信息均已实现（通过 `charEditor.updateField/updateAttribute/updateVitals/updateBody/addTalent/removeTalent`）。**但性别和职业/地位仍为只读展示**（CharacterDetailsPanel.vue 行 1460-1470：纯 `<span class="info-value">{{ gender }}</span>`，无 click handler 或编辑控件）。Plan §3.1.a 明确标注这两个字段从 "❌ 只读" → "✅ 可编辑"。 |
| 2 | 用户可在地图面板中 CRUD 地点 + 管理连接关系 + 管理 NPC 驻留 | ✅ **通过** | MapPanel.vue 使用 `useLocationEditor`，0 个直接 setValue。新增创建/编辑/删除按钮 + 编辑模态（含连接 tag list + NPC tag list + 上级 select）+ 右键上下文菜单。双向连接自动维护。 |
| 3 | 用户可在社交面板中编辑 NPC 全部字段（含 Social-1 新字段） | ✅ **通过** | RelationshipPanel.vue 编辑模态已补齐 6 个 Social-1 字段：核心性格特征/关系状态/好感度突破条件/关系突破条件/关系网变量/总结记忆。D26 提示条存在（行 1070）。 |
| 4 | 用户可在社交面板中新增/删除 NPC | ✅ **通过** | 使用 `npcEditor.save()` 和 `npcEditor.delete()`。cascade 完整：删除时清理地点 NPC 列表 + 关系网变量 + Engram 通知。 |
| 5 | 用户可在背包面板中 CRUD 物品 + 编辑货币 | ✅ **通过** | InventoryPanel.vue 使用 `useInventoryEditor`，0 个直接 setValue。物品 CRUD + 货币编辑模态完整。 |
| 6 | 用户可在剧情面板中编辑弧线标题/概要 | ✅ **通过** | PlotPanel.vue 使用 `usePlotEditor.updateArc()`。plotStore.ts 新增 `updateArc` 方法（行 143-149，已导出行 402）。内联编辑触发 + persist 序列完整。 |
| 7 | D26 标注 | ✅ **通过** | RelationshipPanel.vue 行 1070：`<span class="form-hint form-hint--d26">ⓘ {{ $t('relationship.editForm.d26Hint') }}</span>`。i18n 中英双语均存在。 |
| 8 | 所有编辑通过 editor composable 层 | ⚠️ **部分通过** | 5 个 composable 全部存在且被面板导入使用。**但 RelationshipPanel 的 4 个 toggle 函数（toggleAttention/toggleHeartbeatLock/togglePresence/toggleMajorRole，行 206-263）仍直接调用 `setValue()`**，未使用 `npcEditor.toggleFlag()`。composable 已导出 `toggleFlag` 函数，面板未消费。 |
| 9 | Cascade 正确 | ✅ **通过** | useNpcEditor: rename → 地点 NPC 列表 + 关系网变量 + Engram。delete → 同上。useLocationEditor: rename → 子地点上级 + 连接 + NPC 位置。delete → 同上。双向连接维护。集成测试文件存在（398 行，覆盖关键 cascade 路径）。 |
| 10 | i18n 双语完整覆盖 | ✅ **通过** | character.edit.* / relationship.editForm.* / map.action.* + map.edit.* + map.delete.* + map.validate.* / inventory.action.* + inventory.edit.* + inventory.delete.* + inventory.validate.* / plot.arc.editTitle + plot.toast.arcUpdated — 全部存在于 zh-CN 和 en。 |
| 11 | 移动端适配（触摸目标 ≥ 44px） | ✅ **通过** | CharacterDetailsPanel stepper 按钮 `min-width: 44px; min-height: 44px`（行 3438）。MapPanel `touch-action: manipulation`。各面板模态在 `@media (max-width: 767px)` 下有响应式布局。 |
| 12 | Glassmorphism token | ✅ **通过** | 编辑模态使用 `var(--glass-bg)` / `var(--glass-blur)` / `var(--glass-shadow)` token（审计确认）。 |
| 13 | **核心验证：用户从未需要打开 GameVariablePanel** | ⚠️ **存疑** | 各面板均有"高级编辑器"跳转入口（CharacterDetailsPanel 行 845/1726、MapPanel 行 1060、InventoryPanel 行 353）。GameVariablePanel 新增 router query 深链接（useRoute 导入行 12 + route.query.path watch 行 145 + 返回链接行 573）。**但性别/职业编辑缺失意味着用户仍需 GameVariablePanel 来编辑这两个字段。** |

### 11.2 代码质量审计

#### ✅ 通过项

| 检查项 | 状态 | 证据 |
|--------|------|------|
| TypeScript 类型安全 | ✅ | `npx tsc --noEmit` 无错误输出 |
| EditorResult/EditorError 统一返回类型 | ✅ | `types.ts`（137 行）：EditorResult\<T\> + EditorError + 13 个 EditorErrorCode + emitEditorToast helper |
| Player ↔ NPC 名称冲突双向检查 | ✅ | useCharacterEditor 行 57-69（改姓名时检 NPC）+ useNpcEditor 行 73-83（建 NPC 时检玩家名） |
| 循环层级检测 | ✅ | useLocationEditor.wouldCreateCycle() 行 36-53 |
| 删除操作影响预览 | ✅ | useNpcEditor.analyzeDeleteImpact() + useLocationEditor.analyzeDeleteImpact() |
| Engram 协调 inject + eventBus 双路径 | ✅ | useNpcEditor 行 40：`inject('engramEditor', null)`；行 92/186：eventBus emit |
| mock-game-state 测试工具 | ✅ | `__tests__/test-utils/mock-game-state.ts`（80 行）：createMockGameState factory |
| plotStore.updateArc 遵循现有模式 | ✅ | plot-store.ts 行 143-149：find + mutate，无 \_withMutex，与 updateNode/updateGauge 一致 |

#### 🔴 必须修复

| # | 问题 | 严重度 | 位置 | 说明 |
|---|------|--------|------|------|
| **F1** | **性别/职业编辑缺失** | 🔴 Critical | CharacterDetailsPanel.vue 行 1460-1470 | Plan §3.1.a 明确标注 "性别: ❌→✅ 点击→select dropdown" + "职业/地位名称: ❌→✅ 点击→inline text input"。当前仍为只读 `<span>`。useCharacterEditor.updateField 已支持这些路径，但面板 UI 未添加编辑触发控件。**违反铁律"严禁擅自跳过设计文档中的功能"。** |
| **F2** | **全部 7 个单元测试 FAIL** | 🔴 Critical | `src/ui/composables/editors/__tests__/*.test.ts` | 运行 `npx vitest run src/ui/composables/editors/ src/engine/plot/plot-store-updateArc.test.ts` → 7/7 FAIL。错误：`TypeError: Cannot read properties of undefined (reading 'config')`。**根因：** Vue `inject()` 在 composable 中被调用（如 useNpcEditor 行 40），但测试未包裹 Vue app context。`vi.mock` 仅 mock 了 `useGameState` 和 `event-bus`，未处理 Vue 内置 `inject` 的 context 需求。测试需要引入 `@vue/test-utils` 的 `withSetup` helper 或手动 `createApp().provide()` 包裹。 |
| **F3** | **RelationshipPanel 4 个 toggle 绕过 composable** | 🔴 Important | RelationshipPanel.vue 行 206-263 | toggleAttention/toggleHeartbeatLock/togglePresence/toggleMajorRole 共 4 个函数直接调用 `setValue(P.relationships, list)`。composable `npcEditor.toggleFlag()` 已存在但**未被调用**。Plan KD-1："所有编辑通过 editor composable 层，面板组件不直接调用 setValue。"**组件已创建但未被消费 = 违反铁律。** |

#### 🟡 建议改善（不阻塞交付）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| S1 | CharacterDetailsPanel SchemaForm 保存（行 1271）直接 `setValue(schemaModalPath.value, ...)` | CharacterDetailsPanel.vue | 这是"高级编辑"fallback 模态，路径动态（可能超出 charEditor 覆盖范围），暂可接受。长期建议：如果 SchemaForm 编辑的路径属于 charEditor 管理范围，应路由到 charEditor。 |
| S2 | CharacterDetailsPanel 6 个 image-related setValue 调用 | 行 345/370/378/475/482 | 这些是 image anchor/archive 操作，属于图像系统而非 Story 2 编辑范畴。不需要走 charEditor。但长期可考虑 `useImageEditor` composable。 |
| S3 | `inventory.edit.typeOption` 和 `qualityOption` 的 i18n key 应验证双语一致性 | i18n 文件 | 审计确认 key 存在，但建议人工验证中英文翻译的准确性（如"消耗品"→"Consumable"）。 |

### 11.3 总结与交付判定

~~**交付状态：⛔ 未通过 — 3 项必须修复后方可交付。**~~

### 11.4 二次验收（2026-05-23 F1/F2/F3 修复后）

**F1 修复验证：** ✅ **通过。** CharacterDetailsPanel.vue 行 1477-1488 新增性别 select dropdown（`@click → startEditGender()` → `<select v-model="genderDraft">`，选项 男/女/其他，调用 `charEditor.updateField(P.characterGender, ...)`）。行 1490-1497 新增职业 inline text input（`@click → startEditOccupation()`）。editingGender / editingOccupation ref 在行 689-690 定义。

**F2 修复验证：** ✅ **通过。** `npx vitest run` 结果：**7/7 test files passed, 104/104 tests passed**（useCharacterEditor 24 + useNpcEditor 19 + useLocationEditor 18 + useInventoryEditor 13 + usePlotEditor 5 + cross-panel-cascade 19 + plot-store-updateArc 6）。

**F3 修复验证：** ✅ **通过。** RelationshipPanel.vue 的 4 个 toggle 函数现在全部调用 `npcEditor.toggleFlag(idx, flagName)`（行 215/223/252/259）。`grep '^\s*setValue\('` 在 RelationshipPanel 中返回 0 匹配 — 零直接 setValue 调用。

**最终交付状态：✅ 通过 — Story 2 实现完成，可交付。**

| 验证项 | 状态 |
|--------|------|
| §6.5 验证标准 13 项 | ✅ 全部通过 |
| TypeScript 类型安全 | ✅ `npx tsc --noEmit` 无错误 |
| 单元/集成测试 | ✅ 104/104 passed |
| KD-1 composable 层封装 | ✅ 面板零直接 setValue（CharacterDetailsPanel 剩余 6 个为 image 系统的非 Story 2 调用 + 1 个 SchemaForm fallback） |
| 铁律：严禁跳过功能 | ✅ Plan §3.1.a 所有字段已实现 |
| 铁律：组件必须被消费 | ✅ 5 composable 全部被面板导入并调用 |
| 铁律：checklist 全勾 | ✅ 本节逐项核查完成 |

| 项目 | 判定 |
|------|------|
| Composable 层 | ✅ 5 个 composable API 完整、cascade 正确、error code 完备、类型安全 |
| 面板集成 | ⚠️ **F1（性别/职业编辑缺失）+ F3（4 个 toggle 未走 composable）** 需修复 |
| 测试 | ❌ **F2（7/7 tests FAIL）** 需修复 Vue context 问题 |
| i18n | ✅ 中英双语完整覆盖 |
| 移动端 | ✅ 触摸目标 + 响应式布局 |
| plotStore | ✅ updateArc 存在、导出、模式正确 |

**必须修复的 3 项：**

1. **F1 — 性别/职业编辑 UI：** CharacterDetailsPanel.vue 行 1460-1470 需添加：
   - 性别：`@click` → select dropdown（男/女/其他），调用 `charEditor.updateField(P.characterGender, value)`
   - 职业/地位：`@click` → inline text input，调用 `charEditor.updateField(P.characterOccupation, value)`
   - i18n key `character.edit.genderOption.*` 已存在，可直接使用

2. **F2 — 测试 Vue context 修复：** 每个测试文件的 `describe` 块需要 Vue app context 包裹。推荐方案：
   ```typescript
   import { createApp } from 'vue';
   let app: ReturnType<typeof createApp>;
   beforeEach(() => {
     app = createApp({ setup() {} });
     app.provide('engramEditor', null);  // 或 mock
     // 在 app context 内调用 composable
   });
   afterEach(() => app.unmount());
   ```
   或使用 `@vue/test-utils` 的 `withSetup` pattern。

3. **F3 — toggle 函数迁移到 composable：** 将 RelationshipPanel 行 206-263 的 4 个 toggle 函数改为调用 `npcEditor.toggleFlag(index, flagName)`。删除面板中的直接 `setValue` 调用。

**修复完成后重新运行本 checklist，全部 ✅ 后 Story 2 可宣告交付。**
