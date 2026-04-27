import { describe, it, expect } from 'vitest'
import { pruneIrSummary } from '@/lib/orchestrator/prune'
import type { IrSummary } from '@/lib/orchestrator/types'

function makeSummary(overrides: Partial<IrSummary> = {}): IrSummary {
  return {
    projectName: 'TestProject',
    blockCount: 10,
    containerCount: 5,
    edgeCount: 8,
    topContainers: [
      { id: 'a', name: 'Alpha', blockCount: 1 },
      { id: 'b', name: 'Beta', blockCount: 2 },
      { id: 'c', name: 'Gamma', blockCount: 3 },
    ],
    techStacks: ['TypeScript', 'React'],
    estimatedTokens: 100,
    ...overrides,
  }
}

describe('pruneIrSummary', () => {
  it('returns summary unchanged when already within budget', () => {
    const summary = makeSummary()
    const pruned = pruneIrSummary(summary, 600)
    expect(pruned.topContainers).toHaveLength(summary.topContainers.length)
    expect(pruned.techStacks).toEqual(summary.techStacks)
  })

  it('fits JSON-stringified result within maxTokens budget', () => {
    const containers = Array.from({ length: 50 }, (_, i) => ({
      id: `container-${i}`,
      name: `Container ${i} has a very long name that takes up space`,
      blockCount: i,
    }))
    const summary = makeSummary({ topContainers: containers })
    const maxTokens = 200
    const pruned = pruneIrSummary(summary, maxTokens)
    expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(maxTokens * 4)
  })

  it('keeps containers with highest blockCount when trimming', () => {
    const containers = [
      { id: 'small', name: 'Small', blockCount: 1 },
      { id: 'large', name: 'Large', blockCount: 100 },
      { id: 'medium', name: 'Medium', blockCount: 10 },
    ]
    const summary = makeSummary({ topContainers: containers })
    // Very small budget forces trimming to 1 container
    const pruned = pruneIrSummary(summary, 60)
    if (pruned.topContainers.length > 0) {
      expect(pruned.topContainers[0].id).toBe('large')
    }
  })

  it('truncates techStacks to at most 5', () => {
    const summary = makeSummary({
      techStacks: ['TS', 'JS', 'Python', 'Go', 'Rust', 'Java', 'C++'],
    })
    const pruned = pruneIrSummary(summary, 600)
    expect(pruned.techStacks.length).toBeLessThanOrEqual(5)
    expect(pruned.techStacks).toEqual(['TS', 'JS', 'Python', 'Go', 'Rust'])
  })

  it('preserves scalar fields (blockCount, containerCount, edgeCount, projectName)', () => {
    const summary = makeSummary()
    const pruned = pruneIrSummary(summary, 600)
    expect(pruned.projectName).toBe(summary.projectName)
    expect(pruned.blockCount).toBe(summary.blockCount)
    expect(pruned.containerCount).toBe(summary.containerCount)
    expect(pruned.edgeCount).toBe(summary.edgeCount)
  })
})
