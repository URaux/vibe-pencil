import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { INTENTS } from '@/lib/orchestrator/types'
import { loadFixtures } from './load-fixtures'
import { runEval } from './run-eval'
import { emitMetrics } from './emit-metrics'
import type { MetricsOutput } from './emit-metrics'
import { CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES, EXPLAIN_SHAPE_FAIL_OUTCOME } from './canned-outcomes'

const fixtures = loadFixtures()

describe('eval/orchestrator', () => {
  it('every fixture has a mock outcome (no missing keys)', () => {
    for (const f of fixtures) {
      expect(CLASSIFIER_OUTCOMES).toHaveProperty(f.id)
    }
  })

  it('every intent has at least one fixture', () => {
    const covered = new Set(fixtures.map((f) => f.expectedIntent))
    for (const intent of INTENTS) {
      expect(covered.has(intent), `intent '${intent}' has no fixture`).toBe(true)
    }
  })

  it('eval accuracy ≥ 90%', async () => {
    const report = await runEval(fixtures, CLASSIFIER_OUTCOMES)

    // surface per-fixture failures if any
    const failures = report.perFixture.filter((r) => !r.pass)
    if (failures.length > 0) {
      console.error('Failing fixtures:', failures)
    }

    expect(report.totalCount).toBe(fixtures.length)
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9)
  })

  it('explain fixtures pass shape assertions — 0 anchor failures and 0 forbidden-verb failures across all explain fixtures in the canned set', async () => {
    const explainFixtures = fixtures.filter((f) => f.expectedIntent === 'explain' && f.id !== 'ex-shape-fail')
    const explainOutcomes = Object.fromEntries(explainFixtures.map((f) => [f.id, CLASSIFIER_OUTCOMES[f.id]!]))
    const report = await runEval(explainFixtures, explainOutcomes, DISPATCH_OUTCOMES)

    const anchorFails = report.dispatch.perFixture.filter(
      (r) => r.explainShape !== undefined && !r.explainShape.hasAnchorRef
    ).length
    const verbFails = report.dispatch.perFixture.filter(
      (r) => r.explainShape !== undefined && r.explainShape.hasForbiddenVerb
    ).length

    expect(anchorFails).toBe(0)
    expect(verbFails).toBe(0)
    expect(report.dispatch.explainShapeFails).toBe(0)
  })

  it('ex-shape-fail fixture increments explainShapeFails by 1 when its canned outcome contains a forbidden verb', async () => {
    const shapeFail = fixtures.find((f) => f.id === 'ex-shape-fail')
    expect(shapeFail).toBeDefined()
    if (!shapeFail) return

    const singleOutcomes: Record<string, import('./run-eval').MockOutcome> = {
      'ex-shape-fail': CLASSIFIER_OUTCOMES['ex-shape-fail']!,
    }
    const dispatchOverride = { ...DISPATCH_OUTCOMES, explain: EXPLAIN_SHAPE_FAIL_OUTCOME }
    const report = await runEval([shapeFail], singleOutcomes, dispatchOverride)

    expect(report.dispatch.explainShapeFails).toBe(1)
  })

  it('emit-metrics: runs harness with all dispatch=ok, writes valid JSON with classifier.accuracy + dispatch.okCount', async () => {
    const report = await runEval(fixtures, CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES)

    // all dispatch outcomes are stubbed to 'ok'
    expect(report.dispatch.okCount).toBe(fixtures.length)
    expect(report.dispatch.totalCount).toBe(fixtures.length)
    expect(report.dispatch.notImplementedCount).toBe(0)
    expect(report.dispatch.errorCount).toBe(0)

    // write to a temp path
    const tmpDir = os.tmpdir()
    const outPath = path.join(tmpDir, `archviber-eval-metrics-${Date.now()}.json`)

    emitMetrics(report, outPath)

    // read back and validate shape
    const raw = fs.readFileSync(outPath, 'utf8')
    const parsed = JSON.parse(raw) as MetricsOutput

    expect(typeof parsed.generatedAt).toBe('string')
    expect(typeof parsed.classifier.accuracy).toBe('number')
    expect(parsed.classifier.accuracy).toBeGreaterThanOrEqual(0.9)
    expect(typeof parsed.dispatch.okCount).toBe('number')
    expect(parsed.dispatch.okCount).toBe(fixtures.length)
    expect(Array.isArray(parsed.fixtures)).toBe(true)
    expect(parsed.fixtures.length).toBe(fixtures.length)

    // cleanup
    fs.unlinkSync(outPath)
  })
})
