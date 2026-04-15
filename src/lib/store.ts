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
export const DEFAULT_MODEL_BY_BACKEND: Record<ProjectConfig['agent'], string> = {
  'claude-code': 'claude-sonnet-4-6',
  codex: 'gpt-5.4',
  gemini: 'gemini-3-flash-preview',
  'custom-api': 'deepseek-chat',
}

/** Ordered list of fallback models per backend. When the current model fails
 *  with "model not found / unavailable", we try the next one in the list.
 *  Keep 2-3 options per backend — the first is the default, the rest are
 *  reliable alternates. */
export const MODEL_FALLBACKS_BY_BACKEND: Record<ProjectConfig['agent'], string[]> = {
  'claude-code': ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],
  codex: ['gpt-5.4', 'gpt-5-codex', 'o3'],
  gemini: ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  'custom-api': ['deepseek-chat', 'deepseek-reasoner'],
}

/** Pick the next model to try after `currentModel` failed for `agent`.
 *  Returns null if no alternates are left. */
export function pickNextFallbackModel(
  agent: ProjectConfig['agent'],
  currentModel: string | undefined,
): string | null {
  const list = MODEL_FALLBACKS_BY_BACKEND[agent] ?? []
  const current = (currentModel ?? '').trim().toLowerCase()
  for (const candidate of list) {
    if (candidate.toLowerCase() !== current) return candidate
  }
  return null
}

function normalizeModel(agent: ProjectConfig['agent'], model?: string) {
  const fallback = DEFAULT_MODEL_BY_BACKEND[agent] ?? 'gpt-5.4'
  const trimmed = model?.trim()
  if (!trimmed) return fallback
  if (agent === 'codex' && trimmed.toLowerCase() === 'o3') return fallback
  return trimmed
}

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
  config: { agent: 'codex', model: 'gpt-5.4', workDir: './workspace', maxParallel: 3 },
  setConfig: (config) =>
    set(() => {
      const current = get().config
      const merged = {
        ...current,
        ...config,
        ...(typeof config.maxParallel === 'number'
          ? { maxParallel: clampMaxParallel(config.maxParallel) }
          : {}),
      }
      return {
        config: {
          ...merged,
          model: normalizeModel(merged.agent, merged.model),
        },
      }
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

// Union-by-id merge: if both sources have the same session id, keep the one
// with the newer updatedAt. Used during hydration to reconcile the sync LS
// seed with the authoritative async IDB load, without dropping edits made
// while IDB was still loading.
function mergeSessionsById(primary: ChatSession[], secondary: ChatSession[]): ChatSession[] {
  const byId = new Map<string, ChatSession>()
  for (const s of primary) byId.set(s.id, s)
  for (const s of secondary) {
    const existing = byId.get(s.id)
    if (!existing || (s.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      byId.set(s.id, s)
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

if (typeof window !== 'undefined') {
  // ---- Session storage hydration ----
  //
  // Two things to get right here:
  //   1. Race between the sync LS seed and the async server/IDB load — gated
  //      by a `hydrated` flag so the save subscriber doesn't fire early and
  //      clobber the authoritative store.
  //   2. Canvas persistence. The top-level `nodes/edges/projectName` only get
  //      copied into the active session's `canvasSnapshot` when the user
  //      switches or creates a new session. So on a mid-session refresh, the
  //      canvas would evaporate unless we (a) restore it from the active
  //      session on hydrate, and (b) continuously mirror live canvas state
  //      into the active session so saves capture it.

  let hydrated = false

  const attachCanvasToActive = (sessions: ChatSession[]): ChatSession[] => {
    const { activeChatSessionId, nodes, edges, projectName } = useAppStore.getState()
    if (!activeChatSessionId) return sessions
    return sessions.map((s) =>
      s.id === activeChatSessionId
        ? { ...s, canvasSnapshot: { nodes, edges, projectName } }
        : s,
    )
  }

  const restoreActiveCanvas = () => {
    const { activeChatSessionId, chatSessions, locale } = useAppStore.getState()
    if (!activeChatSessionId) return
    const active = chatSessions.find((s) => s.id === activeChatSessionId)
    const snap = active?.canvasSnapshot
    if (!snap) return
    useAppStore.setState({
      nodes: snap.nodes ?? [],
      edges: snap.edges ?? [],
      projectName: snap.projectName ?? translate(locale, 'untitled'),
    })
  }

  // 1. Sync seed from localStorage — fast, for first paint only.
  const lsSessions = loadChatSessions()
  useAppStore.setState({
    chatSessions: lsSessions,
    activeChatSessionId: lsSessions[0]?.id ?? null,
  })
  restoreActiveCanvas()

  // 2. Async load from authoritative source (server file → IDB → LS).
  loadSessions()
    .then((authSessions) => {
      const current = useAppStore.getState().chatSessions
      const merged = mergeSessionsById(authSessions, current)

      if (
        merged.length !== current.length ||
        merged.some((s, i) => s.id !== current[i]?.id || s.updatedAt !== current[i]?.updatedAt)
      ) {
        const activeId = useAppStore.getState().activeChatSessionId
        useAppStore.setState({
          chatSessions: merged,
          activeChatSessionId:
            activeId && merged.some((s) => s.id === activeId) ? activeId : merged[0]?.id ?? null,
        })
        restoreActiveCanvas()
      }
      hydrated = true

      if (merged.length !== authSessions.length) {
        saveSessions(attachCanvasToActive(merged))
      }
    })
    .catch((err) => {
      console.error('[store] Session hydration failed; continuing on LS-only state', err)
      hydrated = true
    })

  // 3. Save on change — gated until hydration completes. Save whenever the
  // session list OR the live canvas changes, and always mirror the current
  // canvas into the active session before persisting.
  useAppStore.subscribe((state, previousState) => {
    if (!hydrated) return
    const sessionsChanged = state.chatSessions !== previousState.chatSessions
    const canvasChanged =
      state.nodes !== previousState.nodes ||
      state.edges !== previousState.edges ||
      state.projectName !== previousState.projectName
    if (!sessionsChanged && !canvasChanged) return
    saveSessions(attachCanvasToActive(state.chatSessions))
  })

  // 4. Flush pending saves before the tab goes away.
  const flushNow = () => flushSave(attachCanvasToActive(useAppStore.getState().chatSessions))
  window.addEventListener('beforeunload', flushNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}
