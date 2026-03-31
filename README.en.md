# Vibe Pencil

[中文](README.md) | **English**

Design software architecture on a canvas, discuss it with AI, and generate code in one click.

**Target users**: People with product thinking who cannot code — PMs, founders, designers — who want to turn system diagrams directly into working code without writing a single line themselves.

---

## Core Workflow

```
Design Canvas ──→ AI Discussion ──→ Build All ──→ Code Generated
Drag containers    Discuss & iterate   Wave scheduling   Local AI CLI runs
```

1. **Design** — Drag Containers (service groups) and Blocks (components) onto the canvas. Connect them with typed edges to describe dependencies. Or import an existing codebase — Vibe Pencil reverse-engineers it into an architecture canvas automatically.
2. **Discuss** — Open the chat panel and talk to the AI about architecture tradeoffs, implementation order, or missing pieces. The AI can propose canvas mutations (add/update/remove nodes and edges) that you apply with one click. Three-phase session workflow: brainstorm (gather requirements) → design (generate architecture) → iterate (refine).
3. **Build** — Click "Build All". The canvas is topologically sorted into parallel waves, serialized to YAML, and dispatched to your local AI CLI tool. Build progress streams back in real time via SSE.

---

## System Architecture

![System Architecture](docs/arch-system.png)

## Build Flow

![Build Flow](docs/arch-build-flow.png)

## Canvas Model

![Canvas Model](docs/arch-canvas-model.png)

---

## Features

### Canvas & Design

| Feature | Description |
|---|---|
| Container + Block two-layer model | Service-group containers with inner component blocks; elkjs compound layout auto-arranges |
| Resizable containers | Resize handle appears on selection; drag to resize freely |
| 8-direction smart handles | Position-aware edge routing picks the optimal handle pair automatically |
| Typed edges | `sync` (HTTP/gRPC) / `async` (message queue) / `bidirectional` (WebSocket) |
| Undo / Redo | 50-step snapshot stack, `Ctrl+Z` / `Ctrl+Shift+Z` |
| Session-canvas binding | Switching chat sessions auto-saves and restores the corresponding canvas state |

### AI Chat & Workflow

| Feature | Description |
|---|---|
| AI chat | Discuss architecture with AI; AI can directly mutate the canvas (canvas-action) |
| Three-phase session workflow | brainstorm → design → iterate, progressively advancing the project |
| Context Engineering | 7-layer context stack, 2-agent architecture (Canvas Agent + Build Agent) |
| Chat-Build coupling | Chat agent receives live build status; build events are injected into the conversation |
| Markdown rendering | Syntax-highlighted code blocks, GFM tables, inline code |
| Auto-generated session titles | AI summarizes a session title after the first exchange |
| Auto-generated project names | Inferred from architecture content |

### Build System

| Feature | Description |
|---|---|
| Build All | Topological sort → parallel wave scheduling, maximizing concurrency |
| Three AI backends | Claude Code / Codex / Gemini CLI, switchable per project |
| Skill system | 15+ built-in skills + GitHub import + local import; auto-matched by techStack |
| Post-build hooks | Skills can define commands to auto-run after generation (lint, test, etc.) |
| Build progress panel | Real-time wave progress, node animations, witty loading messages |
| Build state resumption | Page refresh recovers in-flight build state automatically |
| SSE real-time stream | Server-Sent Events push build output and status changes as they happen |

### Import / Export

| Feature | Description |
|---|---|
| Two-phase import | Instant skeleton scan + background AI enrichment — reverse-engineers any codebase |
| 9 export formats | YAML / JSON / PNG / Mermaid / Markdown / session backup / project archive / clipboard |

### Other

- **Bilingual i18n** — Chinese and English
- **Inline progress** — StatusBar embeds auto-calculated build progress
- **Auto-save** — Project persists to local workspace automatically

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Canvas | React Flow (`@xyflow/react` v12) |
| Layout engine | elkjs (compound layout) |
| Styling | Tailwind CSS v4 |
| State management | Zustand v5 |
| Streaming | Server-Sent Events (SSE) |
| Agent execution | Node.js `child_process.spawn` |
| Markdown | react-markdown + rehype-highlight + remark-gfm |
| YAML serialization | `yaml` v2 |
| Tests | Vitest v4 + Testing Library |
| Language | TypeScript |

---

## Quick Start

**Prerequisites**: Node.js 20+

```bash
git clone https://github.com/URaux/vibe-pencil.git
cd vibe-pencil
npm install
npm run dev        # http://localhost:3000
```

**Tests**:
```bash
npm test           # run all tests once
npx vitest         # watch mode
```

**Install AI CLI tools** (choose one or more):
```bash
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @openai/codex               # Codex
npm install -g @google/gemini-cli          # Gemini CLI
```

---

## API Reference

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agent/spawn` | Spawn a single agent or kick off a full BuildAll wave plan |
| `GET` | `/api/agent/status` | Poll status for a given `agentId` |
| `GET` | `/api/agent/stream` | SSE stream of all agent events (status, output, waves) |
| `POST` | `/api/agent/stop` | Kill a running agent |
| `GET` | `/api/agent/build-state` | Retrieve persisted build state for reconnection |
| `POST` | `/api/chat` | SSE streaming chat with canvas context |
| `GET` | `/api/models` | Model list for a given backend |
| `POST` | `/api/project/save` | Save project to disk |
| `POST` | `/api/project/load` | Load project from disk |
| `POST` | `/api/project/scan` | Two-phase import: skeleton scan |
| `POST` | `/api/project/import` | Two-phase import: AI enrichment pass |
| `GET` | `/api/skills/list` | List all available skills |
| `POST` | `/api/skills/add` | Import a skill from GitHub URL or local path |
| `POST` | `/api/skills/resolve` | Match the best skill for a given techStack |
| `POST` | `/api/build/read-files` | Read build artifact files (post-build hooks) |

---

## Architecture Overview

```
User
 │
 ├─ Canvas (Container + Block) ───────────────────────────┐
 │   └─ elkjs auto-layout                                  │
 │                                                         │
 ├─ AI Chat (ChatSidebar)                                  │
 │   ├─ Context Engine (7-layer stack)                     │
 │   ├─ Three-phase workflow (brainstorm / design / iterate)│
 │   └─ canvas-action → one-click apply to canvas ────────┤
 │                                                         │
 └─ Build All (AgentRunner)                                │
     ├─ Topological sort → wave scheduling                 │
     ├─ Skill system (techStack matching)                  │
     ├─ Claude Code / Codex / Gemini CLI                   │
     ├─ SSE real-time progress                             │
     └─ BuildSummary → feeds back into Canvas Agent ───────┘
```

---

## License

MIT
