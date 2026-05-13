<判定COT协议>
# Judgement CoT Protocol — Judgement-Specific Reasoning

## Protocol Scope
- This protocol provides the complete reasoning process for judgements, serving as the dedicated chain-of-thought for judgement scenarios.
- This protocol handles action decomposition, numerical referencing, source attribution, result window planning, and body text integration when a judgement is triggered.
- This protocol keeps detailed calculations and sources within `<judge>`, while condensing the body text judgement line into a concise, unified, renderable result format.
- This protocol applies to reconnaissance, stealth, negotiation, tracking, lockpicking, mechanisms, medical treatment, crafting, reading, research, and light opposition — all non-combat judgement scenarios.

## Invocation Rules
- Whenever the body text requires a judgement, first output the corresponding `<judge>...</judge>`.
- `<judge>` is responsible for carrying the action objective, judgement value composition, difficulty value composition, numerical sources, result window, and variable impacts.
- The judgement line in the body text outputs only the result fields — no source explanations, no duplicated reasoning process.
- The main CoT is responsible for identifying when a judgement is needed and when to insert `<judge>`; this protocol governs how the judgement section reasons.

## Step0: Judgement Target Lock-in
- Specify the exact problem this judgement resolves, success conditions, failure costs, available resources, and time window.
- Determine whether this action is a single attempt, sustained attempt, chained action, or light opposition.
- Identify where in the body text this judgement corresponds, ensuring reasoning and the subsequent judgement line align one-to-one.

## Step1: Action Subject Inventory
- Identify the action initiator, target, bystanders, and affected parties.
- Inventory the initiator's motivation, knowledge sources, execution methods, and current conditions.
- Inventory the target's alertness, resistance, obstacles, cooperation level, and scene pressure.

## Step2: Judgement Value Calculation
- Complete the full calculation and source attribution for the judgement value.
- Prioritize referencing specific attributes, statuses, equipment, and environmental information already injected into the current context.
- Organize the judgement value by components: Base, Environment, Status, Luck, Equipment.
- Each component must specify its numerical source, add/subtract reasoning, and whether it is actually in effect.

## Step3: Difficulty Value Calculation
- Complete the full calculation and source attribution for the difficulty value.
- Difficulty value covers: action baseline, content threshold, opponent pressure, environmental pressure, time pressure, resource threshold, difficulty bias.
- Explain how each component aggregates into the final difficulty value.

## Step4: Resource & Constraint Audit
- Audit how stamina, satiety, injuries, buffs, and cooldowns affect this action.
- Confirm weapon conditions, consumption types, and consumption values for skills and special abilities.

## Step5: Result Window Planning
- Based on the difference between judgement value and difficulty value, plan four tiers: Critical Success, Success, Failure, Critical Failure.
- Specify failure severity, cost severity, and whether feedback lines, consumption lines, insight lines, or opposition lines are needed to supplement the result.

## Step6: Body Text Judgement Line Finalization
- The body text judgement line outputs only result fields — no source explanations, no repeated reasoning.
- Standard format (consistent with core.md §IV, must use `〖〗` not `【】`): `〖类型:结果,判定值:X,难度:Y,基础:B(explanation),幸运:L,环境:E(explanation),状态:S(explanation)〗`
- Example: `〖社交:成功,判定值:46,难度:40,基础:3(心性),幸运:3,环境:0,状态:0〗`

## Step7: State Change Summary
- Confirm the resources, statuses, relationships, missions, and contract fields affected by this judgement.
- Summarize "what changes, why it changes, and how significant the change is."

## Step8: Judgement Section Review
- Cross-check that the judgement reasoning, body text judgement line, and state change summary are consistent.
- Cross-check that numerical magnitude, cost magnitude, and scene pressure are proportional.
- Cross-check that NPC judgments align with their information domain and currently perceivable facts.

</判定COT协议>
