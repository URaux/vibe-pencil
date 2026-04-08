import { create } from 'zustand'
import { loadSessions, saveSessions, flushSave } from './session-storage'
import {
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import { clampMaxParallel } from './config'
import { assignHandles } from './edge-utils'
import { getLocale, setLocale as setI18nLocale, translate, type Locale } from './i18n'
import type { BuildStatus, CanvasNodeData, HistoryEntry, ProjectConfig } from './types'
import { cloneCanvas } from './canvas-utils'

type SaveState = 'saved' | 'saving'

interface BuildState {
  active: boolean
  currentWave: number
  totalWaves: number
  targetNodeIds: string[]
  waves: string[][]
  nodeTimings: Record<string, { startedAt?: number; finishedAt?: number }>
  blockedNodes: Record<string, string>
  startedAt?: number
  completedAt?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: string[]
  canvasBefore?: { nodes: Node<CanvasNodeData>[]; edges: Edge[] }
  canvasAfter?: { nodes: Node<CanvasNodeData>[]; edges: Edge[] }
}

export type SessionPhase = 'brainstorm' | 'design' | 'iterate'

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  phase: SessionPhase
  canvasSnapshot?: { nodes: Node<CanvasNodeData>[]; edges: Edge[]; projectName?: string }
  ccSessionId?: string  // Claude Code session ID for resume (eliminates prompt cache cold start)
}

interface AppState {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
  canvasVersion: number
  canvasUndoStack: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
  canvasRedoStack: Array<{ nodes: Node<CanvasNodeData>[]; edges: Edge[] }>
  pushCanvasSnapshot: () => void
  undo: () => void
  redo: () => void
  onNodesChange: OnNodesChange<Node<CanvasNodeData>>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  setCanvas: (nodes: Node<CanvasNodeData>[], edges: Edge[]) => void
  addNode: (node: Node<CanvasNodeData>) => void
  addCanvasEdge: (edge: Edge) => void
  removeNode: (id: string) => void
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void
  updateNodeStatus: (id: string, status: BuildStatus, summary?: string, errorMessage?: string) => void
  updateNodeParent: (nodeId: string, newParentId: string | null) => void
  projectName: string
  setProjectName: (name: string) => void
  config: ProjectConfig
  setConfig: (config: Partial<ProjectConfig>) => void
  locale: Locale
  setLocale: (locale: Locale) => void
  history: HistoryEntry[]
  addHistory: (entry: HistoryEntry) => void
  saveState: SaveState
  setSaveState: (saveState: SaveState) => void
  buildState: BuildState
  setBuildState: (buildState: Partial<BuildState>) => void
  drawerState: 'hidden' | 'open' | 'collapsed'
  setDrawerState: (state: 'hidden' | 'open' | 'collapsed') => void
  buildOutputLog: Record<string, string>
  appendBuildOutput: (nodeId: string, text: string) => void
  clearBuildOutputLog: () => void
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  chatSidebarOpen: boolean
  setChatSidebarOpen: (open: boolean) => void
  chatSessions: ChatSession[]
  activeChatSessionId: string | null
  createChatSession: () => string
  switchChatSession: (id: string) => void
  deleteChatSession: (id: string) => void
  renameChatSession: (id: string, title: string) => void
  setSessionPhase: (id: string, phase: SessionPhase) => void
  updateActiveChatMessages: (updater: (msgs: ChatMessage[]) => ChatMessage[]) => void
  appendSystemChatMessage: (content: string) => void
  updateChatSession: (id: string, patch: Partial<ChatSession>) => void
}

const initialLocale = getLocale()
const CHAT_SESSIONS_STORAGE_KEY = 'vp-chat-sessions'

// loadChatSessions: synchronous fallback for SSR/initial render
// Real loading happens async via session-storage.ts
function loadChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const stored = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)

    if (stored) {
      const parsed = JSON.parse(stored) as ChatSession[]
      return parsed.map((s) => ({ ...s, phase: s.phase ?? 'iterate' }))
    }

    return []
  } catch {
    return []
  }
}

// Track whether a node drag is in progress so we snapshot once on drag start
let _isDragging = false

export const useAppStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  canvasVersion: 0,
  canvasUndoStack: [],
  canvasRedoStack: [],
  pushCanvasSnapshot: () => {
    const { nodes, edges, canvasUndoStack } = get()
    const stack = [...canvasUndoStack, cloneCanvas(nodes, edges)].slice(-50)
    set({ canvasUndoStack: stack, canvasRedoStack: [] })
  },
  undo: () => {
    const { canvasUndoStack, canvasRedoStack, nodes, edges } = get()
    if (canvasUndoStack.length === 0) return
    const previous = canvasUndoStack[canvasUndoStack.length - 1]
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      canvasUndoStack: canvasUndoStack.slice(0, -1),
      canvasRedoStack: [...canvasRedoStack, cloneCanvas(nodes, edges)],
    })
  },
  redo: () => {
    const { canvasRedoStack, canvasUndoStack, nodes, edges } = get()
    if (canvasRedoStack.length === 0) return
    const next = canvasRedoStack[canvasRedoStack.length - 1]
    set({
      nodes: next.nodes,
      edges: next.edges,
      canvasRedoStack: canvasRedoStack.slice(0, -1),
      canvasUndoStack: [...canvasUndoStack, cloneCanvas(nodes, edges)],
    })
  },
  onNodesChange: (changes) => {
    const hasRemove = changes.some((c) => c.type === 'remove')
    const hasDragStart = changes.some(
      (c) => c.type === 'position' && c.dragging === true
    )
    const hasDragEnd = changes.some(
      (c) => c.type === 'position' && c.dragging === false
    )

    // Snapshot before removals (unless removeNode already handles it)
    if (hasRemove) {
      get().pushCanvasSnapshot()
    }

    // Snapshot once at the start of a drag gesture
    if (hasDragStart && !_isDragging) {
      _isDragging = true
      get().pushCanvasSnapshot()
    }
    if (hasDragEnd) {
      _isDragging = false
    }

    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },
  onEdgesChange: (changes) => {
    const hasRemove = changes.some((c) => c.type === 'remove')
    if (hasRemove) {
      get().pushCanvasSnapshot()
    }
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },
  onConnect: (connection) => {
    get().pushCanvasSnapshot()
    const nodes = get().nodes
    const sourceNode = nodes.find((node) => node.id === connection.source)
    const targetNode = nodes.find((node) => node.id === connection.target)
    let sourceHandle = connection.sourceHandle
    let targetHandle = connection.targetHandle

    if (sourceNode && targetNode && (!sourceHandle || !targetHandle)) {
      const assignedHandles = assignHandles(sourceNode, targetNode, nodes)
      sourceHandle = sourceHandle || assignedHandles.sourceHandle
      targetHandle = targetHandle || assignedHandles.targetHandle
    }

    set({
      edges: addEdge(
        {
          ...connection,
          sourceHandle,
          targetHandle,
          type: 'sync',
          data: {
            isIntraContainer:
              Boolean(sourceNode?.parentId) && sourceNode?.parentId === targetNode?.parentId,
          },
        },
        get().edges
      ),
    })
  },
  setCanvas: (nodes, edges) => {
    // Filter out invalid edges: both source and target must be existing block nodes (not containers)
    const blockIds = new Set(nodes.filter((n) => n.type === 'block').map((n) => n.id))
    const validEdges = edges.filter((e) => blockIds.has(e.source) && blockIds.has(e.target))
    set({
      nodes,
      edges: validEdges,
      canvasVersion: get().canvasVersion + 1,
      selectedNodeId: nodes.some((node) => node.id === get().selectedNodeId)
        ? get().selectedNodeId
        : null,
    })
  },
  addNode: (node) => set({ nodes: [...get().nodes, node] }),
  addCanvasEdge: (edge) => set({ edges: addEdge(edge, get().edges) }),
  removeNode: (id) => {
    get().pushCanvasSnapshot()
    set(() => {
      const removedIds = new Set(
        get()
          .nodes.filter((node) => node.id === id || node.parentId === id)
          .map((node) => node.id)
      )

      return {
        nodes: get().nodes.filter((node) => !removedIds.has(node.id)),
        edges: get().edges.filter(
          (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
        ),
        selectedNodeId: removedIds.has(get().selectedNodeId ?? '') ? null : get().selectedNodeId,
      }
    })
  },
  updateNodeData: (id, data) =>
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node
      ),
    }),
  updateNodeStatus: (id, status, summary, errorMessage) =>
    set({
      nodes: get().nodes.map((node) =>
        node.id === id && node.type === 'block'
          ? { ...node, data: { ...node.data, status, summary, errorMessage } }
          : node
      ),
    }),
  updateNodeParent: (nodeId, newParentId) =>
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              ...(newParentId
                ? { parentId: newParentId, extent: 'parent' as const }
                : { parentId: undefined, extent: undefined }),
            }
          : node
      ),
    }),
  projectName: translate(initialLocale, 'untitled'),
  setProjectName: (name) => set({ projectName: name }),
  config: { agent: 'codex', model: 'o3', workDir: './workspace', maxParallel: 3 },
  setConfig: (config) =>
    set({
      config: {
        ...get().config,
        ...config,
        ...(typeof config.maxParallel === 'number'
          ? { maxParallel: clampMaxParallel(config.maxParallel) }
          : {}),
      },
    }),
  locale: initialLocale,
  setLocale: (locale) => {
    const current = get()
    const previousUntitled = translate(current.locale, 'untitled')
    const nextProjectName =
      current.projectName === previousUntitled ? translate(locale, 'untitled') : current.projectName

    setI18nLocale(locale)
    set({ locale, projectName: nextProjectName })
  },
  history: [],
  addHistory: (entry) => set({ history: [...get().history, entry] }),
  saveState: 'saved',
  setSaveState: (saveState) => set({ saveState }),
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
  setBuildState: (buildState) =>
    set({
      buildState: {
        ...get().buildState,
        ...buildState,
      },
    }),
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
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  chatOpen: true,
  setChatOpen: (open) => set({ chatOpen: open }),
  chatSidebarOpen: true,
  setChatSidebarOpen: (open) => set({ chatSidebarOpen: open }),
  chatSessions: [],
  activeChatSessionId: null,
  createChatSession: () => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}`
    const now = Date.now()
    const { activeChatSessionId, chatSessions, nodes, edges, projectName, locale } = get()
    // Save current canvas + project name to the session we're leaving
    const updatedSessions = chatSessions.map((s) =>
      s.id === activeChatSessionId
        ? { ...s, canvasSnapshot: { nodes, edges, projectName } }
        : s
    )
    const session: ChatSession = { id, title: '', messages: [], createdAt: now, updatedAt: now, phase: 'brainstorm' }
    const untitled = translate(locale, 'untitled')
    set({
      chatSessions: [session, ...updatedSessions],
      activeChatSessionId: id,
      nodes: [],
      edges: [],
      projectName: untitled,
    })
    return id
  },
  switchChatSession: (id) => {
    const { activeChatSessionId, chatSessions, nodes, edges, projectName, locale } = get()
    // Save current canvas + project name to the session we're leaving
    const updated = chatSessions.map((s) =>
      s.id === activeChatSessionId
        ? { ...s, canvasSnapshot: { nodes, edges, projectName } }
        : s
    )
    // Restore canvas + project name from the session we're switching to
    const target = updated.find((s) => s.id === id)
    const untitled = translate(locale, 'untitled')
    set({
      chatSessions: updated,
      activeChatSessionId: id,
      nodes: target?.canvasSnapshot?.nodes ?? [],
      edges: target?.canvasSnapshot?.edges ?? [],
      projectName: target?.canvasSnapshot?.projectName ?? untitled,
    })
  },
  deleteChatSession: (id) => {
    const remaining = get().chatSessions.filter((s) => s.id !== id)
    const wasActive = get().activeChatSessionId === id
    if (wasActive && remaining.length > 0) {
      // Switch to next session, restore its canvas
      const next = remaining[0]
      set({
        chatSessions: remaining,
        activeChatSessionId: next.id,
        nodes: next.canvasSnapshot?.nodes ?? [],
        edges: next.canvasSnapshot?.edges ?? [],
        projectName: next.canvasSnapshot?.projectName ?? translate(get().locale, 'untitled'),
      })
    } else if (wasActive) {
      // No sessions left — clear everything
      set({
        chatSessions: [],
        activeChatSessionId: null,
        nodes: [],
        edges: [],
        projectName: translate(get().locale, 'untitled'),
      })
    } else {
      set({ chatSessions: remaining })
    }
  },
  renameChatSession: (id, title) => {
    set({
      chatSessions: get().chatSessions.map((s) =>
        s.id === id ? { ...s, title } : s
      ),
    })
  },
  setSessionPhase: (id, phase) => {
    set({
      chatSessions: get().chatSessions.map((s) =>
        s.id === id ? { ...s, phase } : s
      ),
    })
  },
  updateActiveChatMessages: (updater) => {
    const { activeChatSessionId, chatSessions } = get()

    if (!activeChatSessionId) {
      return
    }

    const now = Date.now()
    const updated = chatSessions.map((session) => {
      if (session.id !== activeChatSessionId) {
        return session
      }

      const nextMessages = updater(session.messages)
      // Keep existing title — AI title-gen will set it asynchronously
      const title = session.title

      return { ...session, messages: nextMessages, title, updatedAt: now }
    })

    set({
      chatSessions: updated.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    })
  },
  appendSystemChatMessage: (content) => {
    const { activeChatSessionId, chatSessions } = get()

    if (!activeChatSessionId) {
      return
    }

    const now = Date.now()
    const updated = chatSessions.map((session) => {
      if (session.id !== activeChatSessionId) {
        return session
      }

      const systemMessage: ChatMessage = { role: 'assistant', content }
      return { ...session, messages: [...session.messages, systemMessage], updatedAt: now }
    })

    set({
      chatSessions: updated.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    })
  },
  updateChatSession: (id, patch) => {
    set({
      chatSessions: get().chatSessions.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    })
  },
}))

if (typeof window !== 'undefined') {
  // Synchronous initial load from localStorage (fast, for first render)
  const sessions = loadChatSessions()
  useAppStore.setState({
    chatSessions: sessions,
    activeChatSessionId: sessions[0]?.id ?? null,
  })

  // Async load from IndexedDB (may have more data, e.g. after LS quota trim)
  loadSessions().then((idbSessions) => {
    if (idbSessions.length > 0) {
      const current = useAppStore.getState().chatSessions
      // Only replace if IDB has more sessions (LS may have been trimmed)
      if (idbSessions.length > current.length) {
        useAppStore.setState({
          chatSessions: idbSessions,
          activeChatSessionId: idbSessions[0]?.id ?? null,
        })
      }
    }
  }).catch(() => {})

  // Save to both IDB + LS on every change (debounced)
  useAppStore.subscribe((state, previousState) => {
    if (state.chatSessions !== previousState.chatSessions) {
      saveSessions(state.chatSessions)
    }
  })

  // Flush pending saves on page unload
  window.addEventListener('beforeunload', () => {
    flushSave(useAppStore.getState().chatSessions)
  })
}
