export type VPNodeType = 'container' | 'block'
export type EdgeType = 'sync' | 'async' | 'bidirectional'
export type BuildStatus = 'idle' | 'waiting' | 'building' | 'done' | 'error' | 'blocked'

export type ContainerColor = 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'slate'

export interface ContainerNodeData extends Record<string, unknown> {
  name: string
  color: ContainerColor
  collapsed: boolean
}

export interface BlockNodeData extends Record<string, unknown> {
  name: string
  description: string
  status: BuildStatus
  summary?: string
  errorMessage?: string
  techStack?: string
}

export interface ArchitectEdge {
  type: EdgeType
  label?: string
}
export type CanvasNodeData = ContainerNodeData | BlockNodeData

export type AgentBackendType = 'claude-code' | 'codex' | 'gemini'

export interface ProjectConfig {
  agent: AgentBackendType
  model: string
  workDir: string
  maxParallel: number
}

export interface HistoryEntry {
  action: string
  timestamp: string
  status: 'completed' | 'failed' | 'partial'
  summary: string
}

export interface ArchitectProject {
  name: string
  version: string
  canvas: {
    nodes: any[]
    edges: any[]
  }
  config: ProjectConfig
  history: HistoryEntry[]
}
