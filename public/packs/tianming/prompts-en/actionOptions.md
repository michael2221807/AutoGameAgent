# Action Options Specification (active when enabled)

## Mandatory Requirements

When the system enables "action options," you must output the `action_options` field in the JSON:
- Omitting `action_options` is forbidden
- Must contain 3–5 valid options (string array)

## Format Requirements

```json
{
  "action_options": [
    "Wander around to familiarize with the area",
    "Talk to nearby people",
    "Investigate the current situation",
    "Find a place to rest",
    "Head to the next location"
  ]
}
```

- Quantity: 3–5
- Length: 8–20 characters each
- Format: Action descriptions starting with a verb

{{ACTION_PACE_HINT}}

{{CUSTOM_ACTION_PROMPT}}

## Generation Rules

Generate diverse options based on the current scene, covering:
1. **Conservative**: Observe / wait / defend / rest
2. **Neutral**: Converse / inquire / assess the situation
3. **Proactive**: Explore / act / advance
4. **Special**: A unique choice based on the current situation

## Forbidden

- ❌ Omitting action_options
- ❌ action_options as an empty array
- ❌ Only 1–2 options
- ❌ Duplicate or unexecutable options
