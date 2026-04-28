/**
 * drift-stats.mjs
 *
 * Aggregates a folder of drift result snapshots and prints per-week stats:
 * avg drift count, median, top-N most-drifted blocks across the period.
 *
 * Each snapshot file must be a JSON object with:
 *   { date: string (ISO-8601), driftSummary: DriftSummary, changedBlockIds?: string[] }
 *
 * Usage:
 *   node scripts/drift-stats.mjs --dir drift-history [--last N] [--format md|json]
 *
 * Options:
 *   --dir DIR      Directory of snapshot JSON files (required)
 *   --last N       Only include the last N weeks (default: all)
 *   --top N        Number of top-drifted blocks to show (default: 5)
 *   --format       Output format: md (default) or json
 *
 * Exit codes:
 *   0  Success
 *   1  Missing --dir / unreadable directory / invalid snapshot files
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  return args[i + 1] ?? null
}

const dir = getFlag('--dir')
const lastStr = getFlag('--last')
const topStr = getFlag('--top')
const format = getFlag('--format') ?? 'md'

if (!dir) {
  console.error('usage: node scripts/drift-stats.mjs --dir <directory> [--last N] [--top N] [--format md|json]')
  process.exit(1)
}

const absDir = path.resolve(dir)
if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
  console.error(`drift-stats: directory not found: ${absDir}`)
  process.exit(1)
}

// --- Load snapshots ---

function loadSnapshots(directory) {
  const files = fs.readdirSync(directory).filter((f) => f.endsWith('.json')).sort()
  const snapshots = []

  for (const file of files) {
    const filePath = path.join(directory, file)
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (err) {
      console.error(`drift-stats: failed to parse ${file}: ${err.message}`)
      continue
    }

    if (!raw || typeof raw !== 'object') {
      console.error(`drift-stats: skipping ${file}: not a JSON object`)
      continue
    }

    if (typeof raw.date !== 'string') {
      console.error(`drift-stats: skipping ${file}: missing or invalid "date" field`)
      continue
    }

    const s = raw.driftSummary
    if (!s || typeof s !== 'object' || typeof s.total !== 'number') {
      console.error(`drift-stats: skipping ${file}: missing or invalid "driftSummary" field`)
      continue
    }

    snapshots.push({
      date: new Date(raw.date),
      file,
      summary: {
        addedBlocks: Number(s.addedBlocks ?? 0),
        removedBlocks: Number(s.removedBlocks ?? 0),
        changedBlocks: Number(s.changedBlocks ?? 0),
        addedContainers: Number(s.addedContainers ?? 0),
        removedContainers: Number(s.removedContainers ?? 0),
        addedEdges: Number(s.addedEdges ?? 0),
        removedEdges: Number(s.removedEdges ?? 0),
        total: Number(s.total),
      },
      changedBlockIds: Array.isArray(raw.changedBlockIds) ? raw.changedBlockIds : [],
    })
  }

  return snapshots.sort((a, b) => a.date - b.date)
}

// --- ISO week key (YYYY-WNN) ---

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// --- Aggregation ---

function groupByWeek(snapshots) {
  const weeks = new Map()
  for (const snap of snapshots) {
    const key = isoWeekKey(snap.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key).push(snap)
  }
  return weeks
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function computeWeekStats(weekSnapshots) {
  const totals = weekSnapshots.map((s) => s.summary.total)
  return {
    snapshotCount: weekSnapshots.length,
    avgDrift: average(totals),
    medianDrift: median(totals),
    maxDrift: Math.max(...totals),
    minDrift: Math.min(...totals),
    totalDrift: totals.reduce((a, b) => a + b, 0),
  }
}

function computeTopBlocks(snapshots, topN) {
  const counts = new Map()
  for (const snap of snapshots) {
    for (const id of snap.changedBlockIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([blockId, count]) => ({ blockId, count }))
}

// --- Formatting ---

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function renderMarkdown(weekRows, topBlocks, totalSnapshots, period) {
  const lines = []
  lines.push('# Drift Stats')
  lines.push('')
  lines.push(`Period: ${period}  |  Snapshots analysed: ${totalSnapshots}`)
  lines.push('')

  if (weekRows.length === 0) {
    lines.push('_No snapshots found._')
    return lines.join('\n')
  }

  lines.push('## Per-week Summary')
  lines.push('')
  lines.push('| Week | Snapshots | Avg Drift | Median | Max |')
  lines.push('|------|-----------|-----------|--------|-----|')
  for (const row of weekRows) {
    lines.push(`| ${row.week} | ${row.snapshotCount} | ${fmtNum(row.avgDrift)} | ${fmtNum(row.medianDrift)} | ${row.maxDrift} |`)
  }
  lines.push('')

  if (topBlocks.length > 0) {
    lines.push('## Top Drifted Blocks')
    lines.push('')
    lines.push('| Block ID | Drift Count |')
    lines.push('|----------|-------------|')
    for (const { blockId, count } of topBlocks) {
      lines.push(`| ${blockId} | ${count} |`)
    }
    lines.push('')
  } else {
    lines.push('_No block-level drift recorded._')
    lines.push('')
  }

  return lines.join('\n')
}

function renderJson(weekRows, topBlocks, totalSnapshots, period) {
  return JSON.stringify({ period, totalSnapshots, weeks: weekRows, topBlocks }, null, 2)
}

// --- Main ---

const allSnapshots = loadSnapshots(absDir)

const lastN = lastStr != null ? parseInt(lastStr, 10) : null
const topN = topStr != null ? parseInt(topStr, 10) : 5

if (lastN != null && (isNaN(lastN) || lastN < 1)) {
  console.error('drift-stats: --last must be a positive integer')
  process.exit(1)
}

if (isNaN(topN) || topN < 0) {
  console.error('drift-stats: --top must be a non-negative integer')
  process.exit(1)
}

const weekGroups = groupByWeek(allSnapshots)
let weekKeys = [...weekGroups.keys()].sort()

if (lastN != null) {
  weekKeys = weekKeys.slice(-lastN)
}

const filteredSnapshots = weekKeys.flatMap((k) => weekGroups.get(k))

const weekRows = weekKeys.map((week) => {
  const snaps = weekGroups.get(week)
  return { week, ...computeWeekStats(snaps) }
})

const topBlocks = computeTopBlocks(filteredSnapshots, topN)

const period =
  filteredSnapshots.length === 0
    ? 'none'
    : `${filteredSnapshots[0].date.toISOString().slice(0, 10)} – ${filteredSnapshots[filteredSnapshots.length - 1].date.toISOString().slice(0, 10)}`

const output =
  format === 'json'
    ? renderJson(weekRows, topBlocks, filteredSnapshots.length, period)
    : renderMarkdown(weekRows, topBlocks, filteredSnapshots.length, period)

console.log(output)
process.exit(0)
