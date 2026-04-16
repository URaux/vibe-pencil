---
session: 2026-04-15 evening (post-restart with harness plugins active)
branch: phase1-w1-cleanup
commits_this_session: 5 (7a169fb, 11d8df1, 53a9f0c, 5830af0, ec8387b)
pushed: no
---

## What was done

Ran harness reviewer on the last ~20 commits, got a structured verdict, then parallelized fixes across multiple subagents in two waves.

**Reviewer findings fixed (all landed)**:

- **B1** (BLOCKING) — ChatPanel + ImportDialog never sent `sessionId` on `/api/chat` → server silently skipped brainstorm-state persistence. Fixed: every request now carries the field. Commit `7a169fb`.
- **B2** (BLOCKING) — OptionCards rendered LLM-authored text through `dangerouslySetInnerHTML`. Fixed: safe React-element renderer for bold/italic/code, no HTML string path. Commit `7a169fb`.
- **B3 (IDB)** — `idbSaveSessions` had no `tx.onabort`, silently wiping mirror on tab kill. Fixed: handler rejects with `tx.error`. Commit `53a9f0c`.
- **B4** — `flushSave` dropped the `_doSave` promise on `beforeunload`. Fixed: returns the promise; errors propagate. Commit `53a9f0c`.
- **S1** — OptionCards `submitDisabled` didn't enforce `softMin`. Fixed: blocks under-min unless indifferent. Commit `7a169fb`.
- **S2** — `BRAINSTORM_STATE_DIR` was a relative-at-import-time path. Fixed: subdir name only, full path built inside helper. Commit `11d8df1`.
- **S3** — `TsSymbol` speculative re-export in `ast-ts.ts`. Removed. Commit `5830af0`.
- **S4** — `parseTsProject` produced duplicate symbol entries for exported arrows and destructured bindings. Fixed with name-keyed dedup seeded from `getExportedDeclarations` first. Added a cross-tree duplicate-zero assertion. Commit `5830af0`.
- **S5** — `writeIrFile` parsed the IR twice. Removed the pre-audit parse. Commit `53a9f0c`.
- **S6** — `lastSaveError` silent null overwrite on mirror-sync failure. Fixed: keep the warning. Commit `53a9f0c`.

**User-flagged brainstorm blocking items (3 more, found in wave 2)**:

- `DECISIONS_RE` non-greedy regex truncated nested `tech_preferences` JSON at the first `}` → every decision patch with nested keys silently dropped. Fixed to capture up to `-->`. Commit `11d8df1`.
- `applyAssistantControl` shallow-merged `tech_preferences` → turn 2 clobbered turn 1. Fixed with targeted deep-merge. Commit `11d8df1`.
- Concurrent read-modify-write on per-session state → rapid double-submit lost events. Fixed with `updateBrainstormState` serialized-on-promise helper; route.ts rebased on current read. Commit `11d8df1`. **Cross-process still unlocked** — would need `proper-lockfile` or single-writer routing for multi-worker deploys.

**Scope additions**:

- ChatPanel horizontal snap carousel + progress dots when multiple OptionCards share one assistant bubble. Rank badges now show on all multi-select, not only `ordered`. Commit `7a169fb`.
- `option-parser` truncation appends `…` instead of cutting mid-word. Commit `ec8387b`.
- `BuildDrawer`, `WaveList`, `DrawerHeader`, `OutputLog` i18n TODOs all resolved through existing `t()` + `locale` subscription pattern. Commit `ec8387b`.
- Full XSS audit of LLM-rendered surfaces: only OptionCards was exposed; ChatMarkdown (react-markdown v10) is safe by default. No other fixes applied.
- `src/lib/ingest/ast-treesitter.ts` scaffold with language detection, stubbed parser, shape-compatible with ast-ts, plus smoke test. Commit `5830af0`. Real `web-tree-sitter` install deferred.
- New `tests/integration/brainstorm-e2e.test.ts` (15 cases) specifically designed to catch the B1-style "unit test green but HTTP wiring broken" bug. Commit `11d8df1`.

## Still open

1. **Push** — 5 commits on `phase1-w1-cleanup` not yet pushed. User confirmation required per CLAUDE.md.
2. **Manual browser retest** — carousel + rank-badge UI changes need a human eyeball on `/dev/option-cards-preview` and a live brainstorm flow. Type-checks clean, but no visual verification.
3. **Cross-process mutex** for brainstorm state — flagged as future work; in-process mutex is enough for local dev.
4. **Brainstorm SHOULD-FIX flagged but not applied**: S3 features array clobber vs union-merge, S4 roundCount can regress on LLM hallucination, S5 event log unbounded below compaction threshold. Each is a one-line call; user should confirm intent before mechanical fix.
5. **N1 defense-in-depth** on `parseAssistantControlComments` — add a "never pass user-provided text here" comment; currently safe because only assistant streamed text reaches it.
6. **ReactMarkdown `urlTransform`** — audit recommended explicit whitelist to `https?:` + `mailto:` instead of the default `https?|ircs?|mailto|xmpp`. Low priority.
7. **Tree-sitter stub** — install `web-tree-sitter` + grammar wasm and replace `parseWithStub`. TODO tagged `TODO(W2.D2)`.
8. **Pre-existing tsc error** — `tests/e2e/demo-sessions.spec.ts:208` `Locator.selectAll`. Not mine; leave for the author of that file.

## Tests status

- `npx tsc --noEmit` clean (modulo known e2e error above).
- `npx vitest run tests/lib/brainstorm-state.test.ts` — 15/15.
- `npx vitest run tests/integration/brainstorm-e2e.test.ts` — 15/15.
- `npx vitest run tests/lib/ingest/ast-ts.test.ts` — 4/4 (dedup assertion added).
- `npx vitest run tests/lib/ingest/ast-treesitter.test.ts` — 9/9.

## Branch state

```
ec8387b chore: option-parser ellipsis + resolve i18n TODOs across build drawer
5830af0 refactor(ast): dedup symbol entries, drop speculative re-export, scaffold tree-sitter path
53a9f0c fix(persistence): IDB abort handler, flushSave await, mirror-failure warning, ir pre-parse
11d8df1 fix(brainstorm): regex nesting, tech_preferences deep-merge, serialized RMW
7a169fb fix(chat): sessionId wiring, OptionCards XSS + softMin, carousel
9ddde69 feat(dev): OptionCards preview page at /dev/option-cards-preview for brainstorm v2 verification  (pre-existing)
```

## Harness usage notes

- `claude-code-harness:reviewer` agent fired successfully as an audit pass — would benefit from being wired to a pre-commit hook for large commits.
- `claude-code-harness:worker` subagent type failed with `WorktreeCreate hook failed: no successful output` on this project (not a worktree-ready git repo or hook config issue). Fell back to `general-purpose` for parallel workers, which worked fine.
- Eight parallel subagents total across two waves, zero file collisions via strict per-agent file scopes declared in the spawn prompts.
