import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnRecord } from '@/lib/orchestrator/log'

function makeTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    userPromptHash: 'abc123',
    irBlocks: 5,
    intent: 'explain',
    confidence: 0.95,
    fallback: false,
    dispatchStatus: 'ok',
    ...overrides,
  }
}

const { readRecentPersistedTurnsMock } = vi.hoisted(() => ({
  readRecentPersistedTurnsMock: vi.fn<() => Promise<TurnRecord[]>>(),
}))

vi.mock('@/lib/orchestrator/log', () => ({
  readRecentPersistedTurns: readRecentPersistedTurnsMock,
}))

import { GET } from '@/app/api/telemetry/route'

describe('GET /api/telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns empty array when log file does not exist', async () => {
    readRecentPersistedTurnsMock.mockResolvedValue([])

    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: TurnRecord[] }
    expect(body.turns).toEqual([])
  })

  it('returns correct shape when turns are present', async () => {
    const turn1 = makeTurn({ userPromptHash: 'hash1', intent: 'explain', dispatchStatus: 'ok' })
    const turn2 = makeTurn({
      userPromptHash: 'hash2',
      intent: 'build',
      fallback: true,
      dispatchStatus: 'error',
      error: 'handler threw',
    })
    readRecentPersistedTurnsMock.mockResolvedValue([turn1, turn2])

    const res = await GET()

    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: TurnRecord[] }
    expect(body.turns).toHaveLength(2)
    expect(body.turns[0]).toMatchObject({
      userPromptHash: 'hash1',
      intent: 'explain',
      dispatchStatus: 'ok',
    })
    expect(body.turns[1]).toMatchObject({
      userPromptHash: 'hash2',
      intent: 'build',
      fallback: true,
      dispatchStatus: 'error',
      error: 'handler threw',
    })
  })
})
