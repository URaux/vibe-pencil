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

export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-opus-4-6' | 'claude-haiku-4-5-20251001'
export type CodexModel = 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.3-codex' | 'gpt-5.2-codex' | 'gpt-5.2' | 'gpt-5.1-codex-max' | 'gpt-5.1-codex-mini'

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
