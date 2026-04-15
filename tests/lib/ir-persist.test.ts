import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  readIrFile,
  writeIrFile,
  ensureArchviberDir,
  irFilePath,
  IR_DIR_NAME,
  IR_FILE_NAME,
} from '@/lib/ir/persist'
import { parseIr, serializeIr, IrValidationError } from '@/lib/ir/serialize'
import { IR_VERSION, type Ir } from '@/lib/ir/schema'

let tmpDir: string

const fixedMetadata = {
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

const sampleIr: Ir = {
  version: IR_VERSION,
  project: { name: 'Sample', metadata: fixedMetadata },
  containers: [{ id: 'c1', name: 'Services', color: 'purple' }],
  blocks: [
    {
      id: 'b1',
      name: 'Auth',
      description: 'login',
      status: 'idle',
      container_id: 'c1',
      code_anchors: [],
    },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-ir-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('ir persistence', () => {
  it('returns null when file does not exist', async () => {
    expect(await readIrFile(tmpDir)).toBeNull()
  })

  it('writes to .archviber/ir.yaml', async () => {
    const filePath = await writeIrFile(tmpDir, sampleIr)
    expect(filePath).toBe(path.join(tmpDir, IR_DIR_NAME, IR_FILE_NAME))
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })

  it('round-trips IR through disk (modulo audit_log save entry)', async () => {
    await writeIrFile(tmpDir, sampleIr)
    const loaded = await readIrFile(tmpDir)
    expect(loaded).not.toBeNull()
    // writeIrFile appends one audit entry per save; everything else round-trips.
    expect(loaded!.audit_log).toHaveLength(1)
    expect(loaded!.audit_log[0]).toMatchObject({ action: 'save', actor: 'archviber' })
    expect(typeof loaded!.audit_log[0].timestamp).toBe('string')
    const { audit_log: _ignored, ...rest } = loaded!
    const { audit_log: _ignored2, ...sampleRest } = sampleIr
    expect(rest).toEqual(sampleRest)
  })

  it('appends one audit entry per save and trims to last 100', async () => {
    // Pre-seed audit_log with 99 entries so a single save crosses the cap.
    const seeded: Ir = {
      ...sampleIr,
      audit_log: Array.from({ length: 99 }, (_, i) => ({
        timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        action: 'save',
        actor: 'archviber',
        details: {},
      })),
    }
    await writeIrFile(tmpDir, seeded)
    const after1 = (await readIrFile(tmpDir))!
    expect(after1.audit_log).toHaveLength(100)

    await writeIrFile(tmpDir, after1)
    const after2 = (await readIrFile(tmpDir))!
    expect(after2.audit_log).toHaveLength(100) // trimmed, not 101
    expect(after2.audit_log.every((e) => e.action === 'save')).toBe(true)
  })

  it('writes atomically and leaves no .tmp file behind', async () => {
    const filePath = await writeIrFile(tmpDir, sampleIr)
    const dirEntries = await fs.readdir(path.dirname(filePath))
    expect(dirEntries.some((name) => name.endsWith('.tmp'))).toBe(false)
    expect(dirEntries).toContain(IR_FILE_NAME)
  })

  it('ensureArchviberDir creates .archviber/.gitignore with cache/ entry', async () => {
    await ensureArchviberDir(tmpDir)
    const gitignorePath = path.join(tmpDir, IR_DIR_NAME, '.gitignore')
    const contents = await fs.readFile(gitignorePath, 'utf8')
    expect(contents).toContain('cache/')
  })

  it('ensureArchviberDir does not overwrite an existing .gitignore', async () => {
    const dir = path.join(tmpDir, IR_DIR_NAME)
    await fs.mkdir(dir, { recursive: true })
    const gitignorePath = path.join(dir, '.gitignore')
    await fs.writeFile(gitignorePath, 'custom/\n', 'utf8')
    await ensureArchviberDir(tmpDir)
    const contents = await fs.readFile(gitignorePath, 'utf8')
    expect(contents).toBe('custom/\n')
  })

  it('produces a deterministic YAML (identical output on successive writes)', () => {
    const a = serializeIr(sampleIr)
    const b = serializeIr(sampleIr)
    expect(a).toEqual(b)
  })

  it('parseIr round-trips with serializeIr', () => {
    const yaml = serializeIr(sampleIr)
    expect(parseIr(yaml)).toEqual(sampleIr)
  })

  it('rejects malformed YAML with IrValidationError', () => {
    const bad = 'version: "1.0"\nproject: { name: "bad" }\n'
    expect(() => parseIr(bad)).toThrow(IrValidationError)
  })

  it('rejects IR with wrong version', () => {
    const badIr = { ...sampleIr, version: '2.0' } as unknown as Ir
    expect(() => writeIrFile(tmpDir, badIr)).rejects.toThrow()
  })

  it('irFilePath computes the canonical path', () => {
    expect(irFilePath('/root')).toBe(path.join('/root', IR_DIR_NAME, IR_FILE_NAME))
  })
})
