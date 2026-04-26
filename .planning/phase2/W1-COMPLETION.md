# Phase 2 / W1 — Completion report

**Status**: COMPLETE 2026-04-26
**Branch**: `phase2/w1`
**Total commits**: 7 atomic D-task commits + 1 plan-lock commit

## What shipped

All 4 stub handlers became real, the feature flag flipped to default-on, and CI eval became blocking.

| D-task | Commit | What |
|---|---|---|
| Plan-lock | `8a2dec8` | PLAN.md committed (W2 path, decisions table) |
| Plan-update | `6895cc3` | Add Rust to W2 reference adapter set |
| D1+D2 | `9d64cb7` | `design_edit` real handler — LLM-driven CanvasAction emitter |
| D3+D4 | `0e0b8b9` | `explain` real handler — IR/anchor-grounded prose + eval shape assertions |
| D5+D6 | `adff847` | `modify` real pipeline — ts-morph plan + sandbox + git PR (built from scratch; P1.W2 never shipped this) |
| D7+D8 | `(this branch)` | `build` real handler — plan-only BuildPlan emitter + orchestrator-turn rendering for build/modify |
| D9 | `a827c2a` | Flip `ARCHVIBER_ORCHESTRATOR` default ON; eval CI thresholds become blocking |
| D10 | `(this commit)` | Smoke test for all 5 intents + this report |

## Test snapshot

- Orchestrator + chat suite: **76/76 green** (was 41 at start of W1; +35 net new tests)
- Eval suite: **6/6 green**
- Smoke suite: **7/7 green** (5 intent paths + telemetry ring + clarify)
- `npx tsc --noEmit` clean
- `node scripts/run-eval-ci.mjs` passes all blocking thresholds (100% classifier, 0 dispatch errors, 0 explain shape fails on canned set)

## Default-on confirmation

`src/app/api/chat/route.ts:732`:
```ts
if (process.env.ARCHVIBER_ORCHESTRATOR !== '0' && ir) { ... }
```
Orchestrator runs by default whenever IR is loaded. Opt-out via `ARCHVIBER_ORCHESTRATOR=0`.

## Files added (W1 net)

```
src/lib/modify/
├── apply.ts               # Shared edit applier (sandbox + pr)
├── pr.ts                  # git branch + commit
├── rename.ts              # ts-morph planRename + conflict detection
├── sandbox.ts             # tmp-dir copy + apply + tsc (auto-resolves binary)
└── test-fixtures.ts       # makeTmpProject helper

tests/_helpers/
└── mock-runner.ts         # Shared MockRunner extracted from classify/dispatch tests

tests/lib/modify/{rename,sandbox,pr}.test.ts
tests/lib/orchestrator/handlers/{design_edit,explain,modify,build}.test.ts
tests/api/chat/{design-edit,build}-integration.test.ts
tests/smoke/w1-orchestrator.test.ts

src/lib/orchestrator/handlers/{design_edit,explain,modify,build}.ts  # all replaced
src/lib/orchestrator/dispatch.ts                                      # unchanged
src/app/api/chat/orchestrator-turn.ts                                 # stringifyHandlerResult extended for all 5 intents
src/app/api/chat/route.ts                                             # guard flipped
scripts/run-eval-ci.mjs                                               # blocking thresholds
```

## Notable architectural choices made during W1

1. **MockRunner extracted to `tests/_helpers/mock-runner.ts`** — was duplicated in classify.test.ts and dispatch.test.ts. New handler tests import from the shared helper.
2. **Sandbox tsc auto-resolution**: `runSandbox` resolves the tsc binary by checking `<project>/node_modules/.bin/tsc`, then `<repoRoot>/node_modules/.bin/tsc`, then `npx tsc`. Lets tests run on tmp projects with no node_modules.
3. **Modify handler refuses without `ctx.workDir`**: returns `{ status: 'error', error: 'modify requires a project workDir' }`. Prevents accidental rename in arbitrary cwd.
4. **Build handler is plan-only**: emits `BuildPlan` with `dispatchUrl: '/api/agent/spawn'` + `dispatchBody`. UI confirms before any agent spawn. Direct execution waits for P3 policy gates.
5. **Explain shape assertions in eval**: regex-checks for forbidden tool verbs (`rename|build|spawn|run|refactor|modify`) + asserts at least one anchor reference. Negative fixture `ex-shape-fail` proves the assertion fires.
6. **Telemetry ring buffer**: in-memory 100-turn ring with intent + confidence + dispatchStatus + error. `getRecentTurns()` returns recent oldest-first. Persistent jsonl logging is a P2 follow-up (see PLAN.md §0 row 5).

## Codex rescue subagent — STILL BROKEN

The `Agent(subagent_type='codex:codex-rescue')` route claims it can't reach Codex (gpt-5.5 not supported, fallback denied), even though `node codex-companion.mjs --model gpt-5.5` works fine in the same session. D7+D8 also stalled mid-task on a regular Sonnet agent (stream watchdog timeout) — that one was finished inline by the main agent. Investigation deferred to its own task.

## Open follow-ups for P2.W2

- Persistent telemetry: write `recordClassification` / `recordDispatch` results to `.archviber/cache/orchestrator-log.jsonl` (per W1 PLAN.md decision row 5). Easy add but not on the critical path.
- W1 PR strategy: 4 W3 PRs (#8, #9, #10, plus one more) still open. Once they land, P2.W1's 7 commits can rebase onto master cleanly and split into per-D-task PRs.
- Live-LLM eval: current eval uses MockRunner. PLAN.md §0 row 2 calls for a weekly cron with real-LLM holdout — not on W1's critical path.

## What you can do now

With `ARCHVIBER_ORCHESTRATOR` default ON:
- Ask "add an Auth block between API and Data" → real canvas action plan
- Ask "what does X do?" → grounded plain-text explanation
- Ask "rename Foo to Bar" → PR branch with renamed code (sandbox-verified tsc-clean)
- Ask "build wave 2" → BuildPlan to confirm
- Ask "why is this coupled?" → 5-perspective analysis path (deep_analyze, was already real)
- Low-confidence / off-topic prompts → clarify response listing 5 paths

W1 done. Next: W2 starts with `phase2/w2` branch — language-agnostic ingest with Py/Go/Java/Rust reference adapters + recipe doc.
