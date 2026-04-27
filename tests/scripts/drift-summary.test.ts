import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-summary.mjs')

let tmpDir: string

interface DriftSummary {
  addedBlocks: number
  removedBlocks: number
  changedBlocks: number
  addedContainers: number
  removedContainers: number
  addedEdges: number
  removedEdges: number
  total: number
}

function makeSummary(overrides: Partial<DriftSummary> = {}): DriftSummary {
  return {
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlocks: 0,
    addedContainers: 0,
    removedContainers: 0,
    addedEdges: 0,
    removedEdges: 0,
    total: 0,
    ...overrides,
  }
}

async function writeResult(name: string, driftSummary: DriftSummary): Promise<string> {
  const filePath = path.join(tmpDir, name)
  await fs.writeFile(filePath, JSON.stringify({ driftSummary }), 'utf8')
  return filePath
}

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec('node', [SCRIPT, ...args], { cwd: REPO_ROOT })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-summary-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('drift-summary.mjs', () => {
  it('prints full summary with blocks and secondary sections', async () => {
    const filePath = await writeResult('full.json', makeSummary({
      addedBlocks: 3,
      removedBlocks: 1,
      changedBlocks: 2,
      addedContainers: 4,
      removedEdges: 2,
      total: 12,
    }))

    const { stdout, code } = await run([filePath])
    expect(code).toBe(0)
    expect(stdout).toContain('drift:')
    expect(stdout).toContain('+3 blocks')
    expect(stdout).toContain('-1 block')
    expect(stdout).toContain('~2 changed')
    expect(stdout).toContain('4 added containers')
    expect(stdout).toContain('2 removed edges')
  })

  it('suppresses sections with 0 items', async () => {
    const filePath = await writeResult('partial.json', makeSummary({
      addedBlocks: 2,
      total: 2,
    }))

    const { stdout, code } = await run([filePath])
    expect(code).toBe(0)
    expect(stdout).toContain('+2 blocks')
    // No removed/changed blocks, no containers/edges — no parens
    expect(stdout).not.toContain('(')
    expect(stdout).not.toContain('removed')
    expect(stdout).not.toContain('changed')
  })

  it('prints "drift: clean" when all counts are zero', async () => {
    const filePath = await writeResult('clean.json', makeSummary({ total: 0 }))

    const { stdout, code } = await run([filePath])
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('drift: clean')
  })

  it('exits 1 with error message on missing file', async () => {
    const { stderr, code } = await run([path.join(tmpDir, 'nonexistent.json')])
    expect(code).toBe(1)
    expect(stderr).toContain('file not found')
  })
})
