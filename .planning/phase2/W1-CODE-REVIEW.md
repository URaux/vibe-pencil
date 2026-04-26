# Phase 2 / W1 — Code Review

**Reviewer**: Opus 4.7 (inline; superpowers:code-reviewer subagent stalled with stream watchdog timeout)
**Date**: 2026-04-26
**Branch**: `phase2/w1` (HEAD `b24b947`)
**Scope**: 8 commits — `8a2dec8` (plan), `6895cc3` (Rust), `9d64cb7` D1+D2, `0e0b8b9` D3+D4, `adff847` D5+D6, `d30c407` D7+D8, `a827c2a` D9, `b24b947` D10

## Summary verdict: **SHIP WITH FIXUPS**

No blockers. 7 SEV2 items worth addressing as a fixup PR before W1 PRs land on master, OR queueable as a W2.D1.5 hygiene chunk. Most issues are in the modify pipeline (built from scratch in D5-D6) — expected territory for fresh code.

The W1 work delivers what PLAN.md §3 promised: 4 handler stubs are real, default-on flag flipped, eval CI blocking. Plan adherence is high (one beneficial deviation: D6.5 slack day folded into D6 because tsc-resolution fix landed inline).

## Plan adherence (per D-task)

| D-task | PLAN spec | Delivered | Notes |
|---|---|---|---|
| D1 | design_edit handler emits CanvasAction array | ✅ as specified | tryRepairJson + validateActions both exported for testability |
| D2 | design_edit integration test via runOrchestratorTurn | ✅ | 2 tests (happy + error) — spec said 1; bonus is fine |
| D3 | explain handler with grounded prose, anchor refs, no tool verbs | ✅ as specified | shape validation done in handler itself, mirrored in eval (D4) |
| D4 | eval shape assertions for explain | ✅ | added negative fixture `ex-shape-fail` to prove rule fires |
| D5 | ts-morph plan layer + 5 conflict kinds | ✅ + `not-found` 5th kind added (spec said 4) | reasonable extension |
| D6 | sandbox + pr + handler wiring | ✅ as specified | tsc auto-resolution added (sandbox.ts:10-17) — was a fix during execution, not in spec but necessary for tests with no node_modules in tmp project |
| D7 | build handler plan-only with BuildPlan | ✅ as specified | scope=none routes to error per spec |
| D8 | build integration test | ✅ as specified, automated (no human eyeball) — spec accepted both |
| D9 | flip flag default-on + eval thresholds | ✅ as specified — `=== '1'` → `!== '0'`; thresholds blocking |
| D10 | smoke + W1-COMPLETION.md | ✅ — 7-test smoke + report |

## Findings

### SEV2

#### 1. `pr.ts:40` — branch name uses unsanitized LLM-derived `symbol`/`newName`
**File**: `src/lib/modify/pr.ts:40`
**Issue**: `const branch = \`modify/rename-${opts.symbol}-to-${opts.newName}-${shortId}\`` — `symbol` and `newName` come from agent JSON output. `rename.ts` only validates JS reserved words, not identifier shape. A pathological LLM output like `{"symbol":"../../../etc","newName":"passwd"}` would produce a branch path like `modify/rename-../../../etc-to-passwd-abc123` — git refuses paths with `..` so this is more correctness than security, but it surfaces a bad UX with a confusing error.
**Fix**: in `handlers/modify.ts` after parsing extraction, validate `/^[A-Za-z_$][A-Za-z0-9_$]*$/` on both fields; reject with status 'error' if not a valid JS identifier.

#### 2. `sandbox.ts:79` — `fs.cp(projectRoot, tmpDir, {recursive:true})` copies `node_modules` and `.git`
**File**: `src/lib/modify/sandbox.ts:79`
**Issue**: Recursive copy includes everything. On a real project, `node_modules` alone can be 500MB+. Each rename invocation copies it. The 30s timeout on tsc may even fire because the copy itself burns wall time on a large project.
**Fix**: pass a `filter` callback to `fs.cp` that excludes `node_modules`, `.git`, `.next`, `dist`, `out`. Then `tscResult` resolution still works because `resolveTscBin` checks `process.cwd()/node_modules/.bin/tsc` as fallback.

#### 3. `rename.ts:113-131` — collision detection is over-broad (false positives)
**File**: `src/lib/modify/rename.ts:113-131`
**Issue**: Collision check returns true if `newName` exists anywhere in any source file as a top-level decl, regardless of scope. Two unrelated modules can each declare a `Foo` class without colliding, but this rule blocks the rename.
**Fix**: scope check to the same source file as the declaration, OR use ts-morph's `getSymbol().getDeclarations()` to find true name conflicts in the symbol's actual scope.

#### 4. `rename.ts:84-100` — multi-declaration symbols rename only one definition
**File**: `src/lib/modify/rename.ts:84-100`
**Issue**: When a symbol has multiple declarations (function overloads, namespace merging, both type and value), `declarationNode` picks just the first match. `findReferencesAsNodes()` on that one node may miss references that point to the other declarations.
**Fix**: iterate over all declaration-shaped matches; collect refs from each; dedupe by start/end position. OR document the limitation: "rename only handles single-declaration symbols; for overloads, rename per-overload first."

#### 5. `rename.ts:100` — silent fallback to `declarations[0]` when no declaration kind matched
**File**: `src/lib/modify/rename.ts:100`
**Issue**: `?? declarations[0]` masks the case where the symbol matched only as a property access or an import binding (not a true declaration). Renaming starts from a reference, not a definition, producing partial fileEdits that miss the actual definition.
**Fix**: if no declaration kind matched, return a `not-found` conflict with message "symbol matched only as a reference, not a declaration site".

#### 6. `handlers/explain.ts` forbidden-verb regex over-aggressive
**File**: `src/lib/orchestrator/handlers/explain.ts` (regex `/\b(rename|build|spawn|run|refactor|modify)\s+\w/i`)
**Issue**: Legitimate prose like "the build pipeline runs after each commit" matches because "build pipeline" has whitespace + word after "build". Same with "rename happens at..." → "rename happens" matches. The intent was to flag *commands* like "rename FooService to BarService", not prose mentions.
**Fix**: tighten to imperative-verb pattern, e.g. `/^\s*(rename|build|spawn|run|refactor|modify)\s+\w/im` (line-leading verb only) — or move the validation to a small LLM judge that distinguishes prose from imperative.

#### 7. Default-on flip may break other route.ts integration tests beyond `chat-ir-integration`
**File**: `src/app/api/chat/route.ts:732`
**Issue**: I patched `tests/api/chat-ir-integration.test.ts` to set `ARCHVIBER_ORCHESTRATOR=0` in beforeEach. The `npx vitest run -c vitest.ci.config.ts` run still shows other failures (classify, eval, cluster-verify-real) — those are pre-existing test pollution per W1-COMPLETION.md, but they overshadow whether OTHER `tests/api/chat/*.test.ts` files (chat-route.test.ts, chat-ir-watch.test.ts if any) might also rely on the old default. **Need to audit**: grep for tests that exercise `POST /api/chat` and don't already mock the orchestrator path.
**Fix**: a follow-up scan of `tests/api/chat/*.test.ts` for tests that exercise the legacy path without orchestrator mocking; add `ARCHVIBER_ORCHESTRATOR=0` stub to those.

### NIT

#### N1. `handlers/build.ts:135` `summaryFor` 'none' branch is dead code
The handler returns `error` before scope='none' reaches summaryFor (handlers/build.ts:191-193). The `if (plan.scope === 'none')` branch in summaryFor (lines 134-136) can be deleted.

#### N2. `orchestrator-turn.ts` `not_implemented` branch is unreachable post-W1
After W1 every handler returns either `ok` or `error`. The `if (result.status === 'not_implemented') return null` branch in `runOrchestratorTurn` (line 102-104) is dead. Keep it as defensive code OR delete. Either is fine.

#### N3. `sandbox.ts:38` `shell: true` for tsc/test invocations
On Windows, `shell: true` is needed for `.cmd` shims; on Linux/Mac it's not. If a future caller passes `testCmd` containing user-controlled string, shell parsing applies. Internal-only callers today, but worth flagging if `runSandbox` ever becomes externally callable.

#### N4. `apply.ts` `applyRenamePlanMapped` doesn't `mkdir -p` the destination dir
If a future caller maps a path to a directory that doesn't exist, `fs.writeFile` fails. Sandbox's recursive copy creates dirs first, so this works today. Defensive: `await fs.mkdir(path.dirname(destPath), {recursive: true})` before write.

## Strengths

- **Type strictness**: every new `src/lib/**` file uses explicit interfaces, zero `any` (verified by grep). Returns are precisely typed (e.g. `Promise<RenamePlan>`).
- **`pr.ts` uses `shell: false` + array-form spawn** — correct anti-injection posture for git commands receiving LLM-derived input.
- **Comprehensive conflict enum** in rename.ts: collision, external, reserved, not-found. Each conflict has a human-readable message.
- **Timeouts everywhere**: agent calls (12-15s), child_process (30s), git rev-parse (no timeout but should complete instantly).
- **Tmp dir cleanup** via `try/finally` — sandbox.ts:119-124 even tolerates cleanup failures with empty catch (best-effort, correct).
- **`MockRunner` extraction** to `tests/_helpers/` is a real DRY win — the duplicated class in 2 files became 1.
- **No git-hook bypass**: `pr.ts` runs plain `git commit -m` with no `--no-verify`. Honors project policy.
- **Plan-only build handler**: confirmed no `fetch()` or HTTP call in `handlers/build.ts`. Just returns the plan structure.
- **Test pyramid**: each handler has unit tests (mock the runner), then a chat-route integration test (mock the orchestrator imports). Good layering.
- **Smoke test** (D10) parametric loop over all 5 intents — readable and adds-a-test-per-intent comes for free.
- **Telemetry ring buffer** is reusable — `getRecentTurns()` in tests asserts the ring has 5 entries with correct `dispatchStatus`. Real instrumentation, not a stub.

## Followups (non-blocking, queue for W2 prep or ship-ready PR)

- **Pre-existing test pollution** (classify, eval, cluster-verify-real) is being addressed in parallel by a separate Sonnet agent. Not W1's debt.
- **codex-rescue subagent wrapper bug** — not investigated. Stalled twice during W1, finished inline.
- **Persistent telemetry to `.archviber/cache/orchestrator-log.jsonl`** (PLAN.md §0 row 5). Ring buffer is in-memory only; restart loses everything. Easy add but not on W2 critical path.
- **Live-LLM eval cron** (PLAN.md §0 row 2) — current eval is MockRunner-only; weekly real-LLM holdout still TODO.
- **Prompt-injection risk** in design_edit handler: user prompt goes verbatim into `JSON.stringify({task, userPrompt, irSummary, ...})`. Standard for LLM apps; same risk as classify.ts. Not a W1-specific issue.

## Recommendation

Open a fixup commit on `phase2/w1` titled "phase2/w1/d10.5: code-review fixups" addressing SEV2 #1, #2, #3, #6 minimum (highest impact for low effort). #4 and #5 can wait for an explicit "modify v2" pass. #7 needs a quick audit pass and an env-stub addition where tests slip through.

Then PR-push the W1 chunks. NIT items can ride along with whatever next commit touches those files.
