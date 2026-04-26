/**
 * drift-review.mjs — Phase 3 PR review bot wiring.
 *
 * Reads the JSON output of scripts/drift-check.mjs (--json) and the IR YAML,
 * calls the runArchitectureReview library function once against a configured
 * LLM, and writes a markdown section that the workflow appends to the drift PR comment.
 *
 * Usage: node scripts/drift-review.mjs --drift result.json --ir .archviber/ir.yaml --output review.md
 *
 * Required env: VIBE_LLM_API_BASE / API_KEY / MODEL.
 *
 * Exits 0 always (advisory; never blocks the workflow). When drift is clean
 * or env missing, writes nothing (or a no-op comment) so the existing
 * comment step is unaffected.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
function flag(f) {
  const i = args.indexOf(f)
  return i === -1 ? null : args[i + 1] ?? null
}

const driftPath = flag('--drift')
const irPath = flag('--ir')
const outPath = flag('--output') ?? 'review.md'
if (!driftPath || !irPath) {
  console.error('drift-review: --drift <result.json> --ir <ir.yaml> required')
  process.exit(0)
}

const apiBase = process.env.VIBE_LLM_API_BASE
const apiKey = process.env.VIBE_LLM_API_KEY
const model = process.env.VIBE_LLM_MODEL
if (!apiBase || !apiKey || !model) {
  console.warn('drift-review: VIBE_LLM_* env missing — skipping review')
  fs.writeFileSync(outPath, '', 'utf8')
  process.exit(0)
}

const require = jiti(__filename, {
  alias: { '@': path.join(repoRoot, 'src') },
  interopDefault: true,
})

const { runArchitectureReview, renderReviewSection } = require(
  path.join(repoRoot, 'src/lib/review/architecture-review.ts'),
)
const { irSchema } = require(path.join(repoRoot, 'src/lib/ir/schema.ts'))
const { summarizeIr } = require(path.join(repoRoot, 'src/lib/orchestrator/summarize.ts'))
const yaml = require(path.join(repoRoot, 'node_modules/yaml/dist/index.js'))

async function main() {
  const driftJson = JSON.parse(fs.readFileSync(driftPath, 'utf8'))
  if (!driftJson?.report || driftJson.report.clean) {
    console.log('drift-review: clean — no review needed')
    fs.writeFileSync(outPath, '', 'utf8')
    return
  }

  const irText = fs.readFileSync(irPath, 'utf8')
  const irParsed = yaml.parse(irText)
  const ir = irSchema.parse(irParsed)
  const irSummary = summarizeIr(ir)

  try {
    const result = await runArchitectureReview({
      driftReport: driftJson.report,
      irSummary,
      config: { apiBase, apiKey, model },
      timeoutMs: 25_000,
    })
    const md = renderReviewSection(result)
    fs.writeFileSync(outPath, md, 'utf8')
    console.log(`drift-review: wrote review (${result.durationMs}ms, ${result.review.length} chars) → ${outPath}`)
  } catch (err) {
    console.warn('drift-review: review failed —', err instanceof Error ? err.message : err)
    fs.writeFileSync(outPath, '', 'utf8')
  }
}

main().catch((err) => {
  console.error('drift-review fatal:', err)
  fs.writeFileSync(outPath, '', 'utf8')
  process.exit(0)
})
