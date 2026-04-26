# Phase 3 — Code Review

**Reviewer**: Opus 4.7 (inline, after the spawned reviewer agent hit its own
context ceiling). Coverage is broad but not file-by-file deep; treat NIT-level
findings as "things I'd flag if I had unbounded review time".

**Scope**: 16 P3 PRs (#13–#28). PRs #25 and #26 are stacked.

## Summary verdict: **SHIP MOST WITH FIXUPS**

No blockers. The system extends cleanly along the established scaffolds
(LanguageAdapter, RenamePlan, DriftReport, Policy). The biggest cross-PR
risk is merge ordering: each drift extension and each language adapter
independently widens the same shared types, and they'll conflict on merge.
That's a sequencing concern, not a code-quality one.

## Per-PR verdict

| PR | branch | verdict | note |
|---|---|---|---|
| #13 | lang-ruby | SHIP | Recipe-driven; `__`-prefix not-exported convention adapted live during impl |
| #14 | lang-csharp | SHIP | Visibility lives in named `modifier` child (vs anon for Java); WASM filename uses underscore |
| #15 | modify-move | SHIP | POSIX path normalization caught a Windows bug in test 7 — that's good DX |
| #16 | lang-cpp | SHIP | `.h` ambiguous (C vs C++) — cpp wins for v0.3, future C adapter overrides |
| #17 | persistent-telemetry | SHIP | fire-and-forget write; never throws; ARCHVIBER_TELEMETRY=0 disables |
| #18 | lang-kotlin | SHIP | Multiple deviations from Java template (modifiers nested, import_list wrap, no enum_class node) — all handled |
| #19 | modify-split | SHIP | Thin orchestration over planExtract; non-overlap invariant keeps offsets valid |
| #20 | lang-swift | SHIP | Visibility in `modifiers > visibility_modifier`; one runtime AST probe used |
| #21 | modify-merge | SHIP | v0.3 scope tight (zero params, no return, single caller, top-level expr stmt only) |
| #22 | eval-live | SHIP | Direct fetch (no CLI dep); secrets-gated; 90-day artifact retention |
| #23 | drift-schema | SHIP | Pure logic; renderer truncates to 3 column changes per table |
| #24 | drift-edge-changes | SHIP | Mirror of in-place block change pattern |
| #25 | pr-review-bot | SHIP | Library-only PR; one LLM call (cost-bounded); fetchFn injectable for tests |
| #26 | pr-review-bot-wiring | SHIP | Stacks on #25; advisory; silent-skip when secrets absent |
| #27 | drift-container-changes | SHIP | Mirror of #24 for containers |
| #28 | drift-ignore | SHIP | Noise-suppression lists; pure function; clean recomputed |

## Findings

### SEV2

#### CR-1. Merge ordering risk: shared-type extensions
`DriftReport`, `DriftSummary`, `LanguageAdapter` registry, and
`register-defaults.ts` are extended additively by 5+ PRs each. When they
merge they'll all touch the same lines. Recommend a merge order:
1. All language adapters (#13/14/16/18/20) — all touch register-defaults.ts and FactLanguage union
2. Modify v0.3 verbs (#15/19/21) — all return RenamePlan; modify.ts wires verbs
3. Drift extensions (#23/24/27) — all add DriftReport fields
4. Policy + telemetry + eval-live (#17/22/28) — minimal cross-touch
5. PR review bot stack (#25 → #26)

Mitigation: rebase-merge each PR group, or use `--strategy-option=patience` for the cross-touch lines.

#### CR-2. Modify v0.3 verbs share scaffold but lack a smoke pipeline
move/split/merge each have unit tests with apply round-trips, but no e2e
that runs the WHOLE pipeline (LLM extraction → planX → sandbox → git PR)
on a real fixture. Risk: a regression in handlers/modify.ts could break
all three verbs without unit tests catching it. Add a single
`tests/api/chat/modify-verbs-e2e.test.ts` that exercises each verb through
runOrchestratorTurn with MockRunner.

#### CR-3. Persistent telemetry doesn't bound file size
`persistTurn` appends every turn to `.archviber/cache/orchestrator-log.jsonl`
forever. A long-running default-on deployment fills disk eventually. Add
a size check (rotate at 10MB to `orchestrator-log.jsonl.1`) or document a
`logrotate` recipe.

#### CR-4. Live-LLM eval cron has no result-history dashboard
PR #22 writes a 90-day artifact per run but no script aggregates the
history. Drift in classifier accuracy week-to-week is invisible without
comparing two random artifacts manually. Add `scripts/eval-history.mjs`
that downloads the last N artifacts and prints accuracy over time.

#### CR-5. `applyDriftIgnore` (#28) doesn't reach into nested `changedBlocks` schema drift
PR #28 filters by block id but the structured `schemaDrift` field added in
#23 isn't consulted. If a user adds a block to ignoreBlockIds AND the same
block has schema changes, the schema drift is filtered with the block.
Correct behavior. But if the block is NOT ignored AND its schema diff
references an ignored sub-table, that's not filtered. Minor: P3 doesn't
have ignoreTableNames yet. Note for future P4.

### NIT

- **N1** Each language adapter copy-pastes the WASM loader (`getParser`/
  `resolveWasmDir`/`resolveRuntimeWasm`). Could DRY into
  `src/lib/ingest/languages/wasm-loader.ts` exporting `makeWasmLoader(filename)`.
  Trade-off: per-language loaders are easy to diverge if a grammar needs
  custom init. Defer until divergence actually happens.
- **N2** `runArchitectureReview` (#25) doesn't retry on 5xx. One-shot is
  fine for advisory PR comments but a transient 503 leaves the PR
  comment without review for that run.
- **N3** `inferLanguageFromPath` (in name.ts from W2) duplicates extension
  → language mapping with `EXT_TO_LANGUAGE` in facts.ts. They drift; #28's
  ruby and #16's cpp extensions are only in one or the other.
  Consolidate — but it's a P2/W2 debt, not a P3 issue.

## Strengths

1. **Recipe is load-bearing**: 5 language adapters in a single session
   (Ruby, C#, C++, Kotlin, Swift) is direct evidence that the W2 recipe
   pattern delivers what it promised — ~1 day per language by a Sonnet
   subagent. C# / Kotlin even surfaced AST quirks (modifier shapes,
   import nesting) that the agents resolved live.
2. **Modify v0.3 scaffold reuse**: move/split/merge all return
   `RenamePlan` and feed through `applyRenamePlan` + `runSandbox` +
   `createRenamePr` unchanged. Adding a 6th verb is one new file.
3. **Drift extensions are additive, not invasive**: `BlockChange` got an
   optional `schemaDrift`; `DriftReport` got `changedEdges` /
   `changedContainers`. No existing consumer breaks.
4. **PR review bot is cost-bounded** (one LLM call per drifted PR vs the
   5-perspective fan-out reserved for chat), fetchFn-injectable for tests,
   and silently no-ops when secrets aren't configured.
5. **All scripts exit 0 by default**: drift-check, eval-live, drift-review.
   Enforcement is opt-in via flags. CI never breaks until policy says so.

## Cross-PR observations

- **WASM loader pattern** copy-pasted across 5 lang adapters could DRY
  (see N1). Each loader is ~30 lines; 150 lines repeated.
- **Visibility detection diverges per language**: Java uses anon tokens,
  C# uses named `modifier`, Kotlin uses nested `modifiers >
  visibility_modifier`, Swift mirrors Kotlin. Each adapter handles
  correctly per its grammar; trying to centralize would over-abstract.
- **Drift extensions all touch the same `DriftReport` interface** — see
  CR-1 merge ordering note.
- **No P3 PR adds a new npm dep** ✅ — recipe held.
- **No P3 PR ships unit tests below 5 cases per new feature** ✅ — most
  ship 6-19 tests.

## Recommendation

Land in the order above; address CR-1 (merge sequence) procedurally,
CR-2/CR-3 in a fixup PR (~30 lines combined), CR-4 in a future ops PR,
CR-5 doc-only.
