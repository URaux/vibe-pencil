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
  blocks: [
    { id: 'auth', name: 'Auth', description: '', status: 'idle', container_id: 'api', code_anchors: [] },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

const basePayload: ChatRequest = {
  message: 'add an Auth block between API and Data',
  architecture_yaml: 'project:\n  name: test',
}

function makeRequest(payload: ChatRequest = basePayload): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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

describe('design_edit integration (orchestrator-turn)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('design_edit ok → response.json contains actions array', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'design_edit',
      confidence: 0.95,
      fallback: false,
      rawOutput: '',
    })

    const okResult: HandlerResult = {
      intent: 'design_edit',
      status: 'ok',
      payload: {
        actions: [
          { action: 'add-node', node: { type: 'block', name: 'Auth', parentId: 'api' } },
          { action: 'add-edge', edge: { source: 'api', target: 'data', type: 'sync' } },
        ],
      },
    }
    mockDispatchIntent.mockResolvedValueOnce(okResult)

    const response = await runOrchestratorTurn({ payload: basePayload, ir: minimalIr, request: makeRequest() })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('design_edit')
    expect(body.content).toContain('2 canvas action(s)')
    expect(body.content).toContain('add-node')
    expect(body.content).toContain('Auth')
  })

  it('design_edit error → response status 500 with error field', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'design_edit',
      confidence: 0.9,
      fallback: false,
      rawOutput: '',
    })

    const errorResult: HandlerResult = {
      intent: 'design_edit',
      status: 'error',
      error: 'Design edit parse failed: could not extract JSON from agent output',
    }
    mockDispatchIntent.mockResolvedValueOnce(errorResult)

    const response = await runOrchestratorTurn({
      payload: { message: 'add something broken', architecture_yaml: 'project:\n  name: test' },
      ir: minimalIr,
      request: makeRequest({ message: 'add something broken', architecture_yaml: 'project:\n  name: test' }),
    })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(500)
    const body = await response!.json()
    expect(body.error).toBeTruthy()
    expect(body.orchestrator.intent).toBe('design_edit')
  })
})
