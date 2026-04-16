# Session Handoff — 2026-04-15 (pre-restart for harness plugin pickup)

Written ~11:52 before user restarts CC to activate two freshly installed harness plugins.

## Branch state

`phase1-w1-cleanup` — 17 commits ahead of `master`. Not pushed.

```
9ddde69 feat(dev): OptionCards preview page at /dev/option-cards-preview for brainstorm v2 verification
0697faf fix(skill): force json:user-choice blocks + correct form-submission format spec
3cc374d feat(brainstorm): persistent per-session state with event compaction and prompt injection
599cc6b feat(chat): multi-select / ordered / custom / indifferent option cards for brainstorm v2
4d7f611 feat(skill): brainstorm v2 — batched WHAT/HOW/DEPS + externalDeps event stream + multi-select/ordered/allowIndifferent/allowCustom
8dc80b9 fix(ir): atomic write + audit_log append + ensureArchviberDir helper
f6698cc test(fixtures): populate required description field on block fixtures
9ba8f46 phase1/w2/d1: AST scaffold (ts-morph parseTsProject + smoke test)
82c4a7f fix: guard schema key normalization against undefined table/column names
2d1cd11 feat: sessions persistence API + claude-cli resolver
0ed194b feat: retrying chat-fetch + rolling history compressor
79bcb5f feat: CC-native scaffold for canvas + orchestrator + builder + reviewer agents
ce91863 chore: UX fixes across Canvas / ChatPanel / SchemaEditor
2dc3854 chore: persistent-agent + session-storage reliability
af05472 phase1/w1/d2: add canonical IR serializer (parseIr/serializeIr + validation)
8519236 phase1/w1: IR consumer glue (store + schema)
d04019e phase1/w1: IR persistence wiring
```

## What's DONE today

### W1 — IR layer + persistence
- IR schema v1.0 + Zod validation (`src/lib/ir/schema.ts`)
- SchemaDoc ↔ IR migrator (`src/lib/ir/migrate.ts`, bidirectional)
- Canonical YAML serializer (`src/lib/ir/serialize.ts`)
- Atomic write + audit_log append + `ensureArchviberDir` with .gitignore cache/ entry (`src/lib/ir/persist.ts`)
- Zustand autosave wiring, /api/ir route, external ir.yaml SSE watcher
- Backward-compat load verified: 5 synthesized legacy YAML fixtures, 35/35 round-trip tests pass at `tests/w1-compat-verify.test.ts` (still untracked per handoff)

### W2.D1 — AST scaffold
- `src/lib/ingest/ast-ts.ts`: `parseTsProject(dir) → {modules, imports, exports, symbols, durationMs}` via ts-morph
- Deps added: `ts-morph@^22`, `graphology`, `graphology-communities-louvain`
- Smoke test `tests/lib/ingest/ast-ts.test.ts` — 3/3 pass, 109 modules parsed on archviber/src/ in ~44s
- **tree-sitter deliberately postponed** to W2.D2 (Windows native build fragility)

### CC-native scaffold layer
- `src/lib/cc-native-scaffold.ts` — 4 scratch dirs under %TEMP%:
  - `archviber-cc-canvas-chat/` — canvas chat (brainstorm/design/iterate phases)
  - `archviber-cc-build-orchestrator/` — build orchestrator (dispatches builders + reviewers)
  - `archviber-cc-builder/` — per-block builder subagent
  - `archviber-cc-reviewer/` — wave / PR reviewer
- Each scaffold: CLAUDE.md + `.claude/skills/<name>/SKILL.md` files
- Skills written:
  - `archviber-canvas` — canvas-action JSON format for design/iterate phase
  - `archviber-brainstorm` — 6 dimensions → **v2 rewrite** to WHAT/HOW/DEPS batching + externalDeps event stream + novice/expert mode + multi-select/ordered/custom/indifferent fields
  - `archviber-harness-gen` — 11-field harness spec for orchestrator
  - `archviber-review-checklist` — 8-item reviewer checklist
- `SCAFFOLD_VERSION = 6` (bumped after skill v2 + force-JSON-blocks hardening)
- Runtime-verified: curl POST /api/chat with `backend: claude-code, phase: brainstorm` returned proper brainstorm response with HTML progress comments and scaffold regen'd v6 on disk

### Brainstorm state persistence
- `src/lib/brainstorm/state.ts` — per-session JSON at `.archviber/brainstorm-state/<sessionId>.json`
- Atomic tmp+rename write, 432 lines with Zod schema
- `applyExternalDepsEvents` — append events, compact every 20 to snapshot (dedupe key currently `service + envVar`, **BLOCKING: skill says `service + type`** — mismatch, fix queued)
- `formatStateForPrompt` — returns prefix "## 本次 brainstorm 已知状态" injected into every brainstorm turn
- `parseAssistantControlComments` + `applyAssistantControl` — parses `<!-- progress -->`, `<!-- externalDeps -->`, `<!-- decisions -->` tags from assistant response
- Wired into `src/app/api/chat/route.ts` — loadOrInitBrainstormState / persistBrainstormStateFromResponse
- Tests `tests/lib/brainstorm-state.test.ts` — 11/11 pass

### Frontend multi-select UI
- `src/lib/chat-actions.ts` — `extractUserChoices` now parses `multi, min, max, allowCustom, allowIndifferent, ordered`
- `src/components/OptionCards.tsx` — full rewrite: checkboxes, rank badges (① only when `ordered:true`), custom text input, indifferent-mutex-with-others
- `src/components/ChatPanel.tsx` — `handleFormSubmission(messageIndex, choiceIndex, payload)` updates assistant message's `choiceSelections` WITHOUT emitting user chat bubble
- `src/app/api/chat/route.ts` — accepts new `formSubmission: { questionId?, selections, ordered }` top-level field, synthesizes `[form-submission ...] selections: [...]` into history
- `src/lib/store.ts` — `ChatMessage.choiceSelections` field

### Preview page
- `src/app/dev/option-cards-preview/page.tsx` at http://localhost:3000/dev/option-cards-preview
- Exercises 8 variants of OptionCards
- Returned 200 on curl smoke

### Infra / misc
- Dashboard `E:\claude-workspace\ArchViber\output\dashboard-mockup.html` updated: renamed Vibe Pencil → ArchViber, added W1/W2/W3 sections with all tasks, Phase 1 7-criteria acceptance, Phase 2+ backlog, today's conflicts with old plan spelled out
- Telegram MCP race fix: `~/.claude/settings.json` removed `telegram@claude-plugins-official: true`; `start-claude.bat` now passes `--settings E:\claude-workspace\telegram-session.json` to enable telegram only for user's main CC
- `dev-browser` CLI installed globally (npm) as Playwright-alternative for lower-token browser automation
- Canvas.tsx schema crash defensive fix: `normalizeTableKey` / `normalizeColumnKey` now guard against undefined

## Freshly installed plugins (need CC restart to activate)

1. `revfactory/harness` (user scope) — agent team & skill architect; generates .claude/agents/ + .claude/skills/ for a domain. Use when designing a new agent team.
2. `Chachamaru127/claude-code-harness` (user scope) — Plan/Work/Review/Ship workflow; Go guardrail engine blocks sudo/force-push/protected writes; 4-perspective code review. Use for Claude's own dev workflow (improve subagent dispatch quality).

Expect new slash commands `/harness-*` after restart.

## Known issues (from code review, VERDICT=needs-changes)

### 🔴 BLOCKING
1. `src/lib/brainstorm/state.ts:18,43,184,190-196` — dedupe key `service + envVar`, skill says `service + type`. **Fix**: change `key()` to `${service}::${type ?? envVar ?? ''}`, update skill example.
2. `src/lib/brainstorm/state.ts:337` — `DECISIONS_RE = /\{[\s\S]*?\}/` non-greedy; nested `tech_preferences: {...}` gets truncated. **Fix**: balanced-brace extractor or flatten decisions.
3. `src/lib/brainstorm/state.ts:335` — `PROGRESS_RE` uses brittle `[^>]*?`, swap to `[\s\S]*?` terminating on literal `-->`.
4. `cc-native-scaffold.ts:188-196` — skill example emits `action`/`note` fields but zod schema only whitelists `notes` (plural). Silently dropped on save. **Fix**: skill example → use `notes`, drop `action` string (or extend schema).

### 🟡 SUGGESTED
5. OptionCards hard-cap silently ignores clicks beyond max — needs disabled styling when at max
6. `allowCustom + ordered` interaction: custom text always appended last regardless of insert order
7. Concurrent-writer race: `writeBrainstormState` is atomic per-call but two overlapping turns lose updates (second wins). Add per-session in-process mutex in route.ts
8. Stale snapshot: `brainstormState` captured at request start, control comments applied to outdated snapshot on overlapping turns

### 🟢 NITPICK
9. Prompt injection surface: `decisions` values flow verbatim into prompt prefix; cap length + strip newlines
10. sessionId regex allows `.` and `..` — explicitly reject
11. Build pipeline should honor `group=C` as non-blocking — needs test or fail-closed in Build gate
12. `indexOf` for duplicate-text rank lookup: off-by-one on duplicates

## Outstanding user-requested fixes (post-restart priorities)

In order:

1. **Preview page layout**: user wants HORIZONTAL carousel (left/right arrows between cards) not vertical stack. Currently when Claude emits 3 cards in one assistant message, ChatPanel renders them stacked vertically. Change to carousel with "Question N of M" counter.
2. **Rank badges on ALL multi-select** (not only `ordered:true`): user's request — show pick-order ①②③ on every multi-select for UX feedback, regardless of whether `ordered` semantically matters. Small edit in OptionCards.tsx where `displayRank` is computed.
3. **Retest brainstorm flow end-to-end** after skill v6 takes effect (user would test in-browser). scaffold-version marker deleted; next chat forces v6 regen.
4. **Code review BLOCKING fixes** (1-4 above). Can batch as one commit.

## Pending design discussions

- **Agent dispatch harness for my own code-writing**: to improve output quality of Agent tool calls, either use Chachamaru's `/harness-work` command for structured Plan/Work/Review/Ship, or roll a lightweight `spawnAgent({prompt, outputSchema, validationCmd, maxRetries})` wrapper. Deferred pending evaluation of Chachamaru's tooling after restart.
- **externalDeps categorization** (A/B/C) fully baked into skill v2 but not yet surfaced in UI. Build-time "setup required" panel not built — deferred to after brainstorm flow proven out.
- **Build orchestrator visible terminal architecture**: designed (explicit CC terminal window approach) but not implemented. Waiting until brainstorm flow is solid.

## OpenViking status

User flagged "为什么 openviking 不工作" — not yet investigated this session. Check after restart:
- `python E:/claude-workspace/ov-bridge.py find "test" 3` — does it return results or error?
- Config at `C:\Users\loey\.openviking\ov.conf`
- Known issue per memory `project_ov_windows_fix.md`: WinError 87 lock issues and queue/redo recovery procedures documented
- If OV is fully broken, today's session handoff is covered by this file + the dashboard, but longer-term the user wants OV working as the cross-session memory layer

## Quick orientation after restart

```bash
cd E:\claude-workspace\archviber
git log --oneline master..HEAD    # verify 17 commits still on phase1-w1-cleanup
git status --short                 # should be nearly clean (screenshots, .archviber, tests/w1-compat-verify untracked)
cat .planning/phase1/SESSION-HANDOFF-2026-04-15.md   # this file
# Dev server: check if running on localhost:3000; restart with `pnpm dev` if dead
# Preview: http://localhost:3000/dev/option-cards-preview
# Scaffold check: cat $TEMP/archviber-cc-canvas-chat/.scaffold-version (should be 6 after next chat request)
```

Plugin list after restart should include `harness@harness-marketplace` and `claude-code-harness@claude-code-harness-marketplace`.
