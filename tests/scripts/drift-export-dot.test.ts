import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-export-dot.mjs')

let tmpDir: string

const ADDED_BLOCK = { id: 'blk-new', name: 'NewService' }
const REMOVED_BLOCK = { id: 'blk-old', name: 'OldService' }
const CHANGED_BLOCK = { id: 'blk-changed', name: 'ChangedService', changes: ['description'] }
const ADDED_EDGE = { id: 'edge-new', source: 'blk-a', target: 'blk-b', type: 'sync' }
const REMOVED_EDGE = { id: 'edge-rm', source: 'blk-c', target: 'blk-d', type: 'async' }

function makeDriftJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    clean: false,
    addedBlocks: [ADDED_BLOCK],
    removedBlocks: [REMOVED_BLOCK],
    changedBlocks: [CHANGED_BLOCK],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [ADDED_EDGE],
    removedEdges: [REMOVED_EDGE],
    ...overrides,
  })
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-dot-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFixture(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf-8')
  return p
}

async function runScript(
  fixturePath: string,
  extraArgs: string[] = []
): Promise<{ stdout: string; stderr: string }> {
  return exec('node', [SCRIPT, '--in', fixturePath, ...extraArgs], { cwd: REPO_ROOT })
}

describe('drift-export-dot script', () => {
  it('Test 1: output contains digraph and is valid DOT skeleton', async () => {
    const fixture = await writeFixture('basic.json', makeDriftJson())
    const { stdout } = await runScript(fixture)
    expect(stdout).toContain('digraph drift {')
    expect(stdout).toContain('rankdir=LR')
    expect(stdout.trim()).toMatch(/\}$/)
  })

  it('Test 2: added blocks emit green-colored nodes', async () => {
    const fixture = await writeFixture('added.json', makeDriftJson())
    const { stdout } = await runScript(fixture)
    expect(stdout).toContain('blk-new')
    expect(stdout).toContain('#2da44e')
  })

  it('Test 3: removed blocks emit red-colored nodes', async () => {
    const fixture = await writeFixture('removed.json', makeDriftJson())
    const { stdout } = await runScript(fixture)
    expect(stdout).toContain('blk-old')
    expect(stdout).toContain('#cf222e')
  })

  it('Test 4: added edges appear with green color and removed edges with red + dashed', async () => {
    const fixture = await writeFixture('edges.json', makeDriftJson())
    const { stdout } = await runScript(fixture)
    expect(stdout).toContain('"blk-a" -> "blk-b"')
    expect(stdout).toContain('added')
    expect(stdout).toContain('"blk-c" -> "blk-d"')
    expect(stdout).toContain('removed')
    expect(stdout).toContain('dashed')
  })

  it('Test 5: clean drift report emits a "no_drift" placeholder node', async () => {
    const cleanJson = JSON.stringify({
      clean: true,
      addedBlocks: [],
      removedBlocks: [],
      changedBlocks: [],
      addedContainers: [],
      removedContainers: [],
      addedEdges: [],
      removedEdges: [],
    })
    const fixture = await writeFixture('clean.json', cleanJson)
    const { stdout } = await runScript(fixture)
    expect(stdout).toContain('digraph drift {')
    expect(stdout).toContain('no_drift')
    expect(stdout).toContain('No drift detected')
  })

  it('Test 6: --out writes to file and stdout is empty', async () => {
    const fixture = await writeFixture('out-test.json', makeDriftJson())
    const outFile = path.join(tmpDir, 'out.dot')
    const { stdout } = await runScript(fixture, ['--out', outFile])
    expect(stdout.trim()).toBe('')
    const written = await fs.readFile(outFile, 'utf-8')
    expect(written).toContain('digraph drift {')
  })

  it('Test 7: exits 1 when --in file does not exist', async () => {
    const result = await exec(
      'node',
      [SCRIPT, '--in', path.join(tmpDir, 'nonexistent.json')],
      { cwd: REPO_ROOT }
    ).catch((e) => e)
    expect((result as { code?: number }).code).toBe(1)
  })

  it('Test 8: exits 1 when --in is missing', async () => {
    const result = await exec('node', [SCRIPT], { cwd: REPO_ROOT }).catch((e) => e)
    expect((result as { code?: number }).code).toBe(1)
  })
})
