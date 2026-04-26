# ArchViber Phase 2 — Execution Plan (DRAFT)

**Author**: Opus 4.7 planning agent
**Date**: 2026-04-26
**Scope owner**: solo dev (user = rainy1024)
**Status**: LOCKED 2026-04-26 — user approved walkthrough; execution begins on `phase2/w1` branch
**Predecessor**: `.planning/phase1/PLAN.md` (W1+W2+W3 complete)

## Decisions locked (2026-04-26)

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | W2 path: polyglot ingest vs CRDT | **A: language-agnostic ingest (Py/Go/Java/Rust reference + recipe)** | User: "a 吧，b 暂时没条件做" + "尽量适配全语言" + "rust 也加上吧". Pluggable adapter pattern — 4 reference impls cover scripting/JVM/native/compiled. CRDT moved to P3. |
| 2 | Default-on threshold source | CI mock (fast/free) + weekly cron real-LLM holdout | Best of both — CI stays cheap, real accuracy still tracked |
| 3 | Build handler scope | Plan-only (user confirms before build runs) | Safer for default-on; direct execution waits for P3 policy gates |
| 4 | Drift on PR | Notify by default, opt-in to block via `.archviber/policy.yaml` | Avoids merge-blocking false positives early |
| 5 | Telemetry sink | Persist to `.archviber/cache/orchestrator-log.jsonl`; keep ring buffer for live dashboard | Need queryable history once flag default-on |
| 6 | Branch naming | Continue `phase2/w<N>/d<M>` | Match P1 convention |
| 7 | PR cadence | Chunk per 2-3 D-days, not per-day | Match W3's retroactive-4-PR pattern |

---

## 0. Thesis

Phase 1 made ArchViber **understand and analyze** code (IR + ingest + deep_analyze + orchestrator routing). Phase 2 makes it **act** (close the 4 stub handlers so orchestrator default-on works) and **scale** (extend beyond TS/JS or unlock collaboration — pick one). Phase 1 left these debts on the floor:

- 4/5 orchestrator handlers (`design_edit`, `build`, `modify`, `explain`) return `not_implemented` stubs. `ARCHVIBER_ORCHESTRATOR=1` flag stays default OFF until they're real.
- **W2 modify pipeline NEVER actually shipped** despite being in the P1 plan. `ts-morph` is installed but no `src/lib/modify/*` exists, no rename code, no sandbox runner, no PR generator. P2.W1 has to BUILD this from scratch, not wrap it. Scope inflation: ~4 days of W2's original budget.
- W2 build pipeline is partial: `build-state.ts` is just an in-memory progress tracker, `build-summarizer.ts` parses output via regex, and `/api/agent/spawn` runs builds via prompt — there's NO dedicated `/api/agent/build/route.ts`. The build handler can either spawn via existing route or build a thin orchestration layer first.
- Phase 1 explicitly deferred: multi-language ingest, team memory/CRDT, drift detection, policy enforcement, Modify v0.2 verbs.

## 1. Goals (proposed — needs user lock)

| Week | Deliverable | Exit test |
|---|---|---|
| 1 | All 4 stub handlers implemented; `ARCHVIBER_ORCHESTRATOR=1` flipped default ON | Eval harness routing accuracy ≥ 90%; clarify rate < 15%; each intent answers a representative prompt end-to-end without falling through to legacy chat |
| 2 | **Pick one — needs user choice (§4)**: Multi-language ingest (Python/Go) **OR** Team memory/CRDT v0.1 | Polyglot path: import a Python+Go fixture repo, ≥ 70% block→file anchor coverage on each language. CRDT path: 2 browsers edit the same project simultaneously, conflict-free merge on save |
| 3 | Drift detection v0.1 + Modify v0.2 (extract verb only — move/split/merge defer to P2.5) | On a manual diff between IR and current AST, drift report names ≥ 1 missing/added file accurately; extract a method via chat, PR is tsc-green |

**Non-goals confirmed** (Phase 2 excluded — push to P3):
- Bidirectional diagram↔code live sync
- Initiative/Governance agents
- Modify move/split/merge verbs
- Persistent-session fix (still parked)
- Multi-language ingest beyond what's chosen in W2 (Java waits)
- Live collaboration UX polish (cursors, presence) — only conflict-free save in W2-CRDT

---

## 2. Dependency DAG

```
P1 (complete)
   │
   ├──► P2.W1.D1-D2  design_edit handler ────────┐
   │                       │                      │
   ├──► P2.W1.D3-D4  explain handler              │
   │                                              │
   ├──► P2.W1.D5-D6  modify handler (wraps W2)    ├──► P2.W1.D9-D10 default-on flip + smoke
   │                       │                      │
   └──► P2.W1.D7-D8  build handler (wraps W2)  ───┘
                       │
                       ▼
        ┌──────────────┴──────────────┐
        │                              │
        ▼                              ▼
   P2.W2 [Option A]            P2.W2 [Option B]
   Multi-language ingest       Team CRDT
   (Python + Go)               (Yjs persistence)
        │                              │
        └──────────────┬───────────────┘
                       ▼
                P2.W3.D1-D5  Drift detection v0.1
                P2.W3.D6-D10 Modify v0.2 (extract verb)
```

W2's two options are mutually exclusive for Phase 2; the unselected one slips to P3. Both are independent of W1 — could in theory run in parallel with W1, but W3 work assumes W1 default-on flip already happened.

---

## 3. Week 1 — Close the 4 stub handlers (mandatory)

Goal: stop returning `not_implemented` for every intent except `deep_analyze`. Each handler wraps existing W2 / pre-W2 infrastructure rather than building from scratch.

### W1.D1 — `design_edit` handler: canvas-action emission (3h)
- **Input**: `src/lib/canvas-action-types.ts`, `src/lib/canvas-utils.ts`, current `src/lib/orchestrator/handlers/design_edit.ts` (stub)
- **Output**: real handler that asks the LLM (via `agentRunner.spawnAgent` codex backend) to emit a structured `CanvasAction` JSON given user prompt + IR summary
- **Verify**: 5 unit tests with MockRunner — add block / remove block / connect blocks / move block / rename block → handler returns `{ status: 'ok', payload: { actions: CanvasAction[] } }`
- **Hours**: 3

### W1.D2 — `design_edit` integration test (2h)
- **Input**: chat-route integration shape from `tests/api/chat/orchestrator-turn.test.ts`
- **Output**: `tests/api/chat/design-edit-integration.test.ts` — feature flag on + IR loaded + design_edit prompt → response.json contains `actions` array consumable by the canvas
- **Verify**: existing `npx vitest run tests/api/chat/` plus new test all green
- **Hours**: 2

### W1.D3 — `explain` handler: IR-grounded plain text (3h)
- **Input**: `src/lib/orchestrator/summarize.ts`, `src/lib/deep-analyze/prompt-builder.ts` for `code_anchors` reuse
- **Output**: handler issues a single LLM call with system prompt "explain in plain text, no tool verbs, ground in provided IR + anchors" — returns `{ status: 'ok', payload: { content: string, anchors: string[] } }`
- **Verify**: 4 unit tests — "what does X do", "summarize the architecture", "why does X exist", malformed-input fallback
- **Hours**: 3

### W1.D4 — `explain` shape assertion + eval fixture refresh (2h)
- **Input**: `tests/eval/orchestrator/fixtures/intents.jsonl`
- **Output**: extend eval harness to assert explain responses contain ≥ 1 anchor reference and 0 tool-verb keywords (`rename|build|spawn|run`); update fixtures with explain-specific assertions
- **Verify**: `npx vitest run -c vitest.eval.config.ts` still green; explain shape rule fires when assertion is violated (negative test)
- **Hours**: 2

### W1.D5 — `modify` rename pipeline: ts-morph plan layer (5h)
- **Input**: ts-morph (already installed). NEW directory `src/lib/modify/`.
- **Output**: `src/lib/modify/rename.ts` — `planRename(projectRoot, symbol, newName)` returns `RenamePlan { fileEdits, conflicts, safetyChecks }` without writing files. Pure plan-only.
- **Verify**: 5 unit tests on a tmp ts-morph project — happy rename / collision detected / symbol not found / external module symbol blocked / dry-run mode

### W1.D6 — `modify` sandbox runner + PR generator (5h)
- **Input**: rename plan from D5
- **Output**:
  - `src/lib/modify/sandbox.ts` — applies plan to a tmp git worktree, runs `tsc --noEmit` + `vitest run --reporter=basic` (configurable), returns `SandboxResult { tscOk, testsOk, errors }`
  - `src/lib/modify/pr.ts` — creates a branch + commit on the project repo (no GitHub API call — local git only); returns `{ branch, sha }`
  - Wire all 3 into `src/lib/orchestrator/handlers/modify.ts`: extracts `{symbol, newName}` from prompt via LLM call, runs plan → sandbox → pr, returns `{ status: 'ok', payload: { renamePlan, sandboxResult, branch } }`
- **Verify**: 4 integration tests on a tmp git project — full rename loop, sandbox catches a tsc break, sandbox catches test break, PR branch contains the right files

### W1.D6.5 — `modify` golden-repo smoke (2h, slack day)
- **Input**: a small fixture project committed under `tests/fixtures/modify-golden/`
- **Output**: e2e test renaming a known symbol; asserts branch + tsc-green diff
- **Verify**: green locally; uses `--no-gpg-sign` only for tests, NOT prod code

### W1.D7 — `build` handler: thin dispatch via existing spawn route (4h)
- **Input**: `src/app/api/agent/spawn/route.ts` (W2 existing), `src/lib/build-state.ts`, `src/lib/build-summarizer.ts`. There is NO dedicated `/api/agent/build/route.ts` — builds today happen via spawn + agent prompt. Plan-only handler avoids needing to add an orchestration route.
- **Output**: handler classifies build target (wave / single block / whole project) from prompt + IR, returns `{ status: 'ok', payload: { buildPlan, dispatchUrl: '/api/agent/build', dispatchBody: ... } }`. Does NOT execute the build directly — emits a plan the UI/user can confirm and trigger.
- **Verify**: 4 unit tests — "build this" / "implement Wave 1" / "build the auth block" / no-target fallback
- **Hours**: 3

### W1.D8 — `build` integration smoke (2h)
- **Input**: dev server + a small fixture project
- **Output**: manually verify `build` intent produces a sensible plan; capture screenshot for handoff
- **Verify**: human eyeball check; no hard-fail criterion
- **Hours**: 2

### W1.D9 — Default-on flip: `ARCHVIBER_ORCHESTRATOR=1` becomes default (2h)
- **Input**: `src/app/api/chat/route.ts:732` guard, eval CI advisory mode
- **Output**: change guard from `=== '1'` to `!== '0'` (default on, opt-out via `ARCHVIBER_ORCHESTRATOR=0`); flip eval CI from advisory to **blocking** with thresholds: classifier accuracy ≥ 90%, clarify rate < 15%, dispatch error rate < 5% on the canned set
- **Verify**: eval CI run is green at thresholds; manually toggle env var off and confirm legacy path still reachable
- **Hours**: 2

### W1.D10 — End-to-end smoke + handoff (3h)
- **Input**: all 4 handlers + flag flipped
- **Output**: hit each intent through the dev server with a fresh project and IR loaded; capture telemetry ring buffer and verify all 5 intents land correct handler with confidence > threshold; write `.planning/phase2/W1-COMPLETION.md`
- **Verify**: 5/5 intents work end-to-end; clarify rate on a 10-prompt mixed batch ≤ 1
- **Hours**: 3

**W1 budget**: 33h (was 27h before W2-modify reality check). Real days: 8-9 working days. Slack: 1 day.

---

## 4. Week 2 — Language-agnostic ingest (Py/Go/Java/Rust in W2; recipe for the rest)

LOCKED 2026-04-26 (v3: user asked "rust 也加上吧" 2026-04-26 09:20 — Rust promoted from P3 to W2 reference set alongside Java).

**Rationale**: ArchViber demos better with polyglot fixtures. Tree-sitter has grammars for 100+ languages; the bottleneck is ArchViber's adapter layer, not the parser. W2 ships Python + Go + Java + Rust as the four reference implementations (covering the major backend stacks: scripting, statically-typed/JVM, compiled-native) plus a `LanguageAdapter` interface so adding any new language is ~1 day of mechanical AST-query work.

### Design pattern

```ts
// src/lib/ingest/languages/types.ts
export interface LanguageAdapter {
  id: string                              // 'python' | 'go' | 'java' | ...
  fileExtensions: readonly string[]       // ['.py'], ['.go'], ['.java', '.kt'], ...
  treeSitterGrammar: WasmGrammar | NativeGrammar
  extractFacts(tree: Tree, sourcePath: string): Fact[]   // returns the same Fact shape ts/js already emits
  inferTechStack(facts: Fact[]): string                  // 'Python/FastAPI', 'Go/Gin', ...
}
```

Adding a new language = implement one adapter file + register in `languages/registry.ts`. Cluster naming + IR persistence are language-agnostic and reused.

### Day breakdown

- W2.D1 — tree-sitter Windows pre-flight (1h) + define `LanguageAdapter` interface + extract existing TS adapter behind it (refactor; no behavior change) (4h)
- W2.D2 — Python adapter: tree-sitter-python wired, class/function/import/decorator extraction (5h)
- W2.D3 — Go adapter: tree-sitter-go wired, package/struct/interface/method extraction (5h)
- W2.D4 — Cross-language cluster naming (LLM prompt: "name this cluster of mixed Python + Go files") (4h)
- W2.D5 — Polyglot fixture: vendored `fastapi-with-go-worker` repo under `tests/fixtures/polyglot/` (3h)
- W2.D6 — Anchor coverage validator on polyglot fixture, target ≥ 70% per language (3h)
- W2.D7 — Ingest pipeline: combined pass dispatches by file extension (TS+Py+Go in one ingest) (4h)
- W2.D8 — Java adapter using the recipe (most-demanded "common" language after Py/Go); ~1 day mechanical AST-query work (5h)
- W2.D9 — Rust adapter using the recipe (covers compiled-native ecosystem; cargo metadata = strong tech-stack signal) (5h)
- W2.D10 — `docs/HOW-TO-ADD-A-LANGUAGE.md` recipe + eval-harness polyglot fixtures + handoff (4h)

Budget: 45h. Real days: ~10 working days. Risk: tree-sitter native bindings on Windows can be flaky — D1 pre-flight de-risks. If Java OR Rust overruns, drop the slipping one to P3 (3 reference adapters + recipe still honors "模块化插槽" intent — recipe is the load-bearing deliverable, not the adapter count).

**P3 backlog languages**: C/C++, C#, Ruby, PHP, Swift, Kotlin, Scala. Recipe lets future work pick these up without redesign — explicit goal: "适配全语言" handled via the plug-in slot, not by ArchViber shipping every adapter.

---

## 5. Week 3 — Drift detection + Modify v0.2 (extract)

### W3.D1 — Drift detector: IR vs current AST diff (4h)
- **Output**: `src/lib/drift/detect.ts` — load `.archviber/ir.yaml` + run ingest fresh + diff blocks/edges → returns `DriftReport { addedBlocks, removedBlocks, changedAnchors, addedEdges, removedEdges }`
- **Verify**: 4 unit tests on synthetic diffs

### W3.D2 — Drift report renderer: human-readable markdown (3h)
- **Output**: `src/lib/drift/render.ts` — DriftReport → markdown for chat surface
- **Verify**: snapshot test

### W3.D3 — `/api/drift/route.ts` GET endpoint (2h)
- **Output**: API route + UI button to trigger drift check
- **Verify**: integration test

### W3.D4 — Drift on PR check (3h)
- **Output**: GH Actions workflow `drift.yml` runs on PR — fetches base IR, compares against PR head, posts comment if drift exists
- **Verify**: on a test PR that adds a file, drift comment appears

### W3.D5 — Drift threshold + opt-in to fail PR (2h)
- **Output**: `.archviber/policy.yaml` (new) with `drift.failOnRemoved: true` etc.; drift workflow respects policy
- **Verify**: workflow fails when policy violated, passes when not

### W3.D6 — Modify v0.2: `extract` verb (5h)
- **Output**: `src/lib/orchestrator/handlers/modify.ts` extended to handle `extract` (extract a code block to a new function/method) via ts-morph
- **Verify**: 4 unit tests — happy extract / extract from class method / extract with closure capture / extract failure (e.g. early return)

### W3.D7 — Extract verb integration test (3h)
- **Output**: end-to-end test on golden repo
- **Verify**: PR branch has tsc-green extracted method

### W3.D8 — Update eval harness for new verb (2h)
- **Output**: add 3 fixtures testing extract intent classification
- **Verify**: classifier accuracy unchanged

### W3.D9 — Phase 2 end-to-end smoke (3h)
- **Output**: run through full Phase 2 surface: design_edit → build → modify (rename + extract) → deep_analyze → explain + drift check on a fresh project
- **Verify**: all paths work without falling through to legacy chat

### W3.D10 — Phase 2 completion handoff + Phase 3 backlog (3h)
- **Output**: `.planning/phase2/PHASE2-COMPLETION.md` + `.planning/phase3/BACKLOG.md` (move/split/merge verbs, the OTHER W2 option, persistent-session, policy beyond drift, Initiative agents)
- **Verify**: docs reviewed

**W3 budget**: 30h.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| W1 modify handler depends on W2 modify pipeline being usable — if W2 modify is incomplete, W1.D5-D6 blow up | Day 0 audit: read `src/lib/modify/*` (or wherever W2 put rename code) before P2 starts; if missing, scope-cut to design_edit + explain + build only and defer modify to P3 |
| Default-on flip exposes the orchestrator to real users — clarify rate could spike on unfamiliar prompt patterns | Telemetry ring buffer already wired (W3.D5-D6); add a kill-switch cron that auto-flips to opt-in if clarify rate > 25% over a 24h window |
| W2 Option A (polyglot ingest): tree-sitter native bindings flaky on Windows | Pre-flight test on W2A.D1; if Windows blocks, switch to WSL or run polyglot ingest in CI only |
| W2 Option B (CRDT): scope creep into presence/UI polish | Lock W2B scope to "two browsers can save without losing changes" — no cursors, no avatars, no live preview in P2 |
| Drift detection produces too many false positives on every PR | W3.D5 policy file lets users tune thresholds before drift becomes blocking |
| 27+34+30 = 91h total — single dev, may slip | Build slack (2 days W1, W2 has its own slack via 7h headroom, W3 slack via skipping handoff doc if late) |

---

## 7. Open questions

All P2 plan-time questions resolved (see §0 Decisions). Remaining unknowns are execution-time risks tracked in §6.

---

## 8. Working cadence (proposed)

- Per-week branch: `phase2/w1`, `phase2/w2`, `phase2/w3`
- Daily commit: `phase2/w<N>/d<M>: <subject>` matching P1 convention
- End-of-day OV commit via `ov-bridge.py commit`
- Mid-week Telegram checkpoint (W1.D5, W2.D5, W3.D5)
- PR strategy: one PR per logical chunk (1-3 D-days), opened as soon as the chunk is testable — no retroactive splits

---

## 9. What this plan deliberately does NOT cover (Phase 3+)

- Modify v0.3 verbs: move, split, merge
- Whichever W2 option is NOT chosen
- Persistent-session fix
- Initiative / Governance agents
- Bidirectional diagram↔code live sync
- Policy enforcement beyond drift (e.g. layering rules, dependency direction)
- Build sandbox redesign (selective retry, sub-process isolation)
- Architecture-PR review bot (separate from drift detection)
- Live collaboration UX (cursors, presence, avatars)
- Multi-language ingest beyond what's chosen in W2 (Java, Rust, etc.)

These all stay logged in `.planning/phase3/BACKLOG.md` (created at end of P2.W3.D10).
