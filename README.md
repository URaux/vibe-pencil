# vibe-pencil

A visual architecture editor where users design software systems on a node-graph canvas, discuss the design with an AI assistant, and then generate code by dispatching the canvas to a local AI CLI tool (Claude Code, Codex, or Gemini CLI).

**Target users**: People with product thinking who cannot code — PMs, founders, designers — who want to turn system diagrams directly into working code without writing a single line themselves.

---

## What it does

1. **Design** — Drag nodes onto a canvas, connect them with typed edges, and name each component.
2. **Discuss** — Open the chat panel, select a node or stay in global mode, and have a conversation with the AI about tradeoffs, implementation order, or missing pieces. The AI can propose canvas mutations (add/update/remove nodes and edges) that the user can apply with one click.
3. **Build** — Click "Build All" or right-click a node to spawn an agent. The canvas is serialized to YAML and passed as a prompt to the configured CLI tool. Agents run in parallel waves respecting the topological order of the graph.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Node.js runtime) |
| Canvas | React Flow (`@xyflow/react` v12) |
| Styling | Tailwind CSS v4 |
| State | Zustand v5 |
| Streaming | Server-Sent Events (SSE) via `ReadableStream` |
| Agent execution | Node.js `child_process.spawn` |
| YAML serialization | `yaml` v2 |
| Tests | Vitest v4 + Testing Library |

---

## Architecture

### Canvas

The canvas is built on React Flow. Nodes and edges are stored in Zustand and wired to React Flow via `onNodesChange` / `onEdgesChange` / `onConnect` handlers.

**Node types** (6):

| Type | Description |
|---|---|
| `service` | Backend microservice or server-side worker |
| `frontend` | Web or mobile UI layer |
| `api` | API gateway or REST/GraphQL interface |
| `database` | Persistent data store |
| `queue` | Message broker or async queue |
| `external` | Third-party dependency outside the system boundary |

**Edge types** (3):

| Type | Description |
|---|---|
| `sync` | Synchronous call (HTTP, gRPC, etc.) |
| `async` | One-way async message |
| `bidirectional` | Two-way communication (WebSocket, bidirectional stream) |

Node data shape (`ArchitectNodeData`): `name`, `description`, `status` (`idle | building | done | error`), optional `summary` and `errorMessage`.

### SchemaEngine (`src/lib/schema-engine.ts`)

Converts between the live React Flow canvas and a YAML document that is fed to agents as context.

- `canvasToYaml(nodes, edges, projectName, selectedIds?)` — serializes the canvas (or a subgraph when `selectedIds` is provided, expanding transitively along edges) into a structured YAML document grouped by node type.
- `yamlToCanvas(yamlStr)` — parses a YAML document back into React Flow nodes and edges, auto-assigning positions in a grid layout.

YAML document shape:
```yaml
project: My App
nodes:
  services:
    - id: svc-1
      name: UserService
      description: Handles auth and profiles
      status: idle
  databases:
    - id: db-1
      name: Postgres
      description: Primary OLTP store
      status: idle
edges:
  - id: edge-1
    source: UserService
    sourceId: svc-1
    target: Postgres
    targetId: db-1
    type: sync
```

### AgentRunner (`src/lib/agent-runner.ts`)

A singleton `EventEmitter` that manages child processes for all three CLI backends. One instance is shared across API routes via `src/lib/agent-runner-instance.ts`.

**Key methods**:
- `spawnAgent(nodeId, prompt, backend, workDir, model?)` — spawns a single child process, returns `agentId`.
- `stopAgent(agentId)` — kills the child process.
- `buildAll(waves, prompts, backend, workDir, maxParallel, model?)` — executes a topologically ordered wave plan, running up to `maxParallel` agents concurrently within each wave.
- `getStatus(agentId)` — returns a snapshot of `AgentProcessInfo`.

**Events emitted**: `status` (running/done/error per agent), `output` (stdout/stderr chunk), `wave` (wave index started).

**How each backend is spawned**:

| Backend | Command | Stdin |
|---|---|---|
| `claude-code` | `claude -p --output-format stream-json --verbose [--model X]` | prompt piped via stdin |
| `codex` | `codex exec --full-auto [--model X] "<shell-quoted-prompt>"` | none |
| `gemini` (non-Windows) | `gemini -p "<prompt>" -m <model>` | none |
| `gemini` (Windows) | `node --no-warnings=DEP0040 <gemini-cli/dist/index.js> -p "<prompt>" -m <model>` | none |

On Windows, `shell: true` is the default for all backends except Gemini (which uses `shell: false` because it bypasses the `.ps1` wrapper and calls `node` directly). `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are deleted from the child environment so the CLI tools fall back to their own OAuth sessions rather than inheriting possibly-invalid proxy keys from the parent process.

**Output parsing** (`src/lib/agent-output.ts`): Claude Code emits newline-delimited JSON events; `extractAgentText` handles both NDJSON event streams (Claude's `stream-json` format) and plain text output (Codex, Gemini), extracting human-readable text from whichever format is present. `extractJsonObject` pulls the first valid JSON object out of mixed text, used by the import route.

### Topological Sort (`src/lib/topo-sort.ts`)

`topoSort(nodes, edges)` produces build waves — groups of nodes that can be built in parallel — by running a Kahn BFS over the reversed dependency graph (edges point from dependency to caller). Throws on cycles.

### ChatPanel (`src/components/ChatPanel.tsx`)

Per-node AI discussion. Each node (and the global canvas) has its own independent chat history stored in `chatHistories: Map<string, ChatMessage[]>` in Zustand.

Chat messages are sent to `POST /api/chat` which spawns an agent with a structured prompt that includes:
- The full canvas as YAML
- The selected node's name and description as context
- The full conversation history
- Instructions for the AI to emit `json:canvas-action` blocks when it wants to modify the canvas

The response streams back as SSE. The panel parses `canvas-action` code blocks from the assistant's reply and renders an "Apply to Canvas" button for each proposed mutation. Supported actions: `add-node`, `update-node`, `remove-node`, `add-edge`.

### Settings (`src/components/SettingsDialog.tsx`)

Configures:
- **Agent backend**: `claude-code` | `codex` | `gemini`
- **Model**: fetched from `GET /api/models?backend=X`; falls back to hardcoded lists if unavailable
- **Language**: `zh` (Chinese) | `en` (English)
- **Work directory**: absolute path where agents execute and write files
- **Max parallel**: 1–5 concurrent agents per wave

### i18n (`src/lib/i18n.ts`)

Simple key-value translation system. Two locales: `zh` (default) and `en`. Locale is stored in Zustand and persisted to a module-level variable for use in non-React contexts. `t(key, params?)` is the primary translation call.

### Prompt Templates (`src/lib/prompt-templates.ts`)

Five structured prompt builders used by build and import flows:
- `buildAll` — full project implementation plan
- `buildNode` — single selected node
- `buildSubgraph` — selected subgraph with dependency context
- `analyzeProject` — structural risk analysis (also used by the import route)
- `refactorNode` — refactor plan for a selected node set

All prompts embed the persona ("AI architecture consultant, first-principles, Occam's razor"), the canvas YAML, and canvas-action instructions when mutations are appropriate.

---

## API Routes

All routes use the Node.js runtime (`export const runtime = 'nodejs'`).

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/agent/spawn` | Spawn a single agent for a node, or kick off a full `buildAll` wave plan. Body: `SpawnAgentRequest` or `BuildAllRequest`. Returns `{ agentId }`. |
| `GET` | `/api/agent/status` | Poll status snapshot for a given `agentId`. Returns `AgentProcessInfo`. |
| `GET` | `/api/agent/stream` | SSE stream of all agent events (status changes, stdout/stderr output, wave transitions). Used by the `useAgentStatus` hook. |
| `POST` | `/api/agent/stop` | Kill a running agent by `agentId`. |
| `POST` | `/api/chat` | SSE streaming chat. Spawns an agent with a structured prompt; polls output every 125ms and pushes `chunk`, `done`, or `error` events. |
| `GET` | `/api/models` | Return model list for a given `backend`. Supports custom OpenAI-compatible providers via `baseUrl` + `apiKey` query params. Falls back to hardcoded lists. |
| `POST` | `/api/project/save` | Serialize and write `ArchitectProject` to `<dir>/vibe-pencil.json`. |
| `POST` | `/api/project/load` | Read and return `ArchitectProject` from `<dir>/vibe-pencil.json`. |
| `POST` | `/api/project/import` | Reverse-engineer an existing codebase into a canvas. Spawns an agent in the target directory, parses its JSON output, and returns normalized React Flow nodes and edges. Timeout: 5 minutes. |

---

## Key Files

```
src/
  app/
    api/
      agent/
        spawn/route.ts       — spawn single agent or buildAll wave plan
        status/route.ts      — poll agent status
        stream/route.ts      — SSE broadcast of all agent events
        stop/route.ts        — kill a running agent
      chat/route.ts          — SSE streaming chat with canvas context
      models/route.ts        — model list per backend
      project/
        save/route.ts        — persist project to disk
        load/route.ts        — load project from disk
        import/route.ts      — reverse-engineer codebase into canvas
    page.tsx                 — main app shell
    layout.tsx               — root HTML layout
  components/
    Canvas.tsx               — React Flow canvas, node drag/drop, context menu
    ChatPanel.tsx            — per-node AI chat, canvas-action apply
    BuildButton.tsx          — build all / build selected trigger
    SettingsDialog.tsx       — backend/model/language/workdir config
    ImportDialog.tsx         — import existing project dialog
    NodePalette.tsx          — left-panel node type list for drag-and-drop
    StatusBar.tsx            — save state, build wave progress
    ContextMenu.tsx          — right-click context menu on canvas
    nodes/
      BaseNode.tsx           — shared node UI (status badge, edit inline, etc.)
      ServiceNode.tsx        — service-type node
      FrontendNode.tsx       — frontend-type node
      ApiNode.tsx            — api-type node
      DatabaseNode.tsx       — database-type node
      QueueNode.tsx          — queue-type node
      ExternalNode.tsx       — external-type node
      nodeTypes.ts           — React Flow nodeTypes registry
    edges/
      SyncEdge.tsx           — solid arrow edge
      AsyncEdge.tsx          — dashed arrow edge
      BidirectionalEdge.tsx  — double-headed arrow edge
      edgeTypes.ts           — React Flow edgeTypes registry
  hooks/
    useAgentStatus.ts        — subscribes to /api/agent/stream SSE, updates node statuses
    useAutoSave.ts           — debounced auto-save to /api/project/save
    useBuildActions.ts       — orchestrates topo-sort + spawn for build all/selected
  lib/
    agent-runner.ts          — AgentRunner class (child_process management)
    agent-runner-instance.ts — singleton export shared across API routes
    agent-output.ts          — extract human text from mixed NDJSON/plain output
    config.ts                — clampMaxParallel helper
    i18n.ts                  — zh/en translations, t() helper
    prompt-templates.ts      — structured prompt builders
    project-store.ts         — read/write vibe-pencil.json on disk
    schema-engine.ts         — canvasToYaml / yamlToCanvas
    store.ts                 — Zustand app state
    topo-sort.ts             — Kahn BFS wave planner
    types.ts                 — shared TypeScript types
    ui-text.ts               — node type display labels
```

---

## Development

**Prerequisites**: Node.js 20+, npm.

```bash
cd E:/claude-workspace/vibe-pencil
npm install
npm run dev        # starts Next.js on http://localhost:3000
```

**Tests**:
```bash
npx vitest run     # run all tests once
npx vitest         # watch mode
```

**Build**:
```bash
npm run build
npm run start
```

**Required CLI tools** (install globally before using the respective backend):
- Claude Code: `npm install -g @anthropic-ai/claude-code` — must be authenticated via `claude auth`
- Codex: `npm install -g @openai/codex` — must be authenticated
- Gemini CLI: `npm install -g @google/gemini-cli` — must be authenticated via `gemini auth`

---

## Windows-Specific Notes

- **Gemini CLI**: On Windows, `gemini` is a `.ps1` PowerShell script that cannot be invoked by `cmd.exe` (which Node's `shell: true` uses). The AgentRunner detects `process.platform === 'win32'` and instead spawns `node` directly with the gemini-cli entry point resolved via `require.resolve('@google/gemini-cli/dist/index.js')` (local install) or falling back to the `NPM_GLOBAL_PATH` env var (default: `E:/tools/npm-global`). Set `NPM_GLOBAL_PATH` if your global npm prefix differs.
- **Shell quoting**: Codex receives the prompt as a shell argument. `shellQuote()` in `agent-runner.ts` uses double-quote escaping on Windows, single-quote escaping on POSIX. This is required because `shell: true` on Windows routes through `cmd.exe`.
- **`shell: true` default**: On Windows, `spawn` uses `shell: true` for all backends except Gemini (which uses `shell: false`). This allows `claude` and `codex` to be found on the PATH without specifying full binary paths.
- **PYTHONIOENCODING**: Not directly used by this app, but if you run Python-based agent tooling that outputs Unicode on Windows, set `PYTHONIOENCODING=utf-8` in your shell before starting the dev server.
- **Path separators**: The work directory field in Settings accepts both `\` and `/`. Agents receive the path verbatim as their `cwd`.
- **Next.js note** (`AGENTS.md`): This repo pins Next.js 16, which has breaking changes relative to earlier versions. Before modifying any App Router code, read the relevant guide in `node_modules/next/dist/docs/`. API conventions and file structure may differ from older Next.js training data.

---

## Known Issues / Pending Work

### Custom OpenAI-compatible provider
The `/api/models` endpoint already supports fetching models from a custom `baseUrl` + `apiKey` (OpenAI-compatible `/v1/models`). The SettingsDialog UI does not yet expose fields for entering a custom base URL and API key. The backend plumbing is ready; only the frontend form is missing.

### Startup / onboarding page
There is no welcome screen or first-run wizard. New users land directly on the empty canvas with no guidance beyond the canvas hint text. An onboarding flow (explain the three-step workflow, prompt for work directory, check that at least one CLI tool is installed) has not been built.

### Antigravity CLI backend
A fourth agent backend ("Antigravity") was discussed but not implemented. To add it: extend `AgentBackendType` in `types.ts`, add a branch in `getCommand()` in `agent-runner.ts`, add a model list entry in `models/route.ts`, and add a radio option in `SettingsDialog.tsx`.

### End-to-end testing
All current tests are unit tests. No integration or E2E tests exist that actually spawn agents against a real CLI tool. Real-world smoke tests (spawn claude-code against a minimal canvas, verify output) are needed before treating the build pipeline as production-ready.

### Chat backend override
The chat route reads `process.env.VIBE_CHAT_AGENT_BACKEND` as a server-side override for the chat backend. The import route reads `VIBE_IMPORT_AGENT_BACKEND`. These env vars are not surfaced in the UI and are not documented in Settings.

### Wave abort on error
When `buildAll` is running and one wave's agent exits with an error, the remaining waves still execute. There is currently no short-circuit logic to abort the build plan on first failure.

### Project file discovery
`/api/project/load` requires the caller to supply the directory path. There is no file browser or recent-projects list. Users must type the path manually.
