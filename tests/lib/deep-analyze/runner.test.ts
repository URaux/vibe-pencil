import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runDeepAnalyze, type AgentRunnerLike } from '@/lib/deep-analyze/runner'
import { PERSPECTIVE_NAMES, type PerspectiveName } from '@/lib/deep-analyze'
import type { AgentBackend, CustomApiConfig } from '@/lib/agent-runner'
import type { Ir } from '@/lib/ir/schema'

const fixtureIr: Ir = {
  version: '1.0',
  project: {
    name: 'fixture-proj',
    metadata: {
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
      archviberVersion: '0.1.0',
    },
  },
  containers: [{ id: 'ui', name: 'UI Layer', color: 'blue' }],
  blocks: [
    {
      id: 'page',
      name: 'Home Page',
      description: 'landing route',
      status: 'idle',
      container_id: 'ui',
      code_anchors: [{ files: [{ path: 'src/app/page.tsx', symbols: ['Page'] }], primary_entry: 'src/app/page.tsx' }],
    },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

type Outcome =
  | { type: 'success'; markdown: string }
  | { type: 'error'; errorMessage?: string }
  | { type: 'hang' }

class MockRunner extends EventEmitter implements AgentRunnerLike {
  readonly stopAgent = vi.fn((agentId: string) => {
    this.stopped.push(agentId)
  })

  readonly spawnAgent = vi.fn(
    (
      nodeId: string,
      _prompt: string,
      _backend: AgentBackend,
      _workDir: string,
      _model?: string,
      _customApiConfig?: CustomApiConfig,
      _ccSessionId?: string,
      _systemPrompt?: string
    ) => {
      const perspective = nodeId.replace('deep-analyze-', '') as PerspectiveName
      const agentId = `agent-${perspective}-${this.nextId++}`
      const outcome = this.outcomes.get(perspective) ?? { type: 'success', markdown: `${perspective} report` }

      queueMicrotask(() => {
        if (outcome.type === 'hang') {
          return
        }

        if (outcome.type === 'success') {
          this.emit('output', { agentId, nodeId, text: outcome.markdown })
          this.emit('status', { agentId, nodeId, status: 'done' })
          return
        }

        this.emit('status', { agentId, nodeId, status: 'error', error: outcome.errorMessage ?? 'Agent failed' })
      })

      return agentId
    }
  )

  readonly stopped: string[] = []
  private nextId = 0

  constructor(private readonly outcomes: Map<PerspectiveName, Outcome>) {
    super()
  }
}

describe('deep-analyze/runner', () => {
  it('returns five successes in canonical perspective order', async () => {
    const runner = new MockRunner(
      new Map(
        PERSPECTIVE_NAMES.map((perspective) => [
          perspective,
          { type: 'success', markdown: `# ${perspective}\n\nok` } satisfies Outcome,
        ])
      )
    )

    const results = await runDeepAnalyze(fixtureIr, process.cwd(), {
      runner,
      workDir: process.cwd(),
      timeoutMs: 50,
    })

    expect(results.map((result) => result.perspective)).toEqual(PERSPECTIVE_NAMES)
    expect(results.every((result) => result.status === 'success')).toBe(true)
    expect(results.map((result) => result.markdown)).toEqual(
      PERSPECTIVE_NAMES.map((perspective) => `# ${perspective}\n\nok`)
    )
  })

  it('marks one perspective as error while others succeed', async () => {
    const runner = new MockRunner(
      new Map<PerspectiveName, Outcome>([
        ['redteam', { type: 'error', errorMessage: 'sandbox denied' }],
      ])
    )

    const results = await runDeepAnalyze(fixtureIr, process.cwd(), {
      runner,
      workDir: process.cwd(),
      timeoutMs: 50,
    })

    const redteam = results.find((result) => result.perspective === 'redteam')
    expect(redteam).toMatchObject({
      perspective: 'redteam',
      status: 'error',
      markdown: '',
      errorMessage: 'sandbox denied',
    })
    expect(results.filter((result) => result.status === 'success')).toHaveLength(4)
  })

  it('times out a hanging perspective and stops its agent', async () => {
    const runner = new MockRunner(
      new Map<PerspectiveName, Outcome>([
        ['static', { type: 'hang' }],
      ])
    )

    const results = await runDeepAnalyze(fixtureIr, process.cwd(), {
      runner,
      workDir: process.cwd(),
      timeoutMs: 25,
    })

    const hanging = results.find((result) => result.perspective === 'static')
    expect(hanging).toMatchObject({
      perspective: 'static',
      status: 'timeout',
      markdown: '',
      errorMessage: 'Timed out after 25ms',
    })
    expect(runner.stopAgent).toHaveBeenCalledTimes(1)
  })

  it('returns errors for all perspectives when all fail', async () => {
    const runner = new MockRunner(
      new Map(
        PERSPECTIVE_NAMES.map((perspective) => [
          perspective,
          { type: 'error', errorMessage: `${perspective} failed` } satisfies Outcome,
        ])
      )
    )

    const results = await runDeepAnalyze(fixtureIr, process.cwd(), {
      runner,
      workDir: process.cwd(),
      timeoutMs: 50,
    })

    expect(results).toHaveLength(5)
    expect(results.every((result) => result.status === 'error')).toBe(true)
    expect(results.every((result) => result.markdown === '')).toBe(true)
  })
})
