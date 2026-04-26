import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ir, IrBlock } from '@/lib/ir/schema'

const META = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

function block(id: string, name = id, container_id: string | null = null): IrBlock {
  return { id, name, description: '', status: 'idle', container_id, code_anchors: [] }
}

function makeIr(blocks: IrBlock[] = []): Ir {
  return {
    version: '1.0',
    project: { name: 'test', metadata: META },
    containers: [],
    blocks,
    edges: [],
    audit_log: [],
    seed_state: {},
  }
}

const { readIrFileMock } = vi.hoisted(() => ({ readIrFileMock: vi.fn() }))

vi.mock('@/lib/ir/persist', () => ({
  readIrFile: readIrFileMock,
}))

import { POST } from '@/app/api/drift/route'

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/drift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/drift', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/drift', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when headIr is missing', async () => {
    const res = await POST(postRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing headIr/i)
  })

  it('returns 400 when headIr fails IR validation', async () => {
    const res = await POST(postRequest({ headIr: { not: 'an Ir' } }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when baseIr is absent', async () => {
    readIrFileMock.mockResolvedValue(null)
    const res = await POST(postRequest({ headIr: makeIr([block('b1')]) }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/no base IR/i)
  })

  it('returns drift report when both IRs are valid', async () => {
    const baseIr = makeIr([block('b1', 'Old')])
    const headIr = makeIr([block('b1', 'Renamed'), block('b2', 'New')])
    readIrFileMock.mockResolvedValue(baseIr)

    const res = await POST(postRequest({ headIr }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.total).toBe(2) // 1 added + 1 changed
    expect(body.report.addedBlocks).toHaveLength(1)
    expect(body.report.changedBlocks).toHaveLength(1)
    expect(body.markdown).toContain('Drift detected')
  })

  it('reports clean=true when both IRs are identical', async () => {
    const ir = makeIr([block('b1', 'Auth'), block('b2', 'API')])
    readIrFileMock.mockResolvedValue(ir)
    const res = await POST(postRequest({ headIr: ir }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.report.clean).toBe(true)
    expect(body.markdown).toContain('No drift detected')
  })
})
