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

export function applyDriftIgnore(report: DriftReport, policy: Policy): DriftReport {
  const ignoreBlocks = new Set(policy.drift.ignoreBlockIds ?? [])
  const ignoreContainers = new Set(policy.drift.ignoreContainerIds ?? [])
  const ignoreEdges = new Set(policy.drift.ignoreEdgeIds ?? [])
  const includeOnly = policy.drift.includeOnlyContainers

  const hasIncludeOnly = includeOnly !== undefined && includeOnly.length > 0
  if (ignoreBlocks.size === 0 && ignoreContainers.size === 0 && ignoreEdges.size === 0 && !hasIncludeOnly) {
    return report
  }

  // Cascade: blocks whose container_id is in ignoreContainers are also ignored
  const isBlockIgnored = (b: { id: string; container_id: string | null }) =>
    ignoreBlocks.has(b.id) || (b.container_id !== null && ignoreContainers.has(b.container_id))

  const isChangedBlockIgnored = (c: { blockId: string; before: { id: string; container_id: string | null } }) =>
    ignoreBlocks.has(c.blockId) || (c.before.container_id !== null && ignoreContainers.has(c.before.container_id))

  let addedBlocks = report.addedBlocks.filter((b) => !isBlockIgnored(b))
  let removedBlocks = report.removedBlocks.filter((b) => !isBlockIgnored(b))
  let changedBlocks = report.changedBlocks.filter((c) => !isChangedBlockIgnored(c))
  let addedContainers = report.addedContainers.filter((c) => !ignoreContainers.has(c.id))
  let removedContainers = report.removedContainers.filter((c) => !ignoreContainers.has(c.id))
  let addedEdges = report.addedEdges.filter((e) => !ignoreEdges.has(e.id))
  let removedEdges = report.removedEdges.filter((e) => !ignoreEdges.has(e.id))

  // includeOnlyContainers: keep only drift entries in listed containers.
  // Edges are kept only when BOTH source and target blocks belong to included containers.
  if (includeOnly !== undefined && includeOnly.length > 0) {
    const included = new Set(includeOnly)

    // Build set of block IDs that belong to included containers (from the full report)
    const allBlocks = [
      ...report.addedBlocks,
      ...report.removedBlocks,
      ...report.changedBlocks.map((c) => c.before),
      ...report.changedBlocks.map((c) => c.after),
    ]
    const includedBlockIds = new Set(
      allBlocks.filter((b) => b.container_id !== null && included.has(b.container_id)).map((b) => b.id)
    )

    addedBlocks = addedBlocks.filter((b) => b.container_id !== null && included.has(b.container_id))
    removedBlocks = removedBlocks.filter((b) => b.container_id !== null && included.has(b.container_id))
    changedBlocks = changedBlocks.filter(
      (c) => c.before.container_id !== null && included.has(c.before.container_id)
    )
    addedContainers = addedContainers.filter((c) => included.has(c.id))
    removedContainers = removedContainers.filter((c) => included.has(c.id))
    addedEdges = addedEdges.filter((e) => includedBlockIds.has(e.source) && includedBlockIds.has(e.target))
    removedEdges = removedEdges.filter((e) => includedBlockIds.has(e.source) && includedBlockIds.has(e.target))
  }

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
