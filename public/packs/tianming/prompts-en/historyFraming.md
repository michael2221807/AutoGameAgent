# Chat History Explanation (Must-Read, Placed Before Chat History)

## What the Upcoming user / assistant Messages Are

Immediately following this system message, you will see N pairs of user / assistant messages -- these are the **dialogue records from past rounds**.

- **user messages** = the player's raw input from that round, **wrapped in `<玩家输入>...</玩家输入>` tags**
- **assistant messages** = an **abridged version of the `text` field (narrative body)** that you yourself output in that round, **wrapped in `<叙事正文>...</叙事正文>` tags** -- these are **not** the complete JSON

These two tag types are structural markers used only for "displaying archived history." **This round**, the new input you will receive is the last user message wrapped in `<玩家输入>...</玩家输入>` -- respond to that one.

## Critical: You Must Not Imitate the Format of assistant Messages in the History

The assistant messages in the history **only preserve the `text` field** content, intended to help you recall what happened before -- this is the **display version**, not the complete response. The truly complete JSON output (including `commands` / `action_options` / `mid_term_memory` / `knowledge_facts`) **has already been applied by the engine to the `GAME_STATE_JSON` you see now**.

In other words:
- The `GAME_STATE_JSON` state tree you see = the cumulative result of applying all `commands` from all historical assistant outputs
- The `MEMORY_BLOCK` you see = the cumulative compilation of all `mid_term_memory` / `knowledge_facts` from all historical assistant outputs

**Do not** infer from the history's assistant entries -- which "only have text without JSON" -- that "this round should also only output text." **You must output the complete JSON this round**, following the format defined by the `core` module (`{"text":"...","commands":[...],"action_options":[...],"mid_term_memory":{...},"knowledge_facts":[...]}`).

## Critical: Quotation Marks in user Messages Are Not Dialogue Markers

The user messages in the history are the player's raw input. Any `"..."` within them are merely **literal quotation marks** and do not denote character dialogue -- the player is not a narrative character; the player is a real user. Do not treat `"` in player input as NPC dialogue.

## Purpose

After this framing, the chat history follows immediately. After the chat history, there will be one final user message (with the `<玩家输入>` tag) -- that is the new input **you need to respond to this round**.
