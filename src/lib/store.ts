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
import { getLocale, setLocale as setI18nLocale, translate, type Locale } from './i18n'
import type { ArchitectNodeData, BuildStatus, HistoryEntry, ProjectConfig } from './types'

type SaveState = 'saved' | 'saving'

interface BuildState {
  active: boolean
  currentWave: number
  totalWaves: number
  targetNodeIds: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AppState {
  nodes: Node<ArchitectNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange<Node<ArchitectNodeData>>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  setCanvas: (nodes: Node<ArchitectNodeData>[], edges: Edge[]) => void
  addNode: (node: Node<ArchitectNodeData>) => void
  addCanvasEdge: (edge: Edge) => void
  removeNode: (id: string) => void
  updateNodeData: (id: string, data: Partial<ArchitectNodeData>) => void
  updateNodeStatus: (id: string, status: BuildStatus, summary?: string, errorMessage?: string) => void
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
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  chatHistories: Map<string, ChatMessage[]>
  updateChatHistory: (key: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => void
  clearChatHistories: () => void
}

const initialLocale = getLocale()

export const useAppStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge({ ...connection, type: 'sync' }, get().edges) }),
  setCanvas: (nodes, edges) => set({ nodes, edges, selectedNodeId: null }),
  addNode: (node) => set({ nodes: [...get().nodes, node] }),
  addCanvasEdge: (edge) => set({ edges: addEdge(edge, get().edges) }),
  removeNode: (id) =>
    set({
      nodes: get().nodes.filter((node) => node.id !== id),
      edges: get().edges.filter((edge) => edge.source !== id && edge.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    }),
  updateNodeData: (id, data) =>
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node
      ),
    }),
  updateNodeStatus: (id, status, summary, errorMessage) =>
    set({
      nodes: get().nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, status, summary, errorMessage } } : node
      ),
    }),
  projectName: translate(initialLocale, 'untitled'),
  setProjectName: (name) => set({ projectName: name }),
  config: { agent: 'claude-code', model: 'claude-sonnet-4-6', workDir: './output', maxParallel: 3 },
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
  buildState: { active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] },
  setBuildState: (buildState) =>
    set({
      buildState: {
        ...get().buildState,
        ...buildState,
      },
    }),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  chatOpen: true,
  setChatOpen: (open) => set({ chatOpen: open }),
  chatHistories: new Map(),
  updateChatHistory: (key, updater) => {
    const current = get().chatHistories
    const next = new Map(current)
    next.set(key, updater(next.get(key) ?? []))
    set({ chatHistories: next })
  },
  clearChatHistories: () => set({ chatHistories: new Map() }),
}))
