# Bugfix Spec 2: Edge Routing + Chat Sidebar

## Issue 1: Cross-container edge handles too rigid

### Problem
`assignHandles()` in `edge-utils.ts` always returns `s-bottom`/`t-top` for cross-container edges. This causes twisted/bent edges when containers are side-by-side or the source block isn't directly above the target block.

### Fix
Make `assignHandles()` position-aware for cross-container edges. Compute the **absolute position** of both blocks (block position + parent container position) and choose handles based on the dominant direction vector.

### Implementation

In `src/lib/edge-utils.ts`, replace the `assignHandles` function:

```typescript
export function assignHandles(
  sourceNode: Node<CanvasNodeData>,
  targetNode: Node<CanvasNodeData>,
  allNodes?: Node<CanvasNodeData>[]
): { sourceHandle: string; targetHandle: string } {
  const sameContainer =
    Boolean(sourceNode.parentId) && sourceNode.parentId === targetNode.parentId

  if (sameContainer) {
    const deltaX = targetNode.position.x - sourceNode.position.x
    return deltaX >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }

  // Cross-container: compute absolute positions
  const nodeMap = allNodes
    ? new Map(allNodes.map((n) => [n.id, n]))
    : undefined

  function absoluteCenter(node: Node<CanvasNodeData>): { x: number; y: number } {
    let x = node.position.x
    let y = node.position.y
    if (node.parentId && nodeMap) {
      const parent = nodeMap.get(node.parentId)
      if (parent) {
        x += parent.position.x
        y += parent.position.y
      }
    }
    // Approximate center (block is 200×100)
    return { x: x + 100, y: y + 50 }
  }

  const srcCenter = absoluteCenter(sourceNode)
  const tgtCenter = absoluteCenter(targetNode)
  const dx = tgtCenter.x - srcCenter.x
  const dy = tgtCenter.y - srcCenter.y

  // Choose handle direction based on dominant axis
  if (Math.abs(dy) > Math.abs(dx)) {
    // Vertical dominant
    return dy >= 0
      ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
      : { sourceHandle: 's-top', targetHandle: 't-bottom' }
  } else {
    // Horizontal dominant
    return dx >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }
}
```

Update `assignAllEdgeHandles` to pass `nodes` into `assignHandles`:

```typescript
export function assignAllEdgeHandles(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): Edge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  return edges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)

    if (!sourceNode || !targetNode) {
      return edge
    }

    const { sourceHandle, targetHandle } = assignHandles(sourceNode, targetNode, nodes)

    return {
      ...edge,
      sourceHandle,
      targetHandle,
    }
  })
}
```

Also update `onConnect` in `store.ts` to pass `nodes` as third argument to `assignHandles`:

```typescript
const assignedHandles = assignHandles(sourceNode, targetNode, nodes)
```

---

## Issue 2: Edge labels hidden behind container nodes

### Problem
Edge labels have `zIndex: 10`, but React Flow renders nodes in the HTML layer which sits on top of the SVG edge layer. The EdgeLabelRenderer div needs a much higher z-index to float above container nodes.

### Fix
In ALL THREE edge components (`SyncEdge.tsx`, `AsyncEdge.tsx`, `BidirectionalEdge.tsx`), change the label style `zIndex` from `10` to `1000`.

Also add a subtle white text-shadow for extra contrast in case the label is near a colored container border:

```
className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
style={{
  transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
  zIndex: 1000,
}}
```

---

## Issue 3: Console warnings on "Apply to Canvas"

### Problem
When the user clicks "Apply to Canvas", React Flow may emit warnings about:
- Edges referencing node IDs that don't exist yet (race condition during batch add)
- Missing handle IDs during intermediate state

The root cause: `applyParsedAction` calls `addNode()` and `addCanvasEdge()` one at a time, each triggering a React re-render and React Flow validation. During intermediate states, edges may reference nodes that haven't been added yet.

### Fix
Instead of applying actions one-by-one and triggering N re-renders, batch all actions and apply them as a single `setCanvas()` call.

In `ChatPanel.tsx`, rewrite `applyCanvasActions`:

```typescript
async function applyCanvasActions(rawActions: string[], actionKey: string) {
  if (rawActions.length === 0) return

  const snapshot = cloneCanvasSnapshot()

  try {
    // Start from current state
    let currentNodes = [...useAppStore.getState().nodes.map(n => ({
      ...n,
      position: { ...n.position },
      data: { ...n.data },
      ...(n.style ? { style: { ...n.style } } : {}),
    }))]
    let currentEdges = [...useAppStore.getState().edges.map(e => ({ ...e }))]

    for (const rawAction of rawActions) {
      const parsed = tryRepairJson(rawAction)
      if (!parsed) throw new Error('Invalid JSON action block.')

      const actions = Array.isArray(parsed) ? parsed : [parsed]
      for (const action of actions as CanvasAction[]) {
        const result = applyActionToSnapshot(action, currentNodes, currentEdges)
        currentNodes = result.nodes
        currentEdges = result.edges
      }
    }

    const arranged = await layoutArchitectureCanvas(currentNodes, currentEdges)
    setCanvas(arranged.nodes, arranged.edges)
    setLastCanvasSnapshot(snapshot)
    setLastAppliedActionKey(actionKey)
    setActionErrors((current) => {
      const next = { ...current }
      delete next[actionKey]
      return next
    })
  } catch (applyError) {
    setActionErrors((current) => ({
      ...current,
      [actionKey]:
        applyError instanceof Error ? applyError.message : t('apply_canvas_failed'),
    }))
  }
}
```

Add a new function `applyActionToSnapshot` that modifies arrays in-memory instead of calling store actions:

```typescript
function applyActionToSnapshot(
  action: CanvasAction,
  nodes: CanvasNode[],
  edges: Edge[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  if (action.action === 'add-node') {
    const node = action.node ?? {}
    const type = VALID_NODE_TYPES.has(node.type ?? 'block') ? (node.type ?? 'block') : 'block'
    const id =
      typeof node.id === 'string' && node.id
        ? node.id
        : `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`

    if (type === 'container') {
      const data = node.data as Partial<ContainerNodeData> | undefined
      const colorCandidate =
        typeof data?.color === 'string'
          ? data.color
          : typeof node.color === 'string'
            ? node.color
            : 'blue'

      return {
        nodes: [
          ...nodes,
          {
            id,
            type,
            position: {
              x: typeof node.position?.x === 'number' ? node.position.x : 80 + (nodes.length % 3) * 280,
              y: typeof node.position?.y === 'number' ? node.position.y : 80 + Math.floor(nodes.length / 3) * 220,
            },
            style: {
              width:
                typeof node.style === 'object' && node.style && typeof node.style.width === 'number'
                  ? node.style.width
                  : 400,
              height:
                typeof node.style === 'object' && node.style && typeof node.style.height === 'number'
                  ? node.style.height
                  : 300,
            },
            data: {
              name:
                typeof data?.name === 'string'
                  ? data.name
                  : typeof node.name === 'string'
                    ? node.name
                    : id,
              color: VALID_CONTAINER_COLORS.has(colorCandidate as ContainerColor)
                ? (colorCandidate as ContainerColor)
                : 'blue',
              collapsed:
                typeof data?.collapsed === 'boolean'
                  ? data.collapsed
                  : typeof node.collapsed === 'boolean'
                    ? node.collapsed
                    : false,
            },
          } as CanvasNode,
        ],
        edges,
      }
    }

    // Block node
    const data = node.data as Partial<BlockNodeData> | undefined
    const parentId =
      typeof node.parentId === 'string' &&
      nodes.some((entry) => entry.id === node.parentId && entry.type === 'container')
        ? node.parentId
        : undefined
    const statusCandidate =
      typeof data?.status === 'string' ? data.status : typeof node.status === 'string' ? node.status : 'idle'

    return {
      nodes: [
        ...nodes,
        {
          id,
          type,
          position: {
            x: typeof node.position?.x === 'number' ? node.position.x : parentId ? 24 : 80 + (nodes.length % 3) * 240,
            y: typeof node.position?.y === 'number' ? node.position.y : parentId ? 72 : 80 + Math.floor(nodes.length / 3) * 180,
          },
          ...(parentId ? { parentId, extent: 'parent' as const } : {}),
          data: {
            name:
              typeof data?.name === 'string'
                ? data.name
                : typeof node.name === 'string'
                  ? node.name
                  : id,
            description:
              typeof data?.description === 'string'
                ? data.description
                : typeof node.description === 'string'
                  ? node.description
                  : '',
            status: VALID_BUILD_STATUSES.has(statusCandidate as BuildStatus)
              ? (statusCandidate as BuildStatus)
              : 'idle',
            ...(typeof data?.summary === 'string' ? { summary: data.summary } : {}),
            ...(typeof data?.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
            ...(typeof data?.techStack === 'string'
              ? { techStack: data.techStack }
              : typeof node.techStack === 'string'
                ? { techStack: node.techStack }
                : {}),
          },
        } as CanvasNode,
      ],
      edges,
    }
  }

  if (action.action === 'update-node') {
    return {
      nodes: nodes.map((n) =>
        n.id === action.target_id ? { ...n, data: { ...n.data, ...action.data } } : n
      ),
      edges,
    }
  }

  if (action.action === 'remove-node') {
    const removedIds = new Set(
      nodes.filter((n) => n.id === action.target_id || n.parentId === action.target_id).map((n) => n.id)
    )
    return {
      nodes: nodes.filter((n) => !removedIds.has(n.id)),
      edges: edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)),
    }
  }

  if (action.action === 'add-edge') {
    const edge = action.edge
    if (
      !nodes.some((n) => n.id === edge.source && n.type === 'block') ||
      !nodes.some((n) => n.id === edge.target && n.type === 'block')
    ) {
      throw new Error('Edges can only connect existing block nodes.')
    }

    const type = VALID_EDGE_TYPES.has(edge.type ?? 'sync') ? (edge.type ?? 'sync') : 'sync'

    return {
      nodes,
      edges: [
        ...edges,
        {
          id:
            typeof edge.id === 'string' && edge.id
              ? edge.id
              : `edge-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`,
          source: edge.source,
          target: edge.target,
          type,
          ...(edge.label ? { label: edge.label } : {}),
        },
      ],
    }
  }

  return { nodes, edges }
}
```

Then remove `applyParsedAction` (the old one-by-one function) since it's no longer needed.

---

## Issue 4: Chat sidebar with conversation list

### Problem
User wants a Claude.ai-style left sidebar showing past conversations. Currently chat histories are stored in localStorage but there's no UI to browse/switch between them. The second screenshot shows Claude's sidebar as reference: a "Recents" section with a vertical list of conversation titles.

### Design
Add a conversation management system:

1. **Each conversation gets a unique session ID and title** (derived from first user message, truncated to ~30 chars)
2. **Left sidebar** shows list of conversations with titles, sorted by most recent
3. **Active conversation** is highlighted
4. **"New chat" button** creates a fresh conversation
5. **Delete button** on each conversation entry

### Implementation

#### 4a. Update store types and state

In `src/lib/store.ts`:

Add a new interface and state fields:

```typescript
export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number  // timestamp
  updatedAt: number  // timestamp
}

// In AppState interface, replace chatHistories:
// Remove:
//   chatHistories: Map<string, ChatMessage[]>
//   updateChatHistory: (key: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => void
//   clearChatHistories: () => void
// Add:
  chatSessions: ChatSession[]
  activeChatSessionId: string | null
  createChatSession: () => string  // returns new session ID
  switchChatSession: (sessionId: string) => void
  deleteChatSession: (sessionId: string) => void
  updateActiveChatMessages: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void
  getActiveChatMessages: () => ChatMessage[]
```

The localStorage persistence functions should be updated to use `ChatSession[]` instead of `Map`:

```typescript
const CHAT_SESSIONS_STORAGE_KEY = 'vp-chat-sessions'

function loadChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)
    if (!stored) return []
    return JSON.parse(stored) as ChatSession[]
  } catch {
    return []
  }
}

function saveChatSessions(sessions: ChatSession[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  } catch {}
}
```

Store implementation:

```typescript
chatSessions: [],
activeChatSessionId: null,

createChatSession: () => {
  const id = crypto.randomUUID()
  const session: ChatSession = {
    id,
    title: '',  // will be set from first user message
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  set({ chatSessions: [session, ...get().chatSessions], activeChatSessionId: id })
  return id
},

switchChatSession: (sessionId) => {
  set({ activeChatSessionId: sessionId })
},

deleteChatSession: (sessionId) => {
  const sessions = get().chatSessions.filter(s => s.id !== sessionId)
  const activeId = get().activeChatSessionId === sessionId
    ? (sessions[0]?.id ?? null)
    : get().activeChatSessionId
  set({ chatSessions: sessions, activeChatSessionId: activeId })
},

updateActiveChatMessages: (updater) => {
  const activeId = get().activeChatSessionId
  if (!activeId) return

  const sessions = get().chatSessions.map(s => {
    if (s.id !== activeId) return s
    const newMessages = updater(s.messages)
    // Auto-set title from first user message
    const title = s.title || newMessages.find(m => m.role === 'user')?.content.slice(0, 30) || ''
    return { ...s, messages: newMessages, title, updatedAt: Date.now() }
  })

  // Sort by most recent
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  set({ chatSessions: sessions })
},

getActiveChatMessages: () => {
  const activeId = get().activeChatSessionId
  if (!activeId) return []
  return get().chatSessions.find(s => s.id === activeId)?.messages ?? []
},
```

Remove the old `chatHistories`, `updateChatHistory`, `clearChatHistories` fields entirely.

Update localStorage persistence subscription to watch `chatSessions` instead of `chatHistories`.

Also migrate existing localStorage data: in the hydration code, check for old `'vp-chat-histories'` key and convert to new format if found, then delete the old key.

#### 4b. Update ChatPanel.tsx

Remove all references to `chatHistories`, `getChatKey`, `activeChatKey`. The chat panel now operates on the active session:

```typescript
const chatSessions = useAppStore((s) => s.chatSessions)
const activeChatSessionId = useAppStore((s) => s.activeChatSessionId)
const createChatSession = useAppStore((s) => s.createChatSession)
const switchChatSession = useAppStore((s) => s.switchChatSession)
const deleteChatSession = useAppStore((s) => s.deleteChatSession)
const updateActiveChatMessages = useAppStore((s) => s.updateActiveChatMessages)

const activeSession = chatSessions.find(s => s.id === activeChatSessionId) ?? null
const activeMessages = activeSession?.messages ?? []
```

Replace `updateChatHistory(chatKey, ...)` calls with `updateActiveChatMessages(...)`.

In `handleSubmit`, if there's no active session, auto-create one:

```typescript
if (!activeChatSessionId) {
  createChatSession()
}
```

Remove the `getChatKey` function and `GLOBAL_CHAT_KEY` constant. The node-specific context is still passed to the API (via `nodeContext`), but conversations are no longer keyed by node — they're independent sessions.

#### 4c. Add ChatSidebar component

Create `src/components/ChatSidebar.tsx`:

```tsx
'use client'

import { useAppStore, type ChatSession } from '@/lib/store'
import { t } from '@/lib/i18n'

export function ChatSidebar() {
  const chatSessions = useAppStore((s) => s.chatSessions)
  const activeChatSessionId = useAppStore((s) => s.activeChatSessionId)
  const createChatSession = useAppStore((s) => s.createChatSession)
  const switchChatSession = useAppStore((s) => s.switchChatSession)
  const deleteChatSession = useAppStore((s) => s.deleteChatSession)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('recents') /* Add i18n key: 'recents' → 'Recents' / '最近对话' */}
        </h2>
        <button
          type="button"
          onClick={() => createChatSession()}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          title={t('new_chat') /* Add i18n key */}
        >
          + {t('new_chat')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chatSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-400">
            {t('no_conversations') /* Add i18n key */}
          </div>
        ) : (
          <ul className="py-1">
            {chatSessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => switchChatSession(session.id)}
                  className={`group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                    session.id === activeChatSessionId
                      ? 'bg-slate-100 font-medium text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {session.title || t('untitled_chat') /* Add i18n key */}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteChatSession(session.id)
                    }}
                    className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                    title="Delete"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

#### 4d. Update page layout

In `src/app/page.tsx`, add the ChatSidebar to the left of NodePalette or replace NodePalette's position:

```tsx
<div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
  {/* Chat sidebar - left */}
  <aside className="hidden w-56 shrink-0 border-r border-slate-200/80 xl:block">
    <ChatSidebar />
  </aside>
  <NodePalette />
  <section className="min-h-[24rem] min-w-0 flex-1">
    <Canvas onOpenImportDialog={() => setImportOpen(true)} />
  </section>
  <aside
    className={`vp-panel flex shrink-0 flex-col border-t border-slate-200/80 p-4 transition-[width] duration-300 xl:h-full xl:border-t-0 xl:border-l ${
      chatOpen ? 'w-full xl:w-[24rem] xl:min-w-[22rem]' : 'w-full xl:w-20 xl:min-w-20'
    }`}
  >
    <ChatPanel />
  </aside>
</div>
```

#### 4e. Add i18n keys

In `src/lib/i18n.ts`, add new translation keys:

```typescript
recents: { en: 'Recents', zh: '最近对话' },
new_chat: { en: 'New Chat', zh: '新对话' },
no_conversations: { en: 'No conversations yet', zh: '暂无对话' },
untitled_chat: { en: 'Untitled', zh: '未命名' },
```

---

## File Change Summary

| Action | File |
|--------|------|
| **Modify** | `src/lib/edge-utils.ts` (position-aware cross-container handles) |
| **Modify** | `src/lib/store.ts` (ChatSession model, remove chatHistories, add session management) |
| **Modify** | `src/components/edges/SyncEdge.tsx` (zIndex: 1000) |
| **Modify** | `src/components/edges/AsyncEdge.tsx` (zIndex: 1000) |
| **Modify** | `src/components/edges/BidirectionalEdge.tsx` (zIndex: 1000) |
| **Modify** | `src/components/ChatPanel.tsx` (use session-based chat, batch apply actions) |
| **Create** | `src/components/ChatSidebar.tsx` (conversation list sidebar) |
| **Modify** | `src/app/page.tsx` (add ChatSidebar to layout) |
| **Modify** | `src/lib/i18n.ts` (add new translation keys) |

## Acceptance Criteria

1. Cross-container edges choose handles based on relative position (not always bottom/top)
2. Edge labels render ABOVE container nodes (never hidden behind them)
3. No console warnings when clicking "Apply to Canvas"
4. Left sidebar shows list of past conversations with titles
5. Clicking a conversation switches to it
6. "New Chat" button creates a fresh conversation
7. Delete button removes a conversation
8. Conversations persist across page refresh
9. `npm run build` passes
10. `npm test` passes
