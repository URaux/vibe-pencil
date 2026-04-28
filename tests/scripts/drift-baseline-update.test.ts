import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-baseline-update.mjs')

let tmpDir: string

const SAMPLE_IR = 'version: "1.0"\nproject:\n  name: "test"\n'

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-baseline-'))
})

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec('node', [SCRIPT, ...args])
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('drift-baseline-update', () => {
  it('Test 1: exits with code 1 and error message when --confirm is absent', async () => {
    const headFile = path.join(tmpDir, 'head.yaml')
    await fs.writeFile(headFile, SAMPLE_IR)
    const baseDir = path.join(tmpDir, '.archviber')

    const { code, stderr } = await run(['--head', headFile, '--base-dir', baseDir])

    expect(code).toBe(1)
    expect(stderr).toMatch(/--confirm/)
  })

  it('Test 2: exits with code 1 when --head is missing (with --confirm)', async () => {
    const baseDir = path.join(tmpDir, '.archviber')
    const { code, stderr } = await run(['--confirm', '--base-dir', baseDir])

    expect(code).toBe(1)
    expect(stderr).toMatch(/usage/)
  })

  it('Test 3: exits with code 1 when head file does not exist', async () => {
    const baseDir = path.join(tmpDir, '.archviber')
    const { code, stderr } = await run([
      '--head', path.join(tmpDir, 'nonexistent.yaml'),
      '--base-dir', baseDir,
      '--confirm',
    ])

    expect(code).toBe(1)
    expect(stderr).toMatch(/not found/)
  })

  it('Test 4: successfully copies head to baseline with --confirm', async () => {
    const headFile = path.join(tmpDir, 'head.yaml')
    await fs.writeFile(headFile, SAMPLE_IR)
    const baseDir = path.join(tmpDir, '.archviber')

    const { code, stdout } = await run(['--head', headFile, '--base-dir', baseDir, '--confirm'])

    expect(code).toBe(0)
    expect(stdout).toMatch(/baseline updated/)

    const written = await fs.readFile(path.join(baseDir, 'ir.yaml'), 'utf8')
    expect(written).toBe(SAMPLE_IR)
  })

  it('Test 5: creates backup of existing baseline before overwriting', async () => {
    const headFile = path.join(tmpDir, 'head.yaml')
    const headContent = 'version: "1.0"\nproject:\n  name: "new"\n'
    await fs.writeFile(headFile, headContent)

    const baseDir = path.join(tmpDir, '.archviber')
    await fs.mkdir(baseDir, { recursive: true })

    const existingContent = 'version: "1.0"\nproject:\n  name: "old"\n'
    await fs.writeFile(path.join(baseDir, 'ir.yaml'), existingContent)

    const { code, stdout } = await run(['--head', headFile, '--base-dir', baseDir, '--confirm'])

    expect(code).toBe(0)
    expect(stdout).toMatch(/backed up/)

    const backup = await fs.readFile(path.join(baseDir, 'ir.yaml.bak'), 'utf8')
    expect(backup).toBe(existingContent)

    const updated = await fs.readFile(path.join(baseDir, 'ir.yaml'), 'utf8')
    expect(updated).toBe(headContent)
  })

  it('Test 6: no backup created when no prior baseline exists', async () => {
    const headFile = path.join(tmpDir, 'head.yaml')
    await fs.writeFile(headFile, SAMPLE_IR)
    const baseDir = path.join(tmpDir, '.archviber')

    const { code } = await run(['--head', headFile, '--base-dir', baseDir, '--confirm'])

    expect(code).toBe(0)
    const backupExists = await fs.access(path.join(baseDir, 'ir.yaml.bak')).then(() => true).catch(() => false)
    expect(backupExists).toBe(false)
  })

  it('Test 7: creates .archviber dir if it does not exist', async () => {
    const headFile = path.join(tmpDir, 'head.yaml')
    await fs.writeFile(headFile, SAMPLE_IR)
    const baseDir = path.join(tmpDir, 'new-archviber-dir')

    // Should not exist yet
    const dirExistsBefore = await fs.access(baseDir).then(() => true).catch(() => false)
    expect(dirExistsBefore).toBe(false)

    const { code } = await run(['--head', headFile, '--base-dir', baseDir, '--confirm'])

    expect(code).toBe(0)
    const dirExistsAfter = await fs.access(baseDir).then(() => true).catch(() => false)
    expect(dirExistsAfter).toBe(true)
  })
})
