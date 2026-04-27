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

  it('scope=all: calls spawn with { all: true } and returns agentId', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-all-1' }), { status: 200 })
    )

    const plan = makePlan({ scope: 'all', dispatchBody: { all: true } })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string; plan: BuildPlan }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-all-1')
    expect(json.plan.scope).toBe('all')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/agent/spawn')
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ all: true })
  })

  it('scope=wave: calls spawn with { wave: 1 } and returns agentId', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-wave-1' }), { status: 200 })
    )

    const plan = makePlan({ scope: 'wave', waveIndex: 1, dispatchBody: { wave: 1 } })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-wave-1')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ wave: 1 })
  })

  it('scope=blocks: calls spawn with { blockIds } and returns agentId', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'agent-blocks-1' }), { status: 200 })
    )

    const plan = makePlan({
      scope: 'blocks',
      blockIds: ['auth', 'api'],
      dispatchBody: { blockIds: ['auth', 'api'] },
    })
    const res = await POST(makeRequest({ plan }))
    const json = await res.json() as { agentId: string }

    expect(res.status).toBe(200)
    expect(json.agentId).toBe('agent-blocks-1')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ blockIds: ['auth', 'api'] })
  })

  it('missing plan returns 400', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/plan/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('invalid JSON body returns 400', async () => {
    const req = new Request('http://localhost/api/agent/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spawn returns non-200 → propagates error status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 })
    )

    const plan = makePlan()
    const res = await POST(makeRequest({ plan }))
    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/Spawn failed/i)
  })

  it('dispatches to the dispatchUrl from the plan, not hardcoded path', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agentId: 'x' }), { status: 200 })
    )

    const plan = makePlan({ dispatchUrl: '/api/agent/spawn' })
    await POST(makeRequest({ plan }))

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/agent/spawn')
  })
})
