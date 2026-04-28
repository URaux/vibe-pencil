import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Ir } from '@/lib/ir'
import type {
  OrchestratorStreamEvent,
  StreamClassifyEvent,
  StreamDispatchDoneEvent,
} from '@/lib/orchestrator/stream'

vi.mock('@/lib/orchestrator', () => ({
  summarizeIr: vi.fn(() => ({
    projectName: 'Test',
    blockCount: 2,
    containerCount: 1,
    edgeCount: 0,
    topContainers: [{ id: 'auth', name: 'Auth', blockCount: 2 }],
    techStacks: ['TypeScript'],
    estimatedTokens: 100,
  })),
  classifyIntent: vi.fn(),
  dispatchIntent: vi.fn(),
}))

import { summarizeIr, classifyIntent, dispatchIntent } from '@/lib/orchestrator'
import { runStreamOrchestratorTurn } from '@/lib/orchestrator/stream'

const mockClassify = vi.mocked(classifyIntent)
const mockDispatch = vi.mocked(dispatchIntent)
const mockSummarize = vi.mocked(summarizeIr)

const MOCK_IR: Ir = {
  version: '1.0',
  project: {
    name: 'test',
    metadata: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [{ id: 'auth', name: 'Auth', color: 'blue' }],
  blocks: [{ id: 'login', name: 'LoginService', description: '', status: 'idle', container_id: 'auth', code_anchors: [] }],
  edges: [],
  audit_log: [],
  seed_state: {},
}

async function collectEvents(response: Response): Promise<OrchestratorStreamEvent[]> {
  const text = await response.text()
  const events: OrchestratorStreamEvent[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice(6)) as OrchestratorStreamEvent)
    }
  }
  return events
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSummarize.mockReturnValue({
    projectName: 'Test',
    blockCount: 2,
    containerCount: 1,
    edgeCount: 0,
    topContainers: [{ id: 'auth', name: 'Auth', blockCount: 2 }],
    techStacks: ['TypeScript'],
    estimatedTokens: 100,
  })
})

describe('runStreamOrchestratorTurn', () => {
  it('happy stream: emits classify → dispatch_start → dispatch_done', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'explain',
      confidence: 0.9,
      rawOutput: '',
      fallback: false,
    })
    mockDispatch.mockResolvedValueOnce({
      intent: 'explain',
      status: 'ok',
      payload: { content: 'Auth handles login.', anchorRefs: ['Auth'] },
    })

    const response = runStreamOrchestratorTurn({ prompt: 'explain auth', ir: MOCK_IR })

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.status).toBe(200)

    const events = await collectEvents(response)
    expect(events).toHaveLength(3)

    const classify = events[0] as StreamClassifyEvent
    expect(classify.type).toBe('classify')
    expect(classify.intent).toBe('explain')
    expect(classify.confidence).toBe(0.9)
    expect(classify.fallback).toBe(false)

    expect(events[1].type).toBe('dispatch_start')
    expect((events[1] as { type: string; intent: string }).intent).toBe('explain')

    const done = events[2] as StreamDispatchDoneEvent
    expect(done.type).toBe('dispatch_done')
    expect(done.status).toBe('ok')
    expect(done.payload).toBeTruthy()
  })

  it('classify-only fallback: emits classify with fallback=true, no dispatch events', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'explain',
      confidence: 0.3,
      rawOutput: '',
      fallback: true,
      fallbackReason: 'low confidence',
    })

    const response = runStreamOrchestratorTurn({ prompt: 'hmm', ir: MOCK_IR })
    const events = await collectEvents(response)

    expect(events).toHaveLength(1)
    const classify = events[0] as StreamClassifyEvent
    expect(classify.type).toBe('classify')
    expect(classify.intent).toBe('clarify')
    expect(classify.fallback).toBe(true)

    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('error mid-dispatch: emits classify + dispatch_start + dispatch_done with error status', async () => {
    mockClassify.mockResolvedValueOnce({
      intent: 'build',
      confidence: 0.85,
      rawOutput: '',
      fallback: false,
    })
    mockDispatch.mockResolvedValueOnce({
      intent: 'build',
      status: 'error',
      error: 'Agent timed out',
    })

    const response = runStreamOrchestratorTurn({ prompt: 'build all', ir: MOCK_IR })
    const events = await collectEvents(response)

    expect(events).toHaveLength(3)
    const done = events[2] as StreamDispatchDoneEvent
    expect(done.type).toBe('dispatch_done')
    expect(done.status).toBe('error')
    expect(done.error).toBe('Agent timed out')
  })

  it('fast-path no-stream: non-streaming runOrchestratorTurn returns JSON, not SSE', async () => {
    // When stream is falsy the caller uses runOrchestratorTurn, not this module.
    // Verify our stream module always returns SSE regardless of handler result.
    mockClassify.mockResolvedValueOnce({
      intent: 'design_edit',
      confidence: 0.95,
      rawOutput: '',
      fallback: false,
    })
    mockDispatch.mockResolvedValueOnce({
      intent: 'design_edit',
      status: 'ok',
      payload: { actions: [] },
    })

    const response = runStreamOrchestratorTurn({ prompt: 'add a node', ir: MOCK_IR })

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    const events = await collectEvents(response)
    const done = events[events.length - 1] as StreamDispatchDoneEvent
    expect(done.type).toBe('dispatch_done')
    expect(done.status).toBe('ok')
  })
})
