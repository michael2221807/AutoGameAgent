<div align="center">

[English](README.md) | **中文**

<img src="public/favicon.svg" alt="AutoGameAgent" width="80" />

# AutoGameAgent

**AI 驱动的交互式叙事游戏引擎**

用大语言模型构建沉浸式、持久化的故事世界。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Pinia](https://img.shields.io/badge/Pinia-2-FFD859?logo=vuedotjs&logoColor=black)](https://pinia.vuejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

---

一个运行在浏览器中的游戏引擎，利用大语言模型（Claude、GPT、Ollama 等）生成丰富的叙事体验。支持持久化世界状态、深度角色系统和语义记忆。玩家可以创建角色、探索 AI 生成的世界、与 NPC 建立关系，并通过自然语言塑造涌现式故事。

### [立即游玩 &rarr; michael2221807.github.io/AutoGameAgent](https://michael2221807.github.io/AutoGameAgent/)

无需安装，自带 API Key 即可秒开。

---

[快速开始](#快速开始) ·
[功能特性](#功能特性) ·
[系统架构](#系统架构) ·
[Game Pack 系统](#game-pack-系统) ·
[开发指南](#开发指南) ·
[开源协议](#开源协议)

</div>

---

## 快速开始

### 在线游玩（推荐）

访问 **[michael2221807.github.io/AutoGameAgent](https://michael2221807.github.io/AutoGameAgent/)**，按以下步骤操作：

1. 在主页点击 **API 配置**
2. 添加至少一个 LLM API（OpenAI、Anthropic、Ollama、SiliconFlow 等），并将其分配给 `main` 用途类型
3. 点击 **新建角色** 创建你的第一个角色
4. 跟随创建向导，然后点击 **开始游戏**

> 所有数据均存储在本地浏览器中（IndexedDB + localStorage），不会发送到任何服务器。

### 本地运行

```bash
git clone https://github.com/michael2221807/AutoGameAgent.git
cd AutoGameAgent
npm install
npm run dev
```

---

## 功能特性

### 叙事引擎

- **8 阶段流水线** &mdash; 每个游戏回合依次经过 PreProcess、ContextAssembly、AICall、ResponseRepair、BodyPolish、ReasoningIngest、CommandExecution、PostProcess
- **实时流式输出** &mdash; AI 叙事逐 token 流式呈现，实时格式化
- **富文本格式** &mdash; 环境描写、内心独白、对话、判定检定各有独立视觉样式
- **回退** &mdash; 可回退到任意上一回合的状态

### 世界与角色

- **响应式状态树** &mdash; 所有游戏状态存储在单一响应式对象中，由 AI 通过 dot-path 指令修改
- **角色创建向导** &mdash; 多步骤、由 Game Pack 定义的创建流程，支持 AI 预设生成
- **深度 NPC 系统** &mdash; 传记、性格、关系、一对一私聊、肖像生成、AI 辅助编辑
- **交互式世界地图** &mdash; 基于 Cytoscape.js 的图谱，支持下钻、探索状态和空间导航

### 记忆与知识

- **4 层渐进式记忆** &mdash; 短期、隐式中期、中期、长期，自动 AI 压缩
- **Engram 知识图谱** &mdash; 对齐 Graphiti 架构的语义图谱，包含实体、事实边和混合检索（Cosine + BM25 + RRF + BFS 扩展）
- **实体修复** &mdash; 两层系统自动创建缺失实体桩并通过 AI 充实内容

### 剧情编排

- **故事弧线与节点** &mdash; 通过弧线、节点和完成信号构建叙事结构
- **进度仪表** &mdash; AI 每回合更新的数值计量器（如"怀疑度"）
- **AI 评估** &mdash; 每回合置信度评分，附带证据文本和连续达标追踪

### 图像生成

- **多后端支持** &mdash; NovelAI、OpenAI DALL-E、SD-WebUI、ComfyUI
- **角色视觉锚点** &mdash; AI 为每个角色提取视觉提示词，保证生成一致性
- **场景壁纸** &mdash; AI 生成与叙事匹配的背景图
- **自动生成规则** &mdash; 可配置的自动图像生成触发条件

### 存档与持久化

- **自动存档** &mdash; 每回合可配置间隔自动保存
- **完整备份** &mdash; 所有存档、向量、配置、提示词、设置和图片打包为单一分块压缩包，SHA-256 双层校验
- **云同步** &mdash; 基于 GitHub 的上传/下载
- **Demo 导入** &mdash; 转换旧版格式

---

## 系统架构

```
+----------------------------------------------------------+
|                     Browser (SPA)                        |
+---------------+--------------------------+---------------+
|  UI 层        |     引擎层               |  持久化层     |
|  Vue 3 +      |  纯 TypeScript           |  IndexedDB +  |
|  Pinia        |                          |  localStorage |
|               |  Game Orchestrator       |               |
|  4 视图       |  +-- 8 流水线阶段        |  IDB 存储:    |
|  18 面板      |  +-- 9+ 子流水线         |  - 存档       |
|  50+ 组件     |                          |  - 向量       |
|               |  状态管理器              |  - 配置       |
|               |  记忆管理器 (4层)        |  - 提示词     |
|               |  Engram (知识图谱)       |               |
|               |  提示词组装器            |  localStorage: |
|               |  图像服务                |  - API 密钥   |
|               |  剧情编排                |  - 设置       |
+---------------+--------------------------+---------------+
|               AI 服务层                                  |
|  OpenAI | Anthropic | Ollama | SiliconFlow | 自定义      |
|  功能: LLM | Embedding | Rerank | 图像生成              |
+----------------------------------------------------------+
```

**核心设计原则：**

- **引擎/内容分离** &mdash; 引擎代码不包含任何游戏特定内容；所有游戏数据通过 Game Pack 系统流入
- **响应式状态树** &mdash; 单一响应式对象，由 AI 通过 dot-path 指令修改
- **流水线架构** &mdash; 8 个顺序阶段，带容错处理
- **渐进式记忆** &mdash; 4 层记忆系统，自动压缩与语义知识图谱

---

## Game Pack 系统

所有游戏内容通过模块化 Pack 交付。引擎与内容无关 &mdash; 更换 Pack 即可切换整个游戏世界。

```
packs/{packId}/
+-- manifest.json              # 元数据 + 文件引用
+-- schemas/state-schema.json
+-- creation-flow.json         # 角色创建步骤
+-- prompt-flows/*.json        # 提示词组合配置
+-- prompts/*.md               # 提示词内容，含 {{变量}}
+-- presets/*.json             # 世界/出身/天赋数据
+-- rules/*.json               # 引擎路径、必填字段、行为规则
```

---

## 开发指南

| 命令 | 用途 |
|------|------|
| `npm run dev` | 开发服务器，支持 HMR（局域网可访问） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm test` | 运行测试套件 |
| `npm run test:coverage` | 覆盖率报告 |
| `npm run typecheck` | 仅类型检查 |

### 项目结构

```
src/
+-- engine/           # 纯 TypeScript 引擎（无 Vue 依赖）
|   +-- core/         # StateManager, CommandExecutor, Orchestrator
|   +-- ai/           # AIService, ResponseParser
|   +-- memory/       # 4 层记忆 + Engram 子系统
|   +-- pipeline/     # 8 阶段 + 9 子流水线
|   +-- prompt/       # Assembler, Registry, TemplateEngine
|   +-- persistence/  # Save/Profile/Backup 管理器
|   +-- image/        # 图像生成 Provider
|   +-- plot/         # 剧情编排系统
|   +-- behaviors/    # 时间、效果、NPC 行为
+-- ui/
|   +-- views/        # 4 视图（Home, Creation, Game, Management）
|   +-- components/   # 50+ 组件
|   +-- composables/  # Vue composables
+-- main.ts           # 10 阶段启动引导
```

### 部署

推送到 `main` 分支自动触发：test &rarr; typecheck &rarr; build &rarr; 部署到 GitHub Pages。

---

## 支持的 AI 提供商

| 提供商 | LLM | Embedding | Rerank | 图像 |
|--------|:---:|:---------:|:------:|:----:|
| OpenAI / 兼容 | Yes | Yes | &mdash; | Yes (DALL-E) |
| Anthropic | Yes | &mdash; | &mdash; | &mdash; |
| Ollama | Yes | Yes | &mdash; | &mdash; |
| SiliconFlow | Yes | Yes | Yes | &mdash; |
| NovelAI | &mdash; | &mdash; | &mdash; | Yes |
| SD-WebUI | &mdash; | &mdash; | &mdash; | Yes |
| ComfyUI | &mdash; | &mdash; | &mdash; | Yes |
| 自定义端点 | Yes | Yes | Yes | Yes |

---

## 参与贡献

欢迎贡献代码。请先开 issue 讨论你想做的改动。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/my-feature`)
3. 提交你的改动
4. 推送到分支 (`git push origin feature/my-feature`)
5. 发起 Pull Request

---

## 开源协议

本项目基于 **GNU Affero General Public License v3.0** 开源 &mdash; 详见 [LICENSE](LICENSE) 文件。

这意味着：
- 你可以自由使用、修改和分发本软件
- 如果你修改并将本软件部署为网络服务，你必须以相同协议开源你的源代码
- 所有衍生作品也必须使用 AGPL-3.0 协议

---

<div align="center">

Made with persistence and late-night sessions.

</div>
