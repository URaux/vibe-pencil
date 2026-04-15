export type VPNodeType = 'container' | 'block'
export type EdgeType = 'sync' | 'async' | 'bidirectional'
export type BuildStatus = 'idle' | 'waiting' | 'building' | 'done' | 'error' | 'blocked'

export type ContainerColor = 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'slate'

export interface ContainerNodeData extends Record<string, unknown> {
  name: string
  color: ContainerColor
  collapsed: boolean
}

export interface BuildSummary {
  builtAt: number
  durationMs: number
  backend: AgentBackendType
  model?: string
  filesCreated: string[]
  filesModified: string[]
  entryPoint?: string
  dependencies: string[]
  techDecisions: string[]
  warnings: string[]
  errors: string[]
  outputTokenEstimate: number
  truncatedOutput?: string
}

export interface BuildAttempt {
  builtAt: number
  status: 'done' | 'error'
  durationMs: number
  backend: AgentBackendType
  model?: string
  summaryDigest: string
  errorDigest?: string
  filesCreated?: string[]
}

export interface ColumnConstraints {
  primary?: boolean
  unique?: boolean
  notNull?: boolean
  default?: string
  foreign?: { table: string; column: string }
}

export interface SchemaColumn {
  name: string
  type: string
  constraints?: ColumnConstraints
}

export interface SchemaIndex {
  name: string
  columns: string[]
  unique?: boolean
}

export interface SchemaTable {
  name: string
  columns: SchemaColumn[]
  indexes?: SchemaIndex[]
}

export interface BlockSchema {
  tables: SchemaTable[]
}

export interface FKEdgeData {
  edgeType: 'fk'
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
}

export interface BlockNodeData extends Record<string, unknown> {
  name: string
  description: string
  status: BuildStatus
  summary?: string
  errorMessage?: string
  techStack?: string
  schema?: BlockSchema
  schemaRefs?: string[]
  schemaFieldRefs?: Record<string, string[]>
  buildSummary?: BuildSummary
  buildHistory?: BuildAttempt[]
}

export interface ArchitectEdge {
  type: EdgeType
  label?: string
}
export type CanvasNodeData = ContainerNodeData | BlockNodeData

export type AgentBackendType = 'claude-code' | 'codex' | 'gemini' | 'custom-api'

export interface ProjectConfig {
  agent: AgentBackendType
  model: string
  workDir: string
  maxParallel: number
  customApiBase?: string
  customApiKey?: string
  customApiModel?: string
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
