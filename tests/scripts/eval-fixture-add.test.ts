import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'eval-fixture-add.mjs')

let tmpDir: string
let fixturesPath: string

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec('node', [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, EVAL_FIXTURES_PATH: fixturesPath },
    })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-fixture-add-'))
  fixturesPath = path.join(tmpDir, 'intents.jsonl')
  // Seed with one existing fixture
  await fs.writeFile(
    fixturesPath,
    JSON.stringify({
      id: 'de-01',
      userPrompt: 'existing prompt',
      expectedIntent: 'design_edit',
      expectedConfidence: 1,
    }) + '\n',
    'utf8',
  )
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('scripts/eval-fixture-add.mjs', () => {
  it('appends a new fixture with auto-generated id', async () => {
    const { stdout, code } = await run(['--prompt', 'a brand new prompt', '--intent', 'explain'])
    expect(code).toBe(0)
    expect(stdout).toContain('ex-01')

    const lines = (await fs.readFile(fixturesPath, 'utf8')).split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1]!)
    expect(last.id).toBe('ex-01')
    expect(last.userPrompt).toBe('a brand new prompt')
    expect(last.expectedIntent).toBe('explain')
  })

  it('rejects invalid intent', async () => {
    const { stderr, code } = await run(['--prompt', 'something', '--intent', 'bogus_intent'])
    expect(code).toBe(1)
    expect(stderr).toContain('invalid intent')
  })

  it('refuses duplicate prompt', async () => {
    const { stderr, code } = await run(['--prompt', 'existing prompt', '--intent', 'build'])
    expect(code).toBe(1)
    expect(stderr).toContain('duplicate')
  })

  it('refuses duplicate id when --id is explicitly provided', async () => {
    const { stderr, code } = await run([
      '--prompt',
      'totally unique prompt xyz',
      '--intent',
      'build',
      '--id',
      'de-01',
    ])
    expect(code).toBe(1)
    expect(stderr).toContain('de-01')
  })
})
