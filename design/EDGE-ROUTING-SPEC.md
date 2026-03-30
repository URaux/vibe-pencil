# Edge Routing Fix: Four-Direction Handles + ELK Edge Routing

## Problem

1. Container内部blocks用elkjs `direction: RIGHT`水平排列，但Block的Handle固定Top/Bottom，导致容器内水平连线被迫走纵向绕路
2. elkjs计算了edge routing但`graph-layout.ts`第155行直接丢弃，只用了节点坐标
3. 跨容器多条边共享同一offset=24，全部重叠

## Step 1: Four-Direction Handles on BlockNode

### `src/components/nodes/BlockNode.tsx`

Add 8 handles (4 directions × 2 types source/target):

```tsx
<Handle id="t-top" type="target" position={Position.Top} className="..." />
<Handle id="t-bottom" type="target" position={Position.Bottom} className="..." />
<Handle id="t-left" type="target" position={Position.Left} className="..." />
<Handle id="t-right" type="target" position={Position.Right} className="..." />

<Handle id="s-top" type="source" position={Position.Top} className="..." />
<Handle id="s-bottom" type="source" position={Position.Bottom} className="..." />
<Handle id="s-left" type="source" position={Position.Left} className="..." />
<Handle id="s-right" type="source" position={Position.Right} className="..." />
```

Left/Right handles should be vertically centered. Use `style={{ top: '50%' }}` for left/right handles.
Keep existing Top/Bottom handle styles (centered horizontally).

### `src/lib/edge-utils.ts` (NEW FILE)

Create a utility to determine the best handle pair based on node positions:

```typescript
import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from './types'

/**
 * Given two block nodes, returns the optimal sourceHandle and targetHandle ids.
 *
 * Logic:
 * - Same container (same parentId), horizontal layout → Right/Left
 * - Different containers or no parent → Bottom/Top (vertical flow)
 * - If target is to the LEFT of source in same container → Left/Right (reverse)
 * - If target is ABOVE source across containers → Top/Bottom (reverse)
 */
export function assignHandles(
  sourceNode: Node<CanvasNodeData>,
  targetNode: Node<CanvasNodeData>
): { sourceHandle: string; targetHandle: string } {
  const sameContainer = sourceNode.parentId && sourceNode.parentId === targetNode.parentId

  if (sameContainer) {
    // Horizontal layout inside container
    const dx = targetNode.position.x - sourceNode.position.x
    return dx >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }

  // Cross-container: use vertical handles
  // Need to compute absolute Y positions (position is relative to parent)
  // For simplicity, use the raw position since cross-container nodes
  // are in different coordinate spaces — the layout engine places
  // containers vertically, so Bottom/Top is almost always correct
  return { sourceHandle: 's-bottom', targetHandle: 't-top' }
}

/**
 * Assigns handles to all edges based on current node positions.
 * Call this after layout is computed.
 */
export function assignAllEdgeHandles(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): Edge[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  return edges.map(edge => {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)

    if (!source || !target) return edge

    const handles = assignHandles(source, target)

    return {
      ...edge,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
    }
  })
}
```

### `src/lib/store.ts` — Update onConnect

The `onConnect` handler must auto-assign handles when user manually connects nodes:

```typescript
onConnect: (connection) => {
  const nodes = get().nodes
  const sourceNode = nodes.find(n => n.id === connection.source)
  const targetNode = nodes.find(n => n.id === connection.target)

  let sourceHandle = connection.sourceHandle
  let targetHandle = connection.targetHandle

  // If user didn't explicitly pick handles (dragged from center), auto-assign
  if (sourceNode && targetNode && (!sourceHandle || !targetHandle)) {
    const handles = assignHandles(sourceNode, targetNode)
    sourceHandle = sourceHandle || handles.sourceHandle
    targetHandle = targetHandle || handles.targetHandle
  }

  set({
    edges: addEdge(
      { ...connection, sourceHandle, targetHandle, type: 'sync' },
      get().edges
    ),
  })
},
```

## Step 2: ELK Edge Routing

### `src/lib/graph-layout.ts` — Major changes

#### 2a. Separate intra-container and inter-container edges

Currently all edges go into the root graph. Fix: put edges whose source AND target are in the same container into that container's `edges` array.

```typescript
// After building elkChildren for containers:
// Split edges into intra-container vs inter-container
for (const edge of filteredEdges) {
  const sourceBlock = visibleBlocks.find(b => b.id === edge.source)
  const targetBlock = visibleBlocks.find(b => b.id === edge.target)

  if (sourceBlock?.parentId && sourceBlock.parentId === targetBlock?.parentId) {
    // Intra-container: add to the container's edges
    const container = elkChildren.find(c => c.id === sourceBlock.parentId)
    if (container) {
      container.edges = container.edges ?? []
      container.edges.push({ id: edge.id, sources: [edge.source], targets: [edge.target] })
    }
  } else {
    // Inter-container: add to root edges
    rootEdges.push({ id: edge.id, sources: [edge.source], targets: [edge.target] })
  }
}
```

#### 2b. Enable orthogonal edge routing

Add to layout options:
```typescript
// Root graph
'elk.edgeRouting': 'ORTHOGONAL',

// Container subgraphs
'elk.edgeRouting': 'ORTHOGONAL',
```

#### 2c. Extract ELK edge sections and convert to SVG paths

After `elk.layout(graph)`, extract the edge routing data:

```typescript
interface EdgeRouteData {
  path: string       // SVG path d attribute
  labelX: number     // midpoint X for label placement
  labelY: number     // midpoint Y for label placement
  isIntraContainer: boolean
}

function elkSectionsToPath(
  sections: Array<{ startPoint: {x:number,y:number}, endPoint: {x:number,y:number}, bendPoints?: Array<{x:number,y:number}> }>,
  offsetX: number,
  offsetY: number
): { path: string; labelX: number; labelY: number } {
  if (!sections?.length) return { path: '', labelX: 0, labelY: 0 }

  const section = sections[0]
  const points = [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ].map(p => ({ x: p.x + offsetX, y: p.y + offsetY }))

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ')

  // Label at midpoint
  const mid = Math.floor(points.length / 2)
  const labelX = points[mid]?.x ?? 0
  const labelY = points[mid]?.y ?? 0

  return { path, labelX, labelY }
}
```

Then build a map and inject into edge data:

```typescript
const edgeRouteMap = new Map<string, EdgeRouteData>()

// Container children edges (intra-container)
for (const elkContainer of layout.children ?? []) {
  if (!containerIds.has(elkContainer.id)) continue
  const ox = elkContainer.x ?? 0
  const oy = elkContainer.y ?? 0

  for (const elkEdge of elkContainer.edges ?? []) {
    if (elkEdge.sections) {
      const { path, labelX, labelY } = elkSectionsToPath(elkEdge.sections, ox, oy)
      edgeRouteMap.set(elkEdge.id, { path, labelX, labelY, isIntraContainer: true })
    }
  }
}

// Root edges (inter-container)
for (const elkEdge of layout.edges ?? []) {
  if (elkEdge.sections) {
    const { path, labelX, labelY } = elkSectionsToPath(elkEdge.sections, 0, 0)
    edgeRouteMap.set(elkEdge.id, { path, labelX, labelY, isIntraContainer: false })
  }
}

// Inject into returned edges
return {
  nodes: layoutNodes,
  edges: assignAllEdgeHandles(layoutNodes, edges.map(edge => {
    const route = edgeRouteMap.get(edge.id)
    return {
      ...edge,
      data: {
        ...edge.data,
        ...(route ? { elkPath: route.path, elkLabelX: route.labelX, elkLabelY: route.labelY, isIntraContainer: route.isIntraContainer } : {}),
      },
    }
  })),
}
```

**IMPORTANT**: Import `assignAllEdgeHandles` from `@/lib/edge-utils`. This ensures every edge leaving the layout engine has correct handle assignments.

#### 2d. Container internal layout direction

Container subgraphs should use `direction: RIGHT` for horizontal block layout. This is already done. Keep it.

### Edge Components — Use ELK path when available

Update ALL THREE edge components (`SyncEdge.tsx`, `AsyncEdge.tsx`, `BidirectionalEdge.tsx`):

```typescript
export function SyncEdge(props: EdgeProps) {
  const elkPath = props.data?.elkPath as string | undefined
  const elkLabelX = props.data?.elkLabelX as number | undefined
  const elkLabelY = props.data?.elkLabelY as number | undefined
  const isIntra = props.data?.isIntraContainer as boolean | undefined

  // Fallback: use getBezierPath for intra-container, getSmoothStepPath for inter-container
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    ...props,
    borderRadius: 0,
    offset: 24,
  })
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath(props)

  const edgePath = elkPath || (isIntra ? bezierPath : smoothPath)
  const labelX = elkLabelX ?? (isIntra ? bezierLabelX : smoothLabelX)
  const labelY = elkLabelY ?? (isIntra ? bezierLabelY : smoothLabelY)

  return (
    <>
      <BaseEdge path={edgePath} markerEnd="url(#arrow)" style={{ stroke: '#94a3b8', strokeWidth: 1.25 }} />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
```

Import `getBezierPath` from `@xyflow/react` in each edge file.

Apply the SAME pattern to `AsyncEdge.tsx` (keep dashed style) and `BidirectionalEdge.tsx` (keep double arrow markers).

## File Change Summary

| Action | File |
|--------|------|
| **Create** | `src/lib/edge-utils.ts` |
| **Modify** | `src/components/nodes/BlockNode.tsx` (add 8 handles) |
| **Modify** | `src/lib/store.ts` (onConnect auto-assign handles) |
| **Rewrite** | `src/lib/graph-layout.ts` (split edges, ELK routing, extract paths, assign handles) |
| **Modify** | `src/components/edges/SyncEdge.tsx` (use elkPath + bezier fallback) |
| **Modify** | `src/components/edges/AsyncEdge.tsx` (same pattern) |
| **Modify** | `src/components/edges/BidirectionalEdge.tsx` (same pattern) |

## Acceptance Criteria

1. `npm run build` passes
2. `npm test` passes
3. Within a container, edges between horizontally-laid-out blocks go LEFT→RIGHT, not TOP→BOTTOM→around
4. Cross-container edges go TOP→BOTTOM cleanly
5. Edges do not overlap or cross through other blocks
6. Edge labels still render correctly
7. Manual edge creation (dragging from handle) auto-selects correct direction
8. Existing projects still load correctly
