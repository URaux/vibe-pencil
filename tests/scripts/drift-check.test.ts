/**
 * Smoke test for scripts/drift-check.mjs — W3.D4.
 * Spawns the real script with two YAML fixtures + asserts the markdown output.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-check.mjs')

let tmpDir: string

const META_LINES = [
  '    createdAt: "2026-01-01T00:00:00.000Z"',
  '    updatedAt: "2026-01-01T00:00:00.000Z"',
  '    archviberVersion: "0.1.0"',
]

function makeIrYaml(blocks: Array<{ id: string; name?: string }>): string {
  const blockEntries = blocks
    .map(
      (b) =>
        `  - id: "${b.id}"\n    name: "${b.name ?? b.id}"\n    description: ""\n    status: idle\n    container_id: null\n    code_anchors: []`,
    )
    .join('\n')
  return [
    'version: "1.0"',
    'project:',
    '  name: "test"',
    '  metadata:',
    ...META_LINES,
    'containers: []',
    'blocks:',
    blockEntries || '  []',
    'edges: []',
    'audit_log: []',
    'seed_state: {}',
    '',
  ].join('\n')
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-check-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeYaml(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

describe('scripts/drift-check.mjs', () => {
  it(
    'emits "No drift detected" when base and head are identical',
    async () => {
      const ir = makeIrYaml([{ id: 'b1', name: 'Auth' }])
      const basePath = await writeYaml('base.yaml', ir)
      const headPath = await writeYaml('head.yaml', ir)

      const { stdout } = await exec('node', [SCRIPT, '--base', basePath, '--head', headPath], {
        cwd: REPO_ROOT,
      })
      expect(stdout).toContain('No drift detected')
    },
    30_000,
  )

  it(
    'emits drift markdown when blocks differ',
    async () => {
      const baseYaml = makeIrYaml([{ id: 'b1', name: 'Old' }])
      const headYaml = makeIrYaml([
        { id: 'b1', name: 'Old' },
        { id: 'b2', name: 'NewBlock' },
      ])
      const basePath = await writeYaml('base.yaml', baseYaml)
      const headPath = await writeYaml('head.yaml', headYaml)

      const { stdout } = await exec('node', [SCRIPT, '--base', basePath, '--head', headPath], {
        cwd: REPO_ROOT,
      })
      expect(stdout).toContain('Drift detected')
      expect(stdout).toContain('Added blocks')
      expect(stdout).toContain('NewBlock')
    },
    30_000,
  )

  it(
    '--json emits structured output',
    async () => {
      const baseYaml = makeIrYaml([{ id: 'b1' }])
      const headYaml = makeIrYaml([{ id: 'b1' }, { id: 'b2' }])
      const basePath = await writeYaml('base-j.yaml', baseYaml)
      const headPath = await writeYaml('head-j.yaml', headYaml)

      const { stdout } = await exec(
        'node',
        [SCRIPT, '--base', basePath, '--head', headPath, '--json'],
        { cwd: REPO_ROOT },
      )
      const parsed = JSON.parse(stdout)
      expect(parsed.summary.total).toBe(1)
      expect(parsed.summary.addedBlocks).toBe(1)
      expect(parsed.report.clean).toBe(false)
      expect(parsed.markdown).toContain('Drift detected')
    },
    30_000,
  )

  it(
    '--output writes markdown to file',
    async () => {
      const baseYaml = makeIrYaml([{ id: 'b1' }])
      const headYaml = makeIrYaml([{ id: 'b1', name: 'Renamed' }])
      const basePath = await writeYaml('base-o.yaml', baseYaml)
      const headPath = await writeYaml('head-o.yaml', headYaml)
      const outPath = path.join(tmpDir, 'drift.md')

      await exec(
        'node',
        [SCRIPT, '--base', basePath, '--head', headPath, '--output', outPath, '--quiet'],
        { cwd: REPO_ROOT },
      )

      const md = await fs.readFile(outPath, 'utf8')
      expect(md).toContain('Drift detected')
      expect(md).toContain('Changed blocks')
    },
    30_000,
  )

  it(
    '--enforce-policy exits 1 when policy violated',
    async () => {
      const baseYaml = makeIrYaml([{ id: 'b1' }, { id: 'b2' }])
      const headYaml = makeIrYaml([{ id: 'b1' }]) // b2 removed
      const basePath = await writeYaml('base-pol.yaml', baseYaml)
      const headPath = await writeYaml('head-pol.yaml', headYaml)
      const policyPath = path.join(tmpDir, 'policy.yaml')
      await fs.writeFile(policyPath, 'drift:\n  failOnRemoved: true\n', 'utf8')

      await expect(
        exec(
          'node',
          [
            SCRIPT,
            '--base',
            basePath,
            '--head',
            headPath,
            '--enforce-policy',
            '--policy',
            policyPath,
            '--quiet',
          ],
          { cwd: REPO_ROOT },
        ),
      ).rejects.toMatchObject({ code: 1 })
    },
    30_000,
  )

  it(
    '--enforce-policy exits 0 when within thresholds',
    async () => {
      const baseYaml = makeIrYaml([{ id: 'b1' }])
      const headYaml = makeIrYaml([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }]) // 2 added
      const basePath = await writeYaml('base-ok.yaml', baseYaml)
      const headPath = await writeYaml('head-ok.yaml', headYaml)
      const policyPath = path.join(tmpDir, 'policy-ok.yaml')
      await fs.writeFile(policyPath, 'drift:\n  maxAddedBlocks: 5\n', 'utf8')

      // No throw → exit 0
      const { stdout: _ } = await exec(
        'node',
        [
          SCRIPT,
          '--base',
          basePath,
          '--head',
          headPath,
          '--enforce-policy',
          '--policy',
          policyPath,
          '--quiet',
        ],
        { cwd: REPO_ROOT },
      )
      expect(_).toBeDefined()
    },
    30_000,
  )
})
