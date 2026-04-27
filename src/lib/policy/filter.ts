/**
 * Policy-driven drift filter — Phase 3.
 *
 * Applies the policy.drift.ignore* lists to a DriftReport, removing matching
 * blocks/containers/edges from each bucket. Returns a new (filtered) report
 * — never mutates the input.
 *
 * Use case: noisy auto-generated blocks (cache layers, generated files,
 * archived containers) that legitimately drift but shouldn't trigger PR
 * comments or policy violations.
 */

import type { DriftReport } from '@/lib/drift/detect'
import type { Policy } from './schema'

function blockMatchesIgnoreTags(blockTags: string[] | undefined, ignoreTags: Set<string>): boolean {
  if (ignoreTags.size === 0 || !blockTags || blockTags.length === 0) return false
  return blockTags.some((t) => ignoreTags.has(t))
}

export function applyDriftIgnore(report: DriftReport, policy: Policy): DriftReport {
  const ignoreBlocks = new Set(policy.drift.ignoreBlockIds ?? [])
  const ignoreContainers = new Set(policy.drift.ignoreContainerIds ?? [])
  const ignoreEdges = new Set(policy.drift.ignoreEdgeIds ?? [])
  const ignoreTags = new Set(policy.drift.ignoreTags ?? [])

  if (
    ignoreBlocks.size === 0 &&
    ignoreContainers.size === 0 &&
    ignoreEdges.size === 0 &&
    ignoreTags.size === 0
  ) {
    return report
  }

  const addedBlocks = report.addedBlocks.filter(
    (b) => !ignoreBlocks.has(b.id) && !blockMatchesIgnoreTags(b.tags, ignoreTags),
  )
  const removedBlocks = report.removedBlocks.filter(
    (b) => !ignoreBlocks.has(b.id) && !blockMatchesIgnoreTags(b.tags, ignoreTags),
  )
  const changedBlocks = report.changedBlocks.filter(
    (c) =>
      !ignoreBlocks.has(c.blockId) &&
      !blockMatchesIgnoreTags(c.before.tags, ignoreTags) &&
      !blockMatchesIgnoreTags(c.after.tags, ignoreTags),
  )
  const addedContainers = report.addedContainers.filter((c) => !ignoreContainers.has(c.id))
  const removedContainers = report.removedContainers.filter((c) => !ignoreContainers.has(c.id))
  const addedEdges = report.addedEdges.filter((e) => !ignoreEdges.has(e.id))
  const removedEdges = report.removedEdges.filter((e) => !ignoreEdges.has(e.id))

  const clean =
    addedBlocks.length === 0 &&
    removedBlocks.length === 0 &&
    changedBlocks.length === 0 &&
    addedContainers.length === 0 &&
    removedContainers.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0

  return {
    addedBlocks,
    removedBlocks,
    changedBlocks,
    addedContainers,
    removedContainers,
    addedEdges,
    removedEdges,
    clean,
  }
}
