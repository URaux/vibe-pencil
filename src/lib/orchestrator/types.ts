import type { Ir } from '@/lib/ir/schema'
import type { AgentRunnerLike } from './classify'

export type { AgentRunnerLike }

export const INTENTS = ['design_edit', 'build', 'modify', 'deep_analyze', 'explain'] as const

export type Intent = (typeof INTENTS)[number]

export interface ClassifyResult {
  intent: Intent
  confidence: number
  rawOutput: string
  fallback: boolean
  fallbackReason?: string
}

export interface IrSummary {
  projectName: string
  blockCount: number
  containerCount: number
  edgeCount: number
  topContainers: Array<{
    id: string
    name: string
    blockCount: number
  }>
  techStacks: string[]
  estimatedTokens: number
}

export interface HandlerContext {
  userPrompt: string
  irSummary: IrSummary
  ir?: Ir
  classifyResult: ClassifyResult
  runner?: AgentRunnerLike
  workDir?: string
}

export interface HandlerResult {
  intent: Intent
  status: 'ok' | 'not_implemented' | 'error'
  payload?: unknown
  error?: string
}

export type Handler = (ctx: HandlerContext) => Promise<HandlerResult>
