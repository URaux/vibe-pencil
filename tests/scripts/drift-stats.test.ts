import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-stats.mjs')

let tmpDir: string

interface SnapshotData {
  date: string
  driftSummary: {
    addedBlocks: number
    removedBlocks: number
    changedBlocks: number
    addedContainers: number
    removedContainers: number
    addedEdges: number
    removedEdges: number
    total: number
  }
  changedBlockIds?: string[]
}

function makeSnapshot(date: string, total: number, changedBlockIds: string[] = []): SnapshotData {
  return {
    date,
    driftSummary: {
      addedBlocks: total,
      removedBlocks: 0,
      changedBlocks: 0,
      addedContainers: 0,
      removedContainers: 0,
      addedEdges: 0,
      removedEdges: 0,
      total,
    },
    changedBlockIds,
  }
}

async function writeSnapshot(dir: string, name: string, data: SnapshotData): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(data), 'utf8')
}

async function run(extraArgs: string[] = [], cwd = REPO_ROOT): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await exec('node', [SCRIPT, '--dir', tmpDir, ...extraArgs], { cwd })
  return { stdout, stderr }
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-stats-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('scripts/drift-stats.mjs', () => {
  describe('empty directory', () => {
    it('prints no-snapshots message in markdown mode', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-stats-empty-'))
      try {
        const { stdout } = await exec('node', [SCRIPT, '--dir', emptyDir], { cwd: REPO_ROOT })
        expect(stdout).toContain('No snapshots found')
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true })
      }
    }, 15_000)

    it('emits valid JSON with empty weeks array in json mode', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-stats-empty2-'))
      try {
        const { stdout } = await exec('node', [SCRIPT, '--dir', emptyDir, '--format', 'json'], { cwd: REPO_ROOT })
        const parsed = JSON.parse(stdout) as { weeks: unknown[]; topBlocks: unknown[]; totalSnapshots: number }
        expect(parsed.weeks).toEqual([])
        expect(parsed.topBlocks).toEqual([])
        expect(parsed.totalSnapshots).toBe(0)
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true })
      }
    }, 15_000)
  })

  describe('populated directory', () => {
    beforeAll(async () => {
      // Week 2026-W17 (Mon Apr 20 – Sun Apr 26 2026)
      await writeSnapshot(tmpDir, '2026-04-20.json', makeSnapshot('2026-04-20T00:00:00Z', 3, ['auth', 'api']))
      await writeSnapshot(tmpDir, '2026-04-22.json', makeSnapshot('2026-04-22T00:00:00Z', 5, ['auth', 'db']))
      // Week 2026-W18 (Mon Apr 27 – Sun May 03 2026)
      await writeSnapshot(tmpDir, '2026-04-27.json', makeSnapshot('2026-04-27T00:00:00Z', 2, ['api']))
      await writeSnapshot(tmpDir, '2026-04-28.json', makeSnapshot('2026-04-28T00:00:00Z', 8, ['auth', 'api', 'db']))
    })

    it('markdown output contains week table header', async () => {
      const { stdout } = await run()
      expect(stdout).toContain('Per-week Summary')
      expect(stdout).toContain('Week')
      expect(stdout).toContain('Avg Drift')
    }, 15_000)

    it('markdown output includes both weeks', async () => {
      const { stdout } = await run()
      expect(stdout).toContain('2026-W17')
      expect(stdout).toContain('2026-W18')
    }, 15_000)

    it('json output has correct week count and snapshot count', async () => {
      const { stdout } = await run(['--format', 'json'])
      const parsed = JSON.parse(stdout) as {
        weeks: Array<{ week: string; avgDrift: number; medianDrift: number; snapshotCount: number }>
        totalSnapshots: number
        topBlocks: Array<{ blockId: string; count: number }>
      }
      expect(parsed.totalSnapshots).toBe(4)
      expect(parsed.weeks).toHaveLength(2)

      const w17 = parsed.weeks.find((w) => w.week === '2026-W17')
      expect(w17).toBeDefined()
      expect(w17!.snapshotCount).toBe(2)
      expect(w17!.avgDrift).toBe(4) // (3+5)/2
      expect(w17!.medianDrift).toBe(4)

      const w18 = parsed.weeks.find((w) => w.week === '2026-W18')
      expect(w18).toBeDefined()
      expect(w18!.avgDrift).toBe(5) // (2+8)/2
    }, 15_000)

    it('--last 1 limits to the most recent week', async () => {
      const { stdout } = await run(['--format', 'json', '--last', '1'])
      const parsed = JSON.parse(stdout) as { weeks: Array<{ week: string }>; totalSnapshots: number }
      expect(parsed.weeks).toHaveLength(1)
      expect(parsed.weeks[0].week).toBe('2026-W18')
      expect(parsed.totalSnapshots).toBe(2)
    }, 15_000)

    it('top-N blocks shows most-drifted across all snapshots', async () => {
      const { stdout } = await run(['--format', 'json', '--top', '3'])
      const parsed = JSON.parse(stdout) as { topBlocks: Array<{ blockId: string; count: number }> }
      // auth: 3 times, api: 3 times, db: 2 times
      expect(parsed.topBlocks).toHaveLength(3)
      const authEntry = parsed.topBlocks.find((b) => b.blockId === 'auth')
      expect(authEntry).toBeDefined()
      expect(authEntry!.count).toBe(3)
      const dbEntry = parsed.topBlocks.find((b) => b.blockId === 'db')
      expect(dbEntry).toBeDefined()
      expect(dbEntry!.count).toBe(2)
    }, 15_000)

    it('top-N capping: --top 1 returns only the single most-drifted block', async () => {
      const { stdout } = await run(['--format', 'json', '--top', '1'])
      const parsed = JSON.parse(stdout) as { topBlocks: Array<{ blockId: string; count: number }> }
      expect(parsed.topBlocks).toHaveLength(1)
      // auth and api both have 3, either could be first depending on insertion order
      expect(parsed.topBlocks[0].count).toBe(3)
    }, 15_000)

    it('markdown shows Top Drifted Blocks section', async () => {
      const { stdout } = await run()
      expect(stdout).toContain('Top Drifted Blocks')
      expect(stdout).toContain('auth')
    }, 15_000)
  })

  describe('missing --dir flag', () => {
    it('exits 1 and prints usage', async () => {
      await expect(
        exec('node', [SCRIPT], { cwd: REPO_ROOT })
      ).rejects.toMatchObject({ code: 1 })
    }, 15_000)
  })
})
