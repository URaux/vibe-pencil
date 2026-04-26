/**
 * run-eval-ci.mjs
 *
 * CI entry-point that runs the eval harness and emits eval-results.json.
 * Called by .github/workflows/eval.yml after `npm ci`.
 *
 * Usage:
 *   node scripts/run-eval-ci.mjs            # blocking — fails on threshold breach
 *   node scripts/run-eval-ci.mjs --advisory # legacy advisory mode (always exits 0)
 *
 * Output:
 *   eval-results.json  (repo root) — consumed by actions/upload-artifact
 *
 * Thresholds (P2.W1.D9): classifier accuracy ≥ 0.90, dispatch error rate ≤ 0.05, explainShapeFails = 0.
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const THRESHOLDS = {
  classifierAccuracyMin: 0.9,
  dispatchErrorRateMax: 0.05,
  explainShapeFailsMax: 0,
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const require = jiti(__filename, {
  alias: { '@': path.join(repoRoot, 'src') },
  interopDefault: true,
})

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

  const advisory = process.argv.includes('--advisory')
  const dispatchTotal = report.dispatch.totalCount
  const dispatchErrorRate = dispatchTotal > 0 ? report.dispatch.errorCount / dispatchTotal : 0

  const failures = []
  if (report.accuracy < THRESHOLDS.classifierAccuracyMin) {
    failures.push(
      `classifier accuracy ${(report.accuracy * 100).toFixed(1)}% < ${(THRESHOLDS.classifierAccuracyMin * 100).toFixed(0)}%`
    )
  }
  if (dispatchErrorRate > THRESHOLDS.dispatchErrorRateMax) {
    failures.push(
      `dispatch error rate ${(dispatchErrorRate * 100).toFixed(1)}% > ${(THRESHOLDS.dispatchErrorRateMax * 100).toFixed(0)}%`
    )
  }
  if (report.dispatch.explainShapeFails > THRESHOLDS.explainShapeFailsMax) {
    failures.push(`explainShapeFails ${report.dispatch.explainShapeFails} > ${THRESHOLDS.explainShapeFailsMax}`)
  }

  if (failures.length === 0) {
    console.log('[run-eval-ci] Done. All thresholds passed. Exit 0.')
    return
  }

  console.error('[run-eval-ci] Threshold failures:')
  for (const f of failures) console.error(`  - ${f}`)

  if (advisory) {
    console.warn('[run-eval-ci] --advisory flag set, exiting 0 despite failures.')
    return
  }

  process.exit(1)
}

main().catch((err) => {
  console.error('[run-eval-ci] Fatal:', err)
  if (process.argv.includes('--advisory')) {
    process.exit(0)
  }
  process.exit(1)
})
