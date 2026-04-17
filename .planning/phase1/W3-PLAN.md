# W3 Plan

## W3 goal

W3 turns the Phase 1 IR from a passive artifact into an execution surface: chat requests are first routed by intent, architecture-review prompts trigger a `deep_analyze` path that runs 5 parallel read-only perspectives against IR + `code_anchors`, and a lightweight eval harness measures whether routing, analysis shape, and benchmark behavior stay correct as the repo evolves. Concretely for ArchViber, this means `POST /api/chat/route.ts` stops being a single undifferentiated chat path, deep analysis becomes a first-class route instead of ad hoc prompting, and CI gains a repeatable benchmark that tells us whether routing and analysis regress before W4+ work lands.

## W3 acceptance (objective)

- Chat prompt like `"why is this coupled?"` routes to `deep_analyze`, returns a 5-viewpoint markdown report, and completes within a 60s wall-clock budget on the benchmark repo.
- Routing on the benchmark set chooses the expected handler (`design_edit | build | modify | deep_analyze | explain`) at **>= 90%** accuracy, with low-confidence cases surfacing a clarify response instead of silently misrouting.
- `POST /api/chat/route.ts` can run with orchestrator enabled, classifier failure falls back to `explain`, and legacy chat remains reachable behind the same route.
- `tests/eval/*` emits a machine-readable report with routing accuracy, deep-analyze shape checks, and benchmark-case pass/fail summary.
- `.github/workflows/eval.yml` runs green on the benchmark fixture and publishes the eval report artifact.

## D1-D10 breakdown

### W3.D1 - deep_analyze prompt pack + viewpoint contract
- **Goal**: Lock the 5-viewpoint contract so analysis output shape is stable before route wiring starts.
- **Code scope (files/modules)**: `src/lib/deep-analyze/perspectives/*`, `src/lib/deep-analyze/prompt-builder.ts` if needed, `src/lib/context-engine.ts` only if prompt-context reuse is required.
- **Test**: Fixture-driven prompt builder test proves each perspective prompt consumes IR summary + relevant `code_anchors` and produces a distinct section contract.
- **Commit msg sketch**: `phase1/w3/d1: define deep_analyze perspective prompts and output contract`

### W3.D2 - AgentRunner-based deep_analyze runner + aggregation
- **Goal**: Add one read-only deep-analyze runner that fans out to 5 ephemeral analysts in parallel and merges partial results into one report.
- **Code scope (files/modules)**: `src/lib/agent-runner.ts`, `src/lib/agent-runner-instance.ts`, `src/lib/deep-analyze/runner.ts`, `src/lib/deep-analyze/aggregate.ts`, `src/app/api/agent/deep-analyze/route.ts`.
- **Test**: Unit test covers all-success, partial-failure, and all-failure aggregation; route test verifies SSE or streamed completion shape and no IR persistence side effects.
- **Commit msg sketch**: `phase1/w3/d2: add AgentRunner deep_analyze route with 5-view aggregation`

### W3.D3 - classifier + IR summarizer
- **Goal**: Classify one chat request into the 5 route intents using a single cheap LLM call plus strict parse/validation.
- **Code scope (files/modules)**: `src/lib/orchestrator/classify.ts`, `src/lib/orchestrator/summarize.ts`, `src/lib/orchestrator/log.ts`.
- **Test**: 20+ canned prompts validate JSON parsing, fallback on malformed output, and expected intent on the benchmark prompt set.
- **Commit msg sketch**: `phase1/w3/d3: add orchestrator intent classifier and IR summarizer`

### W3.D4 - dispatcher + handler split
- **Goal**: Move routing logic into a dispatcher so `chat` becomes a thin entrypoint and each route is explicit.
- **Code scope (files/modules)**: `src/lib/orchestrator/dispatch.ts`, `src/lib/orchestrator/handlers/design-edit.ts`, `src/lib/orchestrator/handlers/build.ts`, `src/lib/orchestrator/handlers/modify.ts`, `src/lib/orchestrator/handlers/deep-analyze.ts`, `src/lib/orchestrator/handlers/explain.ts`.
- **Test**: Unit tests prove each intent branch hits the correct handler; confidence-below-threshold returns clarify; classifier exception returns `explain`.
- **Commit msg sketch**: `phase1/w3/d4: add orchestrator dispatcher and per-intent handlers`

### W3.D5 - chat route integration
- **Goal**: Put the dispatcher in front of `POST /api/chat/route.ts` without rewriting the existing design-edit path.
- **Code scope (files/modules)**: `src/app/api/chat/route.ts`, `src/lib/context-engine.ts`, `tests/api/chat-route.test.ts`, `tests/api/chat-ir-integration.test.ts`.
- **Test**: API integration test proves representative prompts route to `design_edit`, `build`, `modify`, `deep_analyze`, and `explain` with orchestrator enabled.
- **Commit msg sketch**: `phase1/w3/d5: wire orchestrator into chat route behind feature flag`

### W3.D6 - fallback, logging, and clarify path
- **Goal**: Make misclassification survivable and inspectable before eval hardens expectations.
- **Code scope (files/modules)**: `src/lib/orchestrator/log.ts`, `src/lib/orchestrator/dispatch.ts`, `src/lib/orchestrator/classify.ts`, `.archviber/cache/classifier-log.jsonl` behavior via existing IR persistence/cache conventions.
- **Test**: Forced timeout / parse-failure / missing-IR tests prove fallback to `explain` or clarify instead of throwing.
- **Commit msg sketch**: `phase1/w3/d6: add classifier fallback telemetry and clarify behavior`

### W3.D7 - eval harness scaffold
- **Goal**: Create a benchmark runner that executes routing cases and deep-analyze shape checks against a stable fixture repo.
- **Code scope (files/modules)**: `tests/eval/harness.ts`, `tests/eval/cases.ts`, `tests/eval/fixtures/*`, `package.json` script surface if needed.
- **Test**: `pnpm test:eval` (or equivalent) writes a JSON report with per-case results and aggregate routing accuracy.
- **Commit msg sketch**: `phase1/w3/d7: add eval harness scaffold and benchmark fixtures`

### W3.D8 - metrics + assertions
- **Goal**: Convert the eval harness from smoke-only into objective gates.
- **Code scope (files/modules)**: `tests/eval/metrics.ts`, `tests/eval/harness.ts`, optionally `tests/eval/ground-truth.*` if the fixture labeling needs to live beside cases.
- **Test**: Metrics report includes routing accuracy, deep-analyze answer-shape compliance, and benchmark latency buckets; failing thresholds produce a red run.
- **Commit msg sketch**: `phase1/w3/d8: add routing and deep-analyze metrics to eval harness`

### W3.D9 - CI wiring
- **Goal**: Put eval on every PR so W3 does not stay as a local-only confidence exercise.
- **Code scope (files/modules)**: `.github/workflows/eval.yml`, `tests/eval/*`, existing test scripts in `package.json`.
- **Test**: GitHub Actions run completes on ubuntu-latest, uploads eval JSON/artifact, and fails on threshold regressions.
- **Commit msg sketch**: `phase1/w3/d9: add eval workflow and report artifact upload`

### W3.D10 - smoke, default-on decision, and docs cleanup
- **Goal**: Do one end-to-end smoke pass, decide whether orchestrator is safe to default on, and leave Phase 1 docs coherent.
- **Code scope (files/modules)**: `src/app/api/chat/route.ts` env default, `README` or Phase 1 docs as needed, `tests/api/*`, `tests/eval/*`.
- **Test**: Fresh project with IR loaded can answer one prompt per route, eval stays green, and deep-analyze still finishes inside the target budget.
- **Commit msg sketch**: `phase1/w3/d10: smoke orchestrator path and finalize eval defaults`

## Eval harness

Benchmark set target: **24 cases minimum**, split across routing accuracy and deep-analyze answer-shape checks. Every case records:
- `question`
- `expected_agent`
- `expected_answer_shape`
- `notes` for ambiguity or acceptable clarify behavior

Categories:

1. `design_edit` block/container edits - 5 cases
Representative sample:
| Question | Expected agent | Expected answer-shape |
|---|---|---|
| `add a block for auth between API Layer and Data Layer` | `design_edit` | canvas-action or design-edit response mentioning block/edge change |
| `connect Canvas Editor to Store` | `design_edit` | edit plan or emitted edge action; not build, not analyze |

2. `build` execution intents - 4 cases
Representative sample:
| Question | Expected agent | Expected answer-shape |
|---|---|---|
| `build this` | `build` | build proposal / build-target response, not architecture explanation |
| `implement Wave 1` | `build` | wave-targeted build response or proposal with node scope |

3. `modify` rename/refactor intents - 5 cases
Representative sample:
| Question | Expected agent | Expected answer-shape |
|---|---|---|
| `rename FooService to BarService` | `modify` | modify-agent plan with rename semantics |
| `refactor schema-engine.ts` | `modify` | modify route or clarify if outside rename-only scope; must not hit design_edit |

4. `deep_analyze` review/audit intents - 6 cases
Representative sample:
| Question | Expected agent | Expected answer-shape |
|---|---|---|
| `why is this coupled?` | `deep_analyze` | 5-section markdown report with viewpoint headings |
| `security audit this architecture` | `deep_analyze` | security-oriented findings inside the 5-view report, anchored to blocks/files |
| `what is the riskiest part of this system?` | `deep_analyze` | critical-path / cost / complexity oriented review, not plain summary |

5. `explain` read-only understanding intents - 4 cases
Representative sample:
| Question | Expected agent | Expected answer-shape |
|---|---|---|
| `what does Canvas Editor do?` | `explain` | plain explanation grounded in IR summary / anchors, no tool side effects |
| `summarize the architecture` | `explain` | concise summary, not build or deep-analyze |

Harness checks:
- Routing accuracy: exact match against `expected_agent`, except cases explicitly marked `clarify_ok`.
- Deep-analyze shape: exactly 5 viewpoint headings, at least 1 finding or explicit `no issue found` line per section, and at least 2 references to concrete block names or `code_anchors`.
- Explain shape: no tool-plan verbs such as `rename`, `build`, `spawn`, `run`.
- Modify shape: mentions rename/refactor scope and, when unsupported, asks a clarifying question instead of pretending full support.
- Build shape: identifies a build target or wave and does not emit canvas-edit language.

## Orchestrator routing rules

Routing stays consistent with `ORCHESTRATOR-ROUTING.md`: one classifier call in front of chat, explicit fallback to `explain`, and `deep_analyze` implemented via `AgentRunner` rather than CC Task because that is the path already aligned with the routing spec and backend-agnostic Phase 1 constraints.

Pseudo-code:

```ts
type Intent = 'design_edit' | 'build' | 'modify' | 'deep_analyze' | 'explain'

async function dispatchChat(req: ChatRequest) {
  const ir = await tryLoadIr()
  if (!ir) {
    if (looksLikeDesignEdit(req.message)) return designEditHandler(req, null)
    return explainHandler(req, null)
  }

  const verdict = await classify(req.message, {
    irSummary: summarizeIr(ir, { maxTokens: 600 }),
    lastIntent: req.lastIntent ?? null,
    locale: req.locale ?? 'en',
  }).catch(() => ({
    intent: 'explain' as const,
    confidence: 0.3,
    reason: 'classifier failure',
  }))

  await logRouting(verdict, req)

  if (verdict.confidence < 0.7) {
    return clarifyHandler(req, verdict)
  }

  if (verdict.intent === 'deep_analyze') {
    return deepAnalyzeHandler(req, ir)
  }

  if (verdict.intent === 'modify') {
    return modifyHandler(req, ir)
  }

  if (verdict.intent === 'build') {
    return buildHandler(req, ir)
  }

  if (verdict.intent === 'design_edit') {
    return designEditHandler(req, ir)
  }

  return explainHandler(req, ir)
}

function looksLikeDesignEdit(message: string) {
  return /add|remove|connect|disconnect|move block|container|edge/i.test(message)
}
```

Concrete rules:
- If the user asks to add/remove/connect/move blocks, containers, or edges, route `design_edit`.
- If the user asks to generate, implement, build, or run a wave/block, route `build`.
- If the user names code identifiers, files, or symbol renames/refactors, route `modify`; in Phase 1, non-rename refactors should lower confidence and usually trigger clarify.
- If the user asks for review, audit, coupling, complexity, maintainability, risk, or architecture critique, route `deep_analyze`.
- If the user asks what/why/how in a read-only way, route `explain`.
- If confidence is `< 0.7`, return clarify rather than taking an irreversible route.
- If classifier output is malformed or times out, log it and fall back to `explain`.

## Deep-analyze 5 viewpoints

- `coupling`: find hidden dependency tangles, high-blast-radius nodes, and boundary leaks between clusters or layers.
- `complexity`: identify structural hotspots, overloaded modules, and places where line/symbol density likely exceeds the current abstraction level.
- `cost`: estimate expensive-to-change zones, repeated work, and flows likely to amplify future implementation or maintenance effort.
- `cohesion`: check whether named clusters and blocks actually belong together or hide mixed responsibilities behind one label.
- `critical_path`: identify runtime or delivery-critical paths where breakage would block core behavior, deployment, or future change velocity.

## Dependencies on W2

- Canonical IR persistence from W1/W2 is assumed present so routing and deep_analyze can load the project state from `.archviber/ir.yaml`.
- `FactGraph` output from `src/lib/ingest/facts.ts` is the structural source for cluster membership and cross-module relationships.
- Clustering from `src/lib/ingest/cluster.ts` is the basis for reasoning about boundaries, coupling, and cohesion.
- `code_anchors` emitted by `src/lib/ingest/code-anchors.ts` are required so deep_analyze can ground findings in files, symbols, and line ranges instead of free-floating prose.
- Named clusters from `src/lib/ingest/name.ts` are assumed available when the naming pass succeeds; if not, deep_analyze and explain must tolerate fallback names rather than failing.

## Risks & mitigations

- Classifier bleed between `design_edit` and `modify` can silently send users to the wrong path. Mitigation: benchmark cases explicitly target this boundary, and confidence `< 0.7` returns clarify.
- Deep-analyze latency can exceed the chat budget if all 5 analysts run on large repos with heavy anchors. Mitigation: cap IR summary/anchor payload, keep analysts parallel, and degrade gracefully on partial failure.
- Eval harness can become too synthetic and stop catching real routing mistakes. Mitigation: keep cases phrased like real chat prompts, not label-friendly templates.
- AgentRunner-based deep_analyze may expose backend-specific output differences that break answer-shape assertions. Mitigation: eval checks headings and grounding shape, not brittle exact text.
- W2 artifact quality may vary on self-imports or partially named clusters. Mitigation: treat naming fallback as first-class and keep deep-analyze viewpoint prompts robust to generic cluster names.

## Open questions

1. Should W3 benchmark only one vendored fixture repo, or also include ArchViber self-import once W2 output quality stabilizes enough to avoid noisy eval failures?
2. Is the W3 success budget for deep_analyze `<= 60s` or `<= 90s` wall clock? Existing planning notes mention both.
3. Does `build` routing in Phase 1 return a client-side build proposal event only, or should the orchestrator be allowed to invoke a server-side build route directly?
4. Should low-confidence `modify` requests always clarify, or can rename-pattern matches bypass clarify even when classifier confidence is below threshold?
5. Are W2 named clusters guaranteed to be persisted in the IR, or are they only derivable during ingest? If not guaranteed, eval should include fallback-name cases.
6. Is there already a preferred report schema/artifact format for CI beyond generic JSON, or should `tests/eval/harness.ts` define the first stable one?
7. Should `deep_analyze` remain strictly read-only in prompt language, or may it include refactor recommendations that mention modify/build follow-up paths explicitly?
8. Do we want the orchestrator feature flag default-on at W3.D10, or only documented and left opt-in until a full browser smoke pass is completed?
