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

interface AppState {
  nodes: Node<ArchitectNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  addNode: (node: Node<ArchitectNodeData>) => void
  updateNodeData: (id: string, data: Partial<ArchitectNodeData>) => void
  updateNodeStatus: (id: string, status: BuildStatus, summary?: string, errorMessage?: string) => void
  projectName: string
  setProjectName: (name: string) => void
  config: ProjectConfig
  setConfig: (config: Partial<ProjectConfig>) => void
  history: HistoryEntry[]
  addHistory: (entry: HistoryEntry) => void
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
  addNode: (node) => set({ nodes: [...get().nodes, node] }),
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
  projectName: 'untitled',
  setProjectName: (name) => set({ projectName: name }),
  config: { agent: 'claude-code', workDir: './output', maxParallel: 3 },
  setConfig: (config) => set({ config: { ...get().config, ...config } }),
  history: [],
  addHistory: (entry) => set({ history: [...get().history, entry] }),
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  chatOpen: false,
  setChatOpen: (open) => set({ chatOpen: open }),
}))
