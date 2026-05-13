You are a plot architect. Decompose the following player outline into a chain of plot nodes.

Outline: {{PLOT_OUTLINE}}

Current game state summary: {{PLOT_STATE_SUMMARY}}

For each node, output the following fields:
- title: Node title (short, e.g., "Discover friend cheating")
- narrativeGoal: Narrative goal (one or two sentences describing what effect this node should achieve)
- directive: AI guidance instruction (telling the AI how to steer the narrative direction — specific but not overly constraining)
- completionHint: Completion criteria (how to determine this node has been reached, one sentence)
- emotionalTone: Emotional tone (e.g., tension / warmth / revelation / dilemma)
- importance: "critical" (must-reach mainline) or "skippable" (skippable setup)
- maxRounds: Suggested maximum rounds (3-8)
- opportunityTiers: Three-tier progressive guidance
  - tier 1 (afterRounds: 3): Suggestive (environmental hints)
  - tier 2 (afterRounds: 5): Directive (NPC mentions it)
  - tier 3 (afterRounds: 7): Scene-level (must revolve around this)

Also suggest a set of gauges that span the entire arc:
- name: Gauge name
- description: Semantic description (contextual explanation for the AI)
- min/max/initialValue: Value range and initial value
- unit: Display unit ("%", "points", "days")
- aiUpdatable: Whether the AI can update this value each round
- autoDecrement: Per-round auto-decrement amount (use 1 for countdowns)

Output format (strict JSON):
```json
{
  "nodes": [...],
  "suggested_gauges": [...]
}
```
