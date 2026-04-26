import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, type Policy } from '@/lib/policy/schema'
import { checkDriftPolicy } from '@/lib/policy/check'
import type { DriftSummary } from '@/lib/drift/detect'

function summary(overrides: Partial<DriftSummary> = {}): DriftSummary {
  const base: DriftSummary = {
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlocks: 0,
    addedContainers: 0,
    removedContainers: 0,
    addedEdges: 0,
    removedEdges: 0,
    changedEdges: 0,
    total: 0,
  }
  return { ...base, ...overrides }
}

describe('checkDriftPolicy', () => {
  it('default policy yields no violations on any drift', () => {
    const violations = checkDriftPolicy(DEFAULT_POLICY, summary({ removedBlocks: 5, addedBlocks: 3 }))
    expect(violations).toEqual([])
  })

  it('failOnRemoved fires when blocks were removed', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, failOnRemoved: true } }
    const violations = checkDriftPolicy(policy, summary({ removedBlocks: 1 }))
    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('drift.failOnRemoved')
  })

  it('failOnRemoved does NOT fire when no blocks removed', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, failOnRemoved: true } }
    const violations = checkDriftPolicy(policy, summary({ addedBlocks: 5 }))
    expect(violations).toEqual([])
  })

  it('maxAddedBlocks fires when count exceeds threshold', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, maxAddedBlocks: 2 } }
    const violations = checkDriftPolicy(policy, summary({ addedBlocks: 5 }))
    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('drift.maxAddedBlocks')
    expect(violations[0].observed).toBe(5)
    expect(violations[0].threshold).toBe(2)
  })

  it('maxAddedBlocks does NOT fire at the threshold itself', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, maxAddedBlocks: 5 } }
    const violations = checkDriftPolicy(policy, summary({ addedBlocks: 5 }))
    expect(violations).toEqual([])
  })

  it('multiple rules can fire independently', () => {
    const policy: Policy = {
      drift: {
        ...DEFAULT_POLICY.drift,
        failOnRemoved: true,
        failOnRemovedEdges: true,
        maxAddedBlocks: 1,
      },
    }
    const violations = checkDriftPolicy(
      policy,
      summary({ removedBlocks: 2, addedBlocks: 3, removedEdges: 1 }),
    )
    expect(violations).toHaveLength(3)
    expect(violations.map((v) => v.rule).sort()).toEqual([
      'drift.failOnRemoved',
      'drift.failOnRemovedEdges',
      'drift.maxAddedBlocks',
    ])
  })

  it('failOnChanged fires on changed blocks', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, failOnChanged: true } }
    const violations = checkDriftPolicy(policy, summary({ changedBlocks: 1 }))
    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('drift.failOnChanged')
  })

  it('failOnRemovedContainers fires on container removal', () => {
    const policy: Policy = { drift: { ...DEFAULT_POLICY.drift, failOnRemovedContainers: true } }
    const violations = checkDriftPolicy(policy, summary({ removedContainers: 1 }))
    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe('drift.failOnRemovedContainers')
  })
})
