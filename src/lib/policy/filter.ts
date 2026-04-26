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
import type { IrBlock } from '@/lib/ir/schema'
import type { Policy } from './schema'

/** Convert a glob pattern to a RegExp. Supports '*' (within segment) and '**' (any path prefix). */
function globToRegex(pattern: string): RegExp {
  // Normalize separators
  const normalized = pattern.replace(/\\/g, '/')
  let regexStr = ''
  let i = 0
  while (i < normalized.length) {
    if (normalized[i] === '*' && normalized[i + 1] === '*') {
      regexStr += '.*'
      i += 2
      // consume trailing separator if present
      if (normalized[i] === '/') i++
    } else if (normalized[i] === '*') {
      regexStr += '[^/]*'
      i++
    } else {
      regexStr += normalized[i].replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return new RegExp(`^${regexStr}$`)
}

function blockMatchesGlob(block: IrBlock, patterns: RegExp[]): boolean {
  if (patterns.length === 0) return false
  for (const anchor of block.code_anchors) {
    for (const file of anchor.files) {
      const normalized = file.path.replace(/\\/g, '/')
      if (patterns.some((re) => re.test(normalized))) return true
    }
  }
  return false
}

export function applyDriftIgnore(report: DriftReport, policy: Policy): DriftReport {
  const ignoreBlocks = new Set(policy.drift.ignoreBlockIds ?? [])
  const ignoreContainers = new Set(policy.drift.ignoreContainerIds ?? [])
  const ignoreEdges = new Set(policy.drift.ignoreEdgeIds ?? [])
  const fileGlobPatterns = (policy.drift.ignoreFileGlobs ?? []).map(globToRegex)

  const hasAnyFilter =
    ignoreBlocks.size > 0 ||
    ignoreContainers.size > 0 ||
    ignoreEdges.size > 0 ||
    fileGlobPatterns.length > 0

  if (!hasAnyFilter) return report

  const blockIgnored = (b: IrBlock) =>
    ignoreBlocks.has(b.id) || blockMatchesGlob(b, fileGlobPatterns)

  const addedBlocks = report.addedBlocks.filter((b) => !blockIgnored(b))
  const removedBlocks = report.removedBlocks.filter((b) => !blockIgnored(b))
  const changedBlocks = report.changedBlocks.filter(
    (c) => !ignoreBlocks.has(c.blockId) && !blockMatchesGlob(c.before, fileGlobPatterns),
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
