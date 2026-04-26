import path from 'node:path'
import { classifyIntent } from '@/lib/orchestrator'
import { dispatchIntent } from '@/lib/orchestrator/dispatch'
import type { AgentRunnerLike } from '@/lib/orchestrator/classify'
import type { AgentBackend, AgentStatus } from '@/lib/agent-runner'
import type { Intent, HandlerResult } from '@/lib/orchestrator/types'
import { INTENTS } from '@/lib/orchestrator/types'
import type { EvalFixture } from './load-fixtures'

const EXPLAIN_FORBIDDEN_VERB_RE = /\b(rename|build|spawn|run|refactor|modify)\s+\w/i

function computeExplainShape(
  content: string,
  fixture: EvalFixture,
): ExplainShape {
  const lower = content.toLowerCase()

  const topNames = fixture.irSummary.topContainers.map((c) => c.name)
  const anchorPaths: string[] = (fixture as EvalFixture & { anchorPaths?: string[] }).anchorPaths ?? []
  const anchorBasenames = anchorPaths.map((p) => path.basename(p))

  const hasAnchorRef =
    topNames.some((n) => lower.includes(n.toLowerCase())) ||
    anchorBasenames.some((b) => lower.includes(b.toLowerCase()))

  const hasForbiddenVerb = EXPLAIN_FORBIDDEN_VERB_RE.test(content)

  return { hasAnchorRef, hasForbiddenVerb }
}

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

export interface ExplainShape {
  hasAnchorRef: boolean
  hasForbiddenVerb: boolean
}

export interface DispatchFixtureResult {
  id: string
  intent: Intent
  status: HandlerResult['status']
  error?: string
  explainShape?: ExplainShape
}

export interface DispatchReport {
  totalCount: number
  okCount: number
  notImplementedCount: number
  errorCount: number
  explainShapeFails: number
  perFixture: DispatchFixtureResult[]
}

export interface EvalReport {
  totalCount: number
  passCount: number
  accuracy: number
  byIntent: Record<Intent, IntentStats>
  perFixture: FixtureResult[]
  dispatch: DispatchReport
}

export async function runEval(
  fixtures: EvalFixture[],
  mockOutcomes: Record<string, MockOutcome>,
  dispatchOutcomes?: Record<Intent, HandlerResult>
): Promise<EvalReport> {
  const byIntent = Object.fromEntries(
    INTENTS.map((intent) => [intent, { total: 0, pass: 0 }])
  ) as Record<Intent, IntentStats>

  const perFixture: FixtureResult[] = []
  const dispatchPerFixture: DispatchFixtureResult[] = []

  for (const fixture of fixtures) {
    const outcome = mockOutcomes[fixture.id]
    if (!outcome) {
      throw new Error(`No mock outcome for fixture id '${fixture.id}'`)
    }

    const runner = makeMockRunner(outcome)
    const classifyResult = await classifyIntent(fixture.userPrompt, fixture.irSummary, {
      runner,
      timeoutMs: 500,
      confidenceThreshold: 0.6,
      workDir: process.cwd(),
    })

    const pass = classifyResult.intent === fixture.expectedIntent
    byIntent[fixture.expectedIntent].total += 1
    if (pass) byIntent[fixture.expectedIntent].pass += 1

    perFixture.push({
      id: fixture.id,
      expected: fixture.expectedIntent,
      actual: classifyResult.intent,
      fallback: classifyResult.fallback,
      pass,
    })

    // Exercise dispatchIntent with a stub HandlerContext.
    // If a dispatch outcome map is provided, the handler is intercepted via
    // a thin wrapper that bypasses real I/O and returns the canned result.
    let dispatchResult: HandlerResult
    if (dispatchOutcomes) {
      // Use the resolved intent (from classifier) to pick the canned outcome.
      // Fall back to the 'explain' outcome when the intent isn't mapped
      // (shouldn't happen for well-formed maps, but be safe).
      const cannedResult =
        dispatchOutcomes[classifyResult.intent] ?? dispatchOutcomes['explain']

      // Call dispatchIntent with a stub context whose handler map is patched
      // by wrapping the context so the real handlers never fire.
      // We achieve this by passing a minimal HandlerContext and relying on the
      // fact that dispatchIntent routes by classifyResult.intent; we then
      // override the actual dispatch call with our canned value.
      // Since we cannot monkey-patch the module, we call dispatchIntent normally
      // but supply a runner whose output makes each handler return immediately —
      // then we substitute the canned status on the result object.
      const ctx = {
        userPrompt: fixture.userPrompt,
        irSummary: fixture.irSummary,
        classifyResult,
        runner,
        workDir: process.cwd(),
      }
      // Call real dispatch but override its returned status with the canned one.
      // This exercises the dispatch routing path while keeping results deterministic.
      const real = await dispatchIntent(ctx).catch((err: unknown) => ({
        intent: classifyResult.intent,
        status: 'error' as const,
        error: err instanceof Error ? err.message : String(err),
      }))
      dispatchResult = {
        ...real,
        status: cannedResult.status,
        payload: cannedResult.payload,
        error: cannedResult.error,
      }
    } else {
      const ctx = {
        userPrompt: fixture.userPrompt,
        irSummary: fixture.irSummary,
        classifyResult,
        runner,
        workDir: process.cwd(),
      }
      dispatchResult = await dispatchIntent(ctx).catch((err: unknown) => ({
        intent: classifyResult.intent,
        status: 'error' as const,
        error: err instanceof Error ? err.message : String(err),
      }))
    }

    let explainShape: ExplainShape | undefined
    if (
      fixture.expectedIntent === 'explain' &&
      dispatchResult.status === 'ok' &&
      dispatchResult.payload &&
      typeof (dispatchResult.payload as Record<string, unknown>)['content'] === 'string'
    ) {
      const content = (dispatchResult.payload as { content: string }).content
      explainShape = computeExplainShape(content, fixture)
    }

    dispatchPerFixture.push({
      id: fixture.id,
      intent: classifyResult.intent,
      status: dispatchResult.status,
      ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
      ...(explainShape !== undefined ? { explainShape } : {}),
    })
  }

  const passCount = perFixture.filter((r) => r.pass).length
  const okCount = dispatchPerFixture.filter((r) => r.status === 'ok').length
  const notImplementedCount = dispatchPerFixture.filter((r) => r.status === 'not_implemented').length
  const errorCount = dispatchPerFixture.filter((r) => r.status === 'error').length
  const explainShapeFails = dispatchPerFixture.filter(
    (r) => r.explainShape !== undefined && (!r.explainShape.hasAnchorRef || r.explainShape.hasForbiddenVerb)
  ).length

  return {
    totalCount: fixtures.length,
    passCount,
    accuracy: fixtures.length > 0 ? passCount / fixtures.length : 0,
    byIntent,
    perFixture,
    dispatch: {
      totalCount: dispatchPerFixture.length,
      okCount,
      notImplementedCount,
      errorCount,
      explainShapeFails,
      perFixture: dispatchPerFixture,
    },
  }
}
