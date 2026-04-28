import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const AGENT_FILE = path.join(REPO_ROOT, '.claude', 'agents', 'codex-rescue.md')

describe('codex-rescue project-level override', () => {
  it('file exists as a project-level override', async () => {
    const stat = await fs.stat(AGENT_FILE)
    expect(stat.isFile()).toBe(true)
  })

  it('always passes --model gpt-5.5 by default', async () => {
    const content = await fs.readFile(AGENT_FILE, 'utf-8')
    expect(content).toMatch(/Always pass `--model gpt-5\.5`/)
  })

  it('preserves user-specified model override semantics', async () => {
    const content = await fs.readFile(AGENT_FILE, 'utf-8')
    // Spark shorthand still maps to a different model
    expect(content).toMatch(/gpt-5\.3-codex-spark/)
    // Explicit user model overrides the default pin
    expect(content).toMatch(/overriding the default pin/)
  })

  it('does not contain the old leave-model-unset rule', async () => {
    const content = await fs.readFile(AGENT_FILE, 'utf-8')
    expect(content).not.toMatch(/Leave model unset by default/)
  })
})
