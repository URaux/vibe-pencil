/**
 * drift-export-dot.mjs
 *
 * Convert a drift result JSON into Graphviz DOT format.
 * Nodes represent blocks and containers; edges represent drift changes, colored by severity:
 *   added   → green
 *   removed → red
 *   changed → yellow/orange
 *
 * Input: the `{ summary, report, markdown, violations }` object produced by drift-check.mjs --json.
 * A bare DriftReport (with a top-level `clean` boolean) is also accepted.
 *
 * Usage:
 *   node scripts/drift-export-dot.mjs --in drift.json [--out drift.dot]
 *
 * Options:
 *   --in PATH   Path to drift result JSON (required)
 *   --out PATH  Write DOT to this file (default: stdout)
 *
 * Exit codes:
 *   0  Success
 *   1  Missing --in / file not found / JSON parse error / invalid format
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : (args[i + 1] ?? null)
}

const inPath = getFlag('--in')
const outPath = getFlag('--out')

if (!inPath) {
  console.error('usage: node scripts/drift-export-dot.mjs --in <drift.json> [--out <drift.dot>]')
  process.exit(1)
}

const absIn = path.resolve(inPath)
if (!fs.existsSync(absIn)) {
  console.error(`drift-export-dot: file not found: ${absIn}`)
  process.exit(1)
}

let raw
try {
  raw = JSON.parse(fs.readFileSync(absIn, 'utf8'))
} catch (err) {
  console.error(`drift-export-dot: JSON parse failed: ${err.message}`)
  process.exit(1)
}

// Accept either a bare DriftReport (has top-level `clean`) or wrapped { report, summary, ... }
const report = typeof raw.clean === 'boolean' ? raw : raw.report

if (!report || typeof report.clean !== 'boolean') {
  console.error('drift-export-dot: input JSON does not look like a drift result')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// DOT generation
// ---------------------------------------------------------------------------

const COLORS = {
  added: '#2da44e',    // green
  removed: '#cf222e',  // red
  changed: '#d4a017',  // amber/yellow
  unchanged: '#6e7781', // grey
}

function dotId(str) {
  return `"${String(str).replace(/"/g, '\\"')}"`
}

function dotLabel(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

const lines = []
lines.push('digraph drift {')
lines.push('  rankdir=LR;')
lines.push('  node [shape=box, style=filled, fontname="Helvetica", fontsize=10];')
lines.push('  edge [fontname="Helvetica", fontsize=9];')
lines.push('')

const nodeIds = new Set()

function ensureNode(id, label, color, shape = 'box') {
  if (nodeIds.has(id)) return
  nodeIds.add(id)
  lines.push(
    `  ${dotId(id)} [label=${dotId(dotLabel(label))}, fillcolor=${dotId(color)}, shape="${shape}"];`
  )
}

// Blocks — added (green)
for (const b of report.addedBlocks ?? []) {
  ensureNode(b.id, `+ ${b.name ?? b.id}`, COLORS.added)
}

// Blocks — removed (red)
for (const b of report.removedBlocks ?? []) {
  ensureNode(b.id, `- ${b.name ?? b.id}`, COLORS.removed)
}

// Blocks — changed (yellow)
for (const b of report.changedBlocks ?? []) {
  const id = b.id ?? b.blockId ?? 'unknown'
  const name = b.name ?? b.blockId ?? id
  ensureNode(id, `~ ${name}`, COLORS.changed)
}

// Containers — added
for (const c of report.addedContainers ?? []) {
  ensureNode(`container:${c.id}`, `+ [${c.name ?? c.id}]`, COLORS.added, 'folder')
}

// Containers — removed
for (const c of report.removedContainers ?? []) {
  ensureNode(`container:${c.id}`, `- [${c.name ?? c.id}]`, COLORS.removed, 'folder')
}

// Edges — added (green edge)
for (const e of report.addedEdges ?? []) {
  const srcId = e.source ?? 'unknown'
  const tgtId = e.target ?? 'unknown'
  ensureNode(srcId, srcId, COLORS.unchanged)
  ensureNode(tgtId, tgtId, COLORS.unchanged)
  lines.push(
    `  ${dotId(srcId)} -> ${dotId(tgtId)} [label="added", color=${dotId(COLORS.added)}, fontcolor=${dotId(COLORS.added)}];`
  )
}

// Edges — removed (red edge)
for (const e of report.removedEdges ?? []) {
  const srcId = e.source ?? 'unknown'
  const tgtId = e.target ?? 'unknown'
  ensureNode(srcId, srcId, COLORS.unchanged)
  ensureNode(tgtId, tgtId, COLORS.unchanged)
  lines.push(
    `  ${dotId(srcId)} -> ${dotId(tgtId)} [label="removed", color=${dotId(COLORS.removed)}, fontcolor=${dotId(COLORS.removed)}, style=dashed];`
  )
}

if (nodeIds.size === 0) {
  lines.push('  "no_drift" [label="No drift detected", fillcolor="#dafbe1", shape=ellipse];')
}

lines.push('}')

const dot = lines.join('\n') + '\n'

if (outPath) {
  const absOut = path.resolve(outPath)
  fs.mkdirSync(path.dirname(absOut), { recursive: true })
  fs.writeFileSync(absOut, dot, 'utf8')
  console.error(`[drift-export-dot] written → ${absOut}`)
} else {
  process.stdout.write(dot)
}

process.exit(0)
