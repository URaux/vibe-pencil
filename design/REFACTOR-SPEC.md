# Vibe Pencil v2: Container + Block Architecture Refactor

## Overview

Replace the 6 fixed node types (`service | frontend | api | database | queue | external`) with a 2-type system: `container` (visual group box) + `block` (content card). Use elkjs for compound layout. Preserve all existing build/chat/agent functionality.

## Guiding Principles

1. **Delete before adding** — remove the 6-type system entirely, don't layer on top of it
2. **Build pipeline must keep working** — topoSort, agent spawn, wave execution are untouched
3. **Backward compatibility** — old `architect.json` files auto-migrate on load
4. **elkjs for layout** — no hand-written coordinate math

---

## Phase 1: Data Model (`src/lib/types.ts`)

### Remove
- `NodeType` union type (`'service' | 'frontend' | ...`)
- `ClaudeModel`, `CodexModel` union types (unused)

### Add
```typescript
export type VPNodeType = 'container' | 'block'

export interface ContainerNodeData extends Record<string, unknown> {
  name: string
  color: string         // tailwind color key: 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'slate'
  collapsed: boolean
}

export interface BlockNodeData extends Record<string, unknown> {
  name: string
  description: string
  status: BuildStatus
  summary?: string
  errorMessage?: string
  techStack?: string    // freeform: "React 18 + Vite", shown to AI agents
}
```

### Keep unchanged
- `EdgeType`, `BuildStatus`, `ArchitectEdge`
- `ProjectConfig`, `HistoryEntry`, `ArchitectProject`

### Migration note
- `ArchitectNodeData` is replaced by `ContainerNodeData | BlockNodeData`
- Discriminate by node `type` field: `'container'` → `ContainerNodeData`, `'block'` → `BlockNodeData`

---

## Phase 2: Node Components (`src/components/nodes/`)

### Remove all 6 files
- `ServiceNode.tsx`, `FrontendNode.tsx`, `ApiNode.tsx`, `DatabaseNode.tsx`, `QueueNode.tsx`, `ExternalNode.tsx`

### Remove
- `BaseNode.tsx` (will be replaced)

### Create: `ContainerNode.tsx`

A React Flow group node rendered as a colored rectangle with:
- Rounded border (12px radius) in the container's color
- Title label badge (top-left, colored background, white text, uppercase)
- Interior padding for child blocks
- Collapse/expand toggle button (top-right)
- When collapsed: show only title bar, hide children (set `style.height` to a small value)
- No Handles — containers don't participate in edges directly

```typescript
// Registration in nodeTypes.ts
import type { NodeTypes } from '@xyflow/react'
export const nodeTypes: NodeTypes = {
  container: ContainerNode,
  block: BlockNode,
}
```

Container node must have these React Flow properties when created:
```typescript
{
  type: 'container',
  // style.width and style.height are managed by layout engine
  data: { name: '...', color: 'blue', collapsed: false },
}
```

### Create: `BlockNode.tsx`

A content card inside a container:
- White background, 1px slate-200 border, 8px radius
- Block name (14px, semibold)
- Description (11px, slate-400)
- Status indicator dot (bottom-right corner):
  - idle: slate-300
  - building: amber-400 (pulse animation)
  - done: green-400
  - error: red-400
- techStack shown as tiny tag below description if present
- Handle top (target) + Handle bottom (source) for edges — `Position.Top` / `Position.Bottom`
- Must set `parentId` and `extent: 'parent'` when inside a container

Block nodes have these React Flow properties:
```typescript
{
  type: 'block',
  parentId: 'container-id',   // required
  extent: 'parent',           // constrain to container bounds
  data: { name: '...', description: '...', status: 'idle' },
}
```

### Update: `nodeTypes.ts`
```typescript
import { ContainerNode } from './ContainerNode'
import { BlockNode } from './BlockNode'

export const nodeTypes = {
  container: ContainerNode,
  block: BlockNode,
}
```

---

## Phase 3: Edge Components (`src/components/edges/`)

### Keep all 3 edge files, add label rendering

Each edge component (`SyncEdge.tsx`, `AsyncEdge.tsx`, `BidirectionalEdge.tsx`) must:
1. Keep existing path/style
2. Add `EdgeLabelRenderer` to display `props.label` if present
3. Label renders as a small pill badge (white bg, slate border, 11px font) at the edge midpoint

```typescript
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function SyncEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 0, offset: 24 })
  return (
    <>
      <BaseEdge path={edgePath} markerEnd="url(#arrow)" style={{ stroke: '#94a3b8', strokeWidth: 1.25 }} />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
```

Apply same pattern to `AsyncEdge.tsx` and `BidirectionalEdge.tsx`.

---

## Phase 4: Layout Engine (`src/lib/graph-layout.ts`)

### Remove entire file content

### Rewrite using elkjs

Install: `npm install elkjs`

```typescript
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'

const elk = new ELK()

const CONTAINER_PADDING = 60  // top padding for title
const BLOCK_WIDTH = 200
const BLOCK_HEIGHT = 100
const CONTAINER_MIN_WIDTH = 300

export async function layoutArchitectureCanvas(
  nodes: Node[],
  edges: Edge[]
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Separate containers and blocks
  const containers = nodes.filter(n => n.type === 'container')
  const blocks = nodes.filter(n => n.type === 'block')

  // Build elk graph with compound structure
  const elkChildren: ElkNode[] = containers.map(container => {
    const childBlocks = blocks.filter(b => b.parentId === container.id)
    return {
      id: container.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.padding': `[top=${CONTAINER_PADDING},left=20,bottom=20,right=20]`,
        'elk.spacing.nodeNode': '20',
      },
      children: childBlocks.map(b => ({
        id: b.id,
        width: BLOCK_WIDTH,
        height: BLOCK_HEIGHT,
      })),
    }
  })

  // Orphan blocks (no parentId) get added at root level
  const orphans = blocks.filter(b => !b.parentId)
  for (const orphan of orphans) {
    elkChildren.push({ id: orphan.id, width: BLOCK_WIDTH, height: BLOCK_HEIGHT })
  }

  // Edges: only between blocks (not containers)
  const elkEdges: ElkExtendedEdge[] = edges.map(e => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    },
    children: elkChildren,
    edges: elkEdges,
  }

  const layout = await elk.layout(graph)

  // Apply positions back to nodes
  const positionMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()

  for (const elkContainer of layout.children ?? []) {
    // Container position
    positionMap.set(elkContainer.id, {
      x: elkContainer.x ?? 0,
      y: elkContainer.y ?? 0,
      width: elkContainer.width,
      height: elkContainer.height,
    })
    // Child block positions (relative to container)
    for (const elkBlock of elkContainer.children ?? []) {
      positionMap.set(elkBlock.id, {
        x: elkBlock.x ?? 0,
        y: elkBlock.y ?? 0,
      })
    }
  }

  const layoutNodes = nodes.map(node => {
    const pos = positionMap.get(node.id)
    if (!pos) return node

    const result = { ...node, position: { x: pos.x, y: pos.y } }
    if (node.type === 'container' && pos.width && pos.height) {
      result.style = { ...result.style, width: pos.width, height: pos.height }
    }
    return result
  })

  return { nodes: layoutNodes, edges }
}
```

**Important**: The function signature changes from sync to async (returns `Promise`). All callers must be updated to `await`.

---

## Phase 5: Schema Engine (`src/lib/schema-engine.ts`)

### New YAML format

```yaml
project: "My Project"
containers:
  - id: client-layer
    name: 客户端层
    color: blue
    blocks:
      - id: web-app
        name: Web 应用
        description: 面向终端用户的单页应用
        techStack: React 18 + Vite
        status: idle
      - id: mobile-app
        name: 移动端 App
        description: iOS 与 Android 客户端
        status: idle
  - id: api-layer
    name: API 网关层
    color: green
    blocks:
      - id: auth-gateway
        name: 认证网关
        description: JWT 校验
        status: idle
edges:
  - id: edge-1
    source: web-app
    target: auth-gateway
    type: sync
    label: HTTPS / REST
```

### `canvasToYaml` rewrite

Group blocks by `parentId` (container). Blocks without parentId go under a synthetic "ungrouped" container.

```typescript
interface SerializedBlock {
  id: string
  name: string
  description: string
  status: string
  techStack?: string
  summary?: string
  errorMessage?: string
}

interface SerializedContainer {
  id: string
  name: string
  color: string
  blocks: SerializedBlock[]
}

interface SerializedEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string
}

interface SchemaDocument {
  project: string
  containers: SerializedContainer[]
  edges: SerializedEdge[]
}
```

### `yamlToCanvas` rewrite

1. Parse YAML → `SchemaDocument`
2. Create container nodes (type `'container'`)
3. Create block nodes with `parentId` set to their container's id
4. Create edges
5. Call `await layoutArchitectureCanvas(nodes, edges)` — **note: now async**
6. Return result

### Migration: `yamlToCanvas` must also handle OLD format

Detect old format by checking for `document.nodes` (object with `services`, `frontends`, etc. keys).
If old format detected, convert:
- Each old group key → a container (e.g., `services` → container "Services", color "purple")
- Each old node → a block inside that container
- Edges pass through unchanged

```typescript
const LEGACY_GROUP_MAP: Record<string, { containerName: string; color: string }> = {
  services: { containerName: 'Services', color: 'purple' },
  frontends: { containerName: 'Frontend', color: 'blue' },
  apis: { containerName: 'API Gateway', color: 'green' },
  databases: { containerName: 'Data Layer', color: 'amber' },
  queues: { containerName: 'Message Queue', color: 'slate' },
  externals: { containerName: 'External', color: 'rose' },
}
```

---

## Phase 6: Node Palette (`src/components/NodePalette.tsx`)

### Rewrite

Two draggable items:
1. **Container** — icon: `[ ]`, label: "容器" / "Container"
2. **Block** — icon: `■`, label: "模块" / "Block"

Drag data format:
- Container: `event.dataTransfer.setData('application/reactflow', 'container')`
- Block: `event.dataTransfer.setData('application/reactflow', 'block')`

---

## Phase 7: Canvas (`src/components/Canvas.tsx`)

### `onDrop` handler changes

When dropping a `container`:
```typescript
const newNode = {
  id: `container-${Date.now()}`,
  type: 'container',
  position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
  style: { width: 400, height: 300 },
  data: { name: '', color: 'blue', collapsed: false },
}
```

When dropping a `block`:
- Check if drop position intersects with a container using `getIntersectingNodes`
- If inside a container → set `parentId` and use relative position
- If not → create without parentId (orphan block)

```typescript
const blockNode = {
  id: `block-${Date.now()}`,
  type: 'block',
  position: relativePosition, // relative to container if parentId set
  parentId: targetContainerId ?? undefined,
  extent: targetContainerId ? 'parent' : undefined,
  data: { name: '', description: '', status: 'idle' },
}
```

### `onNodeDragStop` — cross-container drag

When a block is dragged:
1. Use `getIntersectingNodes` to find if it overlaps a container
2. If the container is different from current `parentId`, update the node's `parentId`
3. Recalculate relative position

### Context menu changes

Node context menu (`kind: 'node'`):
- If node type is `'container'`: show "Edit", "Collapse/Expand", "Delete"
- If node type is `'block'`: show "Discuss with AI", "Build this node", "Edit", "Delete"

Canvas context menu: keep "Build All" and "Import Project"

### Node editor dialog

Currently uses `draftName` and `draftDescription`. Extend:
- For containers: edit `name` and `color` (dropdown)
- For blocks: edit `name`, `description`, and `techStack`

---

## Phase 8: Store (`src/lib/store.ts`)

### `ArchitectNodeData` references

Replace all `ArchitectNodeData` type references with `ContainerNodeData | BlockNodeData`.

Or better: create a union type:
```typescript
export type CanvasNodeData = ContainerNodeData | BlockNodeData
```

And use `Node<CanvasNodeData>` everywhere.

### `updateNodeData` / `updateNodeStatus`

These already work generically (spread partial data). No changes needed to the functions themselves, just the type signatures.

### Add action: `updateNodeParent`
```typescript
updateNodeParent: (nodeId: string, newParentId: string | null) => void
```

Sets `parentId` and `extent` on a node. If `newParentId` is null, removes parent.

---

## Phase 9: Build Pipeline

### `src/hooks/useBuildActions.ts` — minimal changes

The build pipeline works with node `id`, `data.name`, `data.description`, edges. None of these change.

Only change: when generating prompts, include `techStack` if available on the block:
```typescript
const techInfo = node.data.techStack ? `\nTech stack: ${node.data.techStack}` : ''
```

### `src/lib/topo-sort.ts` — NO changes

topoSort only uses `node.id` and `edge.source/target`. It doesn't know about node types.

### `src/lib/prompt-templates.ts` — NO changes

Templates use `architecture_yaml` and `selected_nodes` strings. The YAML format change is handled by schema-engine.

---

## Phase 10: Import (`src/app/api/project/import/route.ts`)

### Update import prompt

Change the expected JSON output format to container+block:
```json
{
  "containers": [
    { "id": "...", "name": "...", "color": "blue", "blocks": [...] }
  ],
  "edges": [...]
}
```

Update `normalizeCanvas` to handle new format.

Keep backward compatibility: if agent returns old format (with `nodes.services` etc.), use legacy migration.

### Remove
- `VALID_NODE_TYPES` set (no longer needed)
- `NodeType` references

---

## Phase 11: i18n (`src/lib/i18n.ts`)

### Add keys
- `container`: "容器" / "Container"
- `block`: "模块" / "Block"
- `color`: "颜色" / "Color"
- `tech_stack`: "技术栈" / "Tech Stack"
- `collapse`: "折叠" / "Collapse"
- `expand`: "展开" / "Expand"

### Remove keys
- `service`, `frontend`, `api`, `database`, `queue`, `external` (the 6 type labels)

---

## Phase 12: Tests

### `tests/lib/agent-runner.test.ts` — NO changes

### `tests/lib/schema-engine.test.ts` (if exists) — rewrite for new format

### New: `tests/lib/graph-layout.test.ts` — rewrite for elkjs

Test that:
1. Container nodes get positions and dimensions
2. Block nodes get positions relative to their parent container
3. Orphan blocks get root-level positions

---

## Container Color Palette

Available colors and their Tailwind classes:

| Key | Background | Border | Title BG |
|-----|-----------|--------|----------|
| `blue` | `bg-blue-50` | `border-blue-300` | `bg-blue-500` |
| `green` | `bg-green-50` | `border-green-300` | `bg-green-500` |
| `purple` | `bg-purple-50` | `border-purple-300` | `bg-purple-500` |
| `amber` | `bg-amber-50` | `border-amber-300` | `bg-amber-500` |
| `rose` | `bg-rose-50` | `border-rose-300` | `bg-rose-500` |
| `slate` | `bg-slate-50` | `border-slate-300` | `bg-slate-500` |

---

## File Change Summary

| Action | File |
|--------|------|
| **Delete** | `src/components/nodes/ServiceNode.tsx` |
| **Delete** | `src/components/nodes/FrontendNode.tsx` |
| **Delete** | `src/components/nodes/ApiNode.tsx` |
| **Delete** | `src/components/nodes/DatabaseNode.tsx` |
| **Delete** | `src/components/nodes/QueueNode.tsx` |
| **Delete** | `src/components/nodes/ExternalNode.tsx` |
| **Delete** | `src/components/nodes/BaseNode.tsx` |
| **Create** | `src/components/nodes/ContainerNode.tsx` |
| **Create** | `src/components/nodes/BlockNode.tsx` |
| **Rewrite** | `src/components/nodes/nodeTypes.ts` |
| **Rewrite** | `src/components/NodePalette.tsx` |
| **Modify** | `src/components/Canvas.tsx` |
| **Modify** | `src/components/edges/SyncEdge.tsx` |
| **Modify** | `src/components/edges/AsyncEdge.tsx` |
| **Modify** | `src/components/edges/BidirectionalEdge.tsx` |
| **Rewrite** | `src/lib/types.ts` |
| **Rewrite** | `src/lib/graph-layout.ts` |
| **Rewrite** | `src/lib/schema-engine.ts` |
| **Modify** | `src/lib/store.ts` |
| **Modify** | `src/lib/i18n.ts` |
| **Modify** | `src/lib/ui-text.ts` |
| **Modify** | `src/hooks/useBuildActions.ts` |
| **Modify** | `src/app/api/project/import/route.ts` |
| **Modify** | `src/app/api/chat/route.ts` |
| **Install** | `elkjs` npm package |

---

## Execution Order

**Do phases sequentially.** Each phase should leave the project in a compilable state (possibly with runtime errors until later phases complete).

1. `npm install elkjs` + types
2. Phase 1: types.ts
3. Phase 2: node components (delete old, create new, update nodeTypes.ts)
4. Phase 3: edge label rendering
5. Phase 4: graph-layout.ts (elkjs)
6. Phase 5: schema-engine.ts (new format + legacy migration)
7. Phase 6: NodePalette.tsx
8. Phase 7: Canvas.tsx (drop, drag, context menu, editor)
9. Phase 8: store.ts (type updates + updateNodeParent)
10. Phase 9: build pipeline (techStack in prompts)
11. Phase 10: import route
12. Phase 11: i18n
13. Phase 12: tests
14. `npm run build` — fix all type errors
15. Manual verification: create containers, drop blocks, connect edges, build

---

## Acceptance Criteria

1. `npm run build` passes with zero errors
2. Existing tests pass (agent-runner, topo-sort)
3. Can create containers, add blocks inside them, connect blocks with labeled edges
4. Can drag blocks between containers
5. Can collapse/expand containers
6. Build pipeline works: select a block → right-click → "Build this node" → agent spawns
7. Old `architect.json` files load correctly (auto-migration)
8. YAML export uses new container format
9. Import from codebase produces container+block graph
10. Canvas looks like the design preview at `design/architecture-preview.html`
