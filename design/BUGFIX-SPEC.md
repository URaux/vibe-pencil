# Bugfix Spec: 4 Issues

## Bug 1: View jumps to origin after applying canvas actions

### Problem
After `setCanvas()` is called (from chat apply, import, container collapse), the view snaps to coordinates near (0,0) but the rendered architecture may be elsewhere. User must manually pan to find it.

### Fix
After every `setCanvas()` call, trigger `fitView()` with a small delay so React Flow re-centers on the content.

### Implementation

In `Canvas.tsx`, watch for canvas changes and auto-fitView:

```typescript
const { fitView } = useReactFlow()

// After setCanvas is called, fitView to show all content
useEffect(() => {
  if (nodes.length > 0) {
    // Small delay to let React Flow process the new nodes
    const timer = setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50)
    return () => clearTimeout(timer)
  }
}, [nodes.length, fitView])
```

BUT this would fire on every node add. Better approach: add a `canvasVersion` counter to the store that increments on `setCanvas()` calls. Watch that instead:

In `store.ts`:
- Add `canvasVersion: number` to AppState (initial: 0)
- In `setCanvas`: increment `canvasVersion`

In `Canvas.tsx`:
```typescript
const canvasVersion = useAppStore((state) => state.canvasVersion)

useEffect(() => {
  if (canvasVersion > 0 && nodes.length > 0) {
    const timer = setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 100)
    return () => clearTimeout(timer)
  }
}, [canvasVersion, fitView])
```

This ensures fitView fires only on bulk canvas updates (apply actions, import, layout), not on individual node adds/drags.

---

## Bug 2: Edge labels obscured by the edge line

### Problem
Edge label text sits directly on top of the edge line, making it hard to read.

### Fix
The label div already has `bg-white` and `border`, but it may be rendered behind the edge SVG. Fix:
1. Add `z-index` and `padding` to ensure the label is above the line
2. Add a subtle shadow for separation

### Implementation

In ALL THREE edge components (SyncEdge, AsyncEdge, BidirectionalEdge), update the label div className:

```
className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
```

Key changes:
- `px-2` → `px-2.5` and `py-0.5` → `py-1` for more padding
- Add `font-medium` for better readability
- `text-slate-500` → `text-slate-600` for darker text
- Add `shadow-sm` for visual separation from the line

Also add `style` with explicit `zIndex: 10` to ensure it renders above edges:
```
style={{
  transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
  zIndex: 10,
}}
```

---

## Bug 3: Edges are static SVG paths — don't follow node drag

### Problem
When ELK computes edge paths, they become absolute SVG coordinates stored in `edge.data.elkPath`. When the user drags a node, the edge path doesn't update — it stays at the original position, appearing "disconnected".

This is the MOST CRITICAL bug. ELK paths are only valid immediately after layout. Any user interaction (drag, resize) invalidates them.

### Fix
**Remove elkPath from edges entirely.** Don't use ELK's edge routing for rendering.

Instead:
1. Keep using `getSmoothStepPath` / `getBezierPath` for rendering (these are dynamic — they recalculate from current node positions)
2. Keep the four-direction handles and `assignAllEdgeHandles` — this is the key improvement that fixes routing direction
3. The handle assignment (`sourceHandle`/`targetHandle`) is stable after layout because it's based on relative positions, which don't change within a container when you drag the container

### Implementation

In `graph-layout.ts`:
- Remove ALL elkPath/elkLabelX/elkLabelY injection code
- Remove `elkSectionsToPath` function and related code
- Keep `assignAllEdgeHandles` — this is still needed
- Keep intra-container edge splitting for ELK (improves node placement)
- Still mark edges with `isIntraContainer` in edge data (used for bezier vs smoothstep choice)

The return should be:
```typescript
return {
  nodes: layoutNodes,
  edges: assignAllEdgeHandles(layoutNodes, clonedEdges.map(edge => {
    const sourceBlock = visibleBlockMap.get(edge.source)
    const targetBlock = visibleBlockMap.get(edge.target)
    const isIntra = sourceBlock?.parentId && sourceBlock.parentId === targetBlock?.parentId
    return {
      ...edge,
      data: { ...edge.data, isIntraContainer: isIntra || false },
    }
  })),
}
```

In edge components:
- Remove `elkPath` / `elkLabelX` / `elkLabelY` usage
- Keep the `isIntraContainer` check for bezier vs smoothstep
- Always use dynamic path calculation:
  - Intra-container: `getBezierPath(props)`
  - Inter-container: `getSmoothStepPath({ ...props, borderRadius: 0, offset: 24 })`

```typescript
export function SyncEdge(props: EdgeProps) {
  const isIntra = props.data?.isIntraContainer as boolean | undefined

  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath(props)
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    ...props,
    borderRadius: 0,
    offset: 24,
  })

  const edgePath = isIntra ? bezierPath : smoothPath
  const labelX = isIntra ? bezierLabelX : smoothLabelX
  const labelY = isIntra ? bezierLabelY : smoothLabelY

  return (
    <>
      <BaseEdge path={edgePath} markerEnd="url(#arrow)" style={{ stroke: '#94a3b8', strokeWidth: 1.25 }} />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: 10,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
```

Apply same pattern to AsyncEdge (keep `strokeDasharray: '5 5'`) and BidirectionalEdge (keep `markerStart`).

---

## Bug 4: Chat history lost on page refresh

### Problem
Chat histories are in Zustand store (in-memory). Page refresh clears everything.

### Fix
Persist chat histories to localStorage.

### Implementation

In `store.ts`, add persistence for chatHistories:

```typescript
// After store creation, hydrate chatHistories from localStorage
function loadChatHistories(): Map<string, ChatMessage[]> {
  if (typeof window === 'undefined') return new Map()
  try {
    const stored = localStorage.getItem('vp-chat-histories')
    if (!stored) return new Map()
    const parsed = JSON.parse(stored) as Array<[string, ChatMessage[]]>
    return new Map(parsed)
  } catch {
    return new Map()
  }
}

function saveChatHistories(histories: Map<string, ChatMessage[]>) {
  if (typeof window === 'undefined') return
  try {
    const entries = Array.from(histories.entries())
    localStorage.setItem('vp-chat-histories', JSON.stringify(entries))
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}
```

Modify the store:
- Initialize `chatHistories` with `loadChatHistories()`
- In `updateChatHistory`, after updating the map, call `saveChatHistories(next)`
- In `clearChatHistories`, also call `localStorage.removeItem('vp-chat-histories')`

Note: `loadChatHistories()` must handle SSR (check `typeof window`). Initialize with empty Map on server, hydrate on client.

Actually, since Zustand runs on client too, the simplest approach is to use a subscribe handler:

```typescript
// After store creation:
if (typeof window !== 'undefined') {
  // Hydrate on load
  const stored = loadChatHistories()
  if (stored.size > 0) {
    useAppStore.setState({ chatHistories: stored })
  }

  // Persist on change
  useAppStore.subscribe(
    (state, prevState) => {
      if (state.chatHistories !== prevState.chatHistories) {
        saveChatHistories(state.chatHistories)
      }
    }
  )
}
```

---

## File Change Summary

| Action | File |
|--------|------|
| **Modify** | `src/lib/store.ts` (canvasVersion + chat persistence) |
| **Modify** | `src/components/Canvas.tsx` (fitView on canvasVersion change) |
| **Modify** | `src/lib/graph-layout.ts` (remove elkPath injection, keep handle assignment + isIntraContainer) |
| **Modify** | `src/components/edges/SyncEdge.tsx` (remove elkPath, improve label style) |
| **Modify** | `src/components/edges/AsyncEdge.tsx` (same) |
| **Modify** | `src/components/edges/BidirectionalEdge.tsx` (same) |

## Acceptance Criteria

1. After clicking "apply to canvas" in chat, view auto-centers on the architecture
2. Edge labels are clearly readable above the edge line
3. Dragging a container or block keeps edges connected and following
4. Chat history survives page refresh
5. `npm run build` passes
6. `npm test` passes
