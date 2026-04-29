# Codex Guidelines — AutoGameAgent

> **First action on every new session:** read this file, then read [docs/INDEX.md](./docs/INDEX.md), then use its Quick Lookup table to choose the 1-2 relevant docs for the task.
>
> **First action on every new task:** quickly re-check this file's current rules and `docs/INDEX.md`; before editing code, state which project docs were consulted. If the same continuous task is still in progress, reuse already-read context and say so.
>
> This file is the Codex companion to [CLAUDE.md](./CLAUDE.md). It does not replace project documentation. It translates the same working contract into Codex-specific operating rules so Codex and Claude stay aligned.

---

## Current Project Snapshot

AutoGameAgent is a Vue 3 + TypeScript + Pinia + Vite browser game engine for AI-driven persistent narrative games.

The current source of truth is:

1. `docs/INDEX.md` — authoritative map of all docs.
2. `docs/status/bugfix-changelog.md` — newest fixed behavior and bug history.
3. `docs/architecture/*.md` — architecture contracts that new work must not break.
4. Code under `src/` — ground truth when docs and implementation disagree.

Important current state as of this Codex handoff:

- **Engram V2 / Graphiti alignment is recently completed.** Recent work added KnowledgeEdge, unified retrieval scoring traces, and per-round Engram visualization.
- **Plot Direction System has an MVP feedback loop and several audit fixes.** Active docs: `docs/design/plot-direction-system.md` and `docs/status/plot-sprint1-gap-audit.md`.
- **Sanctuary UI migration is documented as shipped.** Active docs: `docs/status/ui-migration-plan.md` and `docs/status/ui-migration-changelog.md`.
- **MRJH migration gap analysis is older but still useful for missing feature areas.** The biggest historical gaps were image generation UX, Settings UX, CoT visualization, and shared primitive adoption. Verify against current code and changelog before treating a gap as still open.
- **There is currently a dirty worktree entry in** `src/ui/components/panels/SavePanel.vue`. Do not overwrite or revert it unless the user explicitly asks.

---

## Collaboration Contract

Default goal: deliver stable, verifiable results with minimal user interruption. The user primarily reviews outcomes, not a stream of micro-decisions.

- **Documentation beats session memory.** Key decisions, requirement changes, acceptance criteria, and fix records must be written to local docs under `docs/`.
- **Use matching skills automatically.** If a task clearly matches an installed skill, read that skill's `SKILL.md` and follow it.
- **Define done in observable terms.** Prefer "what the user sees or can do" over internal state claims.
- **Chinese by default for planning/status docs.** Code, identifiers, and code comments stay English unless local conventions already differ.
- **Partial is not done.** If work is incomplete, record exactly what is done, what is not done, and the next concrete files/tasks.

---

## Working Loop

For every task:

1. **Define success criteria.** Make them checkable and user-observable.
2. **Choose the shortest credible path.** Read docs/code first, then implement.
3. **Validate incrementally.** Treat command output, diffs, and browser behavior as evidence.
4. **Only declare done when evidence matches the criteria.**

Before coding a bug fix:

1. Name the flow precisely.
2. Define expected behavior in user-observable terms.
3. Find the root cause by reading code.
4. Fix it.
5. Update `docs/status/bugfix-changelog.md` after confirmation.

For UI changes:

- Start the dev server and exercise the feature in a browser before calling it complete.
- User-visible change is required. If the user opens the browser and nothing changed, the task is not delivered.
- A component only counts when it is actually consumed by a real screen or flow.

---

## Architecture Rules

Read these docs before touching related code:

- `docs/architecture/decisions.md`
- `docs/architecture/engine-principles.md`
- `docs/architecture/schema-contract.md`

Non-negotiables:

- Engine code under `src/engine/` must stay content-agnostic.
- Never hardcode state paths. Use `DEFAULT_ENGINE_PATHS` from `src/engine/pipeline/types.ts`.
- Engine classes must not call Pinia stores directly. Use constructor injection, callbacks, event bus, or `StateManager`.
- Before touching state-reading code, perform the three-system audit: prompt, state schema, component.
- No unexplained `any`; prefer `unknown` plus type guards.
- Async paths must handle rejection or fail softly by design.
- Code is ground truth. If docs contradict current code, trust code and update the docs.

---

## UI / UX Rules

The UI target is the sanctuary aesthetic defined by `.impeccable.md` and tracked in `docs/status/ui-migration-plan.md`.

Principles:

- The narrative is the main light source; chrome should recede.
- Warm charcoal, sage, amber, bone, and warm rust are the core palette.
- Avoid cold indigo/purple SaaS defaults, pure white, neon glows, hard colored side stripes, and browser-default form controls.
- Panel-grade frosted glass must use the tokenized glass system in `src/ui/styles/tokens.css`; hard `1px solid` glass borders are forbidden for panel-grade surfaces.
- Follow Polanyi-style tacit UX from `CLAUDE.md`: users should understand through spatial cues, rhythm, and interaction affordance, not explanatory copy.

When editing Vue components:

- Prefer existing primitives and patterns.
- Preserve templates/scripts for style-only refaces unless behavior must change.
- Verify no key content is clipped, overlapped, hidden behind sidebars, or unreadable on mobile/desktop.

---

## Validation Commands

Common commands:

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

Notes:

- Historical docs mention pre-existing type errors during earlier UI phases. Always check current output; do not assume old errors remain.
- If a bug fix changes behavior, include real case evidence in the final report.
- If tests cannot be run, say why and identify residual risk.

---

## Handoff Format

When ending a substantial task, report:

- **Result:** what changed.
- **Evidence:** commands, browser checks, or concrete cases.
- **Not done:** explicit gaps, if any.
- **Next:** one or two practical next steps only when useful.

When context is running low or work pauses:

1. Record honest progress.
2. List incomplete items with file paths.
3. Never use context limits as a reason to declare incomplete work done.

---

## Keeping Codex And Claude Aligned

- `CLAUDE.md` and `CODEX.md` should agree on project rules, doc entry points, validation expectations, and architecture boundaries.
- If a project rule changes in one file, update the other or add a note explaining why the rule is agent-specific.
- Shared project truth belongs in `docs/`, not in either agent-specific guideline file.
- When in doubt, follow this priority order:
  1. Current user instruction.
  2. `docs/INDEX.md` and linked authoritative docs.
  3. Current code behavior.
  4. `CLAUDE.md` / `CODEX.md`.
