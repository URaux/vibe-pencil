import type { AgentBackend } from '@/lib/agent-runner'
import type { Locale } from '@/lib/i18n'
import type { SessionPhase } from '@/lib/store'

export interface FormSubmission {
  questionId?: string
  selections: string[]
  ordered: boolean
}

export interface ChatRequest {
  message: string
  formSubmission?: FormSubmission
  formSubmissions?: FormSubmission[]
  history?: { role: 'user' | 'assistant'; content: string }[]
  nodeContext?: string
  selectedNodeId?: string
  codeContext?: string
  buildSummaryContext?: string
  architecture_yaml: string
  backend?: AgentBackend
  model?: string
  locale?: Locale
  phase?: SessionPhase
  customApiBase?: string
  customApiKey?: string
  customApiModel?: string
  ccSessionId?: string
  sessionId?: string
  stream?: boolean
}
