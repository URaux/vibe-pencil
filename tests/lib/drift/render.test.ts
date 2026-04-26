import { describe, expect, it } from 'vitest'
import type { DriftReport, BlockChange } from '@/lib/drift/detect'
import { renderDriftMarkdown } from '@/lib/drift/render'
import type { IrBlock, IrContainer, IrEdge } from '@/lib/ir/schema'

const META = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

function block(id: string, name = id): IrBlock {
  return { id, name, description: '', status: 'idle', container_id: null, code_anchors: [] }
}
function container(id: string, name = id): IrContainer {
  return { id, name, color: 'blue' }
}
function edge(id: string, source: string, target: string): IrEdge {
  return { id, source, target, type: 'sync' }
}

function emptyReport(): DriftReport {
  return {
    addedBlocks: [],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
    clean: true,
  }
}

describe('renderDriftMarkdown', () => {
  it('returns "in sync" message when clean', () => {
    const md = renderDriftMarkdown(emptyReport())
    expect(md).toContain('No drift detected')
  })

  it('renders headline with totals', () => {
    const r: DriftReport = {
      ...emptyReport(),
      clean: false,
      addedBlocks: [block('b1', 'New'), block('b2', 'Other')],
      removedEdges: [edge('e1', 'a', 'b')],
    }
    const md = renderDriftMarkdown(r)
    expect(md).toContain('+2 blocks')
    expect(md).toContain('−1 edges')
    expect(md).toContain('Drift detected')
  })

  it('renders added blocks with id and name', () => {
    const r: DriftReport = {
      ...emptyReport(),
      clean: false,
      addedBlocks: [block('b1', 'Auth')],
    }
    const md = renderDriftMarkdown(r)
    expect(md).toContain('Added blocks')
    expect(md).toContain('`b1` (Auth)')
  })

  it('renders changed blocks with truncated change list', () => {
    const change: BlockChange = {
      blockId: 'b1',
      before: block('b1', 'X'),
      after: block('b1', 'Y'),
      changes: ['name: X → Y', 'container_id: c1 → c2', 'tech_stack: foo → bar', 'code_anchors changed'],
    }
    const r: DriftReport = { ...emptyReport(), clean: false, changedBlocks: [change] }
    const md = renderDriftMarkdown(r)
    expect(md).toContain('Changed blocks')
    expect(md).toContain('b1 (X)')
    // 4 changes → first 2 shown, +2 more suffix
    expect(md).toContain('+2 more')
  })

  it('truncates long sections to MAX_PER_SECTION (8) with footer', () => {
    const blocks = Array.from({ length: 15 }, (_, i) => block(`b${i}`, `B${i}`))
    const r: DriftReport = { ...emptyReport(), clean: false, addedBlocks: blocks }
    const md = renderDriftMarkdown(r)
    // 8 shown + 1 footer line
    const matches = md.match(/`b\d+`/g) ?? []
    expect(matches).toHaveLength(8)
    expect(md).toContain('+7 more')
  })

  it('renders all 7 section types', () => {
    const r: DriftReport = {
      addedBlocks: [block('b-add')],
      removedBlocks: [block('b-rem')],
      changedBlocks: [
        {
          blockId: 'b-chg',
          before: block('b-chg', 'X'),
          after: block('b-chg', 'Y'),
          changes: ['name: X → Y'],
        },
      ],
      addedContainers: [container('c-add')],
      removedContainers: [container('c-rem')],
      addedEdges: [edge('e-add', 'a', 'b')],
      removedEdges: [edge('e-rem', 'b', 'c')],
      clean: false,
    }
    const md = renderDriftMarkdown(r)
    expect(md).toContain('Added blocks')
    expect(md).toContain('Removed blocks')
    expect(md).toContain('Changed blocks')
    expect(md).toContain('Added containers')
    expect(md).toContain('Removed containers')
    expect(md).toContain('Added edges')
    expect(md).toContain('Removed edges')
  })

  it('omits sections with zero items', () => {
    const r: DriftReport = {
      ...emptyReport(),
      clean: false,
      addedBlocks: [block('b1')],
    }
    const md = renderDriftMarkdown(r)
    expect(md).not.toContain('Removed blocks')
    expect(md).not.toContain('Changed blocks')
    expect(md).not.toContain('containers')
    expect(md).not.toContain('edges')
  })
})
