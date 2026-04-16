# ArchViber Phase 1 — 3-Week Execution Plan

**Author**: Opus 4.6 planning agent
**Date**: 2026-04-14
**Scope owner**: solo dev (user = rainy1024)
**Status**: DRAFT — pending user review before execution begins

---

## 0. Goals (locked)

| Week | Deliverable | Exit test |
|---|---|---|
| 1 | Canonical IR v0.1 + git-persisted `.archviber/ir.yaml` + round-trip from existing SchemaDocument | `pnpm test` green; open existing project in UI, save, reopen — diagram byte-identical |
| 2 | Ingest pipeline (replaces `project-scanner.ts` + folds enhance into single path) producing IR with `code_anchors` (TS/JS) + Modify agent v0.1 (rename only, ts-morph + sandbox + PR) | Import FastAPI golden repo yields ≥ 80% block→file anchor coverage; rename a symbol via chat, confirm PR branch created with tsc-green diff |
| 3 | `deep_analyze` v0.1 (5 perspectives, ephemeral) + Canvas orchestrator routing layer + Eval harness v0.1 with 1 golden repo in CI | Orchestrator correctly routes 5/5 canned prompts on the harness repo; ARI ≥ 0.75 on golden clustering; CI job publishes report |

**Non-goals confirmed** (Phase 1 excluded): Build sandbox redesign, Initiative/Governance agents, policy enforcement, team memory persistence, Modify move/extract/split/merge, persistent-session fix.

---

## 1. Dependency DAG (tasks)

```
W1.D1 IR schema draft ──┐
W1.D2 Zod validator    ──┤
W1.D3 Migrator (SchemaDoc→IR) ──┐
                                 ├─► W1.D4 File I/O + git glue
                                 │    (.archviber/ir.yaml atomic save)
W1.D3 Migrator ─────────────────┘
W1.D4 ─► W1.D5 Round-trip test + backward-compat load
                                 │
                                 ▼
                    W2.D1 tree-sitter + ts-morph scaffold
                                 │
                                 ├─► W2.D2 ingest.ts (AST fact extraction, TS/JS)
                                 │    ─► W2.D3 graphology Louvain clustering
                                 │          ─► W2.D4 code_anchors emission
                                 │                ─► W2.D5 LLM naming pass (optional, fallback OK)
                                 │
                                 └─► W2.D6 Modify agent skeleton (plan-only)
                                         ─► W2.D7 ts-morph rename codemod
                                               ─► W2.D8 sandbox runner (tsc + vitest)
                                                     ─► W2.D9 PR generator
                                                           ─► W2.D10 end-to-end test
                                 │
                                 ▼
                    W3.D1 deep_analyze prompt pack (5 perspectives)
                        ─► W3.D2 ephemeral spawn + aggregator
                                 │
                    W3.D3 orchestrator classifier (single LLM call)
                        ─► W3.D4 route dispatcher (5 branches)
                              ─► W3.D5 /api/chat/route.ts integration
                                    ─► W3.D6 fallback wiring (classify fail → explain)
                                 │
                    W3.D7 Eval harness skeleton (FastAPI golden repo vendored)
                        ─► W3.D8 ARI + anchor-coverage metrics
                              ─► W3.D9 CI wiring (GH Actions node 20, vitest)
                                    ─► W3.D10 smoke run on main
```

---

## 2. Week 1 — IR schema + persistence

Focus: move canvas state from ad-hoc `SchemaDocument` to a canonical IR that downstream agents can reason over. **Do not change the canvas UI** — yamlToCanvas/canvasToYaml still work unchanged; IR is a superset that wraps them.

Total budget: **5 working days** (user has the week). Slack: 1 day buffer.

### W1.D1 — IR schema draft (4h)
- **Input**: `src/lib/schema-engine.ts`, `src/lib/types.ts`, IR-SCHEMA.md (this phase's spec)
- **Output**: `src/lib/ir/schema.ts` — TypeScript types matching IR-SCHEMA.md §2
- **Verify**: `tsc --noEmit` green, exported types are importable from `@/lib/ir`
- **Hours**: 4

### W1.D2 — Zod validator + canonical serializer (3h)
- **Input**: `src/lib/ir/schema.ts`
- **Output**: `src/lib/ir/validate.ts` (runtime guard) + `src/lib/ir/serialize.ts` (deterministic YAML output — stable key ordering, 2-space indent, no trailing newline variance)
- **Verify**: Unit test: fuzz 20 random valid IRs, serialize→parse→deep-equal
- **Hours**: 3
- **Note**: Zod is **not yet a dependency**. Add `zod@^3.23` (~15KB gz) — acceptable.

### W1.D3 — Migrator: SchemaDocument → IR v0.1 (4h)
- **Input**: `src/lib/schema-engine.ts` (existing SerializedContainer/Block), `src/lib/ir/schema.ts`
- **Output**: `src/lib/ir/migrate.ts` exporting `schemaDocumentToIr(doc)` + reverse `irToSchemaDocument(ir)` for UI rendering compatibility
- **Verify**: Load every fixture in `tests/fixtures/canvases/*.yaml` (create 3 if absent), round-trip twice, deep-equal
- **Hours**: 4

### W1.D4 — Disk persistence + git glue (5h)
- **Input**: migrator + serializer
- **Output**: `src/lib/ir/persist.ts` with:
  - `loadIr(projectDir): Promise<IR | null>` — reads `.archviber/ir.yaml`
  - `saveIr(projectDir, ir): Promise<void>` — atomic write (tmp + rename), updates `audit_log` with commit SHA (if git repo) + timestamp
  - `ensureArchviberDir(projectDir)` — creates `.archviber/.gitignore` with `cache/` entry
- **New API route**: `src/app/api/project/ir/route.ts` GET/PUT/POST (see route shape below)
- **Verify**: Playwright e2e: open project → edit node → auto-save fires → file exists & parses
- **Hours**: 5

Route shape (W1.D4):
```
GET  /api/project/ir?dir=<abs>          → { ir } | { ir: null }
PUT  /api/project/ir                     body: { dir, ir }   → { ok: true }
POST /api/project/ir/migrate            body: { dir, schemaDocument } → { ir }
```

### W1.D5 — Backward-compat load + Zustand wiring (4h)
- **Input**: `src/lib/store.ts`, persistence layer
- **Output**: Store gets `loadProjectIr` / `saveProjectIr` actions. `ImportDialog` and `useAutoSave` wire through. Legacy YAML loads go through `migrate.ts`.
- **Verify**: Open a project that was saved with old format → loads, IR fields populated with sensible defaults (empty `code_anchors`, empty `audit_log`)
- **Hours**: 4

**W1 Checkpoint**: `ls E:/claude-workspace/archviber/.archviber/ir.yaml` exists after saving ArchViber itself. Reopen → diagram identical. Old format YAMLs in `data/` still load.

**W1 risks**:
- Zod dep size bump → mitigation: tree-shake or hand-roll validator if bundle complaint
- Existing data loss during migration → mitigation: W1.D3 migrator is non-destructive; legacy YAML is preserved alongside

---

## 3. Week 2 — Ingest pipeline + Modify agent (rename)

This is the heaviest week. **6 working days of work compressed into 5 — plan 1 day of slippage**.

### W2.D1 — AST scaffold (4h)
- **Deps to add**: `ts-morph@^22`, `tree-sitter@^0.21` (Node binding), `tree-sitter-typescript`, `graphology`, `graphology-communities-louvain`
- **Output**: `src/lib/ingest/ast-ts.ts` exposing `parseTsProject(dir): {modules, imports, exports, symbols}`
- **Verify**: Run on `archviber/src/` itself → emits ≥ 150 modules, no parse errors
- **Hours**: 4
- **Hook**: This file is pluggable — future Python/Go backends implement the same interface

### W2.D2 — Fact extraction (5h)
- **Input**: AST scaffold
- **Output**: `src/lib/ingest/facts.ts` — converts raw AST to `FactGraph` (nodes = modules+symbols, edges = imports/calls). Caches to `.archviber/cache/facts.json` keyed by file mtimes
- **Verify**: Re-run is idempotent; cache hit <200ms on 500-file repo
- **Hours**: 5

### W2.D3 — Clustering (3h)
- **Input**: FactGraph
- **Output**: `src/lib/ingest/cluster.ts` using graphology Louvain; merges tiny clusters (< 2 nodes) into parent
- **Verify**: FastAPI golden repo produces 3–8 clusters matching intuitive layering
- **Hours**: 3

### W2.D4 — Code anchors (3h)
- **Input**: FactGraph + clustering
- **Output**: Each IR block gets `code_anchors` populated per IR-SCHEMA §3.3 (files + primary_entry + symbols + line_ranges)
- **Verify**: Anchor coverage metric ≥ 80% on golden repo (block has ≥1 file)
- **Hours**: 3

### W2.D5 — Optional LLM naming pass (4h)
- **Input**: Clusters
- **Output**: `src/lib/ingest/name.ts` — one LLM call (direct API, not CC) names clusters + edges. On failure/timeout (15s), default cluster names (`Cluster A`, `Cluster B`) are used — **that's the whole fallback**; no scan-skeleton fallback
- **Verify**: Names are in user's locale; failure path still yields a usable diagram
- **Hours**: 4

### W2.D6 — Modify agent skeleton (2h)
- **Input**: MODIFY-AGENT-DESIGN.md
- **Output**: `src/lib/modify/agent.ts` exposing `planIntent(userRequest, ir): Intent | ClarifyingQ`
- **Verify**: Unit test with 5 canned rename prompts → correct Intent shape
- **Hours**: 2

### W2.D7 — ts-morph rename codemod (4h)
- **Input**: Intent
- **Output**: `src/lib/modify/codemods/rename.ts` — rename file, class, function, variable
- **Verify**: Rename `schema-engine.ts → canvas-schema.ts` on archviber itself → all imports updated
- **Hours**: 4

### W2.D8 — Sandbox runner (5h)
- **Input**: Codemod diff
- **Output**: `src/lib/modify/sandbox.ts` — creates git worktree, applies diff, runs `tsc --noEmit && vitest run`, captures result. Max 120s wall.
- **Verify**: Passing rename verified green; intentionally-broken rename flagged with failing test name
- **Hours**: 5

### W2.D9 — PR generator (3h)
- **Input**: Sandbox-verified diff
- **Output**: `src/lib/modify/pr.ts` — create branch `archviber/modify-<timestamp>`, commit, push if remote set, template PR body
- **Verify**: Run on a disposable repo, confirm branch + commit SHA
- **Hours**: 3

### W2.D10 — Integration test + chat wiring (4h)
- **Input**: Everything above
- **Output**: `/api/agent/modify/route.ts` — POST `{intent}` → streams status; `useBuildActions` gets `runModify(intent)`
- **Verify**: From canvas UI, right-click block → "Rename…" → PR link returned
- **Hours**: 4

**W2 Checkpoint**:
1. `pnpm dev`, import golden FastAPI repo → IR with `code_anchors` persisted
2. Chat "rename FooService to BarService" → returns PR URL with tsc-green diff
3. Import ArchViber itself → diagram makes sense (no empty API LAYER, block names not file-name style)

**W2 risks**:
- ts-morph slow on monorepos → **mitigation**: first-run budget 60s, cache Project instance; if > 60s, fall back to "TS-only, skip .d.ts"
- Sandbox flakiness on Windows (git worktree on junction-backed `.git`) → **mitigation**: test early W2.D8; if broken, use in-place `git stash` with refusal-on-dirty-tree
- Louvain non-determinism → **mitigation**: seed RNG; hash IR emits cluster IDs derived from member set not Louvain IDs

---

## 4. Week 3 — deep_analyze + routing + eval

### W3.D1 — 5 perspective prompts (3h)
- **Output**: `src/lib/deep-analyze/perspectives/{security,scalability,maintainability,coupling,testability}.md` — each a prompt template consuming IR + `code_anchors`
- **Verify**: Manual one-shot each on FastAPI golden repo yields ≥ 1 actionable bullet
- **Hours**: 3

### W3.D2 — Spawn + aggregator (4h)
- **Input**: 5 prompts
- **Output**: `src/lib/deep-analyze/runner.ts` — spawns 5 ephemeral CC/codex subagents in parallel (reuses agentRunner), aggregates text into markdown report. **No persistence** — runs each time.
- **Verify**: E2E call returns within 90s wall budget (5 parallel × ~60s each, capped)
- **Hours**: 4

### W3.D3 — Intent classifier (3h)
- **Input**: ORCHESTRATOR-ROUTING.md §3 prompt
- **Output**: `src/lib/orchestrator/classify.ts` — single cheap LLM call (direct API, 300 tok max), returns `{intent, confidence, reason}`
- **Verify**: 20 canned prompts → ≥ 90% correct routing
- **Hours**: 3

### W3.D4 — Dispatcher (3h)
- **Output**: `src/lib/orchestrator/dispatch.ts` — switch on intent → calls design_edit | build | modify | deep_analyze | explain handlers
- **Verify**: Unit: each branch dispatches without UI
- **Hours**: 3

### W3.D5 — Chat route integration (4h)
- **Input**: `src/app/api/chat/route.ts`
- **Output**: Route now calls `classify` first (if enabled via env flag `VIBE_ORCHESTRATOR=1`), routes accordingly. Default OFF for safety; enable in W3.D10.
- **Verify**: Integration test — 5 prompts hit correct handler
- **Hours**: 4

### W3.D6 — Fallback + telemetry (2h)
- **Output**: Classifier failure → "explain" handler. Log every classification (intent, confidence, wall time) to `.archviber/cache/classifier-log.jsonl`
- **Verify**: Induced failure (disconnect network) → explain still responds
- **Hours**: 2

### W3.D7 — Eval harness scaffold (3h)
- **Output**: `tests/eval/harness.ts` + `tests/eval/fixtures/fastapi-sample/` (vendored, ≤ 50 files, MIT-compat)
- **Verify**: `pnpm test:eval` runs, produces JSON report
- **Hours**: 3

### W3.D8 — Metrics (3h)
- **Output**: `tests/eval/metrics.ts` — ARI (against hand-labeled ground truth YAML), anchor coverage, classifier accuracy
- **Verify**: Current state prints baseline numbers
- **Hours**: 3

### W3.D9 — CI wiring (3h)
- **Output**: `.github/workflows/eval.yml` — runs on push to main + PRs; uploads report artifact
- **Verify**: Trigger via push → green run on GitHub
- **Hours**: 3

### W3.D10 — Smoke + docs + cleanup (3h)
- **Output**: README updated, `.archviber/` section documented, orchestrator enabled by default, CHANGELOG Phase 1 entry
- **Verify**: Fresh clone → `pnpm install && pnpm dev` → import + chat roundtrip works
- **Hours**: 3

**W3 Checkpoint**: CI green, classifier ≥ 90% on 20-prompt set, ARI ≥ 0.75 on golden, deep_analyze returns 5-section report.

**W3 risks**:
- Classifier bleed (treating rename as edit) → **mitigation**: explicit test coverage, confidence threshold 0.7 else ask clarifying Q
- Eval harness flaky on Windows CI → **mitigation**: run CI on ubuntu-latest; Windows smoke via local pnpm task

---

## 5. Overall Phase 1 Acceptance Criteria

Phase 1 is DONE when **all 7** pass:

1. Opening any previously-working canvas loads and saves through IR v0.1 with zero user-visible change.
2. Importing `tests/eval/fixtures/fastapi-sample/` produces a diagram with ≥ 80% blocks having `code_anchors.files` non-empty.
3. Importing ArchViber itself produces a diagram where: API LAYER is non-empty, no block is named after React state vars (`nodes`, `edges`), and `skeleton-generator.ts` appears in a Core Libraries-like cluster.
4. Chat prompt "rename X to Y" from UI produces a PR branch with tsc-green diff within 120s.
5. Chat prompt "why is this coupled?" produces a deep_analyze report from 5 perspectives.
6. `.github/workflows/eval.yml` runs green on main.
7. `pnpm test` + `pnpm test:eval` both pass locally on Windows & CI on ubuntu-latest.

---

## 6. Parallel-agent hooks (待调研结论合并)

Two other agents are researching CC-native Task/subagent and skill passthrough in parallel. Phase 1 plan is self-contained, but **these hooks are pre-placed for zero-cost merge later**:

### Hook A — Native CC Task as orchestrator replacement
- **Where it could slot in**: W3.D4 dispatcher (`dispatch.ts`) — if native CC Task can be invoked from a Node process with typed result, dispatcher becomes a thin wrapper (pass classifier output → spawn CC Task with `intent` + IR). **待调研结论合并**: if viable, `deep_analyze`'s ephemeral-spawn aggregator (W3.D2) becomes 1 line of CC Task dispatch instead of our custom parallel spawn.
- **Where it could slot in Build**: `agent-runner.ts` one-shot spawn could become CC Task with structured tool return, unlocking sandbox/selective-retry reuse. **Not in Phase 1 scope**, but we preserve the `AgentRunner` interface so swap is mechanical.

### Hook B — Skill passthrough as route option
- **Where it could slot in**: W3.D4 dispatcher — add a 6th branch `intent=skill` that accepts `{skill_name, args}`, shells out. Classifier prompt (W3.D3) gets one extra category. **待调研结论合并**: if feasibility is confirmed by parallel research, add line in classifier + dispatcher. Cost: < 2h.

### Hook C — Persistent-session switch
- **Where it could slot in**: `handlePersistentChat` in `chat/route.ts` is already written but disabled (TODO comment line 441). Orchestrator dispatcher calls it through a single `useStateful` flag. When persistent-session fix lands, flip `VIBE_CHAT_PERSISTENT=1` env var — one-line change.

All three hooks are **not blocking**. Phase 1 ships with stateless, per-request spawns.

---

## 7. What's intentionally NOT in Phase 1 (log for Phase 2+)

- Selective Build retry + sub-process sandbox for Build agents
- Policy enforcement (schema field exists but never checked)
- move/extract/split/merge Modify verbs
- Bidirectional diagram↔code live sync (just on-import + on-save snapshot)
- Multi-language ingest beyond TS/JS (Python/Go/Java come in Phase 2)
- Team memory / CRDT collaborative editing
- Drift detection / architecture-PR review

## 8. Working cadence

- Daily commit to a `phase1-ir` branch, never to main
- End-of-day OV commit via `ov-bridge.py commit` with day's scope
- Mid-week Telegram checkpoint (W1.D3, W2.D5, W3.D5) — progress + slippage decision
