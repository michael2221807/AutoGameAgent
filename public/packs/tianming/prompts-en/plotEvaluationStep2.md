## Plot Node Evaluation (Required Additional Field)

You need to review **the previous round's generated narrative content** and determine whether the current plot node has been reached.

{{PLOT_EVAL_CONTEXT}}

【完成标志】
"{{PLOT_COMPLETION_HINT}}"

**In this round's JSON output, you must include a `plot_evaluation` field, at the same level as `mid_term_memory` / `commands`:**

```json
{
  "mid_term_memory": { ... },
  "commands": [ ... ],
  "action_options": [ ... ],
  "plot_evaluation": {
    "node_reached": false,
    "confidence": 0.2,
    "evidence": "In the previous round's narrative, the protagonist was only having casual conversation — the completion criteria were not triggered"
  }
}
```

**plot_evaluation field rules:**
- `node_reached` (boolean): Based on **the previous round's** narrative, has the completion criteria been fulfilled
- `confidence` (0.0-1.0): Judgment confidence. Partial fulfillment: 0.3-0.5; full fulfillment: 0.7+
- `evidence` (string): One sentence citing specific plot points from the previous round's narrative as basis
- **This field must not be omitted** — even if the previous round's narrative is completely unrelated to the node, fill it in (node_reached: false, confidence: 0.0)

{{PLOT_GAUGE_INSTRUCTIONS}}
