/**
 * Tests for scripts/policy-validate.mjs — phase3/policy-validate-cli
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'policy-validate.mjs')

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-policy-validate-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function write(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec('node', [SCRIPT, ...args])
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('policy-validate.mjs', () => {
  it('Test 1: valid policy — exits 0 with no output', async () => {
    const p = await write('valid.yaml', `
drift:
  failOnRemoved: false
  failOnAdded: false
  failOnChanged: false
  failOnRemovedContainers: false
  failOnRemovedEdges: false
`)
    const { code, stdout, stderr } = await run([p])
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr.trim()).toBe('')
  })

  it('Test 2: invalid YAML — exits 1 with error mentioning invalid YAML', async () => {
    const p = await write('bad.yaml', `drift: {unclosed`)
    const { code, stderr } = await run([p])
    expect(code).toBe(1)
    expect(stderr).toMatch(/invalid yaml/i)
  })

  it('Test 3: schema violation — exits 1 listing field paths', async () => {
    const p = await write('schema-bad.yaml', `
drift:
  unknownField: 42
  maxAddedBlocks: -1
`)
    const { code, stderr } = await run([p])
    expect(code).toBe(1)
    expect(stderr).toMatch(/schema violation/i)
  })

  it('Test 4: file missing — exits 1 with file-not-found message', async () => {
    const { code, stderr } = await run([path.join(tmpDir, 'does-not-exist.yaml')])
    expect(code).toBe(1)
    expect(stderr).toMatch(/not found|cannot read/i)
  })
})
