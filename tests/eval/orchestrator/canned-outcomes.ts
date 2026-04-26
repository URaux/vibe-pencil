/**
 * canned-outcomes.ts
 *
 * Shared deterministic mock maps used by both eval.test.ts and scripts/run-eval-ci.mjs.
 * Keeping them in one place ensures the CI gate and the test suite agree on inputs.
 */

import type { MockOutcome } from './run-eval'
import type { HandlerResult } from '@/lib/orchestrator/types'
import type { Intent } from '@/lib/orchestrator/types'
import { loadFixtures } from './load-fixtures'

const fixtures = loadFixtures()

/**
 * Classifier mock map: each fixture returns a "done" agent response whose JSON
 * payload names the expected intent at 0.92 confidence.  This drives accuracy ≥ 90%.
 */
export const CLASSIFIER_OUTCOMES: Record<string, MockOutcome> = Object.fromEntries(
  fixtures.map((f) => [
    f.id,
    {
      type: 'done',
      output: JSON.stringify({
        intent: f.expectedIntent,
        confidence: 0.92,
        rationale: 'eval mock',
      }),
    } satisfies MockOutcome,
  ])
)

// baseSummary topContainers for the default fixtures: UI, API, Data.
// The explain payload must cite at least one of these names.
const EXPLAIN_CONTENT =
  'The UI container handles all user-facing presentation, while the API container ' +
  'coordinates requests between the UI and the Data layer, which stores persistent state.'

/**
 * Dispatch mock map: each intent's handler is stubbed to return status='ok'.
 * Used by run-eval when exercising dispatchIntent.
 */
export const DISPATCH_OUTCOMES: Record<Intent, HandlerResult> = {
  design_edit: { intent: 'design_edit', status: 'ok' },
  build: { intent: 'build', status: 'ok' },
  modify: { intent: 'modify', status: 'ok' },
  deep_analyze: { intent: 'deep_analyze', status: 'ok' },
  explain: {
    intent: 'explain',
    status: 'ok',
    payload: { content: EXPLAIN_CONTENT, anchorRefs: ['UI', 'API', 'Data'] },
  },
}

/**
 * Explain shape-fail variant — canned outcome whose content contains a forbidden verb.
 * Used by the ex-shape-fail fixture to verify explainShapeFails increments.
 */
export const EXPLAIN_SHAPE_FAIL_OUTCOME: HandlerResult = {
  intent: 'explain',
  status: 'ok',
  payload: {
    content: 'You should rename the UI container to improve clarity.',
    anchorRefs: ['UI'],
  },
}
