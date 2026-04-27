import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildPlan } from '@/lib/orchestrator/handlers/build'

// Mock global fetch used inside the route to call /api/agent/spawn
const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

const { POST } = await import('@/app/api/agent/build/route')

function makePlan(overrides: Partial<BuildPlan> = {}): BuildPlan {
  return {
    scope: 'all',
    reason: 'build everything',
    dispatchUrl: '/api/agent/spawn',
    dispatchBody: { all: true },
    ...overrides,
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/agent/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agent/build', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scope=wave dispatches correctly with waveIndex in body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-wave-2' }), { status: 200 })
    )

    const plan = makePlan({ scope: 'wave', waveIndex: 2, dispatchBody: { wave: 2 } })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string; plan: BuildPlan }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-wave-2')
    expect(json.plan.scope).toBe('wave')
    expect(json.plan.waveIndex).toBe(2)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/agent/spawn')
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ wave: 2 })
  })

  it('scope=blocks dispatches with blockIds array', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-blocks-3' }), { status: 200 })
    )

    const plan = makePlan({
      scope: 'blocks',
      blockIds: ['auth-service', 'user-db'],
      dispatchBody: { blockIds: ['auth-service', 'user-db'] },
    })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string; plan: BuildPlan }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-blocks-3')
    expect(json.plan.blockIds).toEqual(['auth-service', 'user-db'])

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ blockIds: ['auth-service', 'user-db'] })
  })

  it('scope=all dispatches with all:true body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-all-1' }), { status: 200 })
    )

    const plan = makePlan({ scope: 'all', dispatchBody: { all: true } })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string; plan: BuildPlan }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-all-1')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ all: true })
  })

  it('malformed plan (missing plan key) returns 400', async () => {
    const res = await POST(makeRequest({ wrongKey: {} }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/plan/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
