import { describe, expect, it, vi } from 'vitest'
import type { AgentBackend, AgentStatus, CustomApiConfig } from '@/lib/agent-runner'
import { dispatchIntent } from '@/lib/orchestrator/dispatch'
import type { AgentRunnerLike, HandlerContext, IrSummary, ClassifyResult } from '@/lib/orchestrator/types'
import { PERSPECTIVE_NAMES } from '@/lib/deep-analyze/types'
import type { Ir } from '@/lib/ir/schema'

const baseSummary: IrSummary = {
  projectName: 'ArchViber',
  blockCount: 2,
  containerCount: 1,
  edgeCount: 1,
  topContainers: [{ id: 'ui', name: 'UI', blockCount: 2 }],
  techStacks: ['TypeScript'],
  estimatedTokens: 10,
}

function makeClassify(intent: ClassifyResult['intent'], fallback = false): ClassifyResult {
  return { intent, confidence: 0.9, rawOutput: '', fallback, fallbackReason: fallback ? 'low' : undefined }
}

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
  private nextId = 0
  private readonly statusById = new Map<string, MockStatus>()

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
      const agentId = 'agent-' + String(this.nextId++)
      this.statusById.set(agentId, {
        agentId,
        nodeId: _nodeId,
        prompt: _prompt,
        backend: _backend,
        workDir: _workDir,
        status: 'running',
        output: '',
      })
      return agentId
    }
  )

  readonly getStatus = vi.fn((agentId: string) => this.statusById.get(agentId) ?? null)
  readonly stopAgent = vi.fn((_agentId: string): void => { return })
}

const minimalIr: Ir = {
  version: '1.0',
  project: {
    name: 'test',
    metadata: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [],
  blocks: [],
  edges: [],
  audit_log: [],
  seed_state: {},
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    userPrompt: 'test prompt',
    irSummary: baseSummary,
    classifyResult: makeClassify('explain'),
    runner: new MockRunner(),
    ...overrides,
  }
}

describe('orchestrator/dispatch', () => {
  it('routes design_edit intent to design_edit handler', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('design_edit') })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('not_implemented')
  })

  it('routes build intent to build handler', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('build') })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('build')
    expect(result.status).toBe('not_implemented')
  })

  it('routes modify intent to modify handler', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('modify') })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('modify')
    expect(result.status).toBe('not_implemented')
  })

  it('routes explain intent to explain handler', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('explain') })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('explain')
    expect(result.status).toBe('not_implemented')
  })

  it('routes deep_analyze intent to deep_analyze handler (no ir → error)', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('deep_analyze') })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('deep_analyze')
    expect(result.status).toBe('error')
  })

  it('routes to explain handler when fallback is true regardless of classified intent', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('build', true) })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('explain')
    expect(result.status).toBe('not_implemented')
  })

  it('deep_analyze without ir returns status error', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('deep_analyze'), ir: undefined })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('deep_analyze')
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
  })

  it('deep_analyze with minimal ir returns ok with 5 analystInputs', async () => {
    const ctx = makeCtx({ classifyResult: makeClassify('deep_analyze'), ir: minimalIr })
    const result = await dispatchIntent(ctx)
    expect(result.intent).toBe('deep_analyze')
    expect(result.status).toBe('ok')
    const payload = result.payload as { perspectives: readonly string[]; analystInputs: unknown[] }
    expect(payload.perspectives).toEqual(PERSPECTIVE_NAMES)
    expect(payload.analystInputs).toHaveLength(5)
  })
})
