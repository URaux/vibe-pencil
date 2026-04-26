import { classifyIntent } from '@/lib/orchestrator'
import type { AgentRunnerLike } from '@/lib/orchestrator/classify'
import type { AgentBackend, AgentStatus } from '@/lib/agent-runner'
import type { Intent } from '@/lib/orchestrator/types'
import { INTENTS } from '@/lib/orchestrator/types'
import type { EvalFixture } from './load-fixtures'

// TODO(W3.D8): extend run-eval to also exercise dispatchIntent once D4 lands.
// TODO(W3.D8): emit metrics JSON for CI consumption.

export type MockOutcome =
  | { type: 'done'; output: string }
  | { type: 'error'; output?: string; errorMessage: string }
  | { type: 'hang'; output?: string }

interface AgentStatusRecord {
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

// Minimal mock runner scoped to a single fixture run.
function makeMockRunner(outcome: MockOutcome): AgentRunnerLike {
  const statusMap = new Map<string, AgentStatusRecord>()
  let nextId = 0
  const hanging = new Set<string>()

  return {
    spawnAgent(_nodeId, _prompt, backend, workDir) {
      const agentId = `eval-agent-${nextId++}`
      statusMap.set(agentId, {
        agentId,
        nodeId: 'orchestrator-classifier',
        prompt: '',
        backend,
        workDir,
        status: 'running',
        output: '',
      })

      if (outcome.type === 'hang') {
        hanging.add(agentId)
        if (outcome.output) {
          statusMap.get(agentId)!.output = outcome.output
        }
        return agentId
      }

      queueMicrotask(() => {
        const status = statusMap.get(agentId)
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
    },

    getStatus(agentId) {
      return statusMap.get(agentId) ?? null
    },

    stopAgent(agentId) {
      if (!hanging.has(agentId)) return
      const status = statusMap.get(agentId)
      if (!status) return
      status.status = 'error'
      status.errorMessage = 'Stopped by user'
    },
  }
}

export interface FixtureResult {
  id: string
  expected: Intent
  actual: Intent
  fallback: boolean
  pass: boolean
}

export interface IntentStats {
  total: number
  pass: number
}

export interface EvalReport {
  totalCount: number
  passCount: number
  accuracy: number
  byIntent: Record<Intent, IntentStats>
  perFixture: FixtureResult[]
}

export async function runEval(
  fixtures: EvalFixture[],
  mockOutcomes: Record<string, MockOutcome>
): Promise<EvalReport> {
  const byIntent = Object.fromEntries(
    INTENTS.map((intent) => [intent, { total: 0, pass: 0 }])
  ) as Record<Intent, IntentStats>

  const perFixture: FixtureResult[] = []

  for (const fixture of fixtures) {
    const outcome = mockOutcomes[fixture.id]
    if (!outcome) {
      throw new Error(`No mock outcome for fixture id '${fixture.id}'`)
    }

    const runner = makeMockRunner(outcome)
    const result = await classifyIntent(fixture.userPrompt, fixture.irSummary, {
      runner,
      timeoutMs: 50,
      confidenceThreshold: 0.6,
      workDir: process.cwd(),
    })

    const pass = result.intent === fixture.expectedIntent
    byIntent[fixture.expectedIntent].total += 1
    if (pass) byIntent[fixture.expectedIntent].pass += 1

    perFixture.push({
      id: fixture.id,
      expected: fixture.expectedIntent,
      actual: result.intent,
      fallback: result.fallback,
      pass,
    })
  }

  const passCount = perFixture.filter((r) => r.pass).length
  return {
    totalCount: fixtures.length,
    passCount,
    accuracy: fixtures.length > 0 ? passCount / fixtures.length : 0,
    byIntent,
    perFixture,
  }
}
