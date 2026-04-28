/**
 * drift-export-mermaid.mjs
 *
 * Converts a drift JSON report (produced by `drift-check.mjs --json`) to a
 * Mermaid flowchart diagram.
 *
 * Usage:
 *   node scripts/drift-export-mermaid.mjs --in drift.json [--out diagram.mmd]
 *
 * Color legend (Mermaid fill styles):
 *   added   → #2da44e  (green)
 *   removed → #cf222e  (red)
 *   changed → #d4a017  (amber)
 *   clean   → default
 *
 * When the drift report is clean a single "no_drift" node is emitted.
 * Removed edges are rendered dashed (linkStyle).
 * Added edges are rendered green.
 *
 * Reads JSON from --in (or stdin if omitted). Writes Mermaid to --out (or
 * stdout if omitted). Exits 1 on bad arguments or unreadable input.
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] ?? null : null
}

const inPath = getFlag('--in')
const outPath = getFlag('--out')

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/drift-export-mermaid.mjs --in drift.json [--out diagram.mmd]')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Load drift JSON
// ---------------------------------------------------------------------------

let raw
try {
  raw = inPath ? fs.readFileSync(path.resolve(inPath), 'utf8') : fs.readFileSync('/dev/stdin', 'utf8')
} catch (err) {
  console.error(`drift-export-mermaid: cannot read input: ${err.message}`)
  process.exit(1)
}

let report
try {
  const parsed = JSON.parse(raw)
  // Support both raw DriftReport and the `{ report }` wrapper from drift-check --json
  report = parsed.report ?? parsed
} catch {
  console.error('drift-export-mermaid: input is not valid JSON')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Mermaid generation
// ---------------------------------------------------------------------------

function sanitize(id) {
  return id.replace(/[^A-Za-z0-9_]/g, '_')
}

function label(name) {
  // Escape quotes for Mermaid node labels
  return name.replace(/"/g, "'")
}

function buildMermaid(report) {
  const lines = ['flowchart LR']
  const classDefs = [
    'classDef added fill:#2da44e,color:#fff,stroke:#1a7f37',
    'classDef removed fill:#cf222e,color:#fff,stroke:#a40e26',
    'classDef changed fill:#d4a017,color:#fff,stroke:#9e6e00',
  ]

  if (report.clean) {
    lines.push('  no_drift["No drift detected"]')
    return [...lines, ...classDefs].join('\n')
  }

  const nodeIds = new Set()

  // Containers as subgraphs (added/removed only — changed containers not in DriftReport)
  const addedContainerIds = new Set((report.addedContainers ?? []).map((c) => c.id))
  const removedContainerIds = new Set((report.removedContainers ?? []).map((c) => c.id))

  for (const c of report.addedContainers ?? []) {
    const sid = sanitize(c.id)
    lines.push(`  subgraph ${sid}["+ ${label(c.name)}"]`)
    lines.push('  end')
    lines.push(`  class ${sid} added`)
    nodeIds.add(sid)
  }

  for (const c of report.removedContainers ?? []) {
    const sid = sanitize(c.id)
    lines.push(`  subgraph ${sid}["- ${label(c.name)}"]`)
    lines.push('  end')
    lines.push(`  class ${sid} removed`)
    nodeIds.add(sid)
  }

  // Blocks
  const addedBlockIds = new Set((report.addedBlocks ?? []).map((b) => b.id))
  const removedBlockIds = new Set((report.removedBlocks ?? []).map((b) => b.id))
  const changedBlockIds = new Set((report.changedBlocks ?? []).map((bc) => bc.blockId))

  for (const b of report.addedBlocks ?? []) {
    const sid = sanitize(b.id)
    lines.push(`  ${sid}["+ ${label(b.name)}"]`)
    lines.push(`  class ${sid} added`)
    nodeIds.add(sid)
  }

  for (const b of report.removedBlocks ?? []) {
    const sid = sanitize(b.id)
    lines.push(`  ${sid}["- ${label(b.name)}"]`)
    lines.push(`  class ${sid} removed`)
    nodeIds.add(sid)
  }

  for (const bc of report.changedBlocks ?? []) {
    const sid = sanitize(bc.blockId)
    const name = bc.after?.name ?? bc.blockId
    lines.push(`  ${sid}["~ ${label(name)}"]`)
    lines.push(`  class ${sid} changed`)
    nodeIds.add(sid)
  }

  // Edges — track index for linkStyle
  const edgeLines = []
  const removedEdgeIndices = []
  const addedEdgeIndices = []

  for (const e of report.addedEdges ?? []) {
    const src = sanitize(e.source)
    const tgt = sanitize(e.target)
    const lbl = e.label ? `|"+ ${label(e.label)}"|` : ''
    edgeLines.push(`  ${src} -->${lbl} ${tgt}`)
    addedEdgeIndices.push(edgeLines.length - 1)
  }

  for (const e of report.removedEdges ?? []) {
    const src = sanitize(e.source)
    const tgt = sanitize(e.target)
    const lbl = e.label ? `|"- ${label(e.label)}"|` : ''
    edgeLines.push(`  ${src} -.-> ${tgt}`)
    removedEdgeIndices.push(edgeLines.length - 1)
  }

  lines.push(...edgeLines)

  // linkStyle for added edges (green stroke)
  for (const idx of addedEdgeIndices) {
    lines.push(`  linkStyle ${idx} stroke:#2da44e,stroke-width:2px`)
  }

  // linkStyle for removed edges (red + dashed already via -.->)
  for (const idx of removedEdgeIndices) {
    lines.push(`  linkStyle ${idx} stroke:#cf222e,stroke-dasharray:5 5`)
  }

  lines.push(...classDefs)

  return lines.join('\n')
}

const mermaid = buildMermaid(report)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (outPath) {
  try {
    fs.writeFileSync(path.resolve(outPath), mermaid + '\n', 'utf8')
  } catch (err) {
    console.error(`drift-export-mermaid: cannot write output: ${err.message}`)
    process.exit(1)
  }
} else {
  console.log(mermaid)
}
