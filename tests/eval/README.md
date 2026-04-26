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

## Fixtures

`tests/eval/orchestrator/fixtures/intents.jsonl` — one JSON object per line:

```jsonc
{"id":"de-01","userPrompt":"...","expectedIntent":"design_edit","irSummary":{...}}
```

To add a fixture: append a new line with a unique `id` and set `expectedIntent` to one of the
five allowed intents. Add a matching entry to `mockOutcomes` in `eval.test.ts`.

Skip blank lines and lines starting with `//` — they are ignored by the loader.

## Roadmap

- **D8** — metric reporting: emit a JSON report for CI consumption.
- **D9** — CI wiring: run this suite in GitHub Actions on every PR.
