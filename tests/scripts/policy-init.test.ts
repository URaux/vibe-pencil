import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { parse as parseYaml } from 'yaml'
import { policySchema } from '@/lib/policy/schema'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'policy-init.mjs')

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-init-test-'))
  // Copy .archviber dir skeleton into tmpDir
  const archviberSrc = path.join(REPO_ROOT, '.archviber')
  const archviberDst = path.join(tmpDir, '.archviber')
  await fs.mkdir(archviberDst)
  await fs.copyFile(
    path.join(archviberSrc, 'policy.example.yaml'),
    path.join(archviberDst, 'policy.example.yaml'),
  )
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function runScript(args: string[] = []) {
  return exec(process.execPath, [SCRIPT, ...args], { cwd: tmpDir })
}

describe('policy-init.mjs', () => {
  it('Test 1: --yes writes policy.yaml that parses with policySchema', async () => {
    const { stdout } = await runScript(['--yes'])
    const targetPath = path.join(tmpDir, '.archviber', 'policy.yaml')
    const stat = await fs.stat(targetPath)
    expect(stat.isFile()).toBe(true)
    expect(stdout).toContain('policy.yaml')

    const content = await fs.readFile(targetPath, 'utf8')
    const parsed = parseYaml(content)
    const result = policySchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  it('Test 2: refuses to overwrite existing policy.yaml without --force', async () => {
    const targetPath = path.join(tmpDir, '.archviber', 'policy.yaml')
    await fs.writeFile(targetPath, 'drift:\n  failOnRemoved: false\n')

    await expect(runScript(['--yes'])).rejects.toMatchObject({
      code: 1,
    })

    // File should still have original content
    const content = await fs.readFile(targetPath, 'utf8')
    expect(content).toContain('failOnRemoved: false')
  })

  it('Test 3: --yes --force overwrites existing policy.yaml', async () => {
    const targetPath = path.join(tmpDir, '.archviber', 'policy.yaml')
    await fs.writeFile(targetPath, 'drift:\n  failOnRemoved: true\n')

    const { stdout } = await runScript(['--yes', '--force'])
    expect(stdout).toContain('policy.yaml')

    const content = await fs.readFile(targetPath, 'utf8')
    const parsed = parseYaml(content)
    const result = policySchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })
})
