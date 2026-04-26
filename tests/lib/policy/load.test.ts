import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { loadPolicy } from '@/lib/policy/load'
import { DEFAULT_POLICY } from '@/lib/policy/schema'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-load-'))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('loadPolicy', () => {
  it('returns DEFAULT_POLICY when file absent', async () => {
    const policy = await loadPolicy(tmpRoot)
    expect(policy).toEqual(DEFAULT_POLICY)
  })

  it('parses a minimal opt-in policy', async () => {
    await fs.mkdir(path.join(tmpRoot, '.archviber'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.archviber', 'policy.yaml'),
      'drift:\n  failOnRemoved: true\n',
      'utf8',
    )
    const policy = await loadPolicy(tmpRoot)
    expect(policy.drift.failOnRemoved).toBe(true)
    expect(policy.drift.failOnAdded).toBe(false)
  })

  it('parses thresholds', async () => {
    await fs.mkdir(path.join(tmpRoot, '.archviber'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.archviber', 'policy.yaml'),
      'drift:\n  maxAddedBlocks: 3\n  maxRemovedBlocks: 0\n',
      'utf8',
    )
    const policy = await loadPolicy(tmpRoot)
    expect(policy.drift.maxAddedBlocks).toBe(3)
    expect(policy.drift.maxRemovedBlocks).toBe(0)
  })

  it('throws on malformed YAML', async () => {
    await fs.mkdir(path.join(tmpRoot, '.archviber'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.archviber', 'policy.yaml'),
      'drift:\n  failOnRemoved: [not a bool\n',
      'utf8',
    )
    await expect(loadPolicy(tmpRoot)).rejects.toThrow()
  })

  it('throws on schema violation (unknown field)', async () => {
    await fs.mkdir(path.join(tmpRoot, '.archviber'), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, '.archviber', 'policy.yaml'),
      'drift:\n  failOnNonsense: true\n',
      'utf8',
    )
    await expect(loadPolicy(tmpRoot)).rejects.toThrow(/schema validation/i)
  })
})
