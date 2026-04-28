/**
 * drift-baseline-update.mjs
 *
 * Promotes a head IR snapshot to become the new drift baseline by copying it
 * to .archviber/ir.yaml. The previous baseline is preserved as ir.yaml.bak.
 *
 * Usage:
 *   node scripts/drift-baseline-update.mjs --head path/to/head-ir.yaml --confirm
 *
 * Flags:
 *   --head FILE     Path to the IR YAML to promote as the new baseline (required)
 *   --base-dir DIR  Directory that contains ir.yaml (default: <cwd>/.archviber)
 *   --confirm       Required safety flag — refuses to run without it
 *
 * Exit codes:
 *   0  Baseline updated successfully
 *   1  Missing required args / --confirm absent / file I/O error
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const args = process.argv.slice(2)
const hasFlag = (f) => args.includes(f)
function getFlag(f) {
  const i = args.indexOf(f)
  return i !== -1 ? (args[i + 1] ?? null) : null
}

const headPath = getFlag('--head')
const baseDirArg = getFlag('--base-dir')
const confirmed = hasFlag('--confirm')

if (!confirmed) {
  console.error(
    'drift-baseline-update: refusing to run without --confirm.\n' +
    'This operation overwrites .archviber/ir.yaml (the drift baseline).\n' +
    'Pass --confirm to proceed.',
  )
  process.exit(1)
}

if (!headPath) {
  console.error('usage: node scripts/drift-baseline-update.mjs --head <ir.yaml> --confirm [--base-dir DIR]')
  process.exit(1)
}

const repoRoot = path.resolve(__dirname, '..')
const baseDir = baseDirArg ? path.resolve(baseDirArg) : path.join(repoRoot, '.archviber')
const baselinePath = path.join(baseDir, 'ir.yaml')
const backupPath = path.join(baseDir, 'ir.yaml.bak')
const headAbs = path.resolve(headPath)

if (!fs.existsSync(headAbs)) {
  console.error(`drift-baseline-update: head file not found: ${headAbs}`)
  process.exit(1)
}

// Ensure the .archviber directory exists
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true })
}

// Back up the existing baseline if present
if (fs.existsSync(baselinePath)) {
  fs.copyFileSync(baselinePath, backupPath)
  console.log(`drift-baseline-update: backed up ${baselinePath} → ${backupPath}`)
}

// Copy head to baseline
fs.copyFileSync(headAbs, baselinePath)
console.log(`drift-baseline-update: baseline updated ${headAbs} → ${baselinePath}`)
process.exit(0)
