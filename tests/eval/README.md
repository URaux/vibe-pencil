# Eval Harness — Intent Classifier

Offline evaluation suite for the ArchViber intent classifier. Runs with `vitest` against
a deterministic `MockRunner` — no live LLM calls required.

## Run

```bash
npx vitest run -c vitest.eval.config.ts
```

## What it checks

- Every intent (`design_edit`, `build`, `modify`, `deep_analyze`, `explain`) has coverage.
- Every fixture has a mock outcome defined (no missing keys).
- Overall accuracy across all fixtures is ≥ 90%.
- Emit-metrics: harness with all-ok dispatch outcomes writes valid JSON.

## Fixtures

`tests/eval/orchestrator/fixtures/intents.jsonl` — one JSON object per line:

```jsonc
{"id":"de-01","userPrompt":"...","expectedIntent":"design_edit","irSummary":{...}}
```

### How to add fixtures

1. Append a new line to `fixtures/intents.jsonl` with a unique `id`.
2. Set `expectedIntent` to one of the five allowed intents:
   `design_edit | build | modify | deep_analyze | explain`.
3. Populate `irSummary` with realistic values (see existing entries for shape).
4. **No changes needed elsewhere** — `canned-outcomes.ts` auto-generates a mock outcome
   for every fixture at runtime (it calls `loadFixtures()` itself).  The test file
   imports from `canned-outcomes.ts`, so new fixtures are automatically covered.

Skip blank lines and lines starting with `//` — they are ignored by the loader.

## Metrics emission

After each eval run the harness can serialize results to a JSON file via `emitMetrics`.
This file is consumed by CI (`actions/upload-artifact`) and compared across runs to
detect regressions.  D10 will add blocking threshold checks against this file.

### Emit metrics from code

```ts
import { runEval } from './run-eval'
import { emitMetrics } from './emit-metrics'
import { CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES } from './canned-outcomes'

const report = await runEval(fixtures, CLASSIFIER_OUTCOMES, DISPATCH_OUTCOMES)
emitMetrics(report, 'eval-results.json')
```

### JSON schema

Top-level keys of `eval-results.json`:

| Key            | Type    | Description                                                  |
| -------------- | ------- | ------------------------------------------------------------ |
| `generatedAt`  | string  | ISO-8601 timestamp of when the file was written              |
| `classifier`   | object  | `{ totalCount, passCount, accuracy, byIntent }`              |
| `dispatch`     | object  | `{ totalCount, okCount, notImplementedCount, errorCount, perFixture }` |
| `fixtures`     | array   | Per-fixture classifier results: `{ id, expected, actual, fallback, pass }` |

#### `classifier` object

```jsonc
{
  "totalCount": 15,       // number of fixtures evaluated
  "passCount": 15,        // fixtures where actual intent === expected intent
  "accuracy": 1.0,        // passCount / totalCount
  "byIntent": {
    "design_edit": { "total": 4, "pass": 4 },
    "build":       { "total": 3, "pass": 3 },
    ...
  }
}
```

#### `dispatch` object

```jsonc
{
  "totalCount": 15,           // fixtures dispatched
  "okCount": 15,              // handlers that returned status='ok'
  "notImplementedCount": 0,   // handlers that returned status='not_implemented'
  "errorCount": 0,            // handlers that threw or returned status='error'
  "perFixture": [
    { "id": "de-01", "intent": "design_edit", "status": "ok" },
    ...
  ]
}
```

## CI

The eval workflow (`.github/workflows/eval.yml`) runs on every PR and push to `main`:

```
npx vitest run -c vitest.eval.config.ts
node scripts/run-eval-ci.mjs   →  eval-results.json
```

Both `eval-vitest.json` and `eval-results.json` are uploaded as the `eval-metrics` artifact.

> **Advisory**: the gate is non-blocking until W3.D10 adds threshold enforcement.

## Shape assertions

Per-intent output shape rules run inline inside `runEval` whenever a fixture has status `ok` and the expected intent matches. Results are aggregated into `dispatch.explainShapeFails` in the report.

**Explain shape rule** (applied to every `explain` fixture whose dispatch result is `ok` with a `payload.content` string):
- `hasAnchorRef` — the content must contain at least one `irSummary.topContainers[*].name` or a basename from `anchorPaths`. Failure means the response is ungrounded.
- `hasForbiddenVerb` — the content must NOT match `/\b(rename|build|spawn|run|refactor|modify)\s+\w/i`. Failure means the response used a tool-action verb.

A fixture fails shape if `!hasAnchorRef || hasForbiddenVerb`. The count is in `report.dispatch.explainShapeFails`.

**Adding a shape rule for a new intent**: add a helper function `compute<Intent>Shape` in `run-eval.ts` mirroring `computeExplainShape`, extend `DispatchFixtureResult` with `<intent>Shape?: ...`, compute and attach it in the dispatch loop, and add the fail-count to `DispatchReport` and the `explainShapeFails` aggregation block.

## Roadmap

- **D8** ✓ — metric reporting: emit a JSON report for CI consumption.
- **D9** ✓ — CI wiring: run this suite in GitHub Actions on every PR.
- **D10** — blocking thresholds: fail the CI job when accuracy < 90% or dispatch error rate > 0%.
