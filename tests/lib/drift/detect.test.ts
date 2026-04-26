import { describe, expect, it } from 'vitest'
import type { Ir, IrBlock, IrContainer, IrEdge } from '@/lib/ir/schema'
import { detectDrift, summarizeDrift } from '@/lib/drift/detect'

const META = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

function makeBlock(overrides: Partial<IrBlock> & { id: string }): IrBlock {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? '',
    status: overrides.status ?? 'idle',
    container_id: overrides.container_id ?? null,
    code_anchors: overrides.code_anchors ?? [],
    ...(overrides.tech_stack !== undefined ? { tech_stack: overrides.tech_stack } : {}),
  }
}

function makeContainer(id: string, name = id): IrContainer {
  return { id, name, color: 'blue' }
}

function makeEdge(id: string, source: string, target: string): IrEdge {
  return { id, source, target, type: 'sync' }
}

function makeIr(opts: {
  blocks?: IrBlock[]
  containers?: IrContainer[]
  edges?: IrEdge[]
}): Ir {
  return {
    version: '1.0',
    project: { name: 'test', metadata: META },
    containers: opts.containers ?? [],
    blocks: opts.blocks ?? [],
    edges: opts.edges ?? [],
    audit_log: [],
    seed_state: {},
  }
}

describe('detectDrift', () => {
  it('clean=true when both IRs are identical', () => {
    const ir = makeIr({
      containers: [makeContainer('c1')],
      blocks: [makeBlock({ id: 'b1', container_id: 'c1' })],
      edges: [makeEdge('e1', 'b1', 'b1')],
    })
    const report = detectDrift(ir, ir)
    expect(report.clean).toBe(true)
    expect(report.addedBlocks).toEqual([])
    expect(report.removedBlocks).toEqual([])
    expect(report.changedBlocks).toEqual([])
  })

  it('detects added block', () => {
    const base = makeIr({ blocks: [makeBlock({ id: 'b1' })] })
    const head = makeIr({
      blocks: [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2', name: 'New' })],
    })
    const report = detectDrift(base, head)
    expect(report.clean).toBe(false)
    expect(report.addedBlocks).toHaveLength(1)
    expect(report.addedBlocks[0].id).toBe('b2')
  })

  it('detects removed block', () => {
    const base = makeIr({ blocks: [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' })] })
    const head = makeIr({ blocks: [makeBlock({ id: 'b1' })] })
    const report = detectDrift(base, head)
    expect(report.removedBlocks).toHaveLength(1)
    expect(report.removedBlocks[0].id).toBe('b2')
  })

  it('detects renamed block as a change with name diff', () => {
    const base = makeIr({ blocks: [makeBlock({ id: 'b1', name: 'Old' })] })
    const head = makeIr({ blocks: [makeBlock({ id: 'b1', name: 'New' })] })
    const report = detectDrift(base, head)
    expect(report.changedBlocks).toHaveLength(1)
    expect(report.changedBlocks[0].changes.some((c) => c.includes('name:'))).toBe(true)
  })

  it('detects code_anchors change as a change', () => {
    const base = makeIr({
      blocks: [
        makeBlock({
          id: 'b1',
          code_anchors: [{ files: [{ path: 'src/a.ts', symbols: ['Foo'] }] }],
        }),
      ],
    })
    const head = makeIr({
      blocks: [
        makeBlock({
          id: 'b1',
          code_anchors: [{ files: [{ path: 'src/a.ts', symbols: ['Foo', 'Bar'] }] }],
        }),
      ],
    })
    const report = detectDrift(base, head)
    expect(report.changedBlocks).toHaveLength(1)
    expect(report.changedBlocks[0].changes).toContain('code_anchors changed')
  })

  it('detects container_id move', () => {
    const base = makeIr({
      blocks: [makeBlock({ id: 'b1', container_id: 'c1' })],
    })
    const head = makeIr({
      blocks: [makeBlock({ id: 'b1', container_id: 'c2' })],
    })
    const report = detectDrift(base, head)
    expect(report.changedBlocks).toHaveLength(1)
    expect(report.changedBlocks[0].changes.some((c) => c.includes('container_id:'))).toBe(true)
  })

  it('detects added/removed containers', () => {
    const base = makeIr({ containers: [makeContainer('c1')] })
    const head = makeIr({ containers: [makeContainer('c2')] })
    const report = detectDrift(base, head)
    expect(report.addedContainers).toHaveLength(1)
    expect(report.addedContainers[0].id).toBe('c2')
    expect(report.removedContainers).toHaveLength(1)
    expect(report.removedContainers[0].id).toBe('c1')
  })

  it('detects added/removed edges', () => {
    const base = makeIr({ edges: [makeEdge('e1', 'a', 'b')] })
    const head = makeIr({ edges: [makeEdge('e2', 'a', 'c')] })
    const report = detectDrift(base, head)
    expect(report.addedEdges).toHaveLength(1)
    expect(report.removedEdges).toHaveLength(1)
  })

  it('combined drift across blocks/edges/containers', () => {
    const base = makeIr({
      containers: [makeContainer('c1')],
      blocks: [makeBlock({ id: 'b1', container_id: 'c1' })],
      edges: [makeEdge('e1', 'b1', 'b1')],
    })
    const head = makeIr({
      containers: [makeContainer('c1'), makeContainer('c2')],
      blocks: [
        makeBlock({ id: 'b1', name: 'Renamed', container_id: 'c1' }),
        makeBlock({ id: 'b2', container_id: 'c2' }),
      ],
      edges: [],
    })
    const report = detectDrift(base, head)
    expect(report.clean).toBe(false)
    expect(report.addedBlocks).toHaveLength(1)
    expect(report.changedBlocks).toHaveLength(1)
    expect(report.addedContainers).toHaveLength(1)
    expect(report.removedEdges).toHaveLength(1)

    const summary = summarizeDrift(report)
    expect(summary.total).toBe(4) // 1 added block + 1 changed + 1 added container + 1 removed edge
  })
})
