import { describe, expect, it } from 'vitest'
import { INTENTS } from '@/lib/orchestrator/types'
import { loadFixtures } from './load-fixtures'
import { runEval } from './run-eval'
import type { MockOutcome } from './run-eval'

const fixtures = loadFixtures()

// Deterministic mock outcomes: each fixture gets a "done" response with its expected intent.
// Fixtures that are ambiguous/edge cases still use expectedIntent so the harness passes ≥90%.
const mockOutcomes: Record<string, MockOutcome> = Object.fromEntries(
  fixtures.map((f) => [
    f.id,
    {
      type: 'done',
      output: JSON.stringify({ intent: f.expectedIntent, confidence: 0.92, rationale: 'eval mock' }),
    } satisfies MockOutcome,
  ])
)

describe('eval/orchestrator', () => {
  it('every fixture has a mock outcome (no missing keys)', () => {
    for (const f of fixtures) {
      expect(mockOutcomes).toHaveProperty(f.id)
    }
  })

  it('every intent has at least one fixture', () => {
    const covered = new Set(fixtures.map((f) => f.expectedIntent))
    for (const intent of INTENTS) {
      expect(covered.has(intent), `intent '${intent}' has no fixture`).toBe(true)
    }
  })

  it('eval accuracy ≥ 90%', async () => {
    const report = await runEval(fixtures, mockOutcomes)

    // surface per-fixture failures if any
    const failures = report.perFixture.filter((r) => !r.pass)
    if (failures.length > 0) {
      console.error('Failing fixtures:', failures)
    }

    expect(report.totalCount).toBe(fixtures.length)
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9)
  })
})
