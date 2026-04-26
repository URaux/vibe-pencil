/**
 * Policy enforcement helpers — W3.D5.
 *
 * Pure logic: given a Policy + DriftSummary, return the list of policy
 * violations. Empty array = compliant. Used by scripts/drift-check.mjs.
 */

import type { Policy, DriftPolicy } from './schema'
import type { DriftSummary } from '@/lib/drift/detect'

export interface PolicyViolation {
  rule: string
  observed: number
  threshold?: number
  message: string
}

export function checkDriftPolicy(
  policy: Policy,
  summary: DriftSummary,
): PolicyViolation[] {
  const violations: PolicyViolation[] = []
  const drift: DriftPolicy = policy.drift

  if (drift.failOnRemoved && summary.removedBlocks > 0) {
    violations.push({
      rule: 'drift.failOnRemoved',
      observed: summary.removedBlocks,
      message: `${summary.removedBlocks} block(s) removed; policy disallows any removal`,
    })
  }
  if (drift.failOnAdded && summary.addedBlocks > 0) {
    violations.push({
      rule: 'drift.failOnAdded',
      observed: summary.addedBlocks,
      message: `${summary.addedBlocks} block(s) added; policy disallows any addition`,
    })
  }
  if (drift.failOnChanged && summary.changedBlocks > 0) {
    violations.push({
      rule: 'drift.failOnChanged',
      observed: summary.changedBlocks,
      message: `${summary.changedBlocks} block(s) changed; policy disallows any change`,
    })
  }
  if (drift.failOnRemovedContainers && summary.removedContainers > 0) {
    violations.push({
      rule: 'drift.failOnRemovedContainers',
      observed: summary.removedContainers,
      message: `${summary.removedContainers} container(s) removed; policy disallows`,
    })
  }
  if (drift.failOnRemovedEdges && summary.removedEdges > 0) {
    violations.push({
      rule: 'drift.failOnRemovedEdges',
      observed: summary.removedEdges,
      message: `${summary.removedEdges} edge(s) removed; policy disallows`,
    })
  }

  if (drift.maxAddedBlocks !== undefined && summary.addedBlocks > drift.maxAddedBlocks) {
    violations.push({
      rule: 'drift.maxAddedBlocks',
      observed: summary.addedBlocks,
      threshold: drift.maxAddedBlocks,
      message: `${summary.addedBlocks} added > ${drift.maxAddedBlocks} max`,
    })
  }
  if (drift.maxRemovedBlocks !== undefined && summary.removedBlocks > drift.maxRemovedBlocks) {
    violations.push({
      rule: 'drift.maxRemovedBlocks',
      observed: summary.removedBlocks,
      threshold: drift.maxRemovedBlocks,
      message: `${summary.removedBlocks} removed > ${drift.maxRemovedBlocks} max`,
    })
  }
  if (drift.maxChangedBlocks !== undefined && summary.changedBlocks > drift.maxChangedBlocks) {
    violations.push({
      rule: 'drift.maxChangedBlocks',
      observed: summary.changedBlocks,
      threshold: drift.maxChangedBlocks,
      message: `${summary.changedBlocks} changed > ${drift.maxChangedBlocks} max`,
    })
  }

  return violations
}
