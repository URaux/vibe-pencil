# Build All UX — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-03-29-build-all-ux-design.md`
**Date:** 2026-03-30

---

## Phase 1: Types, Store Changes, CSS Animations (Foundation)

### Step 1.1 — Extend `BuildStatus` type

**File:** `src/lib/types.ts`

**Change:** Add `'waiting'` and `'blocked'` to the `BuildStatus` union.

```typescript
// Before:
export type BuildStatus = 'idle' | 'building' | 'done' | 'error'

// After:
export type BuildStatus = 'idle' | 'waiting' | 'building' | 'done' | 'error' | 'blocked'
```

**Dependencies:** None
**Verify:** `npx tsc --noEmit` — expect errors in `BlockNode.tsx` (the `statusDotClasses` record is now missing keys). Those are fixed in Phase 5.

---

### Step 1.2 — Extend `BuildState` interface and store

**File:** `src/lib/store.ts`

**Changes:**

1. Expand the `BuildState` interface:

```typescript
interface BuildState {
  active: boolean
  currentWave: number
  totalWaves: number
  targetNodeIds: string[]
  // New:
  waves: string[][]                                       // full wave plan (node IDs per wave)
  nodeTimings: Record<string, { startedAt?: number; finishedAt?: number }>
  blockedNodes: Record<string, string>                    // nodeId -> blockedByNodeId
  startedAt?: number
  completedAt?: number
}
```

2. Add drawer state to `AppState`:

```typescript
// Add to AppState interface:
drawerState: 'hidden' | 'open' | 'collapsed'
setDrawerState: (state: 'hidden' | 'open' | 'collapsed') => void

// Add to AppState interface — per-node output log accumulator:
buildOutputLog: Record<string, string>        // nodeId -> accumulated output text
appendBuildOutput: (nodeId: string, text: string) => void
clearBuildOutputLog: () => void
```

3. Update the initial `buildState` value:

```typescript
buildState: {
  active: false,
  currentWave: 0,
  totalWaves: 0,
  targetNodeIds: [],
  waves: [],
  nodeTimings: {},
  blockedNodes: {},
  startedAt: undefined,
  completedAt: undefined,
},
```

4. Add new state and actions to the store creator:

```typescript
drawerState: 'hidden',
setDrawerState: (state) => set({ drawerState: state }),
buildOutputLog: {},
appendBuildOutput: (nodeId, text) =>
  set({
    buildOutputLog: {
      ...get().buildOutputLog,
      [nodeId]: (get().buildOutputLog[nodeId] ?? '') + text,
    },
  }),
clearBuildOutputLog: () => set({ buildOutputLog: {} }),
```

5. Update `setBuildState` to merge the new fields correctly (it already uses spread, so no change needed, but the initial value must include the new keys).

**Dependencies:** Step 1.1
**Verify:** `npx tsc --noEmit` passes (aside from expected BlockNode errors).

---

### Step 1.3 — CSS animations for build states

**File:** `src/app/globals.css` (append to existing file)

**Add these keyframes and utility classes:**

```css
/* ---- Build All UX animations ---- */

@keyframes vp-node-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}

@keyframes vp-node-flash-green {
  0% { box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.8), 0 0 20px rgba(52, 211, 153, 0.4); }
  100% { box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.22), 0 0 24px rgba(52, 211, 153, 0.12); }
}

@keyframes vp-spinner {
  to { transform: rotate(360deg); }
}

@keyframes vp-drawer-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes vp-checkmark-pop {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.3); }
  100% { transform: scale(1); opacity: 1; }
}

.vp-node--error {
  animation: vp-node-shake 0.3s ease;
}

.vp-node--waiting {
  border-style: dashed;
  opacity: 0.5;
}

.vp-node--blocked {
  border-style: dashed;
  opacity: 0.4;
  filter: grayscale(0.5);
}

.vp-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(224, 122, 58, 0.3);
  border-top-color: rgba(224, 122, 58, 1);
  border-radius: 50%;
  animation: vp-spinner 0.6s linear infinite;
}

.vp-checkmark-pop {
  animation: vp-checkmark-pop 0.3s ease-out forwards;
}

.vp-flash-green {
  animation: vp-node-flash-green 0.6s ease-out forwards;
}

.vp-drawer-enter {
  animation: vp-drawer-slide-up 0.25s ease-out;
}
```

**Dependencies:** None
**Verify:** Visual — no runtime errors. Animations visible once applied in Phase 5.

---

### Step 1.4 — Loading messages module

**File:** `src/lib/loading-messages.ts` (new file)

```typescript
import { getLocale } from './i18n'

const MESSAGES_EN = [
  "Gathering resources from the dependency tree...",
  "The code monsters are restless tonight...",
  "Attempting to appease the build gods...",
  "Science machine is processing...",
  "Teaching the AI to write semicolons...",
  "Convincing the compiler this is fine...",
  "Negotiating with the package manager...",
  "Resolving existential dependencies...",
  "Performing mass code synthesis...",
  "Turning coffee into code...",
  "Asking Stack Overflow for help...",
  "Reticulating splines...",
  "Compiling quantum entanglement...",
  "Summoning the mass demons...",
]

const MESSAGES_ZH = [
  "正在向代码之神献祭...",
  "AI 正在冥想最佳实现方案...",
  "节点们正在开会讨论架构...",
  "依赖树正在光合作用...",
  "正在翻译人类的需求为机器语言...",
]

let lastIndex = -1

export function getRandomLoadingMessage(): string {
  const locale = getLocale()
  const pool = locale === 'zh' ? MESSAGES_ZH : MESSAGES_EN
  let index: number
  do {
    index = Math.floor(Math.random() * pool.length)
  } while (index === lastIndex && pool.length > 1)
  lastIndex = index
  return pool[index]
}
```

**Dependencies:** None
**Verify:** Import and call `getRandomLoadingMessage()` — returns a string.

---

## Phase 2: BuildPlanDialog (Pre-build Preview)

### Step 2.1 — Create `BuildPlanDialog.tsx`

**File:** `src/components/BuildPlanDialog.tsx` (new file)

**Props:**

```typescript
interface BuildPlanDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  waves: string[][]         // computed by caller
  nodeNames: Map<string, string>
  mode: 'all' | 'selected'
}
```

**Content:**
- Modal overlay using existing `vp-dialog-backdrop` + `vp-dialog-card` CSS classes (same pattern as `SettingsDialog` and `ImportDialog`)
- Title: `t('build_plan_title')` — e.g., "Build Plan"
- Subtitle: `t('waves_count', { count: totalNodes, waves: waves.length })`
- Config summary row: Agent backend, model, workDir (read from `useAppStore` config)
- Wave breakdown list: For each wave, show "Wave {n}" header + comma-separated node names
- Footer: Cancel button (`vp-button-secondary`) + Start Build button (`vp-button-primary`)

**Key implementation details:**
- `onConfirm` callback triggers the actual build; the dialog itself does NOT call `runBatchBuild`
- Close on Escape key and backdrop click (same pattern as existing dialogs)
- Dialog is purely presentational — all data is passed in as props

**Dependencies:** Phase 1 (i18n keys from Phase 9 can be stubbed with raw strings initially)
**Verify:** Render with mock waves data. Dialog opens/closes. Confirm button fires callback.

---

## Phase 3: BuildDrawer + WaveList + DrawerHeader (Progress Panel)

### Step 3.1 — Create `DrawerHeader.tsx`

**File:** `src/components/build/DrawerHeader.tsx` (new file)

**Props:**

```typescript
interface DrawerHeaderProps {
  onStopAll: () => void
  onCollapse: () => void
  loadingMessage: string
}
```

**Content:**
- Left: "Build Progress" title + whimsical loading message (rotating via `getRandomLoadingMessage()`)
- Center: Wave progress indicator: `Wave {currentWave}/{totalWaves}`
- Right: Stop All button (red `vp-button-secondary` style) + Collapse button (minimize icon)
- All build state read from `useAppStore` selectors

**Implementation detail for loading message rotation:**
- Use a `useEffect` + `setInterval` (4-6 seconds) that calls `getRandomLoadingMessage()` and sets local state
- Only rotate while `buildState.active` is true

**Dependencies:** Step 1.4
**Verify:** Renders with correct wave info from store.

---

### Step 3.2 — Create `WaveList.tsx`

**File:** `src/components/build/WaveList.tsx` (new file)

**Reads from store:** `buildState.waves`, `nodes` (for status/name), `buildState.nodeTimings`, `buildState.blockedNodes`

**Content:**
- Iterate `buildState.waves` — each wave is a collapsible section
- Each wave header: "Wave {n}" + aggregate status icon (all done = checkmark, any building = spinner, all waiting = circle)
- Each node row within a wave:
  - Status icon: `circle` (waiting/idle), `vp-spinner` div (building), green checkmark SVG with `vp-checkmark-pop` (done), red X SVG (error)
  - Node name
  - Elapsed time: computed from `nodeTimings[nodeId]` — show `--` if not started, live counter if building, final time if done/error
  - If error: inline expandable error message from `node.data.errorMessage`
  - If blocked: "Blocked by: {blockerName}" badge in muted red

**Elapsed time implementation:**
- For nodes with `startedAt` but no `finishedAt`: use a 1-second `setInterval` to update display
- Format: `Xs` for < 60s, `Xm Ys` for >= 60s

**Dependencies:** Step 1.2
**Verify:** Mock `buildState` in store with sample waves; verify wave sections render and expand/collapse.

---

### Step 3.3 — Create `BuildDrawer.tsx`

**File:** `src/components/BuildDrawer.tsx` (new file)

**Layout:**
- Fixed to bottom of viewport, overlays canvas area
- Three states driven by `drawerState` in store: `'hidden'` (not rendered), `'open'` (full panel), `'collapsed'` (summary strip)

**Collapsed state (summary strip):**
- Single-line bar, ~40px tall, full width
- Content: summary text (e.g., "5/6 nodes built, 1 failed | 2m 34s" or "Building... Wave 2/3 | 3/6 nodes")
- Click expands to full panel

**Open state:**
- Drag handle at top: a horizontal bar (8px wide centered div) — `onMouseDown` starts resize
- Resize logic: track mouse Y delta, clamp panel height between 120px and 60vh
- Use `useState` for panel height, default 280px
- Tab bar: "Waves" | "Output Log" | "Results" (Results only shown after build completes)
- Tab content area renders `WaveList`, `OutputLog`, or `BuildResults` based on active tab
- Header: `DrawerHeader` component

**Auto-behavior (managed in a `useEffect`):**
- When `buildState.active` transitions from `false` to `true`: `setDrawerState('open')`
- When `buildState.active` transitions from `true` to `false`: `setDrawerState('collapsed')`
- Store `completedAt` timestamp when build finishes

**CSS:**
- Use `vp-drawer-enter` animation class on mount
- `vp-panel` class for backdrop blur + shadow
- Border-top: `border-slate-200/80`

**Dependencies:** Steps 3.1, 3.2
**Verify:** Toggle `drawerState` in store manually; verify open/collapsed/hidden transitions. Drag handle resizes panel.

---

## Phase 4: OutputLog Tab (Streaming Log with Loading Messages)

### Step 4.1 — Create `OutputLog.tsx`

**File:** `src/components/build/OutputLog.tsx` (new file)

**Reads from store:** `buildOutputLog`, `buildState.targetNodeIds`, `nodes` (for names)

**Content:**
- Filter dropdown at top: "All nodes" option + one option per target node (by name)
- Log display area: `<pre>` or `<div>` with `font-mono text-xs` styling, dark background (`bg-slate-900 text-slate-200`)
- Filtered view: when a specific node is selected, show only that node's output from `buildOutputLog[nodeId]`
- "All nodes" view: interleave all node outputs with `[NodeName]` prefix per line
- Auto-scroll: `useEffect` that scrolls to bottom when new content arrives, unless user has scrolled up
- Pin-to-bottom toggle: a small button in the corner; when toggled off, auto-scroll is disabled

**Loading messages interspersed:**
- Every 4-6 seconds during active build, append a loading message line (styled differently — italic, muted color) to a local display buffer
- These are display-only, not stored in `buildOutputLog`

**Implementation details:**
- Use a `ref` for the scroll container
- Track `isUserScrolled` via `onScroll` handler: if `scrollTop + clientHeight < scrollHeight - 20`, user has scrolled up
- Filter state is local `useState`

**Dependencies:** Step 1.2 (store additions), Step 1.4 (loading messages)
**Verify:** Set mock data in `buildOutputLog` store; verify filter dropdown works, auto-scroll behavior, loading messages appear.

---

## Phase 5: Node Visual States Update (BlockNode Animations)

### Step 5.1 — Update `BlockNode.tsx`

**File:** `src/components/nodes/BlockNode.tsx`

**Changes:**

1. Update `statusDotClasses` to include new statuses:

```typescript
const statusDotClasses = {
  idle: 'bg-slate-300',
  waiting: 'bg-slate-200',
  building: 'bg-amber-400 animate-pulse',
  done: 'bg-green-400',
  error: 'bg-red-400',
  blocked: 'bg-slate-300',
} satisfies Record<BuildStatus, string>
```

2. Add a CSS class map for the outer node div:

```typescript
const statusNodeClasses: Record<BuildStatus, string> = {
  idle: '',
  waiting: 'vp-node--waiting',
  building: 'vp-node--building',
  done: 'vp-node--done',
  error: 'vp-node--error',
  blocked: 'vp-node--blocked',
}
```

3. Apply the node-level class to the outer `<div>`:

```typescript
<div
  className={`relative min-h-[100px] w-[200px] rounded-[8px] border bg-white px-4 py-3 shadow-sm ${
    selected ? 'border-orange-300' : 'border-slate-200'
  } ${statusNodeClasses[blockData.status]}`}
>
```

4. Replace the status dot with a conditional element:

```typescript
{blockData.status === 'building' ? (
  <span className="absolute bottom-3 right-3 vp-spinner" />
) : blockData.status === 'done' ? (
  <span className="absolute bottom-3 right-3 vp-checkmark-pop">
    <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  </span>
) : blockData.status === 'error' ? (
  <span className="absolute bottom-3 right-3" title={blockData.errorMessage}>
    <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  </span>
) : (
  <span
    className={`absolute bottom-3 right-3 h-2.5 w-2.5 rounded-full ${statusDotClasses[blockData.status]}`}
    aria-label={blockData.status}
  />
)}
```

5. Add summary line below description when building:

```typescript
{blockData.status === 'building' && blockData.summary ? (
  <div className="mt-1 truncate text-[10px] text-slate-400">
    {blockData.summary}
  </div>
) : null}
```

6. Add "blocked" badge when status is `'blocked'`:

```typescript
{blockData.status === 'blocked' ? (
  <div className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-400">
    {t('blocked_status')}
  </div>
) : null}
```

**Dependencies:** Step 1.1, Step 1.3
**Verify:** Set a node's status to each value (`waiting`, `building`, `done`, `error`, `blocked`) in the store and verify the correct visual appears on the canvas.

---

## Phase 6: Smart Error Handling (Block Downstream Deps)

### Step 6.1 — Add downstream dependency computation

**File:** `src/lib/topo-sort.ts`

**Add a new export function:**

```typescript
/**
 * Given an edge list, return all transitive downstream dependents of a node.
 * "Downstream" means nodes that depend on the given node (directly or transitively).
 * In our edge model, source -> target means target depends on source.
 */
export function getDownstreamDependents(
  nodeId: string,
  allNodeIds: string[],
  edges: TopoEdge[]
): string[] {
  // Build adjacency: for each node, which nodes depend on it?
  // Edge: source -> target means target depends on source
  // So source's downstream includes target
  const dependents = new Map<string, string[]>()
  for (const id of allNodeIds) dependents.set(id, [])
  for (const edge of edges) {
    // Note: topo-sort reverses edges (target -> source as dependency).
    // In the original graph, source -> target means "target depends on source".
    // But in topo-sort.ts, the convention is reversed:
    //   adjacency.get(edge.target)?.push(edge.source)
    //   inDegree for edge.source is incremented
    // This means edges are: target = dependency, source = dependent.
    // So downstream of nodeId = nodes reachable via adjacency from nodeId in original edge direction.
    // Actually, let's re-examine:
    //   In the UI, an edge from A -> B means B depends on A.
    //   In topo-sort, this becomes: adjacency[B] -> [A], inDegree[A]++
    //   So A is in a later wave (higher inDegree) — that's wrong, let me re-read.
    //
    // Actually from topo-sort.ts:
    //   adjacency.get(edge.target)?.push(edge.source)
    //   inDegree.set(edge.source, ...)
    // This means edge.source has higher inDegree = later wave.
    // So in the UI: edge.source -> edge.target means edge.source depends on edge.target.
    // Therefore: edge.target is built first (lower wave), edge.source is built later.
    //
    // Downstream of a failed node X = nodes that transitively depend on X.
    // A node Y depends on X if there's an edge Y -> X (source=Y, target=X).
    // So we need: all nodes reachable from X following edges where X is the target.
    // i.e., for edge (source, target), if target === X, then source depends on X.
    //
    // Build reverse adjacency: target -> [sources that depend on it]
    dependents.get(edge.target)?.push(edge.source)
  }

  const visited = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const dep of dependents.get(current) ?? []) {
      if (!visited.has(dep)) {
        visited.add(dep)
        queue.push(dep)
      }
    }
  }
  return Array.from(visited)
}
```

**IMPORTANT NOTE ON EDGE DIRECTION:** The edge direction in `topo-sort.ts` is somewhat counter-intuitive. From the existing code:
- `adjacency.get(edge.target)?.push(edge.source)` — target's adjacency list contains source
- `inDegree.set(edge.source, ...)` — source's in-degree is incremented

This means `edge.source` is in a **later** wave (depends on `edge.target`). So `edge.source -> edge.target` in the UI means **source depends on target**. The implementation above accounts for this: downstream dependents of X are found by following edges where X is the `target` (collecting `source` nodes).

**Dependencies:** None
**Verify:** Unit test with a simple diamond graph. Node A has no deps. B, C depend on A. D depends on B and C. Downstream of A should be [B, C, D]. Downstream of B should be [D].

---

### Step 6.2 — Update `useAgentStatus` to handle blocking

**File:** `src/hooks/useAgentStatus.ts`

**Changes:**

1. Import `getDownstreamDependents` from `topo-sort.ts`

2. In the `status` handler, when a node finishes with `'error'`:

```typescript
if (payload.status === 'error') {
  // Compute downstream dependents that should be blocked
  const state = useAppStore.getState()
  const dependents = getDownstreamDependents(
    payload.nodeId,
    state.buildState.targetNodeIds,
    state.edges
  )
  if (dependents.length > 0) {
    const newBlocked = { ...state.buildState.blockedNodes }
    for (const depId of dependents) {
      // Only block if not already done or errored
      const depNode = state.nodes.find(n => n.id === depId)
      if (depNode && depNode.data.status !== 'done' && depNode.data.status !== 'error') {
        newBlocked[depId] = payload.nodeId
        state.updateNodeStatus(depId, 'blocked')
      }
    }
    state.setBuildState({ blockedNodes: newBlocked })
  }
}
```

3. In the `output` handler, also append to `buildOutputLog`:

```typescript
if (payload.type === 'output') {
  store.appendBuildOutput(payload.nodeId, payload.text)
  // existing summary logic stays
}
```

4. In the `status` handler, record timing data:

```typescript
if (payload.status === 'building') {
  const timings = { ...store.buildState.nodeTimings }
  timings[payload.nodeId] = { startedAt: Date.now() }
  store.setBuildState({ nodeTimings: timings })
}

if (payload.status === 'done' || payload.status === 'error') {
  const timings = { ...store.buildState.nodeTimings }
  const existing = timings[payload.nodeId] ?? {}
  timings[payload.nodeId] = { ...existing, finishedAt: Date.now() }
  store.setBuildState({ nodeTimings: timings })
}
```

5. When build completes (all finished), record `completedAt`:

```typescript
if (allFinished) {
  nextState.setBuildState({
    active: false,
    currentWave: nextState.buildState.totalWaves,
    targetNodeIds: nextState.buildState.targetNodeIds, // keep for results display
    completedAt: Date.now(),
  })
}
```

Note: Do NOT clear `targetNodeIds` on completion — they are needed by BuildResults. They get cleared when a new build starts.

**Dependencies:** Step 6.1, Step 1.2
**Verify:** Trigger a build where one node fails. Verify downstream nodes get `'blocked'` status and `blockedNodes` map is populated. Verify timings are recorded.

---

### Step 6.3 — Update `AgentRunner.buildAll` to skip blocked nodes

**File:** `src/lib/agent-runner.ts`

**Change in `buildAll` method:** Before spawning a node, check if it's in the blocked set. The blocked set is managed client-side (store), but the server also needs to know. Two approaches:

**Approach A (simpler, recommended):** The server-side `buildAll` already processes waves sequentially. Modify the SSE stream handler: when a node has status `'blocked'` in the store, the client simply ignores its `'building'` status event. However, the server will still spawn it.

**Approach B (proper):** Add a `skipNodes` mechanism to `buildAll`. The server checks a skip set before spawning. This requires either:
- A new API endpoint to report blocked nodes back to server, or
- The server itself computing downstream deps on error

**Recommended approach:** Approach B via server-side computation. Modify `buildAll`:

```typescript
async buildAll(
  waves: string[][],
  prompts: Map<string, string>,
  backend: AgentBackend,
  workDir: string,
  maxParallel: number,
  model?: string
) {
  const concurrency = clampMaxParallel(maxParallel)
  const blockedSet = new Set<string>()

  // Pre-compute adjacency for downstream lookups
  const allNodeIds = waves.flat()
  // edges aren't passed in — we need them. Add edges parameter.
  // OR: compute downstream from the waves structure (waves encode the dependency order).
  // Simpler: pass edges to buildAll.

  for (const [waveIndex, wave] of waves.entries()) {
    const activeNodes = wave.filter(id => !blockedSet.has(id))
    this.emit('wave-start', waveIndex)
    this.emit('wave', { wave: waveIndex })

    for (let index = 0; index < activeNodes.length; index += concurrency) {
      const batch = activeNodes.slice(index, index + concurrency)
      const agentIds = batch.map((nodeId) =>
        this.spawnAgent(nodeId, prompts.get(nodeId) ?? '', backend, workDir, model)
      )

      const results = await Promise.allSettled(
        agentIds.map((agentId) => this.waitForAgent(agentId))
      )

      // Check for failures and block downstream
      for (const [i, result] of results.entries()) {
        if (result.status === 'rejected') {
          const failedNodeId = batch[i]
          // Block all downstream dependents
          // Need edges — pass them through or compute from waves
          // For now, emit an event so the client can handle blocking
          this.emit('node-failed', { nodeId: failedNodeId })
        }
      }
    }
  }
}
```

**Important:** The current `waitForAgent` rejects on error, which causes `Promise.all` to short-circuit. Change to `Promise.allSettled` so all nodes in a batch complete even if one fails.

**Also update the API route** (`/api/agent/spawn`) to pass edges if needed, or handle the `node-failed` event server-side.

**Simplest viable approach:** Just change `Promise.all` to `Promise.allSettled` in `buildAll`, and let the client handle blocking via the SSE stream (Phase 6.2 above). The server will still attempt to spawn blocked nodes, but the client marks them as blocked before the server gets to them. Since waves are sequential, by the time the server reaches a later wave, the client has already marked blocked nodes. The server can check the emitted `node-failed` events.

**Minimal change:**

```typescript
// In buildAll, change:
await Promise.all(agentIds.map((agentId) => this.waitForAgent(agentId)))
// To:
await Promise.allSettled(agentIds.map((agentId) => this.waitForAgent(agentId)))
```

This prevents a single failure from aborting the entire wave. The client-side blocking (Step 6.2) handles the downstream logic.

**Dependencies:** None (can be done in parallel with 6.2)
**Verify:** Fail one node in a multi-node wave. Other nodes in the same wave should still complete. Nodes in subsequent waves that depend on the failed node should be blocked.

---

## Phase 7: BuildResults Tab (Post-build Summary)

### Step 7.1 — Create `BuildResults.tsx`

**File:** `src/components/build/BuildResults.tsx` (new file)

**Reads from store:** `buildState` (waves, nodeTimings, blockedNodes, completedAt, startedAt), `nodes` (for name, status, errorMessage)

**Content:**
- Summary header: one of three variants based on results:
  - All success: green checkmark + "All {n} nodes built successfully | {elapsed}"
  - Partial: amber warning + "{done}/{total} nodes built, {failed} failed | {elapsed}"
  - All failed: red X + "Build failed | 0/{total} nodes succeeded | {elapsed}"
- Result cards list, sorted: errors first, then blocked, then done
- Each card:
  - Node name + status icon (checkmark/X/blocked badge)
  - Elapsed time (from `nodeTimings`)
  - For errors: full error message in a `<pre>` block, with a "Copy" button
  - For done: last 3 lines of output (from `buildOutputLog`), expandable

**Dependencies:** Step 1.2, Phase 4 (for buildOutputLog data)
**Verify:** Complete a build (some success, some failure). Expand drawer, switch to Results tab. Verify cards render correctly with times and error messages.

---

## Phase 8: Integration (Wire BuildButton -> Dialog -> Drawer Flow)

### Step 8.1 — Update `useBuildActions` to expose wave computation without execution

**File:** `src/hooks/useBuildActions.ts`

**Add a new function** `computeBuildPlan` that does the scoping and topo sort but does NOT spawn agents:

```typescript
function computeBuildPlan(mode: BatchBuildMode) {
  const scopedYaml =
    mode === 'selected'
      ? canvasToYaml(nodes, edges, projectName, selectedNodeIds)
      : canvasToYaml(nodes, edges, projectName)

  // yamlToCanvas is async, but we can compute waves from current nodes/edges directly
  const targetNodes =
    mode === 'selected'
      ? buildableNodes.filter((n) => selectedNodeIds.includes(n.id))
      : buildableNodes

  if (targetNodes.length === 0) return null

  const targetEdges = edges.filter(
    (e) =>
      targetNodes.some((n) => n.id === e.source) &&
      targetNodes.some((n) => n.id === e.target)
  )

  const waves = topoSort(targetNodes, targetEdges)
  const nodeNames = new Map(targetNodes.map((n) => [n.id, n.data.name || n.id]))

  return { waves, nodeNames, mode, targetNodes }
}
```

**Update return value:**

```typescript
return {
  buildAll,
  buildNode,
  buildSelected,
  computeBuildPlan,   // new
  isBuilding,
  selectedCount,
}
```

**Also update `runBatchBuild`** to accept pre-computed waves and store them in `buildState.waves`:

```typescript
setBuildState({
  active: true,
  currentWave: 1,
  totalWaves: waves.length,
  targetNodeIds,
  waves,                    // store the wave plan
  nodeTimings: {},
  blockedNodes: {},
  startedAt: Date.now(),
  completedAt: undefined,
})
```

And clear the output log at build start:

```typescript
useAppStore.getState().clearBuildOutputLog()
```

**Dependencies:** Phase 1
**Verify:** Call `computeBuildPlan('all')` — returns waves and nodeNames without starting a build.

---

### Step 8.2 — Update `BuildButton.tsx` to open dialog instead of building directly

**File:** `src/components/BuildButton.tsx`

**Changes:**

1. Add local state for dialog and plan:

```typescript
const [dialogOpen, setDialogOpen] = useState(false)
const [buildPlan, setBuildPlan] = useState<ReturnType<typeof computeBuildPlan>>(null)
const [pendingMode, setPendingMode] = useState<'all' | 'selected'>('all')
```

2. Change button onClick handlers:

```typescript
// Instead of calling buildAll() directly:
onClick={() => {
  const plan = computeBuildPlan('all')
  if (plan) {
    setBuildPlan(plan)
    setPendingMode('all')
    setDialogOpen(true)
  }
}}
```

Same for `buildSelected`.

3. Add `BuildPlanDialog` component:

```typescript
<BuildPlanDialog
  open={dialogOpen}
  onClose={() => setDialogOpen(false)}
  onConfirm={() => {
    setDialogOpen(false)
    if (pendingMode === 'selected') buildSelected()
    else buildAll()
  }}
  waves={buildPlan?.waves ?? []}
  nodeNames={buildPlan?.nodeNames ?? new Map()}
  mode={pendingMode}
/>
```

**Dependencies:** Phase 2, Step 8.1
**Verify:** Click "Build All" — dialog opens showing wave plan. Click "Start Build" — dialog closes and build starts. Click "Cancel" — dialog closes, no build.

---

### Step 8.3 — Add `BuildDrawer` to page layout

**File:** `src/app/page.tsx`

**Changes:**

1. Import `BuildDrawer`:

```typescript
import { BuildDrawer } from '@/components/BuildDrawer'
```

2. Add it inside the `<main>` element, after `<StatusBar>`:

```typescript
<StatusBar onOpenSettings={() => setSettingsOpen(true)} />
<BuildDrawer />
```

The drawer positions itself via CSS (fixed/absolute bottom), so placement in the DOM just needs to be within the main layout.

**Dependencies:** Phase 3
**Verify:** Start a build. Drawer auto-opens. Wave list shows nodes with real-time status updates. Collapse/expand works. Stop All kills agents.

---

### Step 8.4 — Wire Stop All functionality

**File:** `src/components/build/DrawerHeader.tsx` (already created in 3.1)

**The `onStopAll` handler needs to:**

1. Call `POST /api/agent/stop` (existing endpoint)
2. Set all building/waiting nodes to `'error'` with message "Stopped by user"
3. Set `buildState.active = false`

**Implementation in `BuildDrawer.tsx` (passed as prop to DrawerHeader):**

```typescript
async function handleStopAll() {
  await fetch('/api/agent/stop', { method: 'POST' })
  const state = useAppStore.getState()
  for (const nodeId of state.buildState.targetNodeIds) {
    const node = state.nodes.find(n => n.id === nodeId)
    if (node && (node.data.status === 'building' || node.data.status === 'waiting')) {
      state.updateNodeStatus(nodeId, 'error', undefined, 'Stopped by user')
    }
  }
  state.setBuildState({
    active: false,
    completedAt: Date.now(),
  })
}
```

**Dependencies:** Phase 3
**Verify:** Start a build, click Stop All. All running nodes show error. Drawer collapses to summary.

---

### Step 8.5 — Update `useAgentStatus` to set nodes to `'waiting'` at wave start

**File:** `src/hooks/useAgentStatus.ts`

**In the `wave` handler, mark nodes in the upcoming wave as `'building'` (the server does this) but also mark nodes in future waves as `'waiting'`:**

This is better handled at build start time. In `useBuildActions.runBatchBuild`, after setting `setBuildState`, mark all target nodes:

```typescript
// Wave 1 nodes start as idle (will become building via SSE)
// All other nodes start as waiting
const wave1Set = new Set(waves[0])
for (const nodeId of targetNodeIds) {
  if (wave1Set.has(nodeId)) {
    updateNodeStatus(nodeId, 'idle')
  } else {
    updateNodeStatus(nodeId, 'waiting')
  }
}
```

**Dependencies:** Step 8.1
**Verify:** Start a multi-wave build. Nodes in wave 2+ show dashed border and dimmed appearance immediately.

---

## Phase 9: i18n Keys

### Step 9.1 — Add all new translation keys

**File:** `src/lib/i18n.ts`

**Add to `translations.zh`:**

```typescript
build_plan_title: '构建计划',
build_plan_subtitle: '以下节点将按波次顺序构建',
waves_count: '{count} 个节点，{waves} 个波次',
start_build: '开始构建',
cancel_build: '取消',
stop_all: '停止全部',
wave_n: '波次 {n}',
building_status: '构建中',
waiting_status: '等待中',
blocked_status: '已阻塞',
blocked_by: '阻塞于: {name}',
build_complete: '全部 {count} 个节点构建成功',
build_partial: '{done}/{total} 个节点已构建，{failed} 个失败',
build_failed: '构建失败',
elapsed_time: '耗时',
output_log: '输出日志',
results: '结果',
all_nodes_filter: '全部节点',
filter_by_node: '按节点筛选',
build_progress: '构建进度',
build_stopped: '已停止',
copy: '复制',
copied: '已复制',
pin_to_bottom: '固定到底部',
```

**Add to `translations.en`:**

```typescript
build_plan_title: 'Build Plan',
build_plan_subtitle: 'The following nodes will be built in wave order',
waves_count: '{count} nodes in {waves} waves',
start_build: 'Start Build',
cancel_build: 'Cancel',
stop_all: 'Stop All',
wave_n: 'Wave {n}',
building_status: 'Building',
waiting_status: 'Waiting',
blocked_status: 'Blocked',
blocked_by: 'Blocked by: {name}',
build_complete: 'All {count} nodes built successfully',
build_partial: '{done}/{total} nodes built, {failed} failed',
build_failed: 'Build failed',
elapsed_time: 'Elapsed',
output_log: 'Output Log',
results: 'Results',
all_nodes_filter: 'All Nodes',
filter_by_node: 'Filter by node',
build_progress: 'Build Progress',
build_stopped: 'Stopped',
copy: 'Copy',
copied: 'Copied',
pin_to_bottom: 'Pin to bottom',
```

**Dependencies:** None (can be done first or last)
**Verify:** Call `t('build_plan_title')` in both locales — returns correct string.

---

## File Change Summary

| File | Action | Phase | Description |
|---|---|---|---|
| `src/lib/types.ts` | Modify | 1 | Add `'waiting'` and `'blocked'` to `BuildStatus` |
| `src/lib/store.ts` | Modify | 1 | Extend `BuildState`, add `drawerState`, `buildOutputLog` |
| `src/app/globals.css` | Modify | 1 | Add keyframes: shake, flash, spinner, drawer-slide, checkmark-pop + utility classes |
| `src/lib/loading-messages.ts` | **Create** | 1 | Whimsical loading message pool with locale support |
| `src/components/BuildPlanDialog.tsx` | **Create** | 2 | Pre-build plan preview modal |
| `src/components/build/DrawerHeader.tsx` | **Create** | 3 | Drawer header: title, wave progress, stop all, collapse |
| `src/components/build/WaveList.tsx` | **Create** | 3 | Wave sections with per-node status, timing, error display |
| `src/components/BuildDrawer.tsx` | **Create** | 3 | Bottom drawer container: tabs, resize, open/collapsed/hidden |
| `src/components/build/OutputLog.tsx` | **Create** | 4 | Streaming log with node filter, auto-scroll, loading messages |
| `src/components/nodes/BlockNode.tsx` | Modify | 5 | Rich visual states: spinner, checkmark, shake, waiting, blocked |
| `src/lib/topo-sort.ts` | Modify | 6 | Add `getDownstreamDependents()` export |
| `src/hooks/useAgentStatus.ts` | Modify | 6 | Block downstream on error, record timings, append output log |
| `src/lib/agent-runner.ts` | Modify | 6 | `Promise.allSettled` in `buildAll` to survive single-node failures |
| `src/components/build/BuildResults.tsx` | **Create** | 7 | Post-build result cards with summary, errors, timing |
| `src/hooks/useBuildActions.ts` | Modify | 8 | Add `computeBuildPlan()`, store waves, set waiting status |
| `src/components/BuildButton.tsx` | Modify | 8 | Open `BuildPlanDialog` instead of direct build |
| `src/app/page.tsx` | Modify | 8 | Add `<BuildDrawer />` to layout |
| `src/lib/i18n.ts` | Modify | 9 | ~20 new zh/en translation keys |

**New files: 7** | **Modified files: 11** | **Total: 18**
