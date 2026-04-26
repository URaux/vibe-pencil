import { vi } from 'vitest'
import type { AgentBackend, AgentStatus, CustomApiConfig } from '@/lib/agent-runner'
import type { AgentRunnerLike } from '@/lib/orchestrator/classify'

export type MockOutcome =
  | { type: 'done'; output: string }
  | { type: 'error'; output?: string; errorMessage: string }
  | { type: 'hang'; output?: string }

interface MockStatus {
  agentId: string
  nodeId: string
  prompt: string
  backend: AgentBackend
  workDir: string
  status: AgentStatus
  output: string
  errorMessage?: string
  exitCode?: number | null
}

export class MockRunner implements AgentRunnerLike {
  readonly spawnAgent = vi.fn(
    (
      _nodeId: string,
      _prompt: string,
      _backend: AgentBackend,
      _workDir: string,
      _model?: string,
      _customApiConfig?: CustomApiConfig,
      _ccSessionId?: string,
      _systemPrompt?: string
    ): string => {
      const agentId = `agent-${this.nextId++}`
      this.statusById.set(agentId, {
        agentId,
        nodeId: _nodeId,
        prompt: _prompt,
        backend: _backend,
        workDir: _workDir,
        status: 'running',
        output: '',
      })

      const outcome = this.outcomes.shift() ?? { type: 'done' as const, output: '' }

      if (outcome.type === 'hang') {
        this.hanging.add(agentId)
        if (outcome.output) {
          this.statusById.get(agentId)!.output = outcome.output
        }
        return agentId
      }

      queueMicrotask(() => {
        const status = this.statusById.get(agentId)
        if (!status) return

        if (outcome.type === 'done') {
          status.status = 'done'
          status.output = outcome.output
          return
        }

        status.status = 'error'
        status.output = outcome.output ?? ''
        status.errorMessage = outcome.errorMessage
      })

      return agentId
    }
  )

  readonly getStatus = vi.fn((agentId: string) => this.statusById.get(agentId) ?? null)

  readonly stopAgent = vi.fn((agentId: string) => {
    if (!this.hanging.has(agentId)) return
    const status = this.statusById.get(agentId)
    if (!status) return
    status.status = 'error'
    status.errorMessage = 'Stopped by user'
  })

  private nextId = 0
  private readonly statusById = new Map<string, MockStatus>()
  private readonly hanging = new Set<string>()

  constructor(private readonly outcomes: MockOutcome[] = []) {}
}
