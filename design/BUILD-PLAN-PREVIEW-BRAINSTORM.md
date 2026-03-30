# Build Plan Preview UX Brainstorm

> Current state: `BuildPlanDialog.tsx` shows waves + global config. No per-node detail. No skill visibility. No editability.

---

## The Core Question

The user is about to click "Start Build" and spawn N parallel agent subprocesses that will write code to disk. Before that irreversible action, they should be able to answer:

1. What will each agent be loaded with?
2. Why was that chosen?
3. Can I change it?

The current dialog answers none of these. It shows "Wave 1: Auth Service, Frontend App" and global config (backend, model, workDir). That's a shopping receipt, not a build plan.

---

## What the Preview Should Show Per Node

| Layer | Data | Source | Currently Available? |
|-------|------|--------|---------------------|
| Wave assignment | Wave number | `topoSort()` | Yes |
| Dependencies | Which nodes this waits for | Edge list + topo | Easy to derive |
| Skills loaded | `['core', 'backend', 'testing']` | `resolveSkills(node, allNodes)` | Yes -- can call at preview time |
| Skill source reason | "core: required, backend: matched techStack 'FastAPI', testing: build-level required" | Needs new `resolveSkillsWithReasons()` | No -- needs new function |
| Harness preview | Persona + constraints summary | `writeAgentConfig` logic (but without writing) | Derivable -- extract from writeAgentConfig |
| Working directory | Where files will be written | `config.workDir` (global) | Yes |
| Backend + Model | Which agent backend | `config.agent` + `config.model` (global) | Yes |
| Tech stack | From node data | `node.data.techStack` | Yes |
| Estimated prompt size | Rough token count | Count merged skill markdown | Easy to derive |

### What NOT to show

- Full merged skill content (too long, belongs in a "view details" drill-down)
- The raw prompt (implementation detail, not user-facing)
- Exact file paths the agent will create (unknowable before execution)

---

## What Should Be Editable

### Worth building (high signal, low complexity)

1. **Add/remove skills per node.** Override the auto-resolved list. The skill system already supports manual overrides via `node.data.skills`. The preview just needs to let the user toggle them and persist to node data before build starts.

2. **Override techStack matching.** If a node says "FastAPI" but the user wants to also load `frontend/` skills (maybe it serves templates), let them add it.

### Maybe later (medium value, medium complexity)

3. **Per-node model override.** Currently global. Some nodes are trivial (config file generators) and could use a cheaper model. But this requires changing the spawn API to accept per-node model config. Defer unless the skill system is done.

### Not worth building (showing off, not useful)

4. **Drag nodes between waves.** Waves are computed from dependency topology. Letting users drag nodes to earlier waves would violate dependency constraints. Dragging to later waves is technically valid but confusing -- if you want to delay a node, just remove it from the selection.

5. **Reorder nodes within a wave.** Parallel execution means order is meaningless.

6. **Edit the prompt directly.** If the user needs to edit prompts, the skill system has failed. Fix skills, don't expose raw prompts.

---

## Data Flow for Preview

Currently, skills are resolved at build time inside `writeAgentConfig`. For preview, we need to resolve skills WITHOUT building.

```
User clicks "Build All"
    |
    v
computeBuildPlan(mode)          <-- already exists, returns { waves, nodeNames, targetNodes }
    |
    v
NEW: computeSkillPreview(targetNodes, allNodes)
    |
    For each node:
    |   resolveSkills(node, allNodes) --> ['core', 'backend', 'testing']
    |   resolveSkillReasons(node, allNodes) --> { core: 'required', backend: 'techStack:FastAPI', ... }
    |   estimatePromptSize(skills) --> ~2400 tokens
    |
    v
BuildPlanDialog receives:
    {
      waves: string[][],
      nodeNames: Map<string, string>,
      skillPlan: Map<string, {
        skills: string[],
        reasons: Map<string, string>,
        techStack: string | undefined,
        dependencies: string[],       // node IDs this waits for
        estimatedTokens: number,
      }>
    }
    |
    v
User reviews, optionally toggles skills
    |
    v
On confirm: persist skill overrides to node data, then start build
```

### New function needed in `skill-loader.ts`

```typescript
export function resolveSkillsWithReasons(
  node: Node<CanvasNodeData>,
  allNodes: Node<CanvasNodeData>[]
): { skills: string[], reasons: Map<string, string> } {
  // Same logic as resolveSkills, but tracks WHY each skill was included:
  // - 'required': core/* always loaded
  // - 'techStack:React': matched from node.data.techStack
  // - 'inherited:container-name': inherited from parent container
  // - 'manual': explicitly set in node.data.skills
  // - 'build-level': testing/*, build/* always loaded for build agents
}
```

---

## UX Layout

### Decision: Modal dialog, not full page

Reasons:
- The user is mid-flow (they just clicked Build All). A full page navigation breaks that flow.
- The dialog needs to be wider than current (max-w-lg -> max-w-3xl) but still a modal.
- For 20+ nodes, scrolling inside a modal is fine. Pagination is overkill.

### Decision: Two-level disclosure, not flat list

Every node in the wave list is a collapsible row. Collapsed = one line summary. Expanded = full skill breakdown.

### Decision: No "simple" vs "advanced" toggle

Two views doubles maintenance cost. One view with progressive disclosure (collapse/expand) achieves the same goal. The collapsed state IS the simple view. Expanding a node IS the advanced view.

---

## Wireframe: Collapsed State (Default)

```
+-----------------------------------------------------------------------+
|  Build Plan                                                    [Close] |
|  12 nodes across 4 waves                                              |
+-----------------------------------------------------------------------+
|                                                                       |
|  CONFIG ------------------------------------------------------------ |
|  Backend: claude-code    Model: sonnet-4    Dir: ./my-project         |
|  Max parallel: 3                                                      |
|                                                                       |
+-----------------------------------------------------------------------+
|                                                                       |
|  WAVE 1 (3 nodes)                                                     |
|  +------------------------------------------------------------------+ |
|  | [v] Auth Service         FastAPI    3 skills    ~1.8k tokens      | |
|  +------------------------------------------------------------------+ |
|  | [v] Frontend App         Next.js    4 skills    ~2.4k tokens      | |
|  +------------------------------------------------------------------+ |
|  | [v] Config Store         Redis      2 skills    ~1.2k tokens      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  WAVE 2 (2 nodes) -- waits for Wave 1                                 |
|  +------------------------------------------------------------------+ |
|  | [v] API Gateway          Express    3 skills    ~1.8k tokens      | |
|  +------------------------------------------------------------------+ |
|  | [v] Worker Queue         BullMQ     2 skills    ~1.2k tokens      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  WAVE 3 (1 node)  -- waits for Wave 2                                 |
|  +------------------------------------------------------------------+ |
|  | [v] Integration Tests    Vitest     3 skills    ~2.0k tokens      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
|                                          [Cancel]   [Start Build >>]  |
+-----------------------------------------------------------------------+
```

Key design choices:
- Each row shows: node name, techStack, skill count, estimated prompt size
- `[v]` is a disclosure triangle (collapsed by default)
- Token estimate gives a rough sense of "how much context is this agent getting"
- No per-node checkboxes to include/exclude (that's what "Build Selected" is for)

---

## Wireframe: Expanded Node

```
  +------------------------------------------------------------------+
  | [^] Auth Service         FastAPI    3 skills    ~1.8k tokens      |
  |                                                                    |
  |  SKILLS                                                            |
  |  [x] core          required           (2 files, ~600 tokens)      |
  |  [x] backend        techStack: FastAPI  (3 files, ~900 tokens)     |
  |  [x] testing        build-level required (1 file, ~300 tokens)    |
  |  [ ] frontend       --                 (2 files, ~800 tokens)      |
  |  [ ] architect      --                 (1 file, ~400 tokens)       |
  |  [+ Add skill...]                                                  |
  |                                                                    |
  |  HARNESS                                                           |
  |  Role: Module implementer                                          |
  |  Constraints: Only modify files within working directory           |
  |               Keep changes focused on assigned component           |
  |                                                                    |
  |  DEPENDENCIES                                                      |
  |  None (first wave)                                                 |
  |                                                                    |
  +------------------------------------------------------------------+
```

Key design choices:
- Checkboxes on skills allow toggling. Checked = will be loaded. Unchecked = available but not loaded.
- "required" and "build-level required" skills show the reason but the checkbox is disabled (can't uncheck core).
- The reason column explains WHY each skill was selected (techStack match, inherited, manual, required).
- Harness section shows the persona/constraints that will be written to CLAUDE.md/AGENTS.md/GEMINI.md.
- Dependencies section lists upstream nodes by name (or "None" for Wave 1).
- Token estimate per skill category helps the user understand context budget.

---

## Wireframe: Expanded Node with Dependency Detail

```
  |  DEPENDENCIES                                                      |
  |  Waits for: Auth Service (Wave 1), Config Store (Wave 1)           |
  |  Blocked by: --                                                    |
```

"Blocked by" only appears if a dependency has status `error` from a previous build. This is for re-run scenarios.

---

## The 7-Layer Context Stack Visualization

### Should the preview show it?

No. Not directly.

The 7-layer model (Language, Identity, History, Canvas State, Task, Skills, Constraints, Output Format) is an internal architecture concept. Showing it raw would be:
- Confusing to users who don't know the architecture
- Redundant -- the user cares about "what skills" and "what constraints," not "which layer number"

### What to show instead

The expanded node view already surfaces the layers that matter to the user:
- **Skills** (Layer 5) -- the checkboxes
- **Constraints** (Layer 6) -- the harness section
- **Output format** (Layer 7) -- implicit from backend type

Layers 0-4 (Language, Identity, History, Canvas State, Task) are not user-controllable and don't need preview. They're assembled automatically by the orchestrator.

### Portfolio/interview angle

The 7-layer model is a talking point, not a UI element. When asked "how does context assembly work?", the answer references the stack. But the UI should show the RESULT of context assembly (skills + constraints), not the PROCESS.

---

## Handling 20+ Nodes

### Problem
With 20 nodes across 5 waves, the dialog becomes a wall of text.

### Solution: wave-level collapse too

```
  WAVE 1 (8 nodes)  [Expand all]                          ~12.4k tokens
  WAVE 2 (6 nodes)  [Expand all]                          ~9.8k tokens
  WAVE 3 (4 nodes)  [Expand all]                          ~6.2k tokens
  WAVE 4 (2 nodes)  [Expand all]                          ~3.6k tokens
```

- Waves are collapsed by default (show count + total tokens only)
- Click wave header to expand and see node rows
- Click node row to expand and see skill detail
- "Expand all" per wave for quick scan
- Total token estimate per wave gives a cost signal

This is a two-level accordion: Wave -> Node -> Skill Detail.

### At massive scale (50+ nodes)

Add a search/filter bar at the top of the wave breakdown area:
```
  [Filter nodes...] [Show only: modified skills]
```

But honestly, if you have 50+ nodes in a single build, the problem is the architecture graph, not the preview dialog. Don't build for this case yet.

---

## Interaction Flow

```
1. User clicks "Build All" (or "Build Selected")
2. computeBuildPlan() runs (already exists)
3. NEW: computeSkillPreview() runs for each target node
4. BuildPlanDialog opens with full preview data
5. User scans waves (collapsed by default)
6. Optionally expands nodes to inspect/modify skills
7. Skill toggles update local state (not persisted until confirm)
8. User clicks "Start Build"
9. Skill overrides are persisted to node.data.skills
10. Build proceeds with overridden skills
```

### Cancel behavior
If user toggles skills then clicks Cancel, all changes are discarded. No "are you sure?" prompt -- the changes are lightweight (just checkbox state).

### Keyboard shortcuts
- `Escape` -- close (already implemented)
- `Enter` -- confirm and start build
- Arrow keys to navigate nodes? Probably overkill for v1.

---

## Component Architecture

```
BuildPlanDialog (modal shell, header, footer)
  |
  +-- ConfigSummary (global config: backend, model, workDir, maxParallel)
  |
  +-- WaveAccordion (per wave)
       |
       +-- WaveHeader (wave number, node count, total tokens, expand/collapse)
       |
       +-- NodeRow (per node, collapsible)
            |
            +-- NodeSummaryLine (name, techStack, skill count, token estimate)
            |
            +-- NodeDetailPanel (expanded state)
                 |
                 +-- SkillCheckboxList (toggle skills, show reasons)
                 |
                 +-- HarnessPreview (persona + constraints text)
                 |
                 +-- DependencyList (upstream node names)
```

### State management

Local component state for the dialog. NOT Zustand. Reasons:
- Skill toggle state is transient (discarded on cancel)
- Only persisted on confirm (written back to node.data.skills)
- No other component needs this state while the dialog is open

```typescript
// Local state in BuildPlanDialog
const [skillOverrides, setSkillOverrides] = useState<Map<string, string[]>>(new Map())
// Key: nodeId, Value: overridden skill list

function handleSkillToggle(nodeId: string, skillCategory: string, enabled: boolean) {
  setSkillOverrides(prev => {
    const next = new Map(prev)
    const current = next.get(nodeId) ?? initialSkills.get(nodeId) ?? []
    if (enabled) {
      next.set(nodeId, [...current, skillCategory])
    } else {
      next.set(nodeId, current.filter(s => s !== skillCategory))
    }
    return next
  })
}
```

---

## Props Interface Change

```typescript
// Current
interface BuildPlanDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  waves: string[][]
  nodeNames: Map<string, string>
  mode: 'all' | 'selected'
}

// Proposed
interface SkillPlanEntry {
  skills: string[]
  reasons: Map<string, string>  // skill -> reason string
  techStack: string | undefined
  dependencies: string[]        // node IDs
  estimatedTokens: number
}

interface BuildPlanDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (skillOverrides: Map<string, string[]>) => void  // pass overrides back
  waves: string[][]
  nodeNames: Map<string, string>
  skillPlan: Map<string, SkillPlanEntry>  // nodeId -> skill plan
  availableSkills: string[]               // all skill categories in the system
  mode: 'all' | 'selected'
}
```

The `onConfirm` callback now receives skill overrides so `useBuildActions` can persist them before spawning agents.

---

## What This Demonstrates in a Portfolio

1. **Orchestrator awareness.** The preview shows the user what the orchestrator will assemble for each agent. This is the "glass box" principle -- the system is transparent, not a black box.

2. **Skill system integration.** Skills aren't just loaded silently. The user sees what was matched, why, and can override. This shows the skill resolver is a first-class system, not a config dump.

3. **Cost awareness.** Token estimates per node and per wave give the user a rough cost signal before committing to N parallel API calls.

4. **Progressive disclosure.** Collapsed = simple view (wave, node count). One click = node detail. Another click = full skill breakdown. The same dialog serves both "just let me build" and "I want to inspect everything" users.

5. **Constraint transparency.** Showing the harness (persona + constraints) that will be written to CLAUDE.md makes the trust boundary visible. The user can see that build agents are scoped to their working directory.

---

## Implementation Priority

### P0 -- Minimum viable preview (enhance current dialog)
- Add `resolveSkills()` call at preview time for each node
- Show skill list per node (collapsed rows, no toggle yet)
- Show dependencies per node
- Widen dialog to max-w-3xl

### P1 -- Interactive skill editing
- Add `resolveSkillsWithReasons()` function
- Skill checkboxes with reason labels
- Token estimation
- Persist overrides on confirm

### P2 -- Full detail panel
- Harness preview (persona + constraints)
- Wave-level collapse for large graphs
- Per-skill token breakdown

### P3 -- Advanced features
- Per-node model override
- Search/filter for large node counts
- "Compare with last build" diff view

---

## Open Questions

1. **Should `resolveSkillsWithReasons` be a server-side API call or client-side?** Skills live on the filesystem (`skills/` directory). The client can't read them directly. So either: (a) API route `GET /api/skills/resolve?nodeId=xxx` returns the plan, or (b) the skill index is loaded into the store at app startup and resolution happens client-side. Option (b) is better for preview responsiveness but requires the skill index to be serializable and sent to the client.

2. **Token estimation accuracy.** Counting characters in merged skill markdown and dividing by 4 is crude but good enough for a preview. Don't use a real tokenizer -- the dependency isn't worth it for an estimate.

3. **Should "required" skills be uncheckable?** Probably yes. Core skills and build-level testing skills should always be loaded. Showing them as disabled checkboxes communicates "this is always included" without allowing the user to shoot themselves in the foot.

4. **What happens if the user removes ALL optional skills?** The agent still gets core + the prompt template. It will work, just without domain-specific guidance. No need to warn or block.

5. **Should the preview update live as the user toggles skills?** The token estimate should update. The harness preview should NOT update (it's computed from the same level/persona logic regardless of skills). This keeps the interaction responsive without confusing dynamic changes.
