import { create } from 'zustand'
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react'
import type { ArchitectNodeData, ProjectConfig, HistoryEntry, BuildStatus } from './types'

type SaveState = 'saved' | 'saving'

interface BuildState {
  active: boolean
  currentWave: number
  totalWaves: number
  targetNodeIds: string[]
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
}

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
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }),
  updateNodeStatus: (id, status, summary, errorMessage) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, status, summary, errorMessage } } : n
      ),
    }),
  projectName: '未命名项目',
  setProjectName: (name) => set({ projectName: name }),
  config: { agent: 'claude-code', workDir: './output', maxParallel: 3 },
  setConfig: (config) => set({ config: { ...get().config, ...config } }),
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
}))
