/**
 * Drift report markdown renderer — W3.D2.
 *
 * Produces a chat-surface-friendly markdown summary of a DriftReport.
 * Output format is compact: a one-line headline + bulleted sections per
 * change kind. Limits each section to MAX_PER_SECTION items with a
 * "+N more" footer when truncated, so a 200-block delta doesn't fill the
 * chat with bullets.
 */

import type { DriftReport, BlockChange, EdgeChange } from './detect'

const MAX_PER_SECTION = 8

function truncatedList<T>(items: readonly T[], render: (item: T) => string): string[] {
  const lines = items.slice(0, MAX_PER_SECTION).map((it) => '  - ' + render(it))
  if (items.length > MAX_PER_SECTION) {
    lines.push(`  - … +${items.length - MAX_PER_SECTION} more`)
  }
  return lines
}

function renderBlockChange(c: BlockChange): string {
  const id = c.before.id
  const before = c.before.name
  const changes = c.changes.length > 2 ? c.changes.slice(0, 2).join('; ') + ` (+${c.changes.length - 2} more)` : c.changes.join('; ')
  return `${id} (${before}): ${changes}`
}

function renderEdgeChange(c: EdgeChange): string {
  const id = c.before.id
  const summary = `${c.before.source} → ${c.before.target}`
  const changes = c.changes.length > 2 ? c.changes.slice(0, 2).join('; ') + ` (+${c.changes.length - 2} more)` : c.changes.join('; ')
  return `${id} (${summary}): ${changes}`
}

export function renderDriftMarkdown(report: DriftReport): string {
  if (report.clean) {
    return 'Diagram and code are in sync. No drift detected.'
  }

  const out: string[] = []

  const totals = [
    report.addedBlocks.length > 0 ? `+${report.addedBlocks.length} blocks` : '',
    report.removedBlocks.length > 0 ? `−${report.removedBlocks.length} blocks` : '',
    report.changedBlocks.length > 0 ? `~${report.changedBlocks.length} blocks` : '',
    report.addedContainers.length > 0 ? `+${report.addedContainers.length} containers` : '',
    report.removedContainers.length > 0 ? `−${report.removedContainers.length} containers` : '',
    report.addedEdges.length > 0 ? `+${report.addedEdges.length} edges` : '',
    report.removedEdges.length > 0 ? `−${report.removedEdges.length} edges` : '',
    report.changedEdges.length > 0 ? `~${report.changedEdges.length} edges` : '',
  ]
    .filter((s) => s.length > 0)
    .join(', ')

  out.push(`**Drift detected**: ${totals}.`)
  out.push('')

  if (report.addedBlocks.length > 0) {
    out.push('**Added blocks**:')
    out.push(...truncatedList(report.addedBlocks, (b) => `\`${b.id}\` (${b.name})`))
    out.push('')
  }

  if (report.removedBlocks.length > 0) {
    out.push('**Removed blocks**:')
    out.push(...truncatedList(report.removedBlocks, (b) => `\`${b.id}\` (${b.name})`))
    out.push('')
  }

  if (report.changedBlocks.length > 0) {
    out.push('**Changed blocks**:')
    out.push(...truncatedList(report.changedBlocks, renderBlockChange))
    out.push('')
  }

  if (report.addedContainers.length > 0) {
    out.push('**Added containers**:')
    out.push(...truncatedList(report.addedContainers, (c) => `\`${c.id}\` (${c.name})`))
    out.push('')
  }

  if (report.removedContainers.length > 0) {
    out.push('**Removed containers**:')
    out.push(...truncatedList(report.removedContainers, (c) => `\`${c.id}\` (${c.name})`))
    out.push('')
  }

  if (report.addedEdges.length > 0) {
    out.push('**Added edges**:')
    out.push(...truncatedList(report.addedEdges, (e) => `\`${e.id}\` (${e.source} → ${e.target})`))
    out.push('')
  }

  if (report.removedEdges.length > 0) {
    out.push('**Removed edges**:')
    out.push(...truncatedList(report.removedEdges, (e) => `\`${e.id}\` (${e.source} → ${e.target})`))
    out.push('')
  }

  if (report.changedEdges.length > 0) {
    out.push('**Changed edges**:')
    out.push(...truncatedList(report.changedEdges, renderEdgeChange))
    out.push('')
  }

  // Trim trailing blank line
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
