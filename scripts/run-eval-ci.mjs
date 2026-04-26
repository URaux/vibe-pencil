/**
 * run-eval-ci.mjs
 *
 * CI entry-point that runs the eval harness and emits eval-results.json.
 * Called by .github/workflows/eval.yml after `npm ci`.
 *
 * Usage:
 *   node scripts/run-eval-ci.mjs
 *
 * Output:
 *   eval-results.json  (repo root) — consumed by actions/upload-artifact
 *
 * Exit code: always 0 (advisory gate; D10 adds blocking thresholds).
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

// Create a jiti instance that understands TypeScript and the @/ alias.
const require = jiti(__filename, {
  alias: {
    '@': path.join(repoRoot, 'src'),
  },
  // jiti v2: use interopDefault so default exports work correctly
  interopDefault: true,
})

// Load the TypeScript modules via jiti.
const { loadFixtures } = require(path.join(repoRoot, 'tests/eval/orchestrator/load-fixtures.ts'))
const { runEval } = require(path.join(repoRoot, 'tests/eval/orchestrator/run-eval.ts'))
const { emitMetrics } = require(path.join(repoRoot, 'tests/eval/orchestrator/emit-metrics.ts'))
const { CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES } = require(
  path.join(repoRoot, 'tests/eval/orchestrator/canned-outcomes.ts')
)

const outPath = path.join(repoRoot, 'eval-results.json')

async function main() {
  console.log('[run-eval-ci] Loading fixtures...')
  const fixtures = loadFixtures()
  console.log(`[run-eval-ci] Loaded ${fixtures.length} fixtures.`)

  console.log('[run-eval-ci] Running eval harness...')
  const report = await runEval(fixtures, CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES)

  console.log(
    `[run-eval-ci] Classifier accuracy: ${(report.accuracy * 100).toFixed(1)}% ` +
      `(${report.passCount}/${report.totalCount})`
  )
  console.log(
    `[run-eval-ci] Dispatch: ok=${report.dispatch.okCount} ` +
      `not_implemented=${report.dispatch.notImplementedCount} ` +
      `error=${report.dispatch.errorCount} ` +
      `explainShapeFails=${report.dispatch.explainShapeFails}`
  )

  console.log(`[run-eval-ci] Writing ${outPath}...`)
  emitMetrics(report, outPath)
  console.log('[run-eval-ci] Done. Exit 0 (advisory gate).')
}

main().catch((err) => {
  console.error('[run-eval-ci] Fatal:', err)
  // Still exit 0 — advisory only until D10.
  process.exit(0)
})
