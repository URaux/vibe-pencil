# W2 Split Proposal — PRO (Advocate Position)

**Author**: Claude Sonnet 4.6 (proposer agent, pro-split)
**Date**: 2026-04-14
**Stance**: W2 MUST be split into W2a (ingest/code_anchors) + W2b (modify/rename). This document is the formal case.

---

## Verdict: W2 Must Be Split

The current PLAN.md W2 is a single 10-day sprint that attempts to deliver two fundamentally different systems (an AST ingest pipeline and an agentic code-modification loop) with a single checkpoint at the end. Codex flagged this as "严重过载" (critically overloaded). The split is not a scheduling preference — it is a correctness constraint. A single checkpoint at W2.D10 collapses three independent failure domains into one, making recovery impossible without destroying the entire week's work.

---

## W2a — Day-Level Task Table (D6–D10)

W2a goal: produce an ingest pipeline that emits IR with populated `code_anchors`. All Modify agent work is **explicitly excluded** from W2a scope.

| Day | Deliverable | Verify |
|-----|-------------|--------|
| **D6** | Windows worktree/junction smoke test (see §Windows below) + `ts-morph` + `tree-sitter` + `graphology` dependencies installed; `src/lib/ingest/ast-ts.ts` scaffold compiles | `npx tsc --noEmit` green; run scaffold on `archviber/src/` → emits module list, no crash |
| **D7** | `src/lib/ingest/facts.ts` — AST fact extraction: FactGraph (nodes=modules+symbols, edges=imports/calls); `.archviber/cache/facts.json` with mtime-keyed cache | Re-run is idempotent; cache hit < 200ms on 500-file repo; `archviber/src/` emits ≥ 150 modules |
| **D8** | `src/lib/ingest/cluster.ts` — graphology Louvain with seeded RNG + tiny-cluster merge (< 2 nodes → parent); cluster IDs derived from member-set hash, not Louvain order | FastAPI golden repo yields 3–8 clusters; re-run same input → identical cluster IDs (determinism test) |
| **D9** | `src/lib/ingest/code-anchors.ts` — maps each IR block to `code_anchors` per IR-SCHEMA §3.3 (files, primary_entry, symbols, line_ranges, confidence) | Anchor coverage metric ≥ 80% on FastAPI golden repo (block has ≥ 1 file); `symbols[].file` always in `files` (Zod validates) |
| **D10** | Optional LLM naming pass (`src/lib/ingest/name.ts`) + full ingest integration: `src/lib/ingest/pipeline.ts` replaces `project-scanner.ts` and folds `import-enhance` logic; API route `POST /api/project/ingest` | Import ArchViber itself → IR persisted with `code_anchors`; block names sensible (not file-name style); LLM timeout → graceful default naming fallback |

**W2a checkpoint** (must pass before D11 begins): see §Checkpoint Standards below.

---

## W2b — Day-Level Task Table (D11–D15)

W2b goal: Modify agent v0.1 (rename only), consuming IR produced by W2a. Requires W2a checkpoint to be green.

| Day | Deliverable | Verify |
|-----|-------------|--------|
| **D11** | `src/lib/modify/intent.ts` (ModifyIntent DSL, all 5 verb types as per MODIFY-AGENT-DESIGN.md §2) + `src/lib/modify/plan.ts` (planIntent: user message → Intent or ClarifyingQ via oneShot LLM) | Unit: 5 canned rename prompts → correct Intent shape; 1 ambiguous prompt → ClarifyingQ |
| **D12** | `src/lib/modify/agent.ts` skeleton (full plan→codemod→sandbox→pr orchestration loop, stubbed codemod/sandbox for now) + `resolveSymbolRef` against IR code_anchors | Unit: resolveSymbolRef with ambiguous name → null; blockId resolution → filePath populated |
| **D13** | `src/lib/modify/codemods/rename.ts` — ts-morph rename (file, class, function, variable per MODIFY-AGENT-DESIGN.md §4) | Integration: rename `schema-engine.ts → canvas-schema.ts` on archviber fixture → all imports updated; `tsc --noEmit` green on result |
| **D14** | `src/lib/modify/sandbox.ts` — git worktree creation + `tsc --noEmit && vitest run` + 120s wall timeout + fallback to `git stash` path if worktree fails | Passing rename → green; deliberately broken rename → `tscOk=false` with failing output captured |
| **D15** | `src/lib/modify/pr.ts` + `src/app/api/agent/modify/route.ts` (SSE stream: plan→diff→sandbox→pr events) + chat panel wiring (`useBuildActions.runModify`) | E2E: from UI, right-click block → "Rename…" → PR link returned with tsc-green diff within 120s |

---

## Windows Worktree/Junction Verification — Moved to D6

**Why it was at D8 (wrong)**: PLAN.md originally placed worktree testing inside the sandbox task (W2.D8), meaning a Windows-specific infrastructure failure could not be detected until after 7 days of ingest work and 2 days of Modify agent scaffolding. On this machine (Windows 11, junction-backed paths documented in `reference_cache_junctions.md`), worktree creation inside a junction-resident repo is a known failure mode that requires a code path switch (worktree → `git stash` fallback).

**What D6 does instead**:

1. `git worktree add --detach .archviber/sandbox/smoke-test` — run from `E:/claude-workspace/archviber`
2. If exit code 0: worktree path is viable. Record result in `.archviber/cache/platform-caps.json` as `{ worktree: true }`.
3. If exit code non-zero (junction blocking): record `{ worktree: false }`. The sandbox implementation will unconditionally use the `git stash` fallback path. No further retry. This is a **one-time decision gate** — not a warning.
4. Verify `git worktree list` shows the sandbox entry; then `git worktree remove --force` it.
5. Total budget: 30 minutes. If `platform-caps.json` does not exist, ingest pipeline aborts with a clear error before D14 work begins.

**Why D6 (W2a day 1) and not earlier**: This check is meaningless without the `.archviber/` directory structure, which is created in W1.D4. W1 must complete first. D6 is the earliest valid point.

**Fallback impact**: if `worktree: false`, sandbox.ts must be written using the stash path from day 1 of D14. The stash path requires `git status --porcelain` to be clean before applying the diff. This is a harder constraint to enforce but does not block any W2a work — the platform-caps.json is only consumed by sandbox.ts.

---

## W2a Checkpoint Standards

**Entry condition for W2b (D11)**: ALL of the following must be true at end of D10.

| Gate | Criterion | How to verify |
|------|-----------|---------------|
| **Ingest green** | `POST /api/project/ingest` on FastAPI golden repo returns 200 with IR | curl test + inspect `.archviber/ir.yaml` |
| **Anchor coverage** | ≥ 80% of IR blocks have `code_anchors.files` non-empty | `pnpm test:eval` anchor-coverage metric |
| **Determinism** | Re-ingest same repo at same commit → byte-identical `ir.yaml` (excluding `audit_log.at` timestamps) | `diff <(ingest && cat .archviber/ir.yaml \| grep -v at:) <(ingest again \| ...)` |
| **Zod valid** | `validateIr(loadedIr)` passes with no throw | existing validator from W1.D2 |
| **Self-ingest** | ArchViber imported on itself → no block named after a state variable (`nodes`, `edges`), no empty API LAYER | manual inspect + 1 assertion in test |
| **Platform caps recorded** | `.archviber/cache/platform-caps.json` exists | `ls` check |

**If any gate fails**: W2b start date slides by the number of days needed to fix. This is not optional — starting W2b with broken code_anchors means `resolveSymbolRef` will return null for all queries, making the entire Modify agent untestable.

---

## Slippage Emergency Plan

### Scenario A: W2a completes on time (D10), W2b slips

W2b tasks extend into W3 calendar week. Impact:
- W3.D1–D2 (deep_analyze perspectives + runner) deferred by the number of W2b slip days.
- W3.D7–D9 (eval harness + CI) are the most compressible: harness skeleton and metrics can be done in 2 days if the golden repo is already vendored (vendoring should be done during W2a D9–D10 as a parallel task).
- W3.D10 (smoke + docs) cannot compress; it is a hard gate.
- If W2b slips 3+ days, W3 ships without the eval CI job and with W3.D10 cleanup deferred to Phase 2.

### Scenario B: W2a slips (D10 checkpoint fails)

- W2b does not start. Calendar date is fixed; timeline slides.
- If W2a slip ≤ 2 days: absorb by compressing W3.D10 (docs/cleanup) and W3.D6 (fallback telemetry).
- If W2a slip > 2 days: drop W3.D9 (CI wiring) from Phase 1 scope. CI becomes Phase 2 day 1. Eval runs locally only.
- Non-negotiable: W3 checkpoint criteria (ARI ≥ 0.75, classifier ≥ 90%) are unchanged. Only the CI publication step is dropped.

### Scenario C: Windows worktree hard-fails AND stash path also breaks

If both worktree and stash approaches fail (e.g., repo is in a detached HEAD state or deeply nested junction chain), sandbox.ts implements a third path: **in-memory diff application** using a temp directory copy (`fs.cp` recursive), run tsc+vitest there, discard. This is slower (no git state isolation) but always works. Record as `{ worktree: false, stash: false, tmpdir: true }` in platform-caps.json. D6 smoke test probes all three paths in order.

---

## DAG Update

The split introduces one new node and one new edge compared to PLAN.md §1.

```
W1.D5 ──► W2a.D6  (Windows platform-caps smoke + deps install)
               │
               ▼
          W2a.D7  fact extraction
               │
               ▼
          W2a.D8  Louvain clustering
               │
               ▼
          W2a.D9  code_anchors emission
               │
               ▼
          W2a.D10 LLM naming + ingest pipeline + W2a CHECKPOINT
               │
    ┌──────────┘        ← CHECKPOINT GATE (all 6 criteria must pass)
    │
    ▼
W2b.D11 Intent DSL + planIntent
    │
    ▼
W2b.D12 agent.ts skeleton + resolveSymbolRef
    │
    ▼
W2b.D13 ts-morph rename codemod
    │
    ▼
W2b.D14 sandbox runner (uses platform-caps.json from D6)
    │
    ▼
W2b.D15 PR generator + API route + chat wiring + W2 FINAL CHECKPOINT
    │
    ▼
W3.D1 deep_analyze perspectives
    ...
```

**Changes vs. PLAN.md DAG**:
- `W2.D1–D5` (ingest) → `W2a.D6–D10` (same tasks, renumbered to absolute day)
- `W2.D6–D10` (modify) → `W2b.D11–D15` (same tasks, renumbered)
- New dependency edge: `W2b.D11` depends on `W2a CHECKPOINT` (explicit gate, was implicit before)
- `W2.D8 sandbox Windows test` → `W2a.D6 platform-caps smoke` (moved 8 days earlier)
- W3 DAG unchanged; W3.D1 now depends on `W2b.D15` (was `W2.D10`, same logical node)

---

## Arguments for the Split (Evidence-Level Reasoning)

### 1. Codex explicitly flagged W2 overload — and named the exact split

CODEX-REVIEW.md §High finding 3: "W2 把 tree-sitter、ts-morph、Louvain、code_anchors、rename、sandbox、PR 全压进一周…明显偏乐观." CODEX-REVIEW.md §建议修改 2 names the exact split proposed here: "W2a: ingest/code_anchors" and "W2b: modify rename". This is not a planner's intuition — it is an independent reviewer's explicit structural diagnosis on the current plan text.

### 2. W2b has a hard data dependency on W2a that cannot be parallelized

MODIFY-AGENT-DESIGN.md §3.2 (`resolveSymbolRef`) walks `ir.blocks[].code_anchors.symbols` to find symbol locations. If `code_anchors` is empty (ingest not done), `resolveSymbolRef` returns null for every query. The agent then emits ClarifyingQ on every rename prompt and the integration test cannot pass. This is not a "nice to have" — it is a compile-time logical dependency. Merging both workstreams into one checkpoint means a D7 ingest bug can silently invalidate all D11–D14 work.

### 3. The sandbox Windows risk was already acknowledged in PLAN.md but mitigated too late

PLAN.md §W2 risks, last bullet: "Sandbox flakiness on Windows (git worktree on junction-backed `.git`) → mitigation: test early W2.D8". The plan acknowledges the risk but places the test at D8 — after 5 days of ingest work and 2 days of agent scaffolding. `reference_cache_junctions.md` (memory) confirms this machine has active junction-backed cache paths. If worktree fails at D8 in the unsplit plan, the developer must context-switch back into sandbox.ts while D9 (PR) and D10 (integration) are blocked. Frontloading to D6 costs 30 minutes and eliminates a 3-day late-phase blocker.

### 4. 10-day W2 with a single terminal checkpoint violates basic recovery theory

A checkpoint is only useful if there is time to act on it. The unsplit W2 checkpoint at D10 is the last task of the week — by definition, any failure discovered there rolls into W3. The split creates a checkpoint at D10 (end of W2a) where there are still 5 days of scheduled work remaining, giving the developer real optionality: fix W2a issues while W2b timeline slides, rather than discovering problems with zero buffer.

### 5. tree-sitter + ts-morph + graphology + Louvain is already ≥ 4 production integrations in one pass

W2a alone adds four non-trivial Node.js integrations: `tree-sitter` (native binding, Windows prebuilt not guaranteed), `ts-morph` (large API surface, tsconfig resolution edge cases on monorepos), `graphology` (fine), `graphology-communities-louvain` (non-determinism without seed, documented in PLAN.md). Each of these can produce a day-long debugging session on first integration. PLAN.md allocates 4h (W2.D1) for "AST scaffold" covering all four deps. W2a gives 5 calendar days to absorb these integrations before any Modify agent code is written.

---

*End of W2-SPLIT-PROPOSAL-PRO.md*
