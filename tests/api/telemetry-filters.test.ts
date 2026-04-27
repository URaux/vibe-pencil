import { describe, it, expect } from 'vitest'
import { filterTurns } from '@/app/api/telemetry/route'
import type { TurnRecord } from '@/lib/orchestrator/log'

function makeTurn(overrides: Partial<TurnRecord>): TurnRecord {
  return {
    timestamp: new Date().toISOString(),
    userPromptHash: 'abc12345',
    irBlocks: 3,
    intent: 'explain',
    confidence: 0.9,
    fallback: false,
    dispatchStatus: 'ok',
    ...overrides,
  }
}

const TURNS: TurnRecord[] = [
  makeTurn({ userPromptHash: 'aaa11111', intent: 'explain', dispatchStatus: 'ok' }),
  makeTurn({ userPromptHash: 'bbb22222', intent: 'build', dispatchStatus: 'error' }),
  makeTurn({ userPromptHash: 'ccc33333', intent: 'design_edit', dispatchStatus: 'ok' }),
  makeTurn({ userPromptHash: 'ddd44444', intent: 'explain', dispatchStatus: 'not_implemented' }),
  makeTurn({ userPromptHash: 'aaa55555', intent: 'modify', dispatchStatus: 'ok' }),
]

describe('filterTurns', () => {
  it('no-filter passthrough returns all turns', () => {
    const result = filterTurns(TURNS, { intent: null, status: null, q: null })
    expect(result).toHaveLength(5)
  })

  it('intent filter keeps only matching intents', () => {
    const result = filterTurns(TURNS, { intent: 'explain', status: null, q: null })
    expect(result).toHaveLength(2)
    expect(result.every((t) => t.intent === 'explain')).toBe(true)
  })

  it('intent filter supports comma-separated multi-select', () => {
    const result = filterTurns(TURNS, { intent: 'explain,build', status: null, q: null })
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.intent).sort()).toEqual(['build', 'explain', 'explain'])
  })

  it('status filter keeps only matching dispatch status', () => {
    const result = filterTurns(TURNS, { intent: null, status: 'ok', q: null })
    expect(result).toHaveLength(3)
    expect(result.every((t) => t.dispatchStatus === 'ok')).toBe(true)
  })

  it('q substring filter matches on userPromptHash', () => {
    const result = filterTurns(TURNS, { intent: null, status: null, q: 'aaa' })
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.userPromptHash)).toEqual(['aaa11111', 'aaa55555'])
  })

  it('combined intent + status filters compose correctly', () => {
    const result = filterTurns(TURNS, { intent: 'explain', status: 'ok', q: null })
    expect(result).toHaveLength(1)
    expect(result[0].userPromptHash).toBe('aaa11111')
  })
})
