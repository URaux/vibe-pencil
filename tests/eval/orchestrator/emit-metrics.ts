import fs from 'fs'
import path from 'path'
import type { EvalReport } from './run-eval'

export interface MetricsOutput {
  generatedAt: string
  classifier: {
    totalCount: number
    passCount: number
    accuracy: number
    byIntent: EvalReport['byIntent']
  }
  dispatch: EvalReport['dispatch']
  fixtures: EvalReport['perFixture']
}

/**
 * emitMetrics — serialises an EvalReport to a JSON file at outPath.
 *
 * The produced file is consumed by CI (actions/upload-artifact) and can be
 * compared across runs to detect regressions.  D10 will add blocking
 * threshold checks against this file.
 *
 * Schema (top-level keys):
 *   generatedAt  string   ISO-8601 timestamp
 *   classifier   object   { totalCount, passCount, accuracy, byIntent }
 *   dispatch     object   { totalCount, okCount, notImplementedCount, errorCount, perFixture }
 *   fixtures     array    per-fixture classifier results (id, expected, actual, fallback, pass)
 */
export function emitMetrics(result: EvalReport, outPath: string): void {
  const dir = path.dirname(outPath)
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true })
  }

  const output: MetricsOutput = {
    generatedAt: new Date().toISOString(),
    classifier: {
      totalCount: result.totalCount,
      passCount: result.passCount,
      accuracy: result.accuracy,
      byIntent: result.byIntent,
    },
    dispatch: result.dispatch,
    fixtures: result.perFixture,
  }

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8')
}
