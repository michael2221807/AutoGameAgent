# 结构性关系知识边生成

基于已建立的世界数据，生成结构性关系知识边。
格式与主回合 knowledge_facts 一致。

## 世界详情

{{WORLD_DESCRIPTION}}

## 已有 NPC 列表（名称 + 简述）

{{NPC_SUMMARY_LIST}}

## 已有地点列表

{{LOCATIONS_LIST}}

## 主角信息

{{PLAYER_NAME}} — {{PLAYER_DESCRIPTION}}

## 需要生成的关系类型

1. 玩家与NPC 关系（如"玩家是李明的同班同学"）
2. NPC与NPC 关系（如"张三是李四的兄长"）
3. NPC与地点关联（如"王师傅常驻东城铁匠铺"）
4. 实体与组织/物品关系（如"张三是天剑门嫡传弟子"）

## 关键约束

- source_entity 和 target_entity 必须引用上面列出的已有 NPC/地点名称
- 每条 fact 是 15-40 字的完整自然语言句子
- 不要重复已在 NPC 档案"关系状态"字段中表达的简单标签
- 重点描述 AI 在剧情中需要记住的事实关系

## 生成数量：{{EDGE_MIN}}-{{EDGE_MAX}} 条

## 输出格式（严格 JSON，禁止任何非 JSON 内容）

```json
{
  "knowledge_facts": [
    { "fact": "张三是李四的兄长，两人幼年失散", "source_entity": "张三", "target_entity": "李四" }
  ]
}
```

- 禁止 `<thinking>` 标签
- 只输出 JSON，不要输出任何解释文字
