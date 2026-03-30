# UX Fixes Spec: Error Overflow, Project Name, Export, Undo, Sidebar Collapse

## Fix 1 (P0): Error message overflow in chat panel

### Problem
Error messages in ChatPanel.tsx have no height constraint. Long errors push the input field out of view.

### Implementation

In `src/components/ChatPanel.tsx`, find the two error display divs:

1. Main error (near the form):
```tsx
// BEFORE:
{error ? <div className="mb-3 text-sm text-rose-600">{error}</div> : null}

// AFTER:
{error ? <div className="mb-3 max-h-20 overflow-y-auto text-sm text-rose-600">{error}</div> : null}
```

2. Action errors (per action block):
```tsx
// BEFORE:
{actionErrors[actionKey] ? (
  <div className="text-xs text-rose-600">{actionErrors[actionKey]}</div>
) : null}

// AFTER:
{actionErrors[actionKey] ? (
  <div className="max-h-16 overflow-y-auto text-xs text-rose-600">{actionErrors[actionKey]}</div>
) : null}
```

---

## Fix 2 (P0): Project name editable in StatusBar

### Problem
StatusBar shows projectName as read-only text. No way to rename a project.

### Implementation

In `src/components/StatusBar.tsx`:

1. Add state for inline editing:
```tsx
const [isEditingName, setIsEditingName] = useState(false)
const [editValue, setEditValue] = useState('')
```

2. Replace the static project name span with a click-to-edit pattern:
```tsx
{isEditingName ? (
  <input
    type="text"
    value={editValue}
    onChange={(e) => setEditValue(e.target.value)}
    onBlur={() => {
      if (editValue.trim()) setProjectName(editValue.trim())
      setIsEditingName(false)
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        if (editValue.trim()) setProjectName(editValue.trim())
        setIsEditingName(false)
      }
      if (e.key === 'Escape') setIsEditingName(false)
    }}
    className="w-40 rounded border border-slate-300 bg-white px-2 py-0.5 text-sm font-semibold text-slate-800 focus:border-blue-400 focus:outline-none"
    autoFocus
  />
) : (
  <button
    type="button"
    onClick={() => {
      setEditValue(projectName)
      setIsEditingName(true)
    }}
    className="font-semibold text-slate-800 hover:text-blue-600 hover:underline"
    title="Click to rename"
  >
    {projectName}
  </button>
)}
```

3. Import `useState` from react and `setProjectName` from store.

---

## Fix 3 (P1): Export functionality

### Problem
No way to export/download the architecture.

### Implementation

#### 3a. Add export functions in `src/lib/schema-engine.ts`

Add a function to export the full project as JSON:
```typescript
export function exportProjectJson(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  projectName: string,
  config: ProjectConfig
): string {
  return JSON.stringify({
    projectName,
    config,
    canvas: { nodes, edges },
    exportedAt: new Date().toISOString(),
    version: '1.0',
  }, null, 2)
}
```

#### 3b. Add export buttons in the header

In `src/app/page.tsx`, add an export dropdown or buttons next to the import button:

```tsx
<button
  type="button"
  onClick={() => {
    const { nodes, edges } = useAppStore.getState()
    const projectName = useAppStore.getState().projectName
    const yaml = canvasToYaml(nodes, edges, projectName)
    downloadFile(`${projectName}.yaml`, yaml, 'text/yaml')
  }}
  className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium"
>
  {t('export_yaml')}
</button>

<button
  type="button"
  onClick={() => {
    const state = useAppStore.getState()
    const json = exportProjectJson(state.nodes, state.edges, state.projectName, state.config)
    downloadFile(`${projectName}.json`, json, 'application/json')
  }}
  className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium"
>
  {t('export_json')}
</button>
```

Add a helper function (can be in page.tsx or a utils file):
```typescript
function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

#### 3c. Add i18n keys

```typescript
export_yaml: { en: 'Export YAML', zh: '导出 YAML' },
export_json: { en: 'Export JSON', zh: '导出 JSON' },
```

---

## Fix 4 (P1): Ctrl+Z / Ctrl+Shift+Z undo/redo

### Problem
No undo/redo for canvas operations.

### Implementation

#### 4a. Add undo/redo state to store

In `src/lib/store.ts`:

```typescript
// Add to AppState interface:
canvasUndoStack: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
canvasRedoStack: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
pushCanvasSnapshot: () => void
undo: () => void
redo: () => void
```

Implementation:
```typescript
canvasUndoStack: [],
canvasRedoStack: [],

pushCanvasSnapshot: () => {
  const { nodes, edges, canvasUndoStack } = get()
  const snapshot = {
    nodes: nodes.map(n => ({ ...n, position: { ...n.position }, data: { ...n.data }, ...(n.style ? { style: { ...n.style } } : {}) })),
    edges: edges.map(e => ({ ...e })),
  }
  // Limit stack depth to 50
  const stack = [...canvasUndoStack, snapshot].slice(-50)
  set({ canvasUndoStack: stack, canvasRedoStack: [] })
},

undo: () => {
  const { canvasUndoStack, nodes, edges } = get()
  if (canvasUndoStack.length === 0) return

  const previous = canvasUndoStack[canvasUndoStack.length - 1]
  const currentSnapshot = {
    nodes: nodes.map(n => ({ ...n, position: { ...n.position }, data: { ...n.data }, ...(n.style ? { style: { ...n.style } } : {}) })),
    edges: edges.map(e => ({ ...e })),
  }

  set({
    nodes: previous.nodes,
    edges: previous.edges,
    canvasUndoStack: canvasUndoStack.slice(0, -1),
    canvasRedoStack: [...get().canvasRedoStack, currentSnapshot],
  })
},

redo: () => {
  const { canvasRedoStack, nodes, edges } = get()
  if (canvasRedoStack.length === 0) return

  const next = canvasRedoStack[canvasRedoStack.length - 1]
  const currentSnapshot = {
    nodes: nodes.map(n => ({ ...n, position: { ...n.position }, data: { ...n.data }, ...(n.style ? { style: { ...n.style } } : {}) })),
    edges: edges.map(e => ({ ...e })),
  }

  set({
    nodes: next.nodes,
    edges: next.edges,
    canvasRedoStack: canvasRedoStack.slice(0, -1),
    canvasUndoStack: [...get().canvasUndoStack, currentSnapshot],
  })
},
```

#### 4b. Push snapshots before user operations

In `Canvas.tsx`, push a snapshot before these user-triggered operations:
- `onNodeDragStop` (node moved)
- `onDrop` (node added via drag)
- Context menu delete
- Context menu add

Call `useAppStore.getState().pushCanvasSnapshot()` before each mutation.

In `store.ts`:
- In `onConnect`: call `get().pushCanvasSnapshot()` before `addEdge`
- In `removeNode`: call `get().pushCanvasSnapshot()` before remove
- In `setCanvas`: Do NOT push snapshot (AI actions have their own restore button)

#### 4c. Keyboard shortcut listener

In `src/components/Canvas.tsx`, add a `useEffect` for keyboard shortcuts:

```typescript
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      useAppStore.getState().undo()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      useAppStore.getState().redo()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault()
      useAppStore.getState().redo()
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [])
```

---

## Fix 5 (P2): ChatSidebar collapsible

### Problem
ChatSidebar is fixed at w-56, no way to collapse it.

### Implementation

#### 5a. Add sidebar state to store

In `src/lib/store.ts`:
```typescript
// Add to AppState:
chatSidebarOpen: boolean
setChatSidebarOpen: (open: boolean) => void

// Implementation:
chatSidebarOpen: true,
setChatSidebarOpen: (open) => set({ chatSidebarOpen: open }),
```

#### 5b. Update page.tsx

```tsx
const chatSidebarOpen = useAppStore((s) => s.chatSidebarOpen)

// Replace the sidebar aside:
<aside className={`hidden shrink-0 border-r border-slate-200/80 xl:block transition-[width] duration-200 ${
  chatSidebarOpen ? 'w-56' : 'w-10'
}`}>
  {chatSidebarOpen ? <ChatSidebar /> : (
    <button
      type="button"
      onClick={() => useAppStore.getState().setChatSidebarOpen(true)}
      className="flex h-full w-full items-center justify-center text-slate-400 hover:text-slate-600"
      title="Expand sidebar"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )}
</aside>
```

#### 5c. Add collapse button in ChatSidebar

In `src/components/ChatSidebar.tsx`, add a collapse button in the header:
```tsx
<button
  type="button"
  onClick={() => useAppStore.getState().setChatSidebarOpen(false)}
  className="rounded p-1 text-slate-400 hover:text-slate-600"
  title="Collapse sidebar"
>
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
</button>
```

---

## File Change Summary

| Action | File |
|--------|------|
| **Modify** | `src/components/ChatPanel.tsx` (error overflow) |
| **Modify** | `src/components/StatusBar.tsx` (inline project name edit) |
| **Modify** | `src/app/page.tsx` (export buttons, sidebar collapse) |
| **Modify** | `src/lib/store.ts` (undo/redo stack, sidebar state) |
| **Modify** | `src/components/Canvas.tsx` (Ctrl+Z listener, push snapshots) |
| **Modify** | `src/components/ChatSidebar.tsx` (collapse button) |
| **Modify** | `src/lib/schema-engine.ts` (exportProjectJson) |
| **Modify** | `src/lib/i18n.ts` (export i18n keys) |

## Acceptance Criteria

1. Long error messages don't overflow the chat panel
2. Clicking project name in StatusBar lets you rename it
3. Export YAML/JSON buttons download files
4. Ctrl+Z undoes the last canvas operation
5. Ctrl+Shift+Z or Ctrl+Y redoes
6. Undo stack limited to 50 entries
7. ChatSidebar can be collapsed/expanded
8. `npm run build` passes
9. `npm test` passes
