# Phase 3 — Completion Sign-Off

**Date**: 2026-04-28  
**Reference**: PHASE3-PROGRESS.md (PR #86) — this document supersedes that snapshot as the final record.

---

## Summary Counts

| Category | Count |
|----------|-------|
| Total Phase 3 PRs | 89 |
| Language adapters | 22 |
| Modify v0.4 verbs | 8 |
| Drift extensions | 10 |
| Ops / CLI scripts | 10 |
| Eval & CI | 5 |
| Dashboard / UI | 4 |
| Infra / Library | 16 |
| Docs | 3 |
| Bug fixes | 2 |

---

## Language Adapters (22 total)

| PR | Language | Notes |
|----|----------|-------|
| #13 | Ruby | Standard adapter |
| #14 | C# | Standard adapter |
| #16 | C++ | Standard adapter |
| #18 | Kotlin | Standard adapter |
| #20 | Swift | Standard adapter |
| #37 | PHP | Standard adapter |
| #38 | Scala | Standard adapter |
| #40 | Elixir | defmodule/def/defp |
| #45 | Lua | Standard adapter |
| #53 | Zig | Standard adapter |
| #65 | Dart | Standard adapter |
| #75 | Nim | wasm absent — mock-only tests |
| #76 | Solidity | contract/function/event |
| #77 | OCaml | Standard adapter |
| #78 | Bash | function_definition; exported/line fix in #87 |
| #80 | Vue SFC | script block extraction |
| #82 | ReScript | Standard adapter |
| #83 | Elm | wasm ABI mismatch — mock-only tests |
| #84 | Objective-C | @interface/@implementation |
| #87 | Bash (fix) | BashParsedSymbol exported+line fields |
| #88 | ELisp | defun/defmacro/defvar/defconst/require/provide |
| #89 | JSON config | Top-level keys as const symbols; file-type heuristics |

*(PR #61 phase3/lang-yaml and PR #62 phase3/codex-rescue-fix-prompt open at time of writing)*

---

## Modify v0.4 Verbs (8 total)

| PR | Verb | Scope |
|----|------|-------|
| #15 | move | Move declaration to another file |
| #19 | split | Split function into N helpers |
| #21 | merge | Merge helper back into caller |
| #34 | inline | Inline variable |
| #46 | rename-file | Rename file + update imports |
| #66 | add-import | Insert import in TS file |
| #67 | remove-unused-imports | Prune unused imports |
| #69 | sort-imports | Sort imports alphabetically |

---

## Drift Extensions (10 total)

| PR | Branch | Scope |
|----|--------|-------|
| #23 | drift-schema | Table/column/index drift |
| #24 | drift-edge-changes | In-place edge change detection |
| #27 | drift-container-changes | Container name/color changes |
| #28 | drift-ignore | policy.drift.ignore* ID filters |
| #35 | drift-ignore-glob | File-glob ignore for code_anchor paths |
| #36 | drift-ignore-wiring | applyDriftIgnore wired into drift-check.mjs |
| #39 | drift-tag-filter | Drift suppression by block tag |
| #56 | drift-export-html | Self-contained HTML drift report |
| #68 | drift-severity | Severity scoring (critical/high/medium/low) |
| #71 | drift-filter-container | Per-container filter + includeOnly |

---

## Ops / CLI Scripts (10 total)

| PR | Script | Scope |
|----|--------|-------|
| #42 | policy-init-cli | Interactive policy.yaml scaffold |
| #47 | drift-stats-cli | Weekly drift stats aggregator |
| #52 | policy-merge-cli | Merge 2+ policy.yaml files |
| #55 | eval-cli | Unified eval entry point |
| #60 | ir-validate-cli | IR schema validation |
| #63 | drift-summary-cli | One-line drift summary |
| #64 | eval-fixture-add-cli | Add eval fixtures from CLI |
| #72 | policy-validate-cli | policy.yaml schema validator |
| #79 | drift-csv | CSV export for drift results |
| #81 | telemetry-date-filter | ISO-8601 date-range filter |

---

## Eval & CI (5 total)

| PR | Scope |
|----|-------|
| #22 | Weekly real-LLM classifier eval cron |
| #30 | E2E stubs for modify verb routing |
| #43 | Classifier accuracy alert script |
| #51 | Parallel multi-model live eval |
| #70 | Build handler edge case test pyramid |

---

## Dashboard / UI (4 total)

| PR | Scope |
|----|-------|
| #25 | Architectural review LLM library |
| #26 | Drift-review script + GH Actions workflow |
| #32 | Orchestrator telemetry dashboard + API route |
| #49 | Intent/status/query filters for dashboard |

---

## Infra / Library (16 total)

| PR | Scope |
|----|-------|
| #17 | Persistent JSONL turn log |
| #29 | Code review of all P3 PRs |
| #33 | 5MB log rotation for telemetry |
| #41 | Clarify question from top-2 close intents |
| #44 | Build wave clarification + dispatch route |
| #48 | ARCHITECTURE.md overview |
| #50 | Dispatch tracing log (JSONL) |
| #54 | Classifier result LRU cache |
| #57 | Per-intent dispatch metrics |
| #58 | Per-IP token-bucket rate limiter |
| #59 | Codex-rescue wrapper bug investigation |
| #61 | BuildPlan smoke tests (fake spawn) |
| #62 | Cache hit/miss/eviction telemetry |
| #73 | Classifier/handler prompt templates |
| #74 | IR summary pruner before classify |
| #85 | Clarify-response short-circuit resolver |

---

## Known Limitations

1. **Elm + Nim WASM ABI** — `tree-sitter-elm.wasm` (ABI 12) and Nim (absent) are incompatible with the current `web-tree-sitter` (ABI 13/14). Both adapters pass mock-only tests. Require `tree-sitter-wasms` upgrade to unblock real parsing.

2. **YAML adapter** (PR #61, open) — YAML wasm present; adapter parses top-level mapping keys as const symbols with file-type heuristics (`.archviber/policy.yaml`, `.github/workflows/*.yml`, etc.). Not yet merged.

3. **Codex-rescue model pin** (PR #62, open) — Investigation in PR #59 identified `model:null` fallback. Fix proposes `--model gpt-5.5` pin in codex-rescue.md; plugin-cache read-only constraint requires project-level override file.

4. **facts.ts working-tree pollution** — Multi-worker concurrent branch switches cause stale edits to `facts.ts` and `register-defaults.ts` to bleed across branches. Mitigated by stash discipline; root fix is worktrees or a dedicated merge integration branch.

5. **PR base drift** — Many PRs target `phase2/w2` directly. As dependent adapters land, the shared `FactLanguage` union and `EXT_TO_LANGUAGE` map will conflict on merge. Phase 4 should establish a rolling integration branch.

---

## Phase 4 Recommendations

1. **Integration branch** — Create `phase4/integration` from `phase2/w2`, merge all phase3 PRs sequentially to resolve `FactLanguage` / `EXT_TO_LANGUAGE` conflicts in one place before opening individual feature PRs.

2. **WASM upgrade** — Bump `tree-sitter-wasms` to a version with ABI 14 for Elm and Nim. Unblocks real parser tests for both adapters.

3. **Codex-rescue hardening** — Resolve PR #62; add integration smoke test that verifies the forwarded model arg is non-null before invocation.

4. **Language adapter parity** — Still missing: Haskell, F#, Clojure, Crystal, Nix. Consider adding `.toml` config adapter alongside JSON/YAML.

5. **Drift merging** — All drift extension PRs (#23–#71) should be merged and validated against a real `.archviber/policy.yaml` snapshot before Phase 4 drift work continues.

6. **Test coverage gate** — Add a CI step that fails if new adapter files have fewer than 6 `it(...)` blocks. Prevents the pattern of mock-only adapters shipping with inadequate coverage.
