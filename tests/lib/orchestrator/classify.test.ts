import { describe, expect, it, vi } from 'vitest'
import type { AgentBackend, AgentStatus, CustomApiConfig } from '@/lib/agent-runner'
import { classifyIntent, type AgentRunnerLike } from '@/lib/orchestrator'
import type { IrSummary, Intent } from '@/lib/orchestrator'

const baseSummary: IrSummary = {
  projectName: 'ArchViber',
  blockCount: 8,
  containerCount: 3,
  edgeCount: 7,
  topContainers: [
    { id: 'ui', name: 'UI', blockCount: 3 },
    { id: 'api', name: 'API', blockCount: 3 },
    { id: 'data', name: 'Data', blockCount: 2 },
  ],
  techStacks: ['Next.js', 'TypeScript', 'Zod'],
  estimatedTokens: 42,
}

type MockOutcome =
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

class MockRunner implements AgentRunnerLike {
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
    ) => {
      const agentId = `agent-${this.nextId++}`
      this.statusById.set(agentId, {
        agentId,
        nodeId: 'orchestrator-classifier',
        prompt: '',
        backend: 'codex',
        workDir: process.cwd(),
        status: 'running',
        output: '',
      })

      const outcome = this.outcomes.shift() ?? { type: 'done', output: '{"intent":"explain","confidence":0.9,"rationale":"default"}' }
      if (outcome.type === 'hang') {
        this.hanging.add(agentId)
        if (outcome.output) {
          this.statusById.get(agentId)!.output = outcome.output
        }
        return agentId
      }

      queueMicrotask(() => {
        const status = this.statusById.get(agentId)
        if (!status) {
          return
        }

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
    if (!this.hanging.has(agentId)) {
      return
    }
    const status = this.statusById.get(agentId)
    if (!status) {
      return
    }
    status.status = 'error'
    status.errorMessage = 'Stopped by user'
  })

  private nextId = 0
  private readonly statusById = new Map<string, MockStatus>()
  private readonly hanging = new Set<string>()

  constructor(private readonly outcomes: MockOutcome[]) {}
}

const cannedCases: Array<{ prompt: string; expected: Intent }> = [
  { prompt: 'add a block for auth between API Layer and Data Layer', expected: 'design_edit' },
  { prompt: 'connect Canvas Editor to Store', expected: 'design_edit' },
  { prompt: 'remove the edge from Gateway to Billing', expected: 'design_edit' },
  { prompt: 'build this', expected: 'build' },
  { prompt: 'implement Wave 1', expected: 'build' },
  { prompt: 'generate the backend for the payment block', expected: 'build' },
  { prompt: 'rename FooService to BarService', expected: 'modify' },
  { prompt: 'refactor schema-engine.ts', expected: 'modify' },
  { prompt: 'update the UserCard component to use the new hook', expected: 'modify' },
  { prompt: 'why is this coupled?', expected: 'deep_analyze' },
  { prompt: 'security audit this architecture', expected: 'deep_analyze' },
  { prompt: 'what is the riskiest part of this system?', expected: 'deep_analyze' },
  { prompt: 'what does Canvas Editor do?', expected: 'explain' },
  { prompt: 'summarize the architecture', expected: 'explain' },
  { prompt: 'how does the API layer interact with the data layer?', expected: 'explain' },
]

describe('orchestrator/classify', () => {
  it.each(cannedCases)('classifies "$prompt" as $expected', async ({ prompt, expected }) => {
    const runner = new MockRunner([
      { type: 'done', output: `{"intent":"${expected}","confidence":0.92,"rationale":"clear signal"}` },
    ])

    const result = await classifyIntent(prompt, baseSummary, {
      runner,
      timeoutMs: 500,
      confidenceThreshold: 0.6,
      workDir: process.cwd(),
    })

    expect(result).toMatchObject({
      intent: expected,
      confidence: 0.92,
      fallback: false,
    })
  })

  it('parses the first balanced JSON object from noisy output', async () => {
    const runner = new MockRunner([
      { type: 'done', output: 'classification follows\n{"intent":"build","confidence":0.88,"rationale":"implementation request"}\nextra' },
    ])

    const result = await classifyIntent('build it', baseSummary, { runner, timeoutMs: 500 })
    expect(result).toMatchObject({ intent: 'build', fallback: false })
  })

  it('falls back to explain on JSON parse failure', async () => {
    const runner = new MockRunner([{ type: 'done', output: 'not json at all' }])

    const result = await classifyIntent('what is this?', baseSummary, { runner, timeoutMs: 500 })
    expect(result.intent).toBe('explain')
    expect(result.fallback).toBe(true)
    expect(result.fallbackReason).toBeTruthy()
  })

  it('falls back to explain on timeout', async () => {
    const runner = new MockRunner([{ type: 'hang' }])

    const result = await classifyIntent('what is this?', baseSummary, { runner, timeoutMs: 20 })
    expect(result.intent).toBe('explain')
    expect(result.fallback).toBe(true)
    expect(result.fallbackReason).toContain('timeout')
    expect(runner.stopAgent).toHaveBeenCalledTimes(1)
  })

  it('falls back when confidence is below threshold and includes attempted intent', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"intent":"modify","confidence":0.3,"rationale":"ambiguous refactor request"}' },
    ])

    const result = await classifyIntent('tweak this', baseSummary, {
      runner,
      timeoutMs: 500,
      confidenceThreshold: 0.6,
    })

    expect(result).toMatchObject({
      intent: 'explain',
      confidence: 0.3,
      fallback: true,
    })
    expect(result.fallbackReason).toContain('modify')
  })

  it('falls back on invalid intent values', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"intent":"review","confidence":0.95,"rationale":"wrong label"}' },
    ])

    const result = await classifyIntent('audit this', baseSummary, { runner, timeoutMs: 500 })
    expect(result.intent).toBe('explain')
    expect(result.fallback).toBe(true)
    expect(result.fallbackReason).toContain('Invalid intent')
  })
})
