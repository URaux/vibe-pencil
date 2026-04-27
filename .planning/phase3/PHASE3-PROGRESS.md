# Phase 3 Progress

All open PRs as of 2026-04-27. Grouped by category.

---

## Language Adapters (18 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #13 | phase3/lang-ruby | Ruby adapter (5th impl) |
| #14 | phase3/lang-csharp | C# adapter (6th impl) |
| #16 | phase3/lang-cpp | C++ adapter (7th impl) |
| #18 | phase3/lang-kotlin | Kotlin adapter (8th impl) |
| #20 | phase3/lang-swift | Swift adapter (9th impl) |
| #37 | phase3/lang-php | PHP adapter |
| #38 | phase3/lang-scala | Scala adapter |
| #40 | phase3/lang-elixir | Elixir adapter |
| #45 | phase3/lang-lua | Lua adapter |
| #53 | phase3/lang-zig | Zig adapter |
| #65 | phase3/lang-dart | Dart adapter |
| #75 | phase3/lang-nim-w9 | Nim adapter (wasm absent, mock tests) |
| #76 | phase3/lang-solidity | Solidity adapter |
| #77 | phase3/lang-ocaml | OCaml adapter |
| #78 | phase3/lang-bash | Bash script adapter |
| #80 | phase3/lang-vue | Vue SFC adapter |
| #82 | phase3/lang-rescript | ReScript adapter |
| #83 | phase3/lang-elm-w9 | Elm adapter (wasm ABI mismatch, mock tests) |
| #84 | phase3/lang-objc | Objective-C adapter |

---

## Modify Verbs (7 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #15 | phase3/modify-move | Move declaration verb |
| #19 | phase3/modify-split | Split function into N helpers |
| #21 | phase3/modify-merge | Merge helper back into caller |
| #34 | phase3/modify-inline | Inline variable verb |
| #46 | phase3/modify-rename-file | Rename file + update imports |
| #66 | phase3/modify-add-import | Add import to TS file |
| #67 | phase3/modify-remove-unused-imports | Prune unused imports |
| #69 | phase3/modify-sort-imports | Sort imports in TS file |

---

## Drift Extensions (10 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #23 | phase3/drift-schema | Table/column/index drift detection |
| #24 | phase3/drift-edge-changes | Detect in-place edge changes |
| #27 | phase3/drift-container-changes | Detect container name/color changes |
| #28 | phase3/drift-ignore | policy.drift.ignore{Block,Container,Edge}Ids |
| #35 | phase3/drift-ignore-glob | File-glob ignore for code_anchor paths |
| #36 | phase3/drift-ignore-wiring | Wire applyDriftIgnore into drift-check.mjs |
| #39 | phase3/drift-tag-filter | Drift suppression by block tag |
| #56 | phase3/drift-export-html | Self-contained HTML drift report |
| #68 | phase3/drift-severity | Drift severity scoring |
| #71 | phase3/drift-filter-container | Per-container drift filter + includeOnly |

---

## Ops / CLI Scripts (10 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #42 | phase3/policy-init-cli | Interactive policy.yaml scaffold |
| #47 | phase3/drift-stats-cli | Weekly drift stats aggregator |
| #52 | phase3/policy-merge-cli | Merge 2+ policy.yaml files |
| #55 | phase3/eval-cli | Unified eval entry point |
| #60 | phase3/ir-validate-cli | IR schema validation CLI |
| #63 | phase3/drift-summary-cli | One-line drift summary |
| #64 | phase3/eval-fixture-add-cli | Add eval fixtures from CLI |
| #72 | phase3/policy-validate-cli | policy.yaml schema validator |
| #78 | phase3/drift-csv | Export drift result as CSV |
| #81 | phase3/telemetry-date-filter | ISO-8601 date-range filter for telemetry |

---

## Eval & CI (5 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #22 | phase3/eval-live | Weekly real-LLM classifier eval cron |
| #30 | phase3/modify-verbs-e2e | E2E stubs for modify verb routing |
| #43 | phase3/eval-alerts | Classifier accuracy alert script |
| #51 | phase3/eval-multi-model | Parallel multi-model live eval |
| #70 | phase3/build-handler-edge-tests | Build handler edge case test pyramid |

---

## Dashboard / UI (3 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #25 | phase3/pr-review-bot | Architectural review LLM library |
| #26 | phase3/pr-review-bot-wiring | Drift-review script + workflow |
| #32 | phase3/telemetry-dashboard | Orchestrator telemetry dashboard + API |
| #49 | phase3/telemetry-dashboard-filters | Intent/status/query filters |

---

## Infra / Library (12 PRs)

| PR | Branch | Scope |
|----|--------|-------|
| #17 | phase3/persistent-telemetry | JSONL turn log in .archviber/cache |
| #29 | phase3/p3-review-doc | Code review of all P3 PRs |
| #33 | phase3/persistent-telemetry-rotation | 5MB log rotation for telemetry |
| #41 | phase3/orchestrator-clarify | Targeted clarify question from top-2 intents |
| #44 | phase3/build-handler-improvements | Build wave clarification + dispatch route |
| #48 | phase3/docs-architecture | ARCHITECTURE.md overview |
| #50 | phase3/dispatch-trace | Dispatch tracing log (JSONL) |
| #54 | phase3/orchestrator-cache | Classifier result LRU cache |
| #57 | phase3/handler-metrics | Per-intent dispatch metrics aggregation |
| #58 | phase3/orchestrator-rate-limit | Per-IP token-bucket rate limiter |
| #59 | phase3/codex-rescue-investigate | Document wrapper vs direct invocation gap |
| #61 | phase3/build-handler-mock-runner | BuildPlan smoke tests (fake spawn) |
| #62 | phase3/orchestrator-cache-stats | Cache hit/miss/eviction telemetry |
| #73 | phase3/orchestrator-prompt-templates | Extract classifier/handler prompts |
| #74 | phase3/dispatch-context-pruner | Prune oversized IR summary before classify |
| #85 | phase3/orchestrator-clarify-classify | Clarify-response short-circuit resolver |

---

## Outstanding Work / Known Issues

- **#59 codex-rescue-investigate** — documents the bug but fix is a separate task (#62 pending)
- **Elm / Nim wasm ABI** — `tree-sitter-elm.wasm` (ABI 12) and `tree-sitter-nim.wasm` (absent) both incompatible with web-tree-sitter 13-14; adapters work via mock trees but real parsing needs tree-sitter-wasms upgrade
- **bash.ts exported field** — `BashParsedSymbol` has field gaps vs standard `ParsedSymbol` (task #59 in queue)
- **facts.ts stability** — shared working tree causes branch pollution; multiple workers' stashes resetting tracked files mid-session; commits frequently land on wrong branch requiring cherry-pick recovery
- **PR base alignment** — several PRs target phase2/w2 but the actual merge target may need to shift as dependent PRs land
