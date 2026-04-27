#!/usr/bin/env node
/**
 * eval-fixture-add.mjs — W3.D5
 *
 * Appends a new fixture line to tests/eval/orchestrator/fixtures/intents.jsonl.
 *
 * Usage:
 *   node scripts/eval-fixture-add.mjs --prompt "..." --intent design_edit [--id ex-01] [--confidence 0.9] [--description "..."]
 *
 * Rules:
 *   - --prompt and --intent are required
 *   - intent must be one of: design_edit, build, modify, deep_analyze, explain
 *   - --id is auto-generated (intent-prefix + next seq number) if not provided
 *   - Refuses to add a duplicate id or prompt
 *   - Appends JSON line to intents.jsonl
 *
 * Exit codes:
 *   0  Fixture appended
 *   1  Validation error / duplicate / bad args
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const FIXTURES_PATH = process.env.EVAL_FIXTURES_PATH ?? path.join(REPO_ROOT, 'tests', 'eval', 'orchestrator', 'fixtures', 'intents.jsonl')

const VALID_INTENTS = new Set(['design_edit', 'build', 'modify', 'deep_analyze', 'explain'])

const INTENT_PREFIX = {
  design_edit: 'de',
  build: 'bu',
  modify: 'mo',
  deep_analyze: 'da',
  explain: 'ex',
}

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? (args[i + 1] ?? null) : null
}

const prompt = getFlag('--prompt')
const intent = getFlag('--intent')
const inputId = getFlag('--id')
const confidenceRaw = getFlag('--confidence')
const description = getFlag('--description')

if (!prompt || !intent) {
  console.error('usage: node scripts/eval-fixture-add.mjs --prompt "..." --intent <intent> [--id ID] [--confidence 0.9] [--description "..."]')
  process.exit(1)
}

if (!VALID_INTENTS.has(intent)) {
  console.error(`eval-fixture-add: invalid intent "${intent}". Must be one of: ${[...VALID_INTENTS].join(', ')}`)
  process.exit(1)
}

const confidence = confidenceRaw !== null ? parseFloat(confidenceRaw) : 1.0
if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
  console.error(`eval-fixture-add: --confidence must be a number between 0 and 1, got "${confidenceRaw}"`)
  process.exit(1)
}

// Load existing fixtures
let existingLines = []
try {
  const text = fs.readFileSync(FIXTURES_PATH, 'utf8')
  existingLines = text.split('\n').filter((l) => l.trim().length > 0)
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`eval-fixture-add: could not read fixtures: ${err.message}`)
    process.exit(1)
  }
}

const existing = existingLines.map((l) => {
  try { return JSON.parse(l) } catch { return null }
}).filter(Boolean)

// Check for duplicate prompt
const dupPrompt = existing.find((f) => f.userPrompt === prompt)
if (dupPrompt) {
  console.error(`eval-fixture-add: duplicate prompt already exists as id="${dupPrompt.id}"`)
  process.exit(1)
}

// Resolve or generate id
let id = inputId
if (!id) {
  const prefix = INTENT_PREFIX[intent]
  const existing_ids = existing.map((f) => f.id).filter((i) => i && i.startsWith(prefix + '-'))
  const nums = existing_ids.map((i) => parseInt(i.split('-')[1] ?? '0', 10)).filter((n) => !Number.isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  id = `${prefix}-${String(next).padStart(2, '0')}`
}

// Check for duplicate id
const dupId = existing.find((f) => f.id === id)
if (dupId) {
  console.error(`eval-fixture-add: id "${id}" already exists`)
  process.exit(1)
}

// Build fixture entry
const fixture = {
  id,
  userPrompt: prompt,
  expectedIntent: intent,
  expectedConfidence: confidence,
  ...(description ? { description } : {}),
}

// Append to file
const line = JSON.stringify(fixture)
fs.mkdirSync(path.dirname(FIXTURES_PATH), { recursive: true })
fs.appendFileSync(FIXTURES_PATH, line + '\n', 'utf8')

console.log(`eval-fixture-add: added fixture ${id} (intent=${intent})`)
