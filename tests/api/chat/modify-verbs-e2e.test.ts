import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ir } from '@/lib/ir/schema'
import type { ChatRequest } from '@/app/api/chat/types'
import type { HandlerResult } from '@/lib/orchestrator/types'

const minimalIr: Ir = {
  version: '1.0',
  project: {
    name: 'test',
    metadata: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [
    { id: 'api', name: 'API', color: 'blue' },
  ],
  blocks: [
    { id: 'auth', name: 'Auth', description: '', status: 'idle', container_id: 'api', code_anchors: [] },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

function basePayload(message: string): ChatRequest {
  return { message, architecture_yaml: 'project:\n  name: test' }
}

function makeRequest(payload: ChatRequest): Request {
  return new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(payload) })
}

const mockSummarizeIr = vi.fn(() => ({
  projectName: 'test',
  blockCount: 1,
  containerCount: 1,
  edgeCount: 0,
  topContainers: [{ id: 'api', name: 'API', blockCount: 1 }],
  techStacks: [],
  estimatedTokens: 10,
}))

const mockClassifyIntent = vi.fn<() => Promise<unknown>>()
const mockDispatchIntent = vi.fn<() => Promise<unknown>>()

vi.mock('@/lib/orchestrator', () => ({
  summarizeIr: mockSummarizeIr,
  classifyIntent: mockClassifyIntent,
  dispatchIntent: mockDispatchIntent,
}))

const { runOrchestratorTurn } = await import('@/app/api/chat/orchestrator-turn')

describe('modify verbs e2e (orchestrator-turn)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rename verb routes to handler', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'modify',
      confidence: 0.95,
      fallback: false,
      rawOutput: '',
    })

    const okResult: HandlerResult = {
      intent: 'modify',
      status: 'ok',
      payload: {
        verb: 'rename',
        branch: 'modify/rename-auth-to-authz',
        sha: 'abc1234def5',
        sandboxResult: { tscOk: true, testsOk: true },
      },
    }
    mockDispatchIntent.mockResolvedValueOnce(okResult)

    const payload = basePayload('rename Auth to Authz')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request: makeRequest(payload) })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('modify')
    expect(body.orchestrator.confidence).toBe(0.95)
    const p = okResult.payload as Record<string, unknown>
    expect(p.verb).toBe('rename')
    expect(p.branch).toBe('modify/rename-auth-to-authz')
  })

  it('extract verb routes to handler', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'modify',
      confidence: 0.95,
      fallback: false,
      rawOutput: '',
    })

    const okResult: HandlerResult = {
      intent: 'modify',
      status: 'ok',
      payload: {
        verb: 'extract',
        branch: 'modify/extract-auth-login',
        sha: 'bcd2345ef67',
        sandboxResult: { tscOk: true, testsOk: true },
      },
    }
    mockDispatchIntent.mockResolvedValueOnce(okResult)

    const payload = basePayload('extract login logic from Auth into a separate module')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request: makeRequest(payload) })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('modify')
    const p = okResult.payload as Record<string, unknown>
    expect(p.verb).toBe('extract')
    expect(p.branch).toBe('modify/extract-auth-login')
  })

  it('move verb routes to handler', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'modify',
      confidence: 0.95,
      fallback: false,
      rawOutput: '',
    })

    const okResult: HandlerResult = {
      intent: 'modify',
      status: 'ok',
      payload: {
        verb: 'move',
        branch: 'modify/move-auth-to-data',
        sha: 'cde3456fg78',
        sandboxResult: { tscOk: true, testsOk: true },
      },
    }
    mockDispatchIntent.mockResolvedValueOnce(okResult)

    const payload = basePayload('move Auth block from API container to Data container')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request: makeRequest(payload) })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('modify')
    const p = okResult.payload as Record<string, unknown>
    expect(p.verb).toBe('move')
    expect(p.branch).toBe('modify/move-auth-to-data')
  })
})
