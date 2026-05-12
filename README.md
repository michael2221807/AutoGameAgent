<div align="center">

<img src="public/favicon.svg" alt="AutoGameAgent" width="80" />

# AutoGameAgent

**AI-driven interactive narrative game engine**

Build immersive, persistent story worlds powered by large language models.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Pinia](https://img.shields.io/badge/Pinia-2-FFD859?logo=vuedotjs&logoColor=black)](https://pinia.vuejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

---

A browser-based game engine that uses LLMs (Claude, GPT, Ollama, etc.) to generate rich narrative experiences with persistent world state, deep character systems, and semantic memory. Players create characters, explore AI-generated worlds, build relationships with NPCs, and shape emergent stories through natural language.

[Getting Started](#getting-started) ·
[Features](#features) ·
[Architecture](#architecture) ·
[Game Pack System](#game-pack-system) ·
[Development](#development) ·
[License](#license)

</div>

---

## Getting Started

```bash
git clone https://github.com/michael2221807/AutoGameAgent.git
cd AutoGameAgent
npm install
npm run dev
```

**First-time setup:**

1. Open the app in your browser
2. Click **API Configuration** on the home screen
3. Add at least one LLM API (OpenAI, Anthropic, Ollama, SiliconFlow, etc.) and assign it to the `main` usage type
4. Click **New Character** to create your first character
5. Follow the creation wizard, then click **Start Game**

---

## Features

### Narrative Engine

- **8-stage pipeline** &mdash; each game round flows through PreProcess, ContextAssembly, AICall, ResponseRepair, BodyPolish, ReasoningIngest, CommandExecution, and PostProcess
- **Real-time streaming** &mdash; AI narration streams token-by-token with live formatting
- **Rich formatting** &mdash; environment descriptions, inner thoughts, dialogue, and skill checks each have distinct visual styles
- **Rollback** &mdash; revert to the state before any previous round

### World & Characters

- **Reactive state tree** &mdash; all game state lives in a single reactive object, modified via dot-path commands from AI
- **Character creation wizard** &mdash; multi-step, Game-Pack-defined creation flow with AI preset generation
- **Deep NPC system** &mdash; biography, personality, relationships, private 1-on-1 chat, portrait generation, AI-driven editing
- **Interactive world map** &mdash; Cytoscape.js graph with drill-down, exploration status, and spatial navigation

### Memory & Knowledge

- **4-tier progressive memory** &mdash; short-term, implicit mid-term, mid-term, and long-term with automatic AI compression
- **Engram knowledge graph** &mdash; Graphiti-aligned semantic graph with entities, fact edges, and hybrid retrieval (Cosine + BM25 + RRF + BFS expansion)
- **Entity repair** &mdash; two-tier system auto-creates missing entity stubs and enriches them via AI

### Plot Direction

- **Story arcs & waypoints** &mdash; structure narrative with arcs, nodes, and completion signals
- **Progress gauges** &mdash; numeric meters AI updates each round (e.g., suspicion level)
- **AI evaluation** &mdash; per-round confidence scoring with evidence and streak tracking

### Image Generation

- **Multi-backend** &mdash; NovelAI, OpenAI DALL-E, SD-WebUI, ComfyUI
- **Character anchors** &mdash; AI-extracted visual prompts per character for consistency
- **Scene wallpapers** &mdash; AI-generated backgrounds that match the narrative
- **Auto-generation rules** &mdash; configurable triggers for automatic image generation

### Persistence

- **Auto-save** &mdash; configurable interval after every round
- **Full backup** &mdash; all profiles, saves, vectors, configs, prompts, settings, and images in a single chunked bundle with SHA-256 integrity verification
- **Cloud sync** &mdash; GitHub-based upload/download
- **Demo import** &mdash; convert legacy formats

---

## Architecture

```
+----------------------------------------------------------+
|                     Browser (SPA)                        |
+---------------+--------------------------+---------------+
|  UI Layer     |     Engine Layer         |  Persistence  |
|  Vue 3 +      |  Pure TypeScript         |  IndexedDB +  |
|  Pinia        |                          |  localStorage |
|               |  Game Orchestrator       |               |
|  4 Views      |  +-- 8 Pipeline Stages   |  IDB Stores:  |
|  18 Panels    |  +-- 9+ Sub-Pipelines    |  - Saves      |
|  50+ Comps    |                          |  - Vectors    |
|               |  State Manager           |  - Configs    |
|               |  Memory Manager (4-tier) |  - Prompts    |
|               |  Engram (knowledge graph)|               |
|               |  Prompt Assembler        |  localStorage: |
|               |  Image Service           |  - API keys   |
|               |  Plot Direction          |  - Settings   |
+---------------+--------------------------+---------------+
|               AI Service Layer                           |
|  OpenAI | Anthropic | Ollama | SiliconFlow | Custom      |
|  Functions: LLM | Embedding | Rerank | Image Gen        |
+----------------------------------------------------------+
```

**Key design principles:**

- **Engine / Content Separation** &mdash; engine code never contains game-specific content; all game data flows through the Game Pack system
- **Reactive State Tree** &mdash; single reactive object modified via dot-path commands from AI
- **Pipeline Architecture** &mdash; 8 sequential stages with fail-soft error handling
- **Progressive Memory** &mdash; 4-tier memory with automatic compression and semantic knowledge graph

---

## Game Pack System

All game content is delivered through modular packs. The engine is content-agnostic &mdash; swap the pack to change the entire game world.

```
packs/{packId}/
+-- manifest.json              # Metadata + file references
+-- schemas/state-schema.json
+-- creation-flow.json         # Character creation steps
+-- prompt-flows/*.json        # Prompt composition configs
+-- prompts/*.md               # Prompt content with {{variables}}
+-- presets/*.json             # World/origin/talent data
+-- rules/*.json               # Engine paths, required fields, behaviors
```

---

## Development

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with HMR (LAN accessible) |
| `npm run build` | Type-check + production build |
| `npm test` | Run test suite |
| `npm run test:coverage` | Coverage report |
| `npm run typecheck` | Type checking only |

### Project Structure

```
src/
+-- engine/           # Pure TypeScript engine (no Vue dependency)
|   +-- core/         # StateManager, CommandExecutor, Orchestrator
|   +-- ai/           # AIService, ResponseParser
|   +-- memory/       # 4-tier memory + Engram subsystem
|   +-- pipeline/     # 8 stages + 9 sub-pipelines
|   +-- prompt/       # Assembler, Registry, TemplateEngine
|   +-- persistence/  # Save/Profile/Backup managers
|   +-- image/        # Image generation providers
|   +-- plot/         # Plot direction system
|   +-- behaviors/    # Time, effects, NPC behavior
+-- ui/
|   +-- views/        # 4 views (Home, Creation, Game, Management)
|   +-- components/   # 50+ components
|   +-- composables/  # Vue composables
+-- main.ts           # 10-stage bootstrap
```

### Deployment

Push to `main` triggers: test &rarr; typecheck &rarr; build &rarr; deploy to GitHub Pages.

---

## Supported AI Providers

| Provider | LLM | Embedding | Rerank | Image |
|----------|:---:|:---------:|:------:|:-----:|
| OpenAI / compatible | Yes | Yes | &mdash; | Yes (DALL-E) |
| Anthropic | Yes | &mdash; | &mdash; | &mdash; |
| Ollama | Yes | Yes | &mdash; | &mdash; |
| SiliconFlow | Yes | Yes | Yes | &mdash; |
| NovelAI | &mdash; | &mdash; | &mdash; | Yes |
| SD-WebUI | &mdash; | &mdash; | &mdash; | Yes |
| ComfyUI | &mdash; | &mdash; | &mdash; | Yes |
| Custom endpoint | Yes | Yes | Yes | Yes |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** &mdash; see the [LICENSE](LICENSE) file for details.

This means:
- You are free to use, modify, and distribute this software
- If you modify and deploy this software as a network service, you must release your source code under the same license
- All derivative works must also be licensed under AGPL-3.0

---

<div align="center">

Made with persistence and late-night sessions.

</div>
