# Build All UX Design Spec

## Overview

Add a comprehensive Build All UX to Vibe Pencil that provides build plan preview, real-time progress tracking via a bottom drawer panel, rich node animations with whimsical loading messages, and a post-build result summary.

## Context

### Existing Infrastructure (no changes needed)

- `AgentRunner` class — spawn/stop/buildAll/wave management (`agent-runner.ts`)
- API routes — `/api/agent/spawn`, `/api/agent/stream` (SSE), `/api/agent/status`, `/api/agent/stop`
- `useAgentStatus` hook — SSE listener that updates node status in store
- `useBuildActions` hook — buildAll/buildSelected/buildNode with topo sort
- `topoSort` — dependency-aware wave scheduling
- `BuildButton` — current minimal trigger (just a button)
- `BlockNode` — shows colored status dot (idle/building/done/error)
- `BuildState` in store — `{ active, currentWave, totalWaves, targetNodeIds }`

### Current Gaps

1. No build plan preview before execution
2. No progress panel (only status dots on nodes)
3. No node build animations beyond a pulsing dot
4. No Stop All button
5. No post-build result summary
6. No error detail display
7. Failed nodes don't block downstream dependents

---

## Feature 1: Build Plan Preview Dialog

**Trigger:** User clicks "Build All" or "Build Selected"

**Behavior:** Instead of immediately executing, show a modal dialog with the build plan.

### Content

- **Wave breakdown:** Visual list of waves with node names grouped per wave
  - Wave 1: `Database`, `Cache` (no dependencies)
  - Wave 2: `API Server` (depends on Wave 1)
  - Wave 3: `Frontend` (depends on Wave 2)
- **Node count:** "6 nodes in 3 waves"
- **Agent backend indicator:** Shows current backend (Claude Code / Codex / Gemini) from config
- **Model indicator:** Shows current model from config
- **Work directory:** Shows config.workDir

### Actions

- **"Start Build"** button — confirms and begins execution
- **"Cancel"** button — closes dialog, no action
- Preview is read-only; config changes go through SettingsDialog

### Implementation Notes

- Reuse `topoSort` to compute waves for display
- Reuse existing `canvasToYaml` + `yamlToCanvas` scoping logic from `useBuildActions`
- New component: `BuildPlanDialog.tsx`

---

## Feature 2: Bottom Drawer Panel (Build Progress)

**Layout:** Slides up from bottom of the viewport, below the canvas area. Resizable via drag handle.

### States

1. **Hidden** — no build in progress, drawer not visible
2. **Open** — auto-opens when build starts, shows full progress
3. **Collapsed** — user can collapse to a thin summary strip; auto-collapses on build completion

### Structure

```
+------------------------------------------------------------+
| ^ drag handle                                               |
| Build Progress            Wave 2/3        [Stop All]  [_]  |
+------------------------------------------------------------+
| [Waves]  [Output Log]                            tabs      |
|                                                             |
| Wave 1  [checkmark]  Database, Cache           12s         |
| Wave 2  [spinner]    API Server (building...)  --          |
|                      Auth Service (building...)  --        |
| Wave 3  [circle]     Frontend (waiting)         --         |
|                                                             |
+------------------------------------------------------------+
```

### Waves Tab

- Each wave is a collapsible section
- Nodes within a wave show: name, status icon, elapsed time
- Status icons: `circle` (waiting), `spinner` (building), `checkmark` (done), `x` (error)
- Failed nodes show error message inline, expandable
- Blocked nodes (downstream of failures) show "blocked" badge

### Output Log Tab

- Real-time streaming output from agents
- Filter dropdown: "All nodes" or select a specific node
- Auto-scroll to bottom, with a "pin to bottom" toggle
- Whimsical loading messages interspersed (see Feature 3)

### Controls

- **Stop All** button — kills all running agents, marks remaining as cancelled
- **Collapse** button — shrinks to summary strip
- **Drag handle** — resize panel height (min 120px, max 60% viewport)

### Summary Strip (collapsed state)

Single line: `checkmark 5/6 nodes built, 1 failed | 2m 34s` or `spinner Building... Wave 2/3 | 3/6 nodes`

Click to expand back to full panel.

### Auto-behavior

- **Auto-open:** When build starts (after Plan Preview confirmation)
- **Auto-collapse:** When build completes (success or all done with errors), collapse to summary strip
- **Persist:** Drawer remains available (collapsed) until user dismisses or starts a new build

### Implementation Notes

- New components: `BuildDrawer.tsx`, `WaveList.tsx`, `OutputLog.tsx`
- Store additions: `drawerOpen: boolean`, `drawerCollapsed: boolean`, per-node timing data
- Wire into existing SSE stream via `useAgentStatus`

---

## Feature 3: Node Build Animations + Whimsical Messages

### Node Visual States

| State | Visual |
|---|---|
| **idle** | Default appearance, solid border, gray status dot |
| **waiting** | Dashed border, 50% opacity, dim status dot |
| **building** | Glowing border pulse animation (color matches container), spinning status indicator, one-line summary text below node name |
| **done** | Brief green flash, checkmark icon pop-in animation, solid green dot |
| **error** | Red shake animation (0.3s), x icon, red dot, error tooltip on hover |

### Building State Detail

- Border: 2px animated glow (CSS box-shadow pulse, using container's color theme)
- Status indicator: Replace dot with a small CSS spinner (12px)
- Summary line: Show latest output line from SSE stream in `text-[10px] text-slate-400`, truncated to 1 line
- The summary is already partially implemented via `updateNodeData(nodeId, { summary })`

### Whimsical Loading Messages

Random messages displayed in the Output Log tab and optionally on the drawer header during builds. Rotate every 4-6 seconds.

```typescript
const LOADING_MESSAGES = [
  // Don't Starve style
  "Gathering resources from the dependency tree...",
  "The code monsters are restless tonight...",
  "Attempting to appease the build gods...",
  "Science machine is processing...",

  // Claude Code style
  "Teaching the AI to write semicolons...",
  "Convincing the compiler this is fine...",
  "Negotiating with the package manager...",
  "Resolving existential dependencies...",
  "Performing mass code synthesis...",

  // Dev humor
  "Turning coffee into code...",
  "Asking Stack Overflow for help...",
  "Reticulating splines...",
  "Compiling quantum entanglement...",
  "Summoning the mass demons...",

  // Chinese flavor
  "正在向代码之神献祭...",
  "AI 正在冥想最佳实现方案...",
  "节点们正在开会讨论架构...",
  "依赖树正在光合作用...",
  "正在翻译人类的需求为机器语言...",
]
```

Messages are locale-aware: show Chinese messages when locale is `zh`, English when `en`, or mix both.

### Implementation Notes

- Update `BlockNode.tsx` with new visual states
- Add `waiting` to `BuildStatus` type (new status for nodes in future waves)
- CSS animations in a new `build-animations.css` or Tailwind `@keyframes`
- Loading messages in a new `loading-messages.ts` file

---

## Feature 4: Smart Error Handling

### Strategy: Block Downstream Dependencies

When a node fails:

1. Current wave: all other nodes in the same wave continue running to completion
2. Subsequent waves: only nodes that are **downstream dependents** of the failed node are blocked
3. Independent branches in subsequent waves continue normally

### Visual Indicators

- Failed node: red error state (see Feature 3)
- Blocked nodes: "blocked" badge on node, grayed out with dashed border
- Blocked nodes in Waves tab: show "Blocked by: [failed node name]"

### Implementation Notes

- Add downstream dependency tracking to `AgentRunner.buildAll`
- When a node finishes with error, compute its transitive dependents via the edge graph
- Mark those dependents as `blocked` status (new `BuildStatus` value: `'blocked'`)
- Store: add `blockedBy` map to `BuildState`

---

## Feature 5: Post-Build Result Summary

### Collapsed Summary Strip

When build completes, drawer auto-collapses to summary strip:

**Success:** `checkmark All 6 nodes built successfully | 2m 34s`
**Partial:** `warning 5/6 nodes built, 1 failed | 2m 34s`  (click for details)
**All failed:** `x Build failed | 0/6 nodes succeeded | 45s`

### Expanded Result View

When user clicks summary strip or expands drawer after build:

- **Results tab** replaces Waves tab (or becomes a third tab)
- Each node shown as a result card:
  - Node name + status icon
  - Elapsed time
  - Output summary (last 3 lines, expandable)
  - Error message if failed (full text, copyable)
- Sort: errors first, then done, grouped by wave

### Implementation Notes

- Track per-node start/end timestamps in store
- New component: `BuildResults.tsx`
- Compute elapsed time from timestamps

---

## New Types and Store Changes

### Types (`types.ts`)

```typescript
export type BuildStatus = 'idle' | 'waiting' | 'building' | 'done' | 'error' | 'blocked'
```

### Store Additions (`store.ts`)

```typescript
interface BuildState {
  active: boolean
  currentWave: number
  totalWaves: number
  targetNodeIds: string[]
  // New fields:
  nodeTimings: Record<string, { startedAt?: number; finishedAt?: number }>
  blockedNodes: Record<string, string> // nodeId -> blockedByNodeId
  completedAt?: number
  startedAt?: number
}

// New state:
drawerState: 'hidden' | 'open' | 'collapsed'
setDrawerState: (state: 'hidden' | 'open' | 'collapsed') => void
```

---

## Component Tree

```
App
├── StatusBar
├── NodePalette (left)
├── Canvas (center)
│   ├── BlockNode (updated animations)
│   └── ContainerNode
├── ChatSidebar (right, existing)
├── BuildButton (updated: opens BuildPlanDialog)
├── BuildPlanDialog (new, modal)
└── BuildDrawer (new, bottom)
    ├── DragHandle
    ├── DrawerHeader (wave progress, stop all, collapse)
    ├── WaveList tab (wave sections with node statuses)
    ├── OutputLog tab (streaming logs, node filter, loading messages)
    └── BuildResults tab (post-build cards)
```

---

## New Files

| File | Purpose |
|---|---|
| `src/components/BuildPlanDialog.tsx` | Pre-build plan preview modal |
| `src/components/BuildDrawer.tsx` | Bottom drawer container + tabs + header |
| `src/components/build/WaveList.tsx` | Waves tab content |
| `src/components/build/OutputLog.tsx` | Output log tab content |
| `src/components/build/BuildResults.tsx` | Post-build result cards |
| `src/components/build/DrawerHeader.tsx` | Drawer header with progress + controls |
| `src/lib/loading-messages.ts` | Whimsical loading message arrays (zh/en) |
| `src/lib/build-animations.css` | CSS keyframes for node glow/shake/flash |

---

## Out of Scope

- Changing agent backend or model from within Build Plan Preview (use SettingsDialog)
- Per-node agent backend selection (all nodes use same backend)
- Build history / persistent build logs across sessions
- Terminal/console panel (separate future feature)
- Export deployable package (separate future feature)

---

## i18n Keys Needed

All user-facing text needs zh + en entries in `i18n.ts`:
- `build_plan_title`, `build_plan_subtitle`
- `waves_count` (template: "{count} nodes in {waves} waves")
- `start_build`, `cancel_build`, `stop_all`
- `wave_n` (template: "Wave {n}")
- `building_status`, `waiting_status`, `blocked_status`, `blocked_by`
- `build_complete`, `build_partial`, `build_failed`
- `elapsed_time`, `output_log`, `results`
- `all_nodes`, `filter_by_node`
- All loading messages (dual language)
