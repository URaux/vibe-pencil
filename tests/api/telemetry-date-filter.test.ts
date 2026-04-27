import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { filterTurnsByDate } from '@/app/api/telemetry/route'
import { readRecentPersistedTurns } from '@/lib/orchestrator/log'
import type { TurnRecord } from '@/lib/orchestrator/log'

function makeTurn(timestamp: string): TurnRecord {
  return { timestamp, userPromptHash: 'h-' + timestamp, irBlocks: 1, intent: 'explain', confidence: 0.9, dispatchStatus: 'ok' }
}

const T1 = '2026-01-15T10:00:00.000Z'
const T2 = '2026-03-01T12:00:00.000Z'
const T3 = '2026-05-20T08:00:00.000Z'
const TURNS = [makeTurn(T1), makeTurn(T2), makeTurn(T3)]

describe('filterTurnsByDate', () => {
  it('no bounds returns all turns', () => {
    expect(filterTurnsByDate(TURNS, {})).toHaveLength(3)
  })
  it('since filters out entries before cutoff', () => {
    expect(filterTurnsByDate(TURNS, { since: '2026-02-01T00:00:00.000Z' }).map((t) => t.timestamp)).toEqual([T2, T3])
  })
  it('until filters out entries after cutoff', () => {
    expect(filterTurnsByDate(TURNS, { until: '2026-04-01T00:00:00.000Z' }).map((t) => t.timestamp)).toEqual([T1, T2])
  })
  it('since + until returns entries in window', () => {
    expect(filterTurnsByDate(TURNS, { since: '2026-02-01T00:00:00.000Z', until: '2026-04-01T00:00:00.000Z' }).map((t) => t.timestamp)).toEqual([T2])
  })
  it('since beyond last entry returns empty', () => {
    expect(filterTurnsByDate(TURNS, { since: '2027-01-01T00:00:00.000Z' })).toHaveLength(0)
  })
})

describe('readRecentPersistedTurns date filter', () => {
  let tmpDir: string
  let logFile: string
  beforeEach(async () => {
    tmpDir = join(tmpdir(), 'archviber-test-' + Date.now())
    await mkdir(tmpDir, { recursive: true })
    logFile = join(tmpDir, 'orchestrator-log.jsonl')
    await writeFile(logFile, TURNS.map((t) => JSON.stringify(t)).join('
') + '
', 'utf8')
  })
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })
  it('since filters entries from disk', async () => {
    const result = await readRecentPersistedTurns(100, { since: '2026-02-01T00:00:00.000Z', path: logFile })
    expect(result.map((t) => t.timestamp)).toEqual([T2, T3])
  })
  it('until filters entries from disk', async () => {
    const result = await readRecentPersistedTurns(100, { until: '2026-04-01T00:00:00.000Z', path: logFile })
    expect(result.map((t) => t.timestamp)).toEqual([T1, T2])
  })
})
