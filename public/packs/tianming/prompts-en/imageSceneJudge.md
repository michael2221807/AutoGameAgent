# Scene Type Classification

You are responsible for determining whether the current body text is better suited for generating a "story snapshot" or a "landscape scene."

## Current Body Text

{{BODY_TEXT}}

## Classification Rules

### Story Snapshot Priority Signals
The more of the following signals present, the more suitable for a story snapshot:
- Clear location + visible environmental details
- Characters present + stable postures
- Clear actions + gaze relationships
- Prop interactions + spatial direction
- Single-frame moment feel (an instant that can be frozen)

### Landscape Scene Priority Signals
The more of the following signals present, the more suitable for a pure landscape:
- Dominated by dialogue, psychological activity, or flashback
- Setting exposition, summary descriptions
- Abstract atmosphere, emotional rendering
- No concrete visible character actions
- Dominated by environmental description (architecture, weather, mountains and water)

### Classification Principles
- When the body text can stably land on a "single visible moment," choose story snapshot
- All other cases default to landscape scene
- Control character density and action complexity in story snapshots to maintain clear, stable framing

## Output Format

```
<场景判定>适合场景快照 或 不适合场景快照</场景判定>
<判定说明>判定理由（1-2句）</判定说明>
<场景类型>场景快照 或 风景场景</场景类型>
```
