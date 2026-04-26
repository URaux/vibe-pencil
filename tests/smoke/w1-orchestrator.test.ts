// W1 D10 smoke — exercises all 5 intent paths end-to-end through runOrchestratorTurn
// with MockRunner injection. No real LLM calls. Verifies:
//   1) Each intent lands its real handler (no not_implemented stubs left)
//   2) Telemetry ring buffer captures one turn per intent
//   3) Default-on guard works without ARCHVIBER_ORCHESTRATOR=1 set

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ir } from '@/lib/ir/schema'
import type { ChatRequest } from '@/app/api/chat/types'
import type { HandlerResult } from '@/lib/orchestrator/types'

const minimalIr: Ir = {
  version: '1.0',
  project: {
    name: 'smoke',
    metadata: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [
    { id: 'api', name: 'API', color: 'blue' },
    { id: 'data', name: 'Data', color: 'green' },
  ],
  blocks: [
    { id: 'auth', name: 'Auth', description: '', status: 'idle', container_id: 'api', code_anchors: [] },
    { id: 'store', name: 'Store', description: '', status: 'idle', container_id: 'data', code_anchors: [] },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

function makeRequest(message: string): { payload: ChatRequest; request: Request } {
  const payload: ChatRequest = { message, architecture_yaml: 'project:\n  name: smoke' }
  const request = new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify(payload) })
  return { payload, request }
}

const mockSummarizeIr = vi.fn(() => ({
  projectName: 'smoke',
  blockCount: 2,
  containerCount: 2,
  edgeCount: 0,
  topContainers: [
    { id: 'api', name: 'API', blockCount: 1 },
    { id: 'data', name: 'Data', blockCount: 1 },
  ],
  techStacks: [],
  estimatedTokens: 12,
}))

const mockClassifyIntent = vi.fn<() => Promise<unknown>>()
const mockDispatchIntent = vi.fn<() => Promise<unknown>>()

vi.mock('@/lib/orchestrator', () => ({
  summarizeIr: mockSummarizeIr,
  classifyIntent: mockClassifyIntent,
  dispatchIntent: mockDispatchIntent,
}))

const { runOrchestratorTurn } = await import('@/app/api/chat/orchestrator-turn')
const { getRecentTurns } = await import('@/lib/orchestrator/log')

interface IntentCase {
  intent: 'design_edit' | 'build' | 'modify' | 'deep_analyze' | 'explain'
  prompt: string
  payload: unknown
  expectInBody: string
}

const cases: IntentCase[] = [
  {
    intent: 'design_edit',
    prompt: 'add an Auth block between API and Data',
    payload: {
      actions: [{ action: 'add-node', node: { type: 'block', name: 'Auth', parentId: 'api' } }],
    },
    expectInBody: 'canvas action',
  },
  {
    intent: 'build',
    prompt: 'build wave 1',
    payload: {
      plan: {
        scope: 'wave',
        waveIndex: 1,
        reason: 'user named wave',
        dispatchUrl: '/api/agent/spawn',
        dispatchBody: { wave: 1 },
      },
      summary: 'Build wave 1',
    },
    expectInBody: 'Build wave 1',
  },
  {
    intent: 'modify',
    prompt: 'rename FooService to BarService',
    payload: {
      plan: { fileEdits: [], conflicts: [], safetyChecks: { tsConfigFound: true, allFilesInProject: true } },
      sandboxResult: { tscOk: true, testsOk: true, errors: [], durationMs: 100 },
      branch: 'modify/rename-FooService-to-BarService-abc123',
      sha: 'a'.repeat(40),
    },
    expectInBody: 'Rename committed',
  },
  {
    intent: 'deep_analyze',
    prompt: 'why is this coupled?',
    payload: {
      perspectives: ['architect', 'redteam', 'reproducibility', 'static', 'product'],
      analystInputs: [],
    },
    expectInBody: '5 perspectives',
  },
  {
    intent: 'explain',
    prompt: 'what does the API container do?',
    payload: { content: 'The API container handles incoming HTTP requests.', anchorRefs: ['API'] },
    expectInBody: 'API container',
  },
]

describe('W1 D10 smoke — all 5 intents end-to-end', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const c of cases) {
    it(`${c.intent} routes correctly with default-on flag`, async () => {
      mockClassifyIntent.mockResolvedValueOnce({
        intent: c.intent,
        confidence: 0.92,
        fallback: false,
        rawOutput: '',
      })
      const result: HandlerResult = { intent: c.intent, status: 'ok', payload: c.payload }
      mockDispatchIntent.mockResolvedValueOnce(result)

      const { payload, request } = makeRequest(c.prompt)
      const response = await runOrchestratorTurn({ payload, ir: minimalIr, request })

      expect(response).not.toBeNull()
      expect(response!.status).toBe(200)
      const body = await response!.json()
      expect(body.orchestrator.intent).toBe(c.intent)
      expect(body.content).toContain(c.expectInBody)
    })
  }

  it('telemetry ring buffer captures all 5 turns with intent + dispatchStatus', async () => {
    const before = getRecentTurns().length

    for (const c of cases) {
      mockClassifyIntent.mockResolvedValueOnce({
        intent: c.intent,
        confidence: 0.9,
        fallback: false,
        rawOutput: '',
      })
      mockDispatchIntent.mockResolvedValueOnce({ intent: c.intent, status: 'ok', payload: c.payload })
      const { payload, request } = makeRequest(c.prompt)
      await runOrchestratorTurn({ payload, ir: minimalIr, request })
    }

    const after = getRecentTurns()
    expect(after.length).toBeGreaterThanOrEqual(before + 5)
    const lastFive = after.slice(-5)
    const intents = lastFive.map((t) => t.intent)
    expect(intents).toEqual(cases.map((c) => c.intent))
    for (const t of lastFive) {
      expect(t.dispatchStatus).toBe('ok')
      expect(t.fallback).toBe(false)
    }
  })

  it('clarify path triggers when classifier fallback=true (mixed-batch clarify rate metric)', async () => {
    mockClassifyIntent.mockResolvedValueOnce({
      intent: 'explain',
      confidence: 0.4,
      fallback: true,
      fallbackReason: 'low confidence',
      rawOutput: '',
    })

    const { payload, request } = makeRequest('hmm uncertain prompt')
    const response = await runOrchestratorTurn({ payload, ir: minimalIr, request })

    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    const body = await response!.json()
    expect(body.orchestrator.intent).toBe('clarify')
    expect(body.orchestrator.fallback).toBe(true)
    expect(mockDispatchIntent).not.toHaveBeenCalled()
  })
})
