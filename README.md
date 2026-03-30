# Vibe Pencil

A visual architecture editor where users design software systems on a node-graph canvas, discuss the design with an AI assistant, and then generate code by dispatching the canvas to a local AI CLI tool (Claude Code, Codex, or Gemini CLI).

**Target users**: People with product thinking who cannot code — PMs, founders, designers — who want to turn system diagrams directly into working code without writing a single line themselves.

---

## What it does

1. **Design** — Drag containers and blocks onto a canvas, connect them with typed edges, and describe each component.
2. **Discuss** — Open the chat panel, select a node or stay in global mode, and have a conversation with the AI about tradeoffs, implementation order, or missing pieces. The AI can propose canvas mutations (add/update/remove nodes and edges) that the user can apply with one click.
3. **Build** — Click "Build All" to spawn agents. The canvas is serialized to YAML and passed as a prompt to the configured CLI tool. Agents run in parallel waves respecting the topological order of the graph.
4. **Import** — Reverse-engineer an existing codebase into an architecture canvas automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Node.js runtime) |
| Canvas | React Flow (`@xyflow/react` v12) |
| Layout | elkjs (compound layout) |
| Styling | Tailwind CSS v4 |
| State | Zustand v5 |
| Streaming | Server-Sent Events (SSE) via `ReadableStream` |
| Agent execution | Node.js `child_process.spawn` |
| YAML serialization | `yaml` v2 |
| Tests | Vitest v4 + Testing Library |

---

## Architecture

### Canvas — Container + Block Model

The canvas uses a two-layer node architecture:

| Type | Description |
|---|---|
| `container` | Grouping container (e.g., a microservice cluster, data layer). Has a color label and can be collapsed. |
| `block` | Individual component inside a container. Has name, description, status, and optional techStack. |

Blocks are bound to their parent container via React Flow's `parentId` + `extent: 'parent'`. The elkjs compound layout engine automatically arranges blocks within their containers.

**Edge types** (3):

| Type | Description |
|---|---|
| `sync` | Synchronous call (HTTP, gRPC, etc.) |
| `async` | One-way async message |
| `bidirectional` | Two-way communication (WebSocket, bidirectional stream) |

**8-direction handles**: Nodes expose handles on all 8 sides (top, bottom, left, right, and corners). Smart position-aware handle assignment picks the optimal handle pair based on relative node positions.

### SchemaEngine (`src/lib/schema-engine.ts`)

Converts between the live React Flow canvas and a YAML document that is fed to agents as context.

- `canvasToYaml(nodes, edges, projectName, selectedIds?)` — serializes the canvas (or a subgraph when `selectedIds` is provided) into a structured YAML document grouped by container.
- `yamlToCanvas(yamlStr)` — parses YAML back into React Flow nodes and edges with auto-assigned grid positions.

### AgentRunner (`src/lib/agent-runner.ts`)

A singleton `EventEmitter` that manages child processes for all three CLI backends.

**How each backend is spawned**:

| Backend | Command | Stdin |
|---|---|---|
| `claude-code` | `claude -p --output-format stream-json --verbose [--model X]` | prompt piped via stdin |
| `codex` | `codex exec --full-auto --json [--model X] -` | prompt piped via stdin |
| `gemini` (Windows) | `node <gemini-cli/dist/index.js> -p "<prompt>" -m <model>` | none |
| `gemini` (POSIX) | `gemini -p "<prompt>" -m <model>` | none |

**Build All** executes a topologically ordered wave plan via `buildAll(waves, prompts, backend, workDir, maxParallel, model?)`.

### Topological Sort (`src/lib/topo-sort.ts`)

Kahn's algorithm produces build waves — groups of nodes that can be built in parallel. Throws on cycle detection.

### Chat Sidebar (`src/components/ChatSidebar.tsx`)

Claude.ai-style session list with localStorage persistence. Each session maintains independent chat history. Sessions are sorted by last activity.

### Undo / Redo

50-step snapshot stack. `Ctrl+Z` / `Ctrl+Shift+Z`. Drag operations snapshot once at drag start to avoid per-frame snapshots.

---

## Features

- Container + Block two-layer architecture with elkjs compound layout
- 8-direction smart handles with position-aware edge routing
- Three AI backends: Claude Code, Codex, Gemini CLI
- Graph-aware parallel builds (topological sort → wave scheduling)
- SSE real-time streaming of build progress
- AI chat with "Apply to Canvas" mutations
- Chat sidebar with session management (Claude.ai style)
- Import existing codebase → auto-generate architecture canvas
- Export to YAML / JSON
- Undo / Redo (50 steps)
- i18n: Chinese / English
- Editable project name in status bar
- Auto-save to workspace
- Dev Progress Dashboard

---

## API Routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agent/spawn` | Spawn a single agent or kick off a full `buildAll` wave plan |
| `GET` | `/api/agent/status` | Poll status for a given `agentId` |
| `GET` | `/api/agent/stream` | SSE stream of all agent events |
| `POST` | `/api/agent/stop` | Kill a running agent |
| `POST` | `/api/chat` | SSE streaming chat with canvas context |
| `GET` | `/api/models` | Model list for a given backend |
| `POST` | `/api/project/save` | Save project to disk |
| `POST` | `/api/project/load` | Load project from disk |
| `POST` | `/api/project/import` | Reverse-engineer codebase into canvas |
| `POST` | `/api/dashboard/generate` | Generate dev progress dashboard |
| `POST` | `/api/dashboard/save` | Save dashboard data |
| `POST` | `/api/dashboard/load` | Load dashboard data |

---

## Development

**Prerequisites**: Node.js 20+, npm.

```bash
git clone https://github.com/URaux/vibe-pencil.git
cd vibe-pencil
npm install
npm run dev        # starts Next.js on http://localhost:3000
```

**Tests**:
```bash
npx vitest run     # run all tests once
npx vitest         # watch mode
```

**Required CLI tools** (install globally before using the respective backend):
- Claude Code: `npm install -g @anthropic-ai/claude-code`
- Codex: `npm install -g @openai/codex`
- Gemini CLI: `npm install -g @google/gemini-cli`

---

## License

MIT
