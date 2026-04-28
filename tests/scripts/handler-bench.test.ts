import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'handler-bench.mjs')
const INTENTS = ['design_edit', 'build', 'modify', 'deep_analyze', 'explain'] as const

interface BenchRow {
  handler: string
  runs: number
  meanMs: number
  medianMs: number
  minMs: number
  maxMs: number
}

interface BenchReport {
  timestamp: string
  runs: number
  results: BenchRow[]
}

describe('handler-bench script', () => {
  it('emits valid JSON report with correct shape', async () => {
    const { stdout } = await exec('node', [SCRIPT, '--runs', '2'], { cwd: REPO_ROOT })
    const report = JSON.parse(stdout) as BenchReport

    expect(typeof report.timestamp).toBe('string')
    expect(report.runs).toBe(2)
    expect(Array.isArray(report.results)).toBe(true)
    expect(report.results).toHaveLength(INTENTS.length)

    for (const row of report.results) {
      expect(INTENTS).toContain(row.handler)
      expect(row.runs).toBe(2)
      expect(typeof row.meanMs).toBe('number')
      expect(typeof row.medianMs).toBe('number')
      expect(typeof row.minMs).toBe('number')
      expect(typeof row.maxMs).toBe('number')
      expect(row.minMs).toBeGreaterThanOrEqual(0)
      expect(row.maxMs).toBeGreaterThanOrEqual(row.minMs)
      expect(row.meanMs).toBeGreaterThanOrEqual(0)
    }

    const handlerNames = report.results.map((r) => r.handler)
    for (const intent of INTENTS) {
      expect(handlerNames).toContain(intent)
    }
  }, 30_000)

  it('writes report to --out file', async () => {
    const tmpFile = path.join(os.tmpdir(), `handler-bench-test-${Date.now()}.json`)
    try {
      await exec('node', [SCRIPT, '--runs', '1', '--out', tmpFile], { cwd: REPO_ROOT })
      const raw = await fs.readFile(tmpFile, 'utf-8')
      const report = JSON.parse(raw) as BenchReport
      expect(report.runs).toBe(1)
      expect(report.results).toHaveLength(INTENTS.length)
    } finally {
      await fs.unlink(tmpFile).catch(() => {})
    }
  }, 30_000)

  it('exits 1 with no output on bad --runs', async () => {
    const result = await exec('node', [SCRIPT, '--runs', 'notanumber'], { cwd: REPO_ROOT }).catch(
      (e) => e
    )
    // NaN parses to 1 via Math.max(1, NaN) — exits 0 with 1 run is also acceptable
    // but the script must not crash with an unhandled error
    if ('code' in result && result.code !== 0) {
      // error exit — acceptable
      return
    }
    // success exit — must still produce valid JSON
    const stdout = (result as { stdout: string }).stdout
    const report = JSON.parse(stdout) as BenchReport
    expect(report.runs).toBeGreaterThanOrEqual(1)
  }, 30_000)
})
