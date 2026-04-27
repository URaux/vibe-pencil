/**
 * drift-summary.mjs
 *
 * Reads a drift result.json and prints a single-line shell-friendly summary.
 * Useful for status badges or PR titles.
 *
 * Usage:
 *   node scripts/drift-summary.mjs <result.json>
 *
 * The result.json must contain a top-level `driftSummary` object with the
 * DriftSummary shape (addedBlocks, removedBlocks, changedBlocks,
 * addedContainers, removedContainers, addedEdges, removedEdges, total).
 * Alternatively accepts a top-level `summary` key (drift-check --json output).
 *
 * Output examples:
 *   drift: +3 blocks, -1 block, ~2 changed
 *   drift: +3 blocks, -1 block, ~2 changed (4 added containers, 2 removed edges)
 *   drift: clean
 *
 * Exit codes:
 *   0  Summary printed
 *   1  Missing argument / file not found / invalid JSON / missing driftSummary
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/drift-summary.mjs <result.json>')
  process.exit(1)
}

const filePath = path.resolve(args[0])

let raw
try {
  raw = fs.readFileSync(filePath, 'utf8')
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`drift-summary: file not found: ${filePath}`)
  } else {
    console.error(`drift-summary: could not read file: ${err.message}`)
  }
  process.exit(1)
}

let parsed
try {
  parsed = JSON.parse(raw)
} catch (err) {
  console.error(`drift-summary: invalid JSON: ${err.message}`)
  process.exit(1)
}

// Support both {driftSummary: ...} (snapshot format) and {summary: ...} (drift-check --json)
const s = parsed.driftSummary ?? parsed.summary

if (!s || typeof s !== 'object') {
  console.error('drift-summary: result.json must contain a "driftSummary" or "summary" object')
  process.exit(1)
}

function fmt(n, singular, plural) {
  if (!n || n === 0) return null
  const label = Math.abs(n) === 1 ? singular : plural
  return `${n > 0 ? '+' : ''}${n} ${label}`
}

// Primary section: block-level changes
const primary = [
  s.addedBlocks > 0 ? `+${s.addedBlocks} ${s.addedBlocks === 1 ? 'block' : 'blocks'}` : null,
  s.removedBlocks > 0 ? `-${s.removedBlocks} ${s.removedBlocks === 1 ? 'block' : 'blocks'}` : null,
  s.changedBlocks > 0 ? `~${s.changedBlocks} changed` : null,
].filter(Boolean)

// Secondary section: container/edge changes
const secondary = [
  s.addedContainers > 0 ? `${s.addedContainers} added ${s.addedContainers === 1 ? 'container' : 'containers'}` : null,
  s.removedContainers > 0 ? `${s.removedContainers} removed ${s.removedContainers === 1 ? 'container' : 'containers'}` : null,
  s.addedEdges > 0 ? `${s.addedEdges} added ${s.addedEdges === 1 ? 'edge' : 'edges'}` : null,
  s.removedEdges > 0 ? `${s.removedEdges} removed ${s.removedEdges === 1 ? 'edge' : 'edges'}` : null,
].filter(Boolean)

if (primary.length === 0 && secondary.length === 0) {
  console.log('drift: clean')
} else {
  const parts = [primary.join(', ')]
  if (secondary.length > 0) parts.push(`(${secondary.join(', ')})`)
  console.log(`drift: ${parts.filter(Boolean).join(' ')}`)
}
