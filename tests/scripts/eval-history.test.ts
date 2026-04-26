import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const SCRIPT = path.resolve(__dirname, '../../scripts/eval-history.mjs')

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2024-01-01T00:00:00.000Z',
    model: 'gpt-4o',
    classifier: {
      accuracy: 0.9,
      byIntent: {
        design_edit: { pass: 9, total: 10 },
        build: { pass: 8, total: 10 },
        modify: { pass: 7, total: 10 },
        deep_analyze: { pass: 6, total: 10 },
        explain: { pass: 5, total: 10 },
      },
    },
    ...overrides,
  }
}

function run(args: string): string {
  return execSync(`node "${SCRIPT}" ${args}`, { encoding: 'utf8' })
}

describe('eval-history.mjs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-history-'))
    // Write 3 synthetic snapshots with distinct dates
    const snaps = [
      makeSnapshot({ generatedAt: '2024-01-01T00:00:00.000Z' }),
      makeSnapshot({ generatedAt: '2024-01-08T00:00:00.000Z', classifier: { accuracy: 0.85, byIntent: { design_edit: { pass: 8, total: 10 }, build: { pass: 7, total: 10 }, modify: { pass: 6, total: 10 }, deep_analyze: { pass: 5, total: 10 }, explain: { pass: 4, total: 10 } } } }),
      makeSnapshot({ generatedAt: '2024-01-15T00:00:00.000Z', classifier: { accuracy: 0.95, byIntent: { design_edit: { pass: 10, total: 10 }, build: { pass: 9, total: 10 }, modify: { pass: 9, total: 10 }, deep_analyze: { pass: 8, total: 10 }, explain: { pass: 9, total: 10 } } } }),
    ]
    snaps.forEach((snap, i) => {
      fs.writeFileSync(
        path.join(tmpDir, `2024-w0${i + 1}-eval.json`),
        JSON.stringify(snap, null, 2),
      )
    })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('markdown output contains all 3 dates', () => {
    const out = run(`--dir "${tmpDir}" --format md`)
    expect(out).toContain('2024-01-01T00:00:00.000Z')
    expect(out).toContain('2024-01-08T00:00:00.000Z')
    expect(out).toContain('2024-01-15T00:00:00.000Z')
  })

  it('markdown output shows accuracy values', () => {
    const out = run(`--dir "${tmpDir}" --format md`)
    expect(out).toContain('90.0%')
    expect(out).toContain('85.0%')
    expect(out).toContain('95.0%')
  })

  it('json output is parseable array with 3 entries and correct fields', () => {
    const out = run(`--dir "${tmpDir}" --format json`)
    const arr = JSON.parse(out)
    expect(arr).toHaveLength(3)
    expect(arr[0].generatedAt).toBe('2024-01-01T00:00:00.000Z')
    expect(arr[0].accuracy).toBe('90.0%')
    expect(arr[0].design_edit).toBe('9/10')
  })
})
