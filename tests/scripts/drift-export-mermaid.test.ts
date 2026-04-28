import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-export-mermaid.mjs')

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-mermaid-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeDrift(overrides: Record<string, unknown> = {}) {
  return {
    clean: false,
    addedBlocks: [],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
    ...overrides,
  }
}

async function run(jsonInput: unknown, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string; code: number }> {
  const inFile = path.join(tmpDir, `input-${Date.now()}.json`)
  await fs.writeFile(inFile, JSON.stringify(jsonInput), 'utf8')
  try {
    const { stdout, stderr } = await exec('node', [SCRIPT, '--in', inFile, ...extraArgs])
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('drift-export-mermaid', () => {
  it('clean report emits no_drift node', async () => {
    const { stdout, code } = await run({ clean: true, report: { clean: true } })
    expect(code).toBe(0)
    expect(stdout).toContain('no_drift')
    expect(stdout).toContain('flowchart LR')
  })

  it('clean report (raw DriftReport shape) emits no_drift', async () => {
    const { stdout, code } = await run(makeDrift({ clean: true }))
    expect(code).toBe(0)
    expect(stdout).toContain('no_drift')
  })

  it('added block gets green class and + prefix', async () => {
    const drift = makeDrift({
      addedBlocks: [{ id: 'blk1', name: 'UserService', container_id: null, code_anchors: [] }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toContain('class blk1 added')
    expect(stdout).toContain('+ UserService')
    expect(stdout).toContain('#2da44e')
  })

  it('removed block gets red class and - prefix', async () => {
    const drift = makeDrift({
      removedBlocks: [{ id: 'blk2', name: 'OldService', container_id: null, code_anchors: [] }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toContain('class blk2 removed')
    expect(stdout).toContain('- OldService')
    expect(stdout).toContain('#cf222e')
  })

  it('changed block gets amber class and ~ prefix', async () => {
    const before = { id: 'blk3', name: 'AuthService', container_id: null, code_anchors: [] }
    const after = { ...before, name: 'AuthService' }
    const drift = makeDrift({
      changedBlocks: [{ blockId: 'blk3', before, after, changes: ['code_anchors'] }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toContain('class blk3 changed')
    expect(stdout).toContain('~ AuthService')
    expect(stdout).toContain('#d4a017')
  })

  it('added edge rendered with green linkStyle', async () => {
    const drift = makeDrift({
      addedEdges: [{ id: 'e1', source: 'blk1', target: 'blk2', type: 'calls' }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toMatch(/linkStyle\s+0\s+stroke:#2da44e/)
    expect(stdout).toContain('blk1 --> blk2')
  })

  it('removed edge rendered dashed with red linkStyle', async () => {
    const drift = makeDrift({
      removedEdges: [{ id: 'e2', source: 'src', target: 'tgt', type: 'calls' }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toContain('src -.-> tgt')
    expect(stdout).toMatch(/linkStyle\s+0\s+stroke:#cf222e/)
  })

  it('added container rendered as subgraph with added class', async () => {
    const drift = makeDrift({
      addedContainers: [{ id: 'ctr1', name: 'NewLayer', color: 'blue' }],
    })
    const { stdout, code } = await run(drift)
    expect(code).toBe(0)
    expect(stdout).toContain('subgraph ctr1')
    expect(stdout).toContain('+ NewLayer')
    expect(stdout).toContain('class ctr1 added')
  })

  it('--out writes to file', async () => {
    const outFile = path.join(tmpDir, 'out.mmd')
    const drift = makeDrift({ clean: true })
    const { code } = await run(drift, ['--out', outFile])
    expect(code).toBe(0)
    const content = await fs.readFile(outFile, 'utf8')
    expect(content).toContain('flowchart LR')
    expect(content).toContain('no_drift')
  })

  it('invalid JSON exits with code 1', async () => {
    const inFile = path.join(tmpDir, 'bad.json')
    await fs.writeFile(inFile, 'not json', 'utf8')
    try {
      await exec('node', [SCRIPT, '--in', inFile])
      expect.fail('should have thrown')
    } catch (err: unknown) {
      expect((err as { code?: number }).code).toBe(1)
    }
  })

  it('includes classDef declarations', async () => {
    const drift = makeDrift({ addedBlocks: [{ id: 'x', name: 'X', container_id: null, code_anchors: [] }] })
    const { stdout } = await run(drift)
    expect(stdout).toContain('classDef added')
    expect(stdout).toContain('classDef removed')
    expect(stdout).toContain('classDef changed')
  })
})
