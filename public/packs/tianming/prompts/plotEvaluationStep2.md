## 剧情节点评估（必填附加字段）

你需要回顾**上一轮生成的叙事内容**，判断当前剧情节点是否已经达成。

{{PLOT_EVAL_CONTEXT}}

【完成标志】
"{{PLOT_COMPLETION_HINT}}"

**在本轮 JSON 输出中，必须包含 `plot_evaluation` 字段，与 `mid_term_memory` / `commands` 同级：**

```json
{
  "mid_term_memory": { ... },
  "commands": [ ... ],
  "action_options": [ ... ],
  "plot_evaluation": {
    "node_reached": false,
    "confidence": 0.2,
    "evidence": "上一轮叙事中主角只是在日常对话，未触及完成标志描述的情节"
  }
}
```

**plot_evaluation 字段规则：**
- `node_reached` (boolean)：根据**上一轮**叙事，完成标志是否已实现
- `confidence` (0.0-1.0)：判断置信度。部分实现填 0.3-0.5，完全达成填 0.7+
- `evidence` (string)：一句话引用上一轮叙事中的具体情节作为依据
- **不允许省略此字段**，即使上一轮叙事与节点完全无关也要填写（node_reached: false, confidence: 0.0）

{{PLOT_GAUGE_INSTRUCTIONS}}
