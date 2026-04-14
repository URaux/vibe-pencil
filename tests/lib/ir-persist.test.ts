import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  readIrFile,
  writeIrFile,
  parseIr,
  serializeIr,
  irFilePath,
  IrValidationError,
  IR_DIR_NAME,
  IR_FILE_NAME,
  IR_VERSION,
  type Ir,
} from '@/lib/ir'

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

  it('round-trips IR through disk', async () => {
    await writeIrFile(tmpDir, sampleIr)
    const loaded = await readIrFile(tmpDir)
    expect(loaded).toEqual(sampleIr)
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
