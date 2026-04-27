/**
 * Tests for scripts/eval-cli.mjs — phase3/eval-cli
 *
 * Each subcommand test verifies:
 *   1. The correct child script is spawned
 *   2. Extra args are forwarded to the child
 *
 * Strategy: run eval-cli.mjs with a real node, but replace each child script
 * with a tiny shim that prints its argv to stdout and exits 0. We verify
 * stdout contains the expected script name and forwarded args.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const EVAL_CLI = path.join(REPO_ROOT, 'scripts', 'eval-cli.mjs')

let tmpScriptsDir: string

/** Shim that prints argv[1] (its own path) + extra args to stdout. */
const SHIM_CONTENT = `
process.stdout.write(JSON.stringify({ script: process.argv[1], args: process.argv.slice(2) }) + '\\n')
process.exit(0)
`

async function writeShim(name: string): Promise<string> {
  const p = path.join(tmpScriptsDir, name)
  await fs.writeFile(p, SHIM_CONTENT, 'utf8')
  return p
}

beforeAll(async () => {
  tmpScriptsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-eval-cli-'))
  // Create shims for all four child scripts
  await Promise.all([
    writeShim('run-eval-live.mjs'),
    writeShim('eval-history.mjs'),
    writeShim('eval-alert.mjs'),
    writeShim('run-eval-multi.mjs'),
  ])
})

afterAll(async () => {
  if (tmpScriptsDir) await fs.rm(tmpScriptsDir, { recursive: true, force: true })
})

async function runCli(subcommand: string, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string }> {
  // Patch __dirname by symlinking eval-cli.mjs into tmpScriptsDir and running from there
  // Simpler: copy eval-cli.mjs into tmpScriptsDir so __dirname resolves to tmpScriptsDir
  const cliCopy = path.join(tmpScriptsDir, 'eval-cli.mjs')
  await fs.copyFile(EVAL_CLI, cliCopy)
  const { stdout, stderr } = await exec('node', [cliCopy, subcommand, ...extraArgs])
  return { stdout, stderr }
}

describe('eval-cli.mjs subcommand dispatch', () => {
  it('Test 1: live → delegates to run-eval-live.mjs and forwards args', async () => {
    const { stdout } = await runCli('live', ['--fixture', 'foo.json'])
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.script).toContain('run-eval-live.mjs')
    expect(parsed.args).toContain('--fixture')
    expect(parsed.args).toContain('foo.json')
  })

  it('Test 2: history → delegates to eval-history.mjs and forwards args', async () => {
    const { stdout } = await runCli('history', ['--dir', 'snapshots/'])
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.script).toContain('eval-history.mjs')
    expect(parsed.args).toContain('--dir')
    expect(parsed.args).toContain('snapshots/')
  })

  it('Test 3: alerts → delegates to eval-alert.mjs and forwards args', async () => {
    const { stdout } = await runCli('alerts', ['--threshold', '0.8'])
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.script).toContain('eval-alert.mjs')
    expect(parsed.args).toContain('--threshold')
    expect(parsed.args).toContain('0.8')
  })

  it('Test 4: multi → delegates to run-eval-multi.mjs and forwards args', async () => {
    const { stdout } = await runCli('multi', ['--models', 'gpt-4,gpt-3.5'])
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.script).toContain('run-eval-multi.mjs')
    expect(parsed.args).toContain('--models')
    expect(parsed.args).toContain('gpt-4,gpt-3.5')
  })
})
