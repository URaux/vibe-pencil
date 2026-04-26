#!/usr/bin/env node
/**
 * eval-history.mjs
 *
 * Aggregates eval-live-results.json snapshots from a directory into a
 * markdown table or JSON array.
 *
 * Usage:
 *   node scripts/eval-history.mjs [--dir DIR] [--last N] [--format md|json]
 *
 * Defaults:
 *   --dir    eval-history/
 *   --last   12
 *   --format md
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

// ── CLI arg parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getArg(flag, defaultVal) {
  const i = args.indexOf(flag)
  if (i !== -1 && args[i + 1] !== undefined) return args[i + 1]
  return defaultVal
}

const dir = path.resolve(repoRoot, getArg('--dir', 'eval-history'))
const last = parseInt(getArg('--last', '12'), 10)
const format = getArg('--format', 'md')

// ── Load snapshots ────────────────────────────────────────────────────────────
if (!fs.existsSync(dir)) {
  console.log('no snapshots found')
  process.exit(0)
}

const jsonFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()

if (jsonFiles.length === 0) {
  console.log('no snapshots found')
  process.exit(0)
}

const INTENTS = ['design_edit', 'build', 'modify', 'deep_analyze', 'explain']

function cell(val) {
  return val === undefined || val === null ? '-' : String(val)
}

const rows = []

for (const file of jsonFiles) {
  const filePath = path.join(dir, file)
  let data
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    console.warn(`warn: skipping ${file} — malformed JSON (${e.message})`)
    continue
  }

  // Support both flat (live-eval schema) and nested (emit-metrics schema)
  const generatedAt = data.generatedAt ?? '-'
  const model = data.model ?? data.classifier?.model ?? '-'

  let accuracy = '-'
  if (data.classifier?.accuracy !== undefined) {
    accuracy = (data.classifier.accuracy * 100).toFixed(1) + '%'
  } else if (data.accuracy !== undefined) {
    accuracy = (data.accuracy * 100).toFixed(1) + '%'
  }

  const byIntent = data.classifier?.byIntent ?? data.byIntent ?? {}

  const intentCells = INTENTS.map((intent) => {
    const entry = byIntent[intent]
    if (!entry) return '-'
    const pass = entry.pass ?? entry.passCount
    const total = entry.total ?? entry.totalCount
    if (pass === undefined || total === undefined) return '-'
    return `${pass}/${total}`
  })

  rows.push({ generatedAt, model, accuracy, intentCells, _file: file })
}

// Take last N
const sliced = rows.slice(-last)

if (sliced.length === 0) {
  console.log('no snapshots found')
  process.exit(0)
}

// ── Output ────────────────────────────────────────────────────────────────────
if (format === 'json') {
  const out = sliced.map(({ generatedAt, model, accuracy, intentCells }) => {
    const obj = { generatedAt, model, accuracy }
    INTENTS.forEach((intent, i) => { obj[intent] = intentCells[i] })
    return obj
  })
  console.log(JSON.stringify(out, null, 2))
} else {
  // Markdown table
  const header = `| Date | Model | Accuracy | ${INTENTS.join(' | ')} |`
  const sep = `| --- | --- | --- | ${INTENTS.map(() => '---').join(' | ')} |`
  const dataRows = sliced.map(({ generatedAt, model, accuracy, intentCells }) =>
    `| ${generatedAt} | ${model} | ${accuracy} | ${intentCells.join(' | ')} |`
  )
  console.log([header, sep, ...dataRows].join('\n'))
}
