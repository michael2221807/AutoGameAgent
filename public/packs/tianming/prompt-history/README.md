# Prompt History — Pre-Split Originals

This directory contains **original (pre-split) copies** of prompt files that were
refactored on 2026-05-18 to eliminate the `"请根据以上设定开始。"` placeholder.

## Why these exist

The prompt assembler (`src/engine/prompt/prompt-assembler.ts`) injects a generic
user placeholder when all messages are `system` role. To fix this, each affected
prompt was split into:

- **System file** (instructions + output format) — stays in `prompts/{name}.md`
- **User file** (task data + template variables) — new `prompts/{name}Input.md`

These originals are used by `flow-prompt-split.test.ts` content-preservation tests
to verify no content was lost during the split.

## Files

| Original | Split into |
|----------|-----------|
| `midTermRefine.original.md` | `midTermRefine.md` (system) + `midTermRefineInput.md` (user) |
| `memorySummary.original.md` | `memorySummary.md` (system) + `memorySummaryInput.md` (user) |
| `longTermCompact.original.md` | `longTermCompact.md` (system) + `longTermCompactInput.md` (user) |

Note: `worldHeartbeat` and `privacyRepair` were also split but their originals
were not archived here (the content-preservation tests for those use structural
assertions rather than line-by-line comparison).
