import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { computeHandlerMetrics } from '../../../src/lib/orchestrator/metrics'
import type { TurnRecord } from '../../../src/lib/orchestrator/log'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metrics-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeTurn(
  intent: string,
  dispatchStatus: 'ok' | 'error' | 'not_implemented',
  confidence = 0.9
): TurnRecord {
  return {
    timestamp: new Date().toISOString(),
    userPromptHash: 'abcd1234',
    irBlocks: 5,
    intent: intent as TurnRecord['intent'],
    confidence,
    fallback: false,
    dispatchStatus,
  }
}

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}

describe('computeHandlerMetrics', () => {
  it('case 1: empty logs return zero metrics for all intents', async () => {
    const logPath = path.join(tmpDir, 'empty-log.jsonl')
    const tracePath = path.join(tmpDir, 'empty-trace.jsonl')
    await writeJsonl(logPath, [])
    await writeJsonl(tracePath, [])

    const metrics = await computeHandlerMetrics({ logPath, tracePath })

    for (const [, m] of Object.entries(metrics)) {
      expect(m.totalCalls).toBe(0)
      expect(m.okRate).toBe(0)
      expect(m.errorRate).toBe(0)
      expect(m.avgConfidence).toBe(0)
      expect(m.avgDurationMs).toBeNull()
    }
  })

  it('case 2: ok-rate computed correctly from orchestrator-log', async () => {
    const logPath = path.join(tmpDir, 'okrate-log.jsonl')
    const tracePath = path.join(tmpDir, 'okrate-trace.jsonl')
    await writeJsonl(logPath, [
      makeTurn('explain', 'ok', 0.9),
      makeTurn('explain', 'ok', 0.8),
      makeTurn('explain', 'error', 0.6),
      makeTurn('build', 'ok', 0.95),
    ])
    await writeJsonl(tracePath, [])

    const metrics = await computeHandlerMetrics({ logPath, tracePath })

    expect(metrics.explain.totalCalls).toBe(3)
    expect(metrics.explain.okCount).toBe(2)
    expect(metrics.explain.errorCount).toBe(1)
    expect(metrics.explain.okRate).toBeCloseTo(2 / 3)
    expect(metrics.explain.errorRate).toBeCloseTo(1 / 3)
    expect(metrics.explain.avgConfidence).toBeCloseTo((0.9 + 0.8 + 0.6) / 3)

    expect(metrics.build.totalCalls).toBe(1)
    expect(metrics.build.okRate).toBe(1)
  })

  it('case 3: avgDurationMs sourced from dispatch-trace', async () => {
    const logPath = path.join(tmpDir, 'dur-log.jsonl')
    const tracePath = path.join(tmpDir, 'dur-trace.jsonl')
    await writeJsonl(logPath, [makeTurn('modify', 'ok', 0.85)])
    await writeJsonl(tracePath, [
      { timestamp: new Date().toISOString(), intent: 'modify', promptHash: 'abc', classifierConfidence: 0.85, dispatchStatus: 'ok', durationMs: 120 },
      { timestamp: new Date().toISOString(), intent: 'modify', promptHash: 'abc', classifierConfidence: 0.85, dispatchStatus: 'ok', durationMs: 200 },
    ])

    const metrics = await computeHandlerMetrics({ logPath, tracePath })

    expect(metrics.modify.avgDurationMs).toBeCloseTo(160)
  })

  it('case 4: missing log files are treated as empty (no throw)', async () => {
    const logPath = path.join(tmpDir, 'nonexistent-log.jsonl')
    const tracePath = path.join(tmpDir, 'nonexistent-trace.jsonl')

    // Files don't exist — should not throw
    const metrics = await computeHandlerMetrics({ logPath, tracePath })

    expect(Object.keys(metrics).length).toBeGreaterThan(0)
    for (const m of Object.values(metrics)) {
      expect(m.totalCalls).toBe(0)
    }
  })

  it('case 5: not_implemented status counted separately', async () => {
    const logPath = path.join(tmpDir, 'nimpl-log.jsonl')
    const tracePath = path.join(tmpDir, 'nimpl-trace.jsonl')
    await writeJsonl(logPath, [
      makeTurn('deep_analyze', 'not_implemented', 0.7),
      makeTurn('deep_analyze', 'not_implemented', 0.75),
      makeTurn('deep_analyze', 'ok', 0.9),
    ])
    await writeJsonl(tracePath, [])

    const metrics = await computeHandlerMetrics({ logPath, tracePath })

    expect(metrics.deep_analyze.notImplementedCount).toBe(2)
    expect(metrics.deep_analyze.okCount).toBe(1)
    expect(metrics.deep_analyze.totalCalls).toBe(3)
    // not_implemented not counted in errorRate
    expect(metrics.deep_analyze.errorRate).toBe(0)
  })
})
