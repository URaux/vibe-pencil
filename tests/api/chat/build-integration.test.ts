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
    { id: 'data', name: 'Data', color: 'green' },
  ],
  blocks: [{ id: 'auth', name: 'Auth', description: '', status: 'idle', container_id: 'api', code_anchors: [] }],
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
  containerCount: 2,
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

describe('build integration (orchestrator-turn)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('build wave 1 ok → response includes plan with scope=wave', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'build',
      confidence: 0.95,
      fallback: false,
      rawOutput: '',
    })

    const okResult: HandlerResult = {
      intent: 'build',
      status: 'ok',
      payload: {
        plan: {
          scope: 'wave',
          waveIndex: 1,
          reason: 'user named wave 1',
          dispatchUrl: '/api/agent/spawn',
          dispatchBody: { wave: 1 },
        },
        summary: 'Build wave 1',
      },
    }
    mockDispatchIntent.mockResolvedValueOnce(okResult)

    const payload = basePayload('build wave 1')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request: makeRequest(payload) })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('build')
    expect(body.content).toContain('Build wave 1')
  })

  it('build with unknown blockId → handler returns error → response status 500', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'build',
      confidence: 0.9,
      fallback: false,
      rawOutput: '',
    })

    const errorResult: HandlerResult = {
      intent: 'build',
      status: 'error',
      error: 'unknown block ID(s): does-not-exist',
    }
    mockDispatchIntent.mockResolvedValueOnce(errorResult)

    const payload = basePayload('build the magic block that does not exist')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request: makeRequest(payload) })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(500)
    const body = await response!.json()
    expect(body.error).toContain('unknown block')
    expect(body.orchestrator.intent).toBe('build')
  })
})
