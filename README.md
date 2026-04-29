# AutoGameAgent

> AI-driven interactive narrative game engine — build immersive, persistent story worlds powered by large language models.

AutoGameAgent is a browser-based game engine that uses LLMs (Claude, GPT, etc.) to generate rich narrative experiences with persistent world state, deep character systems, and semantic memory. Players create characters, explore AI-generated worlds, build relationships with NPCs, and shape emergent stories through natural language interaction.

**Live Demo:** Deployed via GitHub Pages  
**Tech Stack:** Vue 3.5 | TypeScript 5.8 | Pinia | Vite 6 | Cytoscape.js | IndexedDB

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Home Screen](#home-screen)
- [Character Creation](#character-creation)
- [Main Game Interface](#main-game-interface)
- [Sidebar Navigation](#sidebar-navigation)
- [Character Details](#character-details)
- [Inventory](#inventory)
- [Relationships & NPC System](#relationships--npc-system)
- [World Map](#world-map)
- [Memory System](#memory-system)
- [Engram Knowledge Graph](#engram-knowledge-graph)
- [Image Generation](#image-generation)
- [Plot Direction](#plot-direction)
- [Prompt Management](#prompt-management)
- [Game Variable Editor](#game-variable-editor)
- [API Management](#api-management)
- [Settings](#settings)
- [Save & Backup](#save--backup)
- [Engine Pipeline](#engine-pipeline)
- [Game Pack System](#game-pack-system)
- [Development](#development)

---

## Quick Start

```bash
npm install
npm run dev        # Dev server (LAN accessible)
npm run build      # Production build
npm test           # Run tests
```

**First-time setup:**
1. Open the app in your browser
2. Click **API 配置** on the home screen
3. Add at least one LLM API (OpenAI, Anthropic, etc.) and assign it to the `main` usage type
4. Click **新建角色** to create your first character
5. Follow the creation wizard, then click **开始游戏**

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (SPA)                       │
├──────────────┬──────────────────────────┬────────────────┤
│  UI Layer    │     Engine Layer         │  Persistence   │
│  Vue 3 +     │  Pure TypeScript         │  IndexedDB +   │
│  Pinia       │                          │  localStorage  │
│              │  Game Orchestrator       │                │
│  4 Views     │  ├─ 8 Pipeline Stages    │  IDB Stores:   │
│  18 Panels   │  └─ 9+ Sub-Pipelines    │  - Saves       │
│  50+ Comps   │                          │  - Vectors     │
│              │  State Manager           │  - Configs     │
│              │  Memory Manager (4-tier) │  - Prompts     │
│              │  Engram (knowledge graph)│                │
│              │  Prompt Assembler        │  localStorage:  │
│              │  Image Service           │  - API keys    │
│              │  Plot Direction          │  - Settings    │
├──────────────┴──────────────────────────┴────────────────┤
│               AI Service Layer                           │
│  OpenAI | Anthropic | Ollama | SiliconFlow | Custom      │
│  Functions: LLM | Embedding | Rerank | Image Gen        │
└──────────────────────────────────────────────────────────┘
```

**Key design principles:**
- **Engine/Content Separation** -- Engine code never contains game-specific content. All game data flows through the Game Pack system.
- **Reactive State Tree** -- All game state lives in a single reactive object, modified via dot-path commands from AI.
- **Pipeline Architecture** -- Each game round flows through 8 sequential stages with fail-soft error handling.
- **Progressive Memory** -- 4-tier memory system with automatic compression and semantic knowledge graph.

---

## Home Screen

The entry point of the application.

| Button | Action |
|--------|--------|
| **新建角色** | Opens character creation wizard |
| **继续游戏** | Loads most recent save, enters game |
| **管理存档** | Opens save management view |
| **API 配置** | Opens API configuration modal |
| **设置** | Opens settings modal |
| **云存档** | GitHub cloud sync modal |

Below the buttons, all existing character profiles are shown as cards sorted by most recent save. Click a card to load that character.

---

## Character Creation

A multi-step wizard defined by the Game Pack.

| Step | Type | What you do |
|------|------|-------------|
| 1 | Select One | Pick a world setting |
| 2 | Select One | Pick character origin/background |
| 3 | Select Many | Choose talents (point budget) |
| 4 | Point Allocation | Distribute attribute points |
| 5 | Form | Enter name, gender, age |
| 6 | Confirmation | Review choices, toggle streaming/split-gen |

**AI Preset Generation:** On supported steps, click **AI 生成** to have the AI create a custom preset from your text prompt. Custom presets persist across sessions.

**Finalization:** Clicking **开始游戏** triggers AI to generate the world description and opening scene, then enters the game.

---

## Main Game Interface

The primary gameplay screen.

### Layout

1. **Status Bar** -- Round counter, weather, environment chips, AI indicator
2. **Message History** -- Scrollable narrative with round dividers
3. **Action Options** -- AI-suggested next actions (collapsible)
4. **Input Area** -- Text input + send button

### Gameplay Cycle

1. Type your action (or click an action option to populate it)
2. Press Enter to submit
3. AI generates narrative (streamed in real-time)
4. AI commands execute automatically (location, items, NPC state)
5. Action options appear for the next turn

### Narrative Formatting

- **【环境】** -- Stage directions (italic, muted)
- **\`心理\`** -- NPC inner thoughts (italic, sage)
- **"对话"** -- Dialogue (warm amber)
- **〖判定〗** -- Judgement cards with success/failure indicators and stats

### Round Dividers

Between rounds, dividers show: round number, token metrics, duration. Hover to reveal buttons:
- 🌐 View AI thinking (CoT)
- ☰ View commands and state changes
- ⮂ View raw AI response
- 🧠 View Engram knowledge graph activity

### Controls

| Control | Action |
|---------|--------|
| Enter | Send action (Shift+Enter for newline) |
| Action option click | Populate input (does not auto-send) |
| Cancel button | Abort current AI generation |
| 回退 (Rollback) | Revert to state before previous round |

---

## Sidebar Navigation

### Left Sidebar

Floating panel with navigation tabs in 3 groups:

- **游戏:** Main Panel, Character, Inventory, Relationships, Map, Plot
- **记忆:** Memory, Events, Heartbeat
- **系统:** Variables, AI Assistant, Prompts, API, Settings, Save, Prompt Assembly, Image, Engram Debug

Features: real-time clock, collapse/expand, exit dialog with save options.

### Right Sidebar

At-a-glance character vitals:
- Identity card (name, occupation, location)
- Health + Energy bars (color-coded)
- Reputation tier
- Status effects (hover for details)
- 6 core attributes (progress bars)
- Quick save/export buttons

---

## Character Details

Tabbed character sheet:

| Tab | Content |
|-----|---------|
| **基础** | Name, age, gender, occupation, origin, talents |
| **属性** | Innate stats (baseline) + current stats (with bars) |
| **关系** | NPC relationship cards with affinity |
| **成就** | Achievement list |
| **身体** | Body measurements, sensitivity/development stats (NSFW) |
| **主角生图** | Generate portraits, manage visual anchors |

Double-click editable fields for inline editing.

---

## Inventory

| Feature | Description |
|---------|-------------|
| Currency bar | Cash, Gold, Silver, Copper display |
| Search + filter | By name, description, or item type |
| Item cards | Name, quality badge, description, quantity |
| Actions | Use, Equip/Unequip, Drop (on card click) |
| Quality tiers | Common (green) -> Uncommon (sage) -> Rare (amber) -> Legendary (red) |

---

## Relationships & NPC System

Master-detail interface for managing NPC relationships.

### Left Roster
- Search bar, 7 sort modes (initial, affinity, gender, importance, interaction, location, presence)
- NPC cards with avatar, name, affinity, location, presence badge

### Right Detail Pane
- Hero header with action buttons: mark present/absent, set important, follow, private chat, edit, AI edit, generate image
- Biography, personality traits, inner thoughts, current activity
- Recent conversations (last 8 messages)
- Shared memory timeline
- Portrait gallery

### NPC Private Chat
Click **💬 私聊** for a 1-on-1 chat with an NPC using a separate AI call outside the main round.

### NPC Editor
Full modal editor for all NPC fields including basic info, descriptions, personality traits, memories, NSFW details, body parts, and flags.

---

## World Map

Interactive Cytoscape.js map:

| Interaction | Effect |
|-------------|--------|
| Click node | Select, show detail panel |
| Double-click parent | Drill into subtree |
| Double-click background | Pop back one level |
| Scroll | Zoom (0.15x-6x) |
| Drag | Pan |
| Hover | Tooltip |

**Visual indicators:** Explored (solid green), Partial (dashed yellow), Unexplored (faded), Player (red pulse).

**Detail panel** shows: name, exploration status, description, NPCs present, child locations.

---

## Memory System

4-tier progressive memory:

| Tier | Capacity | What it stores | Promotion trigger |
|------|----------|----------------|-------------------|
| Short-term | 5 entries | Raw narrative text | FIFO overflow |
| Implicit mid-term | Paired 1:1 | AI-structured summary | Promoted with short-term |
| Mid-term | Refine at 25 | Deduplicated summaries | AI compression |
| Long-term | Cap 30 | Worldview evolution | AI summarization |

**Memory Panel** has 3 tabs: memory list (4 collapsible tiers), narrative history (full log), configuration (read-only thresholds).

**Narrative Export:** Download complete story as `.txt` file.

---

## Engram Knowledge Graph

Semantic knowledge graph (V2, Graphiti-aligned):

- **Events** -- Per-round narrative records with mentioned entities
- **Entities** -- Player, NPC, location, item nodes with summaries
- **Fact Edges** -- Complete natural-language sentences connecting two entities (with embeddings)
- **Retrieval** -- 3-scope parallel: Edge + Entity + Event, each using Cosine + BM25, merged via RRF, with BFS expansion

### Debug Panel Features

- Statistics, embedding progress bars (events/entities/edges)
- Per-item lists with round info, mention counts, fact text, invalidation status
- Interactive knowledge graph visualization with filters (round range, node types, edge types, layout)
- Click-to-highlight neighborhood, hover tooltips
- Retrieval snapshot with candidate scores

### Entity Repair

Two-tier system for handling missing entities referenced by fact edges:
- **Tier 1 (same round, zero API cost):** Auto-create entity stubs with type inference
- **Tier 2 (next round, AI call):** Fill in descriptions; mark cleared only on success; retries until complete

---

## Image Generation

8-tab interface:

| Tab | Purpose |
|-----|---------|
| **手动生成** | Character generation (composition, style, backend, size) |
| **图库** | Per-NPC image gallery |
| **场景壁纸** | Scene wallpaper generation |
| **队列** | Active/pending tasks |
| **历史** | All past generations (filterable) |
| **预设** | Artist presets + PNG metadata import |
| **规则** | Auto-generation triggers |
| **设置** | Default backend, transformer toggle |

**Supported backends:** NovelAI, OpenAI DALL-E, SD-WebUI, ComfyUI

**Character anchors:** AI-extracted visual prompts per character for consistent generation.

---

## Plot Direction

Structure AI narrative with plot arcs, waypoint nodes, and gauges.

### Arcs
High-level story directions with status (Draft -> Active -> Completed/Abandoned).

### Nodes
Waypoints in the arc chain with: title, narrative goal, AI directive, completion signal, importance (critical/skippable), max rounds.

### Gauges
Numeric progress meters (e.g., "suspicion level") that AI can update each round. Used as completion conditions.

### AI Evaluation
Each round, AI evaluates plot progress with confidence scores, evidence text, and streak tracking. Critical nodes require manual player confirmation.

---

## Prompt Management

| Tab | Content |
|-----|---------|
| **内置提示词** | All prompt modules (enable/disable, weight 1-10, edit, reset, export) |
| **游戏设定** | Narrative perspective, word count, story style, NoControl, action options |
| **剧情规划** | Character entries, interaction events, stage progression |

Prompts use `{{VARIABLE}}` placeholders filled at runtime (20+ context variables).

---

## Game Variable Editor

Direct state tree access:
- Breadcrumb navigation, tree view, field list
- Search across all paths and values
- Inline editing (double-click), boolean toggles, JSON modal for complex objects
- Reset to defaults, statistics, full JSON export

---

## API Management

### Configuration
Each API: name, category (LLM/Embedding/Rerank/Image), provider, URL, key, model, temperature, max tokens.

### Usage Assignments
20+ usage types independently assigned: main round, CoT, body polish, world gen, memory summary, NPC chat, plot decompose, privacy repair, field repair, image gen, embedding, rerank, assistant, etc.

### Testing
Connection test with latency display. Model list fetching from API.

---

## Settings

12 categories:

| Category | Key Settings |
|----------|-------------|
| NSFW | Adult content toggle, gender filter |
| AI Features | CoT, body polish, heartbeat, NPC chat, field repair, plot, image gen |
| UI | Font size, theme color, animations |
| Game | Auto-save interval, language |
| Action Options | Mode (action/story), pace, custom prompt |
| Heartbeat | History limit, forget rounds |
| NPC | Demotion threshold, generation range |
| Plot | Enable, confidence threshold, tier, gauges |
| Advanced | Debug mode, logging, text replacement rules |
| Scale | UI zoom (80-120%), text speed |
| Data | Export/import saves, clear all data |
| Memory | Tier thresholds, injection style |

**Engram section:** Enable/disable, retrieval mode, vector config, reranking, trimming, fact edges, debug.

---

## Save & Backup

| Feature | Description |
|---------|-------------|
| Auto-save | After every round (configurable) |
| Manual save | Right sidebar or top bar button |
| Rollback | Revert to pre-round state |
| Single export | Download one save as `.json` |
| Single import | Upload a save file |
| Full backup | All profiles + saves + vectors + configs + prompts + settings + images |
| Full restore | Atomic restore with rollback on failure |
| Cloud sync | GitHub-based upload/download |
| Demo import | Convert legacy demo format |

---

## Engine Pipeline

Each round: 8 stages + post-round sub-pipelines.

```
User Input → PreProcess → ContextAssembly → AICall → ResponseRepair
    → BodyPolish → ReasoningIngest → CommandExecution → PostProcess

Post-round (conditional):
  Memory Summary | Mid-Term Refine | Long-Term Compact
  World Heartbeat | Plot Evaluation | NPC Generation
  Privacy Repair | Field Repair + Entity Enrichment + Edge Review
  Auto Image Generation
```

**Error handling:** Pipeline errors trigger automatic rollback. Sub-pipeline errors are caught individually. Commands fail softly.

---

## Game Pack System

All game content delivered through modular packs:

```
packs/{packId}/
├── manifest.json           # Metadata + file references
├── schemas/state-schema.json
├── creation-flow.json      # Character creation steps
├── prompt-flows/*.json     # Prompt composition configs
├── prompts/*.md            # Prompt content with {{variables}}
├── presets/*.json          # World/origin/talent data
└── rules/*.json            # Engine paths, required fields, behaviors
```

The engine is content-agnostic -- swap the pack to change the entire game world.

---

## Development

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check + production build |
| `npm test` | Run test suite |
| `npm run test:coverage` | Coverage report |
| `npm run typecheck` | Type checking only |

### Project Structure

```
src/
├── engine/           # Pure TypeScript (no Vue)
│   ├── core/         # StateManager, CommandExecutor, Orchestrator
│   ├── ai/           # AIService, ResponseParser
│   ├── memory/       # 4-tier memory + Engram subsystem
│   ├── pipeline/     # 8 stages + 9 sub-pipelines
│   ├── prompt/       # Assembler, Registry, TemplateEngine
│   ├── persistence/  # Save/Profile/Backup managers
│   ├── image/        # Image generation providers
│   ├── plot/         # Plot direction system
│   └── behaviors/    # Time, effects, NPC behavior
├── ui/
│   ├── views/        # 4 views (Home, Creation, Game, Management)
│   ├── components/   # 50+ components
│   └── composables/  # Vue composables
└── main.ts           # 10-stage bootstrap
```

### Deployment

GitHub Actions: push to `main` -> test -> typecheck -> build -> deploy to GitHub Pages.

### Design Philosophy

UI follows **Polanyi's Tacit Knowledge** principles: users understand the interface through intuition, not instruction. Visual aesthetic: dark sanctuary theme with sage/amber accents and CJK serif typography.
