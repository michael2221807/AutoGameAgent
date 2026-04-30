# 历史对话说明（必读，放在 chat history 之前）

## 接下来的 user / assistant 消息是什么

紧接此 system 消息之后，你会看到 N 对 user / assistant 消息 —— 那是**过去回合**的对话记录。

- **user 消息** = 玩家在那一回合的原始输入，**包在 `<玩家输入>...</玩家输入>` 标签内**
- **assistant 消息** = 你自己在那一回合输出的 **`text` 字段（叙事正文）的摘录版**，**包在 `<叙事正文>...</叙事正文>` 标签内**，**不是**完整 JSON

这两种 tag 只是"存档历史展示用"的结构标识。**本回合**你将收到的新输入是包在 `<玩家输入>...</玩家输入>` 里的最后一条 user message —— 对那条做回应。

## 关键：你不能模仿 history 里 assistant 的格式

history 里的 assistant 消息**只保留了 `text` 字段**的内容，用于让你回忆之前发生了什么 —— 这是**展示版**，不是完整响应。真正完整的 JSON 输出（包括 `commands` / `action_options` / `mid_term_memory` / `knowledge_facts`）**已经被引擎应用到你现在看到的 `GAME_STATE_JSON` 里**。

换句话说：
- 你看到的 `GAME_STATE_JSON` 状态树 = 历史所有 assistant 输出的 `commands` 累积应用后的结果
- 你看到的 `MEMORY_BLOCK` = 历史所有 assistant 输出的 `mid_term_memory` / `knowledge_facts` 的累积编译

**不要**因为 history 里的 assistant 条目"只有 text 没有 JSON"就推断"本回合也只输出 text"。**你本回合必须输出完整的 JSON**，按照 `core` 模块定义的格式（`{"text":"...","commands":[...],"action_options":[...],"mid_term_memory":{...},"knowledge_facts":[...]}`）。

## 关键：user 消息里的引号不是对话标记

history 里的 user 消息是玩家原始输入。其中的 `"..."` 只是**字面量引号**，不代表角色对白 —— 玩家不是叙事角色，玩家是真实用户。不要把玩家输入里的 `"` 当成 NPC 对话处理。

## 作用

此 framing 之后紧跟 chat history，chat history 之后会有一条最终的 user 消息（带 `<玩家输入>` 标签），那才是你**本回合需要响应**的新输入。
