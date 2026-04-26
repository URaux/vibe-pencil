import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendClassifyLog } from '@/lib/orchestrator'

let tmpDir: string

const sampleEntry = {
  timestamp: '2026-04-21T00:00:00.000Z',
  prompt: 'summarize the architecture',
  intent: 'explain' as const,
  confidence: 0.91,
  fallback: false,
  durationMs: 24,
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-classifier-log-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('orchestrator/log', () => {
  it('creates the log file on first write', async () => {
    const logPath = path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl')

    await appendClassifyLog(sampleEntry, { path: logPath })

    const contents = await fs.readFile(logPath, 'utf8')
    expect(contents.trim()).toBe(JSON.stringify(sampleEntry))
  })

  it('appends entries without overwriting', async () => {
    const logPath = path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl')

    await appendClassifyLog(sampleEntry, { path: logPath })
    await appendClassifyLog({ ...sampleEntry, prompt: 'build this', intent: 'build' as const }, { path: logPath })

    const lines = (await fs.readFile(logPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('"prompt":"summarize the architecture"')
    expect(lines[1]).toContain('"prompt":"build this"')
  })

  it('swallows write failures and warns instead of throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('disk full'))

    await expect(
      appendClassifyLog(sampleEntry, { path: path.join(tmpDir, '.archviber', 'cache', 'classifier-log.jsonl') })
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Persistent telemetry tests — Phase 3
// ---------------------------------------------------------------------------

import {
  recordTurnStart,
  recordClassification,
  recordDispatch,
  persistTurn,
  readRecentPersistedTurns,
} from '@/lib/orchestrator/log'

describe('persistent telemetry (Phase 3)', () => {
  let logFile: string

  beforeEach(async () => {
    // tmpDir is created by the outer beforeEach; reuse it.
    logFile = path.join(tmpDir, 'orchestrator-log.jsonl')
    process.env.ARCHVIBER_TELEMETRY_FILE = logFile
    delete process.env.ARCHVIBER_TELEMETRY
  })

  afterEach(() => {
    delete process.env.ARCHVIBER_TELEMETRY_FILE
    delete process.env.ARCHVIBER_TELEMETRY
  })

  it('persistTurn appends a JSONL line', async () => {
    await persistTurn({
      timestamp: '2026-04-26T00:00:00Z',
      userPromptHash: 'abc123',
      irBlocks: 5,
      intent: 'explain',
      confidence: 0.9,
      fallback: false,
      dispatchStatus: 'ok',
    })
    const text = await fs.readFile(logFile, 'utf8')
    const parsed = JSON.parse(text.trim())
    expect(parsed.userPromptHash).toBe('abc123')
    expect(parsed.intent).toBe('explain')
  })

  it('multiple persistTurn calls produce one JSONL line each', async () => {
    const base = {
      timestamp: '2026-04-26T00:00:00Z',
      userPromptHash: 'h',
      irBlocks: 1,
      intent: 'explain' as const,
      confidence: 0.9,
      fallback: false,
      dispatchStatus: 'ok' as const,
    }
    await persistTurn({ ...base, userPromptHash: 'a' })
    await persistTurn({ ...base, userPromptHash: 'b' })
    await persistTurn({ ...base, userPromptHash: 'c' })

    const lines = (await fs.readFile(logFile, 'utf8')).split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).userPromptHash).toBe('a')
    expect(JSON.parse(lines[2]).userPromptHash).toBe('c')
  })

  it('ARCHVIBER_TELEMETRY=0 disables persistence', async () => {
    process.env.ARCHVIBER_TELEMETRY = '0'
    await persistTurn({
      timestamp: '2026-04-26T00:00:00Z',
      userPromptHash: 'should-not-write',
      irBlocks: 0,
    })
    let exists = false
    try {
      await fs.access(logFile)
      exists = true
    } catch {
      // expected
    }
    expect(exists).toBe(false)
  })

  it('readRecentPersistedTurns returns [] when file absent', async () => {
    const result = await readRecentPersistedTurns()
    expect(result).toEqual([])
  })

  it('readRecentPersistedTurns honors limit', async () => {
    const base = { timestamp: 't', userPromptHash: 'h', irBlocks: 1 }
    for (let i = 0; i < 10; i++) {
      await persistTurn({ ...base, userPromptHash: `h${i}` })
    }
    const last5 = await readRecentPersistedTurns(5)
    expect(last5).toHaveLength(5)
    expect(last5[0].userPromptHash).toBe('h5')
    expect(last5[4].userPromptHash).toBe('h9')
  })

  it('readRecentPersistedTurns skips malformed lines', async () => {
    await fs.mkdir(path.dirname(logFile), { recursive: true })
    await fs.writeFile(
      logFile,
      [
        JSON.stringify({ timestamp: 't', userPromptHash: 'good1', irBlocks: 0 }),
        '{not valid json',
        JSON.stringify({ timestamp: 't', userPromptHash: 'good2', irBlocks: 0 }),
      ].join('\n') + '\n',
      'utf8',
    )
    const result = await readRecentPersistedTurns()
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.userPromptHash)).toEqual(['good1', 'good2'])
  })

  it('recordDispatch triggers persistTurn end-to-end', async () => {
    const record = recordTurnStart({ userPromptHash: 'e2e-hash', irBlocks: 3 })
    recordClassification(record, { intent: 'explain', confidence: 0.95, fallback: false })
    recordDispatch(record, { intent: 'explain', status: 'ok' })

    // recordDispatch's persistTurn is fire-and-forget; flush a tick.
    await new Promise((r) => setTimeout(r, 50))

    const persisted = await readRecentPersistedTurns()
    const latest = persisted[persisted.length - 1]
    expect(latest.userPromptHash).toBe('e2e-hash')
    expect(latest.intent).toBe('explain')
    expect(latest.dispatchStatus).toBe('ok')
  })
})
