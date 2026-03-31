import { create } from 'zustand'
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
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  canvasSnapshot?: { nodes: Node<CanvasNodeData>[]; edges: Edge[]; projectName?: string }
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
  updateActiveChatMessages: (updater: (msgs: ChatMessage[]) => ChatMessage[]) => void
}

const initialLocale = getLocale()
const CHAT_SESSIONS_STORAGE_KEY = 'vp-chat-sessions'
const CHAT_HISTORIES_LEGACY_KEY = 'vp-chat-histories'

function loadChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const stored = window.localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)

    if (stored) {
      return JSON.parse(stored) as ChatSession[]
    }

    // Migrate from legacy Map-based storage
    const legacy = window.localStorage.getItem(CHAT_HISTORIES_LEGACY_KEY)

    if (legacy) {
      const entries = JSON.parse(legacy) as Array<[string, ChatMessage[]]>
      const now = Date.now()
      const migrated: ChatSession[] = entries
        .filter(([, messages]) => messages.length > 0)
        .map(([key, messages], index) => {
          const firstUser = messages.find((m) => m.role === 'user')
          const title = firstUser ? firstUser.content.slice(0, 30) : key
          return {
            id: `migrated-${index}-${now}`,
            title,
            messages,
            createdAt: now - (entries.length - index) * 1000,
            updatedAt: now - (entries.length - index) * 1000,
          }
        })

      window.localStorage.removeItem(CHAT_HISTORIES_LEGACY_KEY)
      return migrated
    }

    return []
  } catch {
    return []
  }
}

function saveChatSessions(sessions: ChatSession[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // Ignore storage failures like quota errors.
  }
}

// Track whether a node drag is in progress so we snapshot once on drag start
let _isDragging = false

function cloneSnapshot(nodes: Node<CanvasNodeData>[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({ ...n, position: { ...n.position }, data: { ...n.data }, ...(n.style ? { style: { ...n.style } } : {}) })),
    edges: edges.map((e) => ({ ...e })),
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  canvasVersion: 0,
  canvasUndoStack: [],
  canvasRedoStack: [],
  pushCanvasSnapshot: () => {
    const { nodes, edges, canvasUndoStack } = get()
    const stack = [...canvasUndoStack, cloneSnapshot(nodes, edges)].slice(-50)
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
      canvasRedoStack: [...canvasRedoStack, cloneSnapshot(nodes, edges)],
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
      canvasUndoStack: [...canvasUndoStack, cloneSnapshot(nodes, edges)],
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
  setCanvas: (nodes, edges) =>
    set({
      nodes,
      edges,
      canvasVersion: get().canvasVersion + 1,
      selectedNodeId: nodes.some((node) => node.id === get().selectedNodeId)
        ? get().selectedNodeId
        : null,
    }),
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
  config: { agent: 'claude-code', model: 'claude-sonnet-4-6', workDir: './workspace', maxParallel: 3 },
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
    const session: ChatSession = { id, title: '', messages: [], createdAt: now, updatedAt: now }
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
    set({
      chatSessions: remaining,
      activeChatSessionId: wasActive ? (remaining[0]?.id ?? null) : get().activeChatSessionId,
    })
  },
  renameChatSession: (id, title) => {
    set({
      chatSessions: get().chatSessions.map((s) =>
        s.id === id ? { ...s, title } : s
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
}))

if (typeof window !== 'undefined') {
  const sessions = loadChatSessions()
  useAppStore.setState({
    chatSessions: sessions,
    activeChatSessionId: sessions[0]?.id ?? null,
  })
  useAppStore.subscribe((state, previousState) => {
    if (state.chatSessions !== previousState.chatSessions) {
      saveChatSessions(state.chatSessions)
    }
  })
}
