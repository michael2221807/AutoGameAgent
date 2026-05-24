# Documentation Index — AutoGameAgent

> **Purpose:** a single entry point for future Claude sessions to find the right
> document without rereading CLAUDE.md reference tables. Scan this index, decide
> which docs are relevant to the current task, then read only those.
>
> **How to use:**
> 1. Identify your task category (bug fix / architecture question / new feature / historical reference)
> 2. Use the "Quick lookup by task" table below to find the 1-2 most relevant docs
> 3. Read the status banner at the top of each doc before trusting its contents
> 4. Update [status/bugfix-changelog.md](./status/bugfix-changelog.md) after every fix
>
> **Last updated:** 2026-05-04 (document archive cleanup — 20 files archived, per-folder index.md added)

---

## Status legend

Every doc starts with a status banner. Meaning:

| Status | Trust level | When to update |
|---|---|---|
| **AUTHORITATIVE** | Verified against current code. Do not contradict without explicit decision. | Only when architecture intentionally changes |
| **ACTIVE** | Current working document. Append entries as project evolves. | On every relevant change |
| **ARCHIVED-RESOLVED** | All items fixed. Preserved for traceability. | Do not edit; add follow-up notes if new findings |
| **MOSTLY-RESOLVED** | Most items fixed; a few explicit exceptions. | Only if an exception is addressed |
| **POINT-IN-TIME-SNAPSHOT** | Captured at a specific date; may be stale. | Do not edit; create a new snapshot if needed |
| **HISTORICAL-REFERENCE** | Structural concepts still valuable; specific details may be outdated. | Do not edit |
| **HISTORICAL-FOUNDATIONAL** | Original design; core principles still valid, some specifics superseded. | Do not edit |
| **HISTORICAL-EXECUTED** | A plan that was fully implemented. Preserved for traceability. | Do not edit |
| **HISTORICAL-SPEC** | A spec that was followed; implementation may have drifted. | Do not edit |
| **HISTORICAL-COMPLETE** | Log of completed work. | Do not edit |

---

## Quick lookup by task

| I need to… | Read |
|---|---|
| Work on Game Card epic (写卡) | [design/game-card-epic-design.md](./design/game-card-epic-design.md) — 游戏卡 epic 设计：创作/导出/导入/存档转卡，10 Stories，20 decisions |
| Understand Story 0 enhanced opening | [plans/story-0-enhanced-opening-implementation.md](./plans/story-0-enhanced-opening-implementation.md) — 7-phase enhanced opening pipeline (world→locations→NPCs→edges→narrative→postprocess→subpipelines) |
| Understand Story 2 UI inline editing | [plans/story-2-ui-inline-editing-implementation.md](./plans/story-2-ui-inline-editing-implementation.md) — 8-phase rollout: editor composables, panel CRUD, i18n, mobile, tests |
| Implement mobile device support | [design/mobile-adaptation-plan.md](./design/mobile-adaptation-plan.md) — 6-phase plan: polyfills, CSS layer, layout, interaction, panels, performance |
| Fix GitHub cloud sync (large backup) | [design/chunked-cloud-sync-design.md](./design/chunked-cloud-sync-design.md) — 分块压缩云同步：拆分+gzip+SHA-256 双层校验 |
| Work on Plot Direction System | [design/plot-direction-system.md](./design/plot-direction-system.md) — full design doc with data model, pipeline integration, prompt optimization, gauge system |
| Audit Plot Direction gaps | [status/plot-sprint1-gap-audit.md](./status/plot-sprint1-gap-audit.md) — exhaustive dual-agent requirement gap analysis (3 CRITICAL, 6 HIGH, 10 MEDIUM) |
| Fix a bug | [status/bugfix-changelog.md](./status/bugfix-changelog.md) — find if the bug was already addressed; see fix patterns |
| Add a state tree path | [architecture/schema-contract.md](./architecture/schema-contract.md) + `src/engine/pipeline/types.ts` `DEFAULT_ENGINE_PATHS` |
| Understand why code is structured X way | [architecture/engine-principles.md](./architecture/engine-principles.md) + [architecture/decisions.md](./architecture/decisions.md) |
| Edit a prompt file | [reference/prompt-change-log.md](./reference/prompt-change-log.md) — check path migrations + NSFW tag rules |
| Edit plot direction prompts | [design/plot-direction-system.md §4.3](./design/plot-direction-system.md) — prompt structure + token budget analysis |
| Debug Engram retrieval | [architecture/engram-v2-graphiti-alignment.md](./architecture/engram-v2-graphiti-alignment.md) (V2 AUTHORITATIVE) + `src/engine/memory/engram/*` (source of truth) |
| Plan / execute next Engram V2 hardening stage | [design/engram-v2-next-roadmap.md](./design/engram-v2-next-roadmap.md) — active roadmap for correctness, rerank/topK wiring, score explainability, temporal facts, and tests |
| Check if feature X from demo exists | [research/mrjh-migration/DEFINITIVE-GAP-ANALYSIS.md](./research/mrjh-migration/DEFINITIVE-GAP-ANALYSIS.md) (MOSTLY-RESOLVED, ~90% done) + verify against current code |
| Understand NSFW system | [architecture/decisions.md §8](./architecture/decisions.md) + `snapshot-sanitizer.ts` |
| Understand API category system | [architecture/decisions.md §9](./architecture/decisions.md) + `status/bugfix-changelog.md` "API 类别系统" entry |
| Understand NPC private chat | [status/bugfix-changelog.md](./status/bugfix-changelog.md) "NPC 私聊（Talk）" entry + `src/engine/pipeline/sub-pipelines/npc-chat.ts` |
| Understand the pipeline | [architecture/decisions.md §5](./architecture/decisions.md) + `src/engine/core/game-orchestrator.ts` |
| Understand the four-tier memory system | [architecture/memory-system.md](./architecture/memory-system.md) |
| Write or run tests | [status/testing-framework-setup.md](./status/testing-framework-setup.md) — commands, coverage, mock factories |
| Debug memory compression / threshold | [architecture/memory-system.md §3-§4](./architecture/memory-system.md) + `src/engine/pipeline/sub-pipelines/{mid-term-refine,memory-summary,long-term-compact}.ts` |
| Trace which phases are done | [history/archive/impl-order-progress.md](./history/archive/impl-order-progress.md) — historical, but authoritative for what was built |
| Understand the demo (`/h/ming`) topology | [history/archive/step-01-module-breakdown.md](./history/archive/step-01-module-breakdown.md) — 15-domain taxonomy |
| Work on CoT system | [research/mrjh-migration/PRINCIPLES.md §3.9-§3.10](./research/mrjh-migration/PRINCIPLES.md) (additive plugin + CoT scope) + `src/engine/pipeline/stages/reasoning-ingest.ts` + `src/engine/ai/response-parser.ts` |
| Work on NPC presence / social | [research/mrjh-migration/PRINCIPLES.md §3.15](./research/mrjh-migration/PRINCIPLES.md) + `src/engine/social/` directory + `schema-contract.md §1.3` |
| Work on image generation | [architecture/image-generation-system.md](./architecture/image-generation-system.md) — **authoritative** system doc (architecture + file index + data model + integration) |
| Plan / implement Civitai image provider | [design/civitai-provider-roadmap.md](./design/civitai-provider-roadmap.md) — ACTIVE epic roadmap + [design/civitai-implementation-plan.md](./design/civitai-implementation-plan.md) — ACTIVE technical implementation plan (7 phases, file inventory, risk register) |
| Design / implement Civitai LoRA Shelf | [design/civitai-lora-shelf-design.md](./design/civitai-lora-shelf-design.md) — ACTIVE PM + tech design for LoRA shelf, trigger dictionary, prompt injection, 主角生图, 图像工作台, persistence, and cross-module branches |
| Implement Civitai LoRA Shelf (code-level) | [design/civitai-lora-implementation-plan.md](./design/civitai-lora-implementation-plan.md) — ACTIVE 8-phase code-level implementation plan with file:line targets, design↔code conflict resolution, dependency graph |
| Plan / implement img2img, captioning, reference | [design/image-reference-captioning-design.md](./design/image-reference-captioning-design.md) — ACTIVE product design + [design/image-reference-captioning-implementation-plan.md](./design/image-reference-captioning-implementation-plan.md) — ACTIVE 8-phase implementation plan |
| Understand MRJH migration principles | [research/mrjh-migration/PRINCIPLES.md](./research/mrjh-migration/PRINCIPLES.md) — the authoritative source for all migration decisions |
| Execute UI/UX sanctuary-aesthetic migration | [status/ui-migration-plan.md](./status/ui-migration-plan.md) — atomic phase-by-phase plan driven by [../.impeccable.md](../.impeccable.md) |
| Work on environment tags | [research/mrjh-migration/07-environment-tags-plan.md](./research/mrjh-migration/07-environment-tags-plan.md) — P0-P4 done, P5 scheduled |
| Implement internationalization (i18n) | [design/i18n-epic-design.md](./design/i18n-epic-design.md) — 双层 i18n 系统设计 + [design/i18n-implementation-plan.md](./design/i18n-implementation-plan.md) — 8-Phase 实现计划 |
| Add i18n to a component (current or new) | `.claude/skills/i18n/SKILL.md` — 可复用 i18n Skill，含命名规范、DO NOT TRANSLATE 清单、验证流程 |

---

## MRJH Migration Context

> These rules were established during the MRJH→AGA migration (2026-04-15 to 2026-04-18).
> They apply specifically to migration work (image gen, CoT, social/presence, UI redesign).
> For non-migration work, follow the general rules in CLAUDE.md only.

**Core rule:** AGA is the main body. MRJH is a product to learn from and borrow arrangement/functional ideas from, NOT copy. See [PRINCIPLES.md](./research/mrjh-migration/PRINCIPLES.md) for the full 13-point directive.

**Migration quality standard:**
- **Prompt text:** copy verbatim from MRJH, but generalize wuxia-specific terms (境界→等级, 武侠/仙侠→特定风格/奇幻)
- **Code logic:** AGA-native implementation, NOT line-for-line port. Same functionality, AGA architecture (Vue 3 + Pinia + StateManager)
- **Coverage:** every MRJH if/else branch (different backends, compositions, anchor modes) must have AGA counterpart

**Immune modules (zero MRJH influence):** MapPanel, InventoryPanel, GameVariablePanel, PromptAssemblyPanel, PromptPanel, MemoryPanel, MainGamePanel

**Key references:**
- [PRINCIPLES.md](./research/mrjh-migration/PRINCIPLES.md) — 13-point migration directive (cross-subsystem, AUTHORITATIVE)
- [DEFINITIVE-GAP-ANALYSIS.md](./research/mrjh-migration/DEFINITIVE-GAP-ANALYSIS.md) — remaining migration TODOs
- [PROMPT-SYSTEM-REDESIGN-PLAN.md](./research/mrjh-migration/PROMPT-SYSTEM-REDESIGN-PLAN.md) — prompt system overhaul (not yet executed)
- `research/mrjh-migration/archive/` — 15 completed/superseded migration planning docs

---

## Directory layout

```
docs/
├── INDEX.md                        ← you are here
├── README.md                       ← brief landing
├── design/                         ← feature design documents (in-progress epics)
│   ���── index.md                    ← folder index
│   ├── plot-direction-system.md    ← Plot Direction System
│   ├── engram-v2-next-roadmap.md   ← Engram V2 hardening roadmap
│   ├��─ civitai-*.md (4 files)      ← Civitai provider + LoRA shelf design + impl plans
│   └── archive/                    ← completed design docs (2 files)
├── architecture/                   ← AUTHORITATIVE — the project's contract with itself
│   ├── index.md                    ← folder index
│   ├── decisions.md                ← 10 finalized architectural decisions
│   ├── schema-contract.md          ← state schema + path contract
│   ├── engine-principles.md        ← engine/content separation + 10 core principles
│   ├── memory-system.md            ← four-tier memory architecture
│   ├── engram-v2-graphiti-alignment.md ← Engram V2 AUTHORITATIVE
│   ├── image-generation-system.md  ← image subsystem AUTHORITATIVE
│   └── archive/                    ← superseded Engram V1 docs (3 files)
├── status/                         ← current state: what works, what's fixed
│   ├── index.md                    �� folder index
│   ├── bugfix-changelog.md         ← ACTIVE — every fix with flow + root cause
│   ├── testing-framework-setup.md  ← test suite documentation
│   ├── ui-migration-plan.md        ← sanctuary aesthetic migration plan
│   ├── ui-migration-changelog.md   ← migration phase changelog
│   ├── cr-custom-presets-*.md      ← open code review
│   ├── plot-sprint1-gap-audit.md   ← Plot Direction gap audit
│   └── archive/                    ← resolved CRs, audits, plans (12 files)
├── reference/                      ← quick-lookup
│   ├── index.md                    ← folder index
│   └── prompt-change-log.md        ← prompt path migrations + change history
├── product notes/                  ← user-reported items
│   └── buglist from regression testing.md
├── demo/                           ← HTML preview demos for UI migration approval gate
���   ├── index.md                    ← folder index
│   └── *.html (11 files)           ← migration + feature demos
├── research/                       ← deep-dive research (read when working on subsystem)
│   ├── index.md                    ← folder index
│   ├── engram-architecture.md      ← why Engram is structured the way it is
│   ├── archive/                    ← completed research (3 files)
│   └── mrjh-migration/
│       ├��─ index.md                ← folder index
│       ├── PRINCIPLES.md           ← migration directives (AUTHORITATIVE)
│       ├── DEFINITIVE-GAP-ANALYSIS.md ← remaining TODOs
���       ├── PROMPT-SYSTEM-REDESIGN-PLAN.md ← prompt system overhaul plan
│       ├── 00, 01, 05, 07-*.md     ← active migration research
│       ├── README.md               ← phase status tracker
│       └── archive/                ← completed migration plans (15 files)
├── test data/                      ← API payloads for regression reference
├── user-guide/                     ← end-user documentation
│   └── cloud-sync.md
└── history/
    ├���─ index.md                    ← folder index
    └── archive/                    ← all planning/implementation docs (8 files)
```

---

## Document inventory (by category)

> Each folder now has an `index.md` with full Active + Archived tables.
> Below are the **active documents only**. For archived docs, see each folder's `index.md`.

### design/ — feature design documents

| File | Status | Use when |
|---|---|---|
| [design/game-card-epic-design.md](./design/game-card-epic-design.md) | ACTIVE | 游戏卡 epic — 创作/导出/导入/存档转卡，10 Stories，20 decisions |
| [design/mobile-adaptation-plan.md](./design/mobile-adaptation-plan.md) | ACTIVE | Mobile device support — 6-phase implementation plan |
| [design/engram-v2-next-roadmap.md](./design/engram-v2-next-roadmap.md) | ACTIVE | Planning or executing the next Engram V2 hardening stage |
| [design/plot-direction-system.md](./design/plot-direction-system.md) | FINAL | Implementing or debugging the Plot Direction System |
| [design/civitai-provider-roadmap.md](./design/civitai-provider-roadmap.md) | ACTIVE | Planning or implementing the Civitai v2 image provider |
| [design/civitai-implementation-plan.md](./design/civitai-implementation-plan.md) | ACTIVE | Technical implementation plan for Civitai provider — 7 phases |
| [design/civitai-lora-shelf-design.md](./design/civitai-lora-shelf-design.md) | ACTIVE | PM + tech design for Civitai LoRA Shelf |
| [design/civitai-lora-implementation-plan.md](./design/civitai-lora-implementation-plan.md) | ACTIVE | Code-level implementation plan for LoRA Shelf — 8 phases |

### architecture/ — the rules future work must not break

| File | Status | Use when |
|---|---|---|
| [architecture/decisions.md](./architecture/decisions.md) | AUTHORITATIVE | Understanding the 10 non-negotiable rules |
| [architecture/schema-contract.md](./architecture/schema-contract.md) | AUTHORITATIVE | Adding paths, understanding Game Pack vs engine boundaries |
| [architecture/engine-principles.md](./architecture/engine-principles.md) | AUTHORITATIVE | Onboarding a new subsystem, judging where code should live |
| [architecture/memory-system.md](./architecture/memory-system.md) | AUTHORITATIVE | Working on any of the four memory tiers |
| [architecture/engram-v2-graphiti-alignment.md](./architecture/engram-v2-graphiti-alignment.md) | AUTHORITATIVE | Engram V2: Graphiti-aligned architecture |
| [architecture/image-generation-system.md](./architecture/image-generation-system.md) | AUTHORITATIVE | Working on image generation subsystem |

### status/ — what is the project's current state

| File | Status | Use when |
|---|---|---|
| [status/bugfix-changelog.md](./status/bugfix-changelog.md) | ACTIVE | Starting any bug fix session; after every fix — add new entry |
| [status/testing-framework-setup.md](./status/testing-framework-setup.md) | ACTIVE | Unit testing: Vitest setup, coverage tracking, mock factories |
| [status/ui-migration-plan.md](./status/ui-migration-plan.md) | ACTIVE | Sanctuary aesthetic UI migration plan |
| [status/ui-migration-changelog.md](./status/ui-migration-changelog.md) | ACTIVE | UI migration phase changelog |
| [status/cr-custom-presets-2026-04-14.md](./status/cr-custom-presets-2026-04-14.md) | OPEN | Custom presets code review — unresolved findings |
| [status/plot-sprint1-gap-audit.md](./status/plot-sprint1-gap-audit.md) | ACTIVE | Plot Direction Sprint 1 gap audit |

### reference/ — quick lookups

| File | Status | Use when |
|---|---|---|
| [reference/prompt-change-log.md](./reference/prompt-change-log.md) | ACTIVE | Editing any prompt file in `public/packs/tianming/prompts/` |

### research/ — deep context on specific subsystems

| File | Status | Use when |
|---|---|---|
| [research/engram-architecture.md](./research/engram-architecture.md) | HISTORICAL-REFERENCE | Debugging Engram retrieval; understanding hybrid-vs-stacking, burn logic |
| [research/mrjh-migration/PRINCIPLES.md](./research/mrjh-migration/PRINCIPLES.md) | AUTHORITATIVE | MRJH migration principles — AGA-first design, additive plugin pattern |
| [research/mrjh-migration/DEFINITIVE-GAP-ANALYSIS.md](./research/mrjh-migration/DEFINITIVE-GAP-ANALYSIS.md) | MOSTLY-RESOLVED | Feature parity tracker — ~90% complete, 7 remaining items |
| [research/mrjh-migration/PROMPT-SYSTEM-REDESIGN-PLAN.md](./research/mrjh-migration/PROMPT-SYSTEM-REDESIGN-PLAN.md) | AUTHORITATIVE | Prompt system overhaul plan (not yet executed) |
| [research/mrjh-migration/05-integration-plan.md](./research/mrjh-migration/05-integration-plan.md) | ACTIVE | Cross-epic sprint plan; toggle inventory |
| [research/mrjh-migration/07-environment-tags-plan.md](./research/mrjh-migration/07-environment-tags-plan.md) | IN-PROGRESS | Environment tags migration; P0-P4 complete, P5 scheduled |
| [research/mrjh-migration/00-codebase-map.md](./research/mrjh-migration/00-codebase-map.md) | ACTIVE | Phase 0 codebase map |
| [research/mrjh-migration/01-prompt-cot-analysis.md](./research/mrjh-migration/01-prompt-cot-analysis.md) | ACTIVE | Phase 1 prompt & CoT analysis |

### history/ — all files archived

All 8 planning/implementation history docs are in `history/archive/`. See [history/index.md](./history/index.md).

---

## What is NOT in this index (on purpose)

- **The demo source code** at `/h/ming/src/`. When the codebase needs a demo reference for a flow, search directly in `/h/ming/src/` — this index is about project *documentation*, not the demo's source.
- **`/h/ming/docs/`**. Those are the demo's own design notes for its cultivation game; they belong to the demo project and are not relevant to AutoGameAgent work.
- **`/h/ming` root-level meta files** (README, SETUP, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, CHANGELOG_MING). These are the demo's own repo metadata.
- **`src/` code comments and JSDoc**. The code is its own documentation for *how* things work. This index tells you *why* they work that way and what decisions shaped them.
- **Per-folder `index.md` files**. Each subfolder has its own `index.md` listing both active and archived docs. Use them for folder-level navigation and to find archived documents.

---

## Adding a new document

If you create a new document:

1. Place it in the most appropriate subdirectory (`architecture/`, `status/`, `reference/`, `research/`, `history/`, `design/`)
2. Add a status banner at the top (copy the format from an existing doc)
3. Add an entry to the right table in this file
4. If the doc is AUTHORITATIVE or ACTIVE, add a "Quick lookup" row at the top of this file
5. Add an entry to the folder's `index.md`

If you retire a document:

1. Run `/doc-archive` to follow the standard archival workflow
2. Or manually: move to `<folder>/archive/`, update folder's `index.md`, update this file
