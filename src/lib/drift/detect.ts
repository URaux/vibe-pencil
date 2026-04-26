/**
 * Drift detection — W3.D1.
 *
 * Pure function over (baseIr, headIr) → DriftReport. Identity is by
 * `id` field for blocks, containers, and edges. "Changed" detection on
 * blocks focuses on `code_anchors` since that is the lossy part of the IR
 * most likely to drift when code moves but the diagram doesn't.
 */

import type { Ir, IrBlock, IrContainer, IrEdge } from '@/lib/ir/schema'
import { detectSchemaDrift, type SchemaDriftReport } from './schema-diff'

export interface BlockChange {
  blockId: string
  before: IrBlock
  after: IrBlock
  /** What changed (free-form short labels for the chat surface to render). */
  changes: string[]
  /** Structured schema diff when the block's `schema` field changed. Phase 3 extension. */
  schemaDrift?: SchemaDriftReport
}

export interface DriftReport {
  addedBlocks: IrBlock[]
  removedBlocks: IrBlock[]
  changedBlocks: BlockChange[]

  addedContainers: IrContainer[]
  removedContainers: IrContainer[]

  addedEdges: IrEdge[]
  removedEdges: IrEdge[]

  /** Convenience flag — true when no diff at all. */
  clean: boolean
}

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const it of items) m.set(it.id, it)
  return m
}

function diffArrays<T extends { id: string }>(
  base: readonly T[],
  head: readonly T[],
): { added: T[]; removed: T[]; common: Array<{ before: T; after: T }> } {
  const baseById = indexById(base)
  const headById = indexById(head)
  const added: T[] = []
  const removed: T[] = []
  const common: Array<{ before: T; after: T }> = []

  for (const item of head) {
    const before = baseById.get(item.id)
    if (before) common.push({ before, after: item })
    else added.push(item)
  }
  for (const item of base) {
    if (!headById.has(item.id)) removed.push(item)
  }

  return { added, removed, common }
}

function anchorsEqual(a: IrBlock['code_anchors'], b: IrBlock['code_anchors']): boolean {
  if (a.length !== b.length) return false
  // Compare deterministically — IR persists in stable order, so direct index compare is fine.
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if ((x.primary_entry ?? '') !== (y.primary_entry ?? '')) return false
    if (x.files.length !== y.files.length) return false
    for (let j = 0; j < x.files.length; j++) {
      const xf = x.files[j]
      const yf = y.files[j]
      if (xf.path !== yf.path) return false
      const xs = xf.symbols ?? []
      const ys = yf.symbols ?? []
      if (xs.length !== ys.length) return false
      for (let k = 0; k < xs.length; k++) {
        if (xs[k] !== ys[k]) return false
      }
      const xl = xf.lines
      const yl = yf.lines
      if ((xl?.start ?? -1) !== (yl?.start ?? -1)) return false
      if ((xl?.end ?? -1) !== (yl?.end ?? -1)) return false
    }
  }
  return true
}

function detectBlockChanges(before: IrBlock, after: IrBlock): string[] {
  const changes: string[] = []

  if (before.name !== after.name) {
    changes.push(`name: "${before.name}" → "${after.name}"`)
  }
  if ((before.container_id ?? '') !== (after.container_id ?? '')) {
    changes.push(`container_id: "${before.container_id ?? '(none)'}" → "${after.container_id ?? '(none)'}"`)
  }
  if ((before.tech_stack ?? '') !== (after.tech_stack ?? '')) {
    changes.push(`tech_stack: "${before.tech_stack ?? '(none)'}" → "${after.tech_stack ?? '(none)'}"`)
  }
  if (!anchorsEqual(before.code_anchors, after.code_anchors)) {
    changes.push('code_anchors changed')
  }
  return changes
}

/** Phase 3: structured schema drift on a block. Returns null when no schema change. */
function detectBlockSchemaDrift(before: IrBlock, after: IrBlock): SchemaDriftReport | null {
  const drift = detectSchemaDrift(before.schema, after.schema)
  return drift.clean ? null : drift
}

export function detectDrift(baseIr: Ir, headIr: Ir): DriftReport {
  const blockDiff = diffArrays(baseIr.blocks, headIr.blocks)
  const containerDiff = diffArrays(baseIr.containers, headIr.containers)
  const edgeDiff = diffArrays(baseIr.edges, headIr.edges)

  const changedBlocks: BlockChange[] = []
  for (const { before, after } of blockDiff.common) {
    const changes = detectBlockChanges(before, after)
    const schemaDrift = detectBlockSchemaDrift(before, after)
    if (schemaDrift) changes.push('schema changed')
    if (changes.length > 0) {
      changedBlocks.push({
        blockId: before.id,
        before,
        after,
        changes,
        ...(schemaDrift ? { schemaDrift } : {}),
      })
    }
  }

  const clean =
    blockDiff.added.length === 0 &&
    blockDiff.removed.length === 0 &&
    changedBlocks.length === 0 &&
    containerDiff.added.length === 0 &&
    containerDiff.removed.length === 0 &&
    edgeDiff.added.length === 0 &&
    edgeDiff.removed.length === 0

  return {
    addedBlocks: blockDiff.added,
    removedBlocks: blockDiff.removed,
    changedBlocks,
    addedContainers: containerDiff.added,
    removedContainers: containerDiff.removed,
    addedEdges: edgeDiff.added,
    removedEdges: edgeDiff.removed,
    clean,
  }
}

export interface DriftSummary {
  addedBlocks: number
  removedBlocks: number
  changedBlocks: number
  addedContainers: number
  removedContainers: number
  addedEdges: number
  removedEdges: number
  total: number
}

export function summarizeDrift(report: DriftReport): DriftSummary {
  const summary: DriftSummary = {
    addedBlocks: report.addedBlocks.length,
    removedBlocks: report.removedBlocks.length,
    changedBlocks: report.changedBlocks.length,
    addedContainers: report.addedContainers.length,
    removedContainers: report.removedContainers.length,
    addedEdges: report.addedEdges.length,
    removedEdges: report.removedEdges.length,
    total: 0,
  }
  summary.total =
    summary.addedBlocks +
    summary.removedBlocks +
    summary.changedBlocks +
    summary.addedContainers +
    summary.removedContainers +
    summary.addedEdges +
    summary.removedEdges
  return summary
}
