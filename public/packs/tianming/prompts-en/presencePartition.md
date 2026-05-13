# NPC Presence / Absence Context Partition

## Present NPCs (Current Scene, Detailed Profiles)

{{NPC_PRESENT_BLOCK}}

## Absent NPCs (Other Locations, Brief Reference)

{{NPC_ABSENT_BLOCK}}

## Presence System Rules (Hard Constraints)

- **Present NPCs**: May participate in dialogue, actions, and interactions. Descriptions should include their reactions and behaviors.
- **Absent NPCs**: Unless the player actively initiates contact (e.g., sending a message, remote communication), they should not appear in the current scene.
- **Presence status must be updated every round**: When an NPC appears in the current scene or leaves, you **must** issue commands:
  - `{"action":"set","path":"社交.关系[名称=X].是否在场","value":true/false}`
  - `{"action":"set","path":"社交.关系[名称=X].位置","value":"Current location name"}`
- When the player moves to a new location, determine which NPCs should follow (companions/teammates -> 是否在场=true) and which stay behind (-> 是否在场=false).
- When a new NPC first appears in the narrative, include `"是否在场": true` and the `"位置"` field directly in the push command.
- Use `set 社交.关系[名称=X].最后互动时间` to record the last interaction time with absent NPCs.
