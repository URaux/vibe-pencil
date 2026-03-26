export type NodeType = 'service' | 'frontend' | 'api' | 'database' | 'queue' | 'external'
export type EdgeType = 'sync' | 'async' | 'bidirectional'
export type BuildStatus = 'idle' | 'building' | 'done' | 'error'

export interface ArchitectNodeData extends Record<string, unknown> {
  name: string
  description: string
  status: BuildStatus
  summary?: string
  errorMessage?: string
}

export interface ArchitectEdge {
  type: EdgeType
  label?: string
}

export interface ProjectConfig {
  agent: 'claude-code' | 'codex'
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
