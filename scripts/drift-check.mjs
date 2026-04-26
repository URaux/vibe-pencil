/**
 * drift-check.mjs — W3.D4
 *
 * Standalone CI script that compares two IR YAML snapshots and prints a
 * markdown summary suitable for posting as a PR comment.
 *
 * Usage:
 *   node scripts/drift-check.mjs --base path/to/base-ir.yaml --head path/to/head-ir.yaml
 *
 * Optional flags:
 *   --output FILE       Write markdown to FILE in addition to stdout
 *   --json              Print JSON { summary, report, markdown, violations } instead of just markdown
 *   --quiet             Print nothing on stdout when clean (markdown still goes to --output)
 *   --enforce-policy    Load .archviber/policy.yaml and exit 1 on any policy violation
 *   --policy FILE       Override the policy path (default: .archviber/policy.yaml in cwd)
 *
 * Exit codes:
 *   0  Drift either absent OR within policy (advisory unless --enforce-policy)
 *   1  Bad arguments / file read errors / policy violations (with --enforce-policy)
 *
 * The workflow in .github/workflows/drift.yml uses this with `--json` so the
 * subsequent gh-cli step can both extract `summary.total` for the comment-skip
 * decision AND get the markdown body in one shot.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  return args[i + 1] ?? null
}
const hasFlag = (flag) => args.includes(flag)

const basePath = getFlag('--base')
const headPath = getFlag('--head')
const outputPath = getFlag('--output')
const asJson = hasFlag('--json')
const quiet = hasFlag('--quiet')
const enforcePolicy = hasFlag('--enforce-policy')
const policyPath = getFlag('--policy') ?? path.join(repoRoot, '.archviber', 'policy.yaml')

if (!basePath || !headPath) {
  console.error('usage: node scripts/drift-check.mjs --base <yaml> --head <yaml> [--output FILE] [--json] [--quiet]')
  process.exit(1)
}

const require = jiti(__filename, {
  alias: { '@': path.join(repoRoot, 'src') },
  interopDefault: true,
})

const { detectDrift, summarizeDrift } = require(path.join(repoRoot, 'src/lib/drift/detect.ts'))
const { renderDriftMarkdown } = require(path.join(repoRoot, 'src/lib/drift/render.ts'))
const { irSchema } = require(path.join(repoRoot, 'src/lib/ir/schema.ts'))
const { policySchema, DEFAULT_POLICY } = require(path.join(repoRoot, 'src/lib/policy/schema.ts'))
const { checkDriftPolicy } = require(path.join(repoRoot, 'src/lib/policy/check.ts'))
const yaml = require(path.join(repoRoot, 'node_modules/yaml/dist/index.js'))

function loadIr(p) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) {
    console.error(`drift-check: file not found: ${abs}`)
    process.exit(1)
  }
  const text = fs.readFileSync(abs, 'utf8')
  let parsed
  try {
    parsed = yaml.parse(text)
  } catch (err) {
    console.error(`drift-check: YAML parse failed for ${abs}: ${err.message ?? err}`)
    process.exit(1)
  }
  const result = irSchema.safeParse(parsed)
  if (!result.success) {
    console.error(`drift-check: IR schema validation failed for ${abs}:`)
    console.error(result.error.issues.slice(0, 5))
    process.exit(1)
  }
  return result.data
}

function loadPolicySync(p) {
  if (!fs.existsSync(p)) return DEFAULT_POLICY
  let parsed
  try {
    parsed = yaml.parse(fs.readFileSync(p, 'utf8'))
  } catch (err) {
    console.error(`drift-check: policy YAML parse failed for ${p}: ${err.message ?? err}`)
    process.exit(1)
  }
  const result = policySchema.safeParse(parsed ?? {})
  if (!result.success) {
    console.error(`drift-check: policy schema validation failed for ${p}:`)
    console.error(result.error.issues.slice(0, 5))
    process.exit(1)
  }
  return result.data
}

const baseIr = loadIr(basePath)
const headIr = loadIr(headPath)

const report = detectDrift(baseIr, headIr)
const summary = summarizeDrift(report)
const markdown = renderDriftMarkdown(report)

let violations = []
if (enforcePolicy) {
  const policy = loadPolicySync(policyPath)
  violations = checkDriftPolicy(policy, summary)
}

if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), markdown, 'utf8')
}

if (asJson) {
  console.log(JSON.stringify({ summary, report, markdown, violations }, null, 2))
} else if (!(quiet && report.clean)) {
  console.log(markdown)
}

if (violations.length > 0) {
  console.error('\ndrift-check: policy violations:')
  for (const v of violations) console.error(`  - [${v.rule}] ${v.message}`)
  process.exit(1)
}

process.exit(0)
