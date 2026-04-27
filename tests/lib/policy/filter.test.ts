import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY } from '@/lib/policy/schema'
import { applyDriftIgnore } from '@/lib/policy/filter'
import type { DriftReport } from '@/lib/drift/detect'
import type { IrBlock, IrContainer, IrEdge } from '@/lib/ir/schema'

function block(id: string): IrBlock {
  return { id, name: id, description: '', status: 'idle', container_id: null, code_anchors: [] }
}
function container(id: string): IrContainer {
  return { id, name: id, color: 'blue' }
}
function edge(id: string): IrEdge {
  return { id, source: 'a', target: 'b', type: 'sync' }
}

function reportWith(opts: Partial<DriftReport>): DriftReport {
  return {
    addedBlocks: [],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
    clean: false,
    ...opts,
  }
}

describe('applyDriftIgnore', () => {
  it('returns same report when no ignore lists set', () => {
    const r = reportWith({ addedBlocks: [block('b1'), block('b2')] })
    const filtered = applyDriftIgnore(r, DEFAULT_POLICY)
    expect(filtered.addedBlocks).toHaveLength(2)
    expect(filtered).toBe(r)
  })

  it('filters out ignored block ids across all block buckets', () => {
    const r = reportWith({
      addedBlocks: [block('b1'), block('b2')],
      removedBlocks: [block('b3')],
      changedBlocks: [{ blockId: 'b1', before: block('b1'), after: block('b1'), changes: ['x'] }],
    })
    const policy = {
      drift: { ...DEFAULT_POLICY.drift, ignoreBlockIds: ['b1', 'b3'] },
    }
    const filtered = applyDriftIgnore(r, policy)
    expect(filtered.addedBlocks.map((b) => b.id)).toEqual(['b2'])
    expect(filtered.removedBlocks).toHaveLength(0)
    expect(filtered.changedBlocks).toHaveLength(0)
  })

  it('filters containers and edges similarly', () => {
    const r = reportWith({
      addedContainers: [container('c1'), container('c2')],
      removedEdges: [edge('e1'), edge('e2')],
    })
    const policy = {
      drift: {
        ...DEFAULT_POLICY.drift,
        ignoreContainerIds: ['c2'],
        ignoreEdgeIds: ['e1'],
      },
    }
    const filtered = applyDriftIgnore(r, policy)
    expect(filtered.addedContainers.map((c) => c.id)).toEqual(['c1'])
    expect(filtered.removedEdges.map((e) => e.id)).toEqual(['e2'])
  })

  it('updates clean flag when filter empties all buckets', () => {
    const r = reportWith({ addedBlocks: [block('noisy')] })
    const policy = {
      drift: { ...DEFAULT_POLICY.drift, ignoreBlockIds: ['noisy'] },
    }
    const filtered = applyDriftIgnore(r, policy)
    expect(filtered.clean).toBe(true)
  })

  it('does not mutate the input report', () => {
    const r = reportWith({ addedBlocks: [block('b1'), block('b2')] })
    const policy = { drift: { ...DEFAULT_POLICY.drift, ignoreBlockIds: ['b1'] } }
    applyDriftIgnore(r, policy)
    expect(r.addedBlocks).toHaveLength(2)
  })
})
