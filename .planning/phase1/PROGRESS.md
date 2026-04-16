# Phase 1 Progress

## W1.D1 — IR Schema & Migrator (2026-04-14, night session)

### Decisions made (autonomously, per user delegation)

- **ID scheme**: persistent UID (pass-through from existing `node.id` — codebase uses `crypto.randomUUID()`). Not content-hash. Rationale: rename stability > IR-level canonical ID across machines; team git-diff is 1-line on rename; avoids edge-ref cascade.
- **Orphan semantics**: `container_id: string | null` where `null` = orphan. Reverse migrator reconstructs synthetic `ungrouped` bucket only when non-empty, matching `canvasToYaml` behavior in `schema-engine.ts`.
- **Zod added**: runtime validation is the "harness" promised to user. Alternative hand-rolled validator rejected.
- **IR as strict superset of SchemaDocument**: IR adds `version / metadata / code_anchors / audit_log / seed_state / policies`; pass-through for everything else. Zero UI risk — `yamlToCanvas` still consumes `SchemaDocument`.

### Code delivered

| File | Purpose |
|---|---|
| `src/lib/ir/schema.ts` | Zod schemas + exported TS types |
| `src/lib/ir/migrate.ts` | `schemaDocumentToIr`, `irToSchemaDocument` |
| `src/lib/ir/persist.ts` | `readIrFile`, `writeIrFile`, `parseIr`, `serializeIr` |
| `src/lib/ir/index.ts` | barrel export |
| `tests/lib/ir-migrate.test.ts` | 15 round-trip + validation tests |
| `tests/lib/ir-persist.test.ts` | 8 persistence + validation tests |

### Tests

`npx vitest run tests/lib/ir-migrate.test.ts tests/lib/ir-persist.test.ts` — **23/23 pass**.

Notable coverage
- Orphan reconstruction round-trip (Codex blocker #1)
- ID preservation through round-trip (no `prefixedId` mutation)
- Deterministic YAML serialization
- Strict Zod rejection of unknown fields and wrong version

### Commits

```
1f940c2 feat(ir): add canonical IR schema v0.1 with bidirectional SchemaDocument migrator
d296b44 chore(deps): add zod for IR schema validation
```

### TODOs flagged for future work (not blocking)

- Integrity validation: duplicate block IDs, edge endpoints referencing missing nodes. Not in Zod schema; could be added as a separate `validateIrReferentialIntegrity()` pass.
- Multiple `ungrouped` buckets on input: forward migrator treats them additively; probably fine, worth a note.
- Metadata timestamps: currently set on forward migrate; for existing repos this will bump `updatedAt` on every migration. `writeIrFile` should probably update `updatedAt` only on actual mutation, not just re-serialize.

### What's NOT done tonight (deferred to W1.D2+)

- Zustand store ↔ IR sync
- `context-engine.ts` accepting optional IR param
- Any chat/route.ts integration
- Any canvas or UI path change

Stopping here to avoid half-done work; checkpoint ready for review.

---

## W1.D2 — Canonical serializer (2026-04-15)

- Deterministic YAML emitter split out of `persist.ts` into dedicated `src/lib/ir/serialize.ts`: stable key ordering, 2-space indent, trailing-newline invariance.
- `parseIr` / `serializeIr` now exported from barrel; round-trip validator fuzzes random valid IRs through serialize→parse→deep-equal.
- W1.D3 migrator work already landed earlier as part of `1f940c2` (bidirectional `schemaDocumentToIr` / `irToSchemaDocument`) — no separate commit this day.

### Commits

```
af05472 phase1/w1/d2: add canonical IR serializer (parseIr/serializeIr + validation)
```

---

## W1.D4 — IR persistence wiring + /api/ir route (2026-04-15)

- `/api/project/ir` route group: GET/PUT/POST with migrate sub-route, backed by atomic tmp-then-rename write.
- `writeIrFile` stamps `audit_log` entries on every mutating write; guarded via `ensureArchviberDir` helper which seeds `.archviber/.gitignore` with `cache/` entry.
- Load path tolerant to missing file (returns `{ ir: null }`), tolerant to legacy SchemaDocument YAML via migrator hook.

### Commits

```
d04019e phase1/w1: IR persistence wiring
8dc80b9 fix(ir): atomic write + audit_log append + ensureArchviberDir helper
```

---

## W1.D5 — Zustand autosave + store glue (2026-04-15)

- Zustand store gained `loadProjectIr` / `saveProjectIr` actions and a subscription-based autosave engine (debounced, cancels in-flight on new mutation).
- `ImportDialog` + `useAutoSave` rewired so legacy YAML loads go through migrator, new writes emit IR.
- Pre-parse in autosave dropped after code review (`53a9f0c`): `writeIrFile` already parses once internally.

### Commits

```
8519236 phase1/w1: IR consumer glue (store + schema)
6251040 feat(ir): add autosave engine with /api/ir routes and Zustand subscription
```

---

## W1 — External ir.yaml watcher + SSE (2026-04-15)

- `src/lib/ir/watcher.ts` (+ SSE route) tails `.archviber/ir.yaml` mtime; pushes `{ type: "ir-changed" }` to any open client.
- UI surfaces a localized "外部修改，重新载入？" dialog when the server-side file mutates outside the app (git pull, manual edit).

### Commits

```
15f7747 phase1/w1/d2: add external ir.yaml watcher with SSE + UI reload prompt
f0b2e01 fix(ir-watcher): localize external edit dialog to Chinese
```

---

## W1 — IR → prompt context pipeline (2026-04-15)

- `context-engine.ts` now consumes IR when present, falling back to SchemaDocument otherwise. `code_anchors` / `audit_log` surfaced to downstream prompts for W2/W3 agents.
- Prompt pipeline stays backward-compat — no behavior change for projects still on legacy YAML.

### Commits

```
3321df3 phase1/w1/d2(p4): wire IR into prompt context pipeline
```

---

## W1 — Backward-compat + e2e demo harness (2026-04-15)

- 5 synthesized legacy YAML fixtures × 7 invariants = 35/35 round-trip compat tests (`tests/w1-compat-verify.test.ts`).
- Reusable import-flow harness `tests/demo-runs/` — observe-and-act, LLM-driven end-to-end against live `/api/*` routes.

### Commits

```
1125b40 phase1/w1/d2: demo e2e harness (observe-and-act LLM-driven)
c4c8a72 test(demo): add reusable import harness for end-to-end API flow
f6698cc test(fixtures): populate required description field on block fixtures
```

---

## W2.D1 — AST scaffold: ts-morph (2026-04-15)

- `src/lib/ingest/ast-ts.ts` exposes `parseTsProject(dir) → { modules, imports, exports, symbols, durationMs }`.
- Deps added: `ts-morph@^22`, `graphology`, `graphology-communities-louvain`.
- Smoke test parses archviber/src/ itself: 109 modules in ~44s, 3/3 tests pass.
- **tree-sitter deliberately deferred to W2.D2** — Windows native build fragility.

### Commits

```
9ba8f46 phase1/w2/d1: AST scaffold (ts-morph parseTsProject + smoke test)
```

---

## W2.D2 — tree-sitter scaffold → real parser (2026-04-15, evening)

- First pass: stubbed `src/lib/ingest/ast-treesitter.ts` with language detection + shape-compatible placeholder so downstream facts pipeline could wire early (`5830af0`).
- Second pass: real `web-tree-sitter` + grammar wasm for TS/TSX/JS/JSX/Python/Go (`81a97db`). Replaces `parseWithStub`; clears W2.D2 TODO tag.

### Commits

```
5830af0 refactor(ast): dedup symbol entries, drop speculative re-export, scaffold tree-sitter path
81a97db feat(ingest): real web-tree-sitter parser for TS/TSX/JS/JSX/Python/Go
```

---

## Evening harness-cleanup session (2026-04-15)

Ran `claude-code-harness:reviewer` against the last ~20 commits, parallelized fixes across 8 subagents in two waves. All BLOCKING + SHOULD findings landed.

### BLOCKING fixes
- **B1** — ChatPanel + ImportDialog never sent `sessionId` on `/api/chat`; brainstorm-state persistence silently skipped. Fixed (`7a169fb`).
- **B2** — OptionCards rendered LLM-authored text through `dangerouslySetInnerHTML`. Replaced with safe React-element renderer (`7a169fb`).
- **B3** — `idbSaveSessions` missing `tx.onabort`, silently wiping mirror on tab kill (`53a9f0c`).
- **B4** — `flushSave` dropped `_doSave` promise on `beforeunload` (`53a9f0c`).

### SHOULD fixes
- **S1** — OptionCards `submitDisabled` didn't enforce `softMin` (`7a169fb`).
- **S2** — `BRAINSTORM_STATE_DIR` was relative-at-import-time path (`11d8df1`).
- **S3** — `TsSymbol` speculative re-export removed (`5830af0`).
- **S4** — `parseTsProject` duplicate symbols from exported arrows + destructured bindings; name-keyed dedup seeded from `getExportedDeclarations` + cross-tree zero-dup assertion (`5830af0`).
- **S5** — `writeIrFile` parsed IR twice; pre-audit parse removed (`53a9f0c`).
- **S6** — `lastSaveError` silent null overwrite on mirror-sync failure (`53a9f0c`).

### User-flagged brainstorm issues (wave 2)
- `DECISIONS_RE` non-greedy truncated nested `tech_preferences` at first `}`; capture now extends to `-->` (`11d8df1`).
- `applyAssistantControl` shallow-merged `tech_preferences` — turn 2 clobbered turn 1; targeted deep-merge (`11d8df1`).
- Rapid double-submit lost events; `updateBrainstormState` serialized-on-promise helper, route rebased on current read (`11d8df1`). Cross-process still unlocked (needs `proper-lockfile` for multi-worker).

### Scope additions
- ChatPanel horizontal snap carousel + progress dots when multiple OptionCards share one bubble; rank badges now on all multi-select (`7a169fb`).
- `option-parser` truncation appends `…` instead of mid-word cut (`ec8387b`).
- `BuildDrawer` / `WaveList` / `DrawerHeader` / `OutputLog` i18n TODOs resolved (`ec8387b`).
- Brainstorm skill spec alignment: externalDeps dedup key + schema harmonized (`92bd673`).
- ReactMarkdown url allow-list + monotonic roundCount (`028ff98`).
- New integration suite `tests/integration/brainstorm-e2e.test.ts` — 15 cases designed to catch B1-style "unit green, HTTP broken" bugs.

### Commits

```
7a169fb fix(chat): sessionId wiring, OptionCards XSS + softMin, carousel
11d8df1 fix(brainstorm): regex nesting, tech_preferences deep-merge, serialized RMW
53a9f0c fix(persistence): IDB abort handler, flushSave await, mirror-failure warning, ir pre-parse
5830af0 refactor(ast): dedup symbol entries, drop speculative re-export, scaffold tree-sitter path
ec8387b chore: option-parser ellipsis + resolve i18n TODOs across build drawer
028ff98 fix(brainstorm+chat): monotonic roundCount + ReactMarkdown url allow-list
92bd673 fix(brainstorm): align externalDeps dedup + schema with skill spec
81a97db feat(ingest): real web-tree-sitter parser for TS/TSX/JS/JSX/Python/Go
```

### Tests status (end of session)
- `npx tsc --noEmit` clean (modulo pre-existing `tests/e2e/demo-sessions.spec.ts:208` `Locator.selectAll`).
- `tests/lib/brainstorm-state.test.ts` — 15/15.
- `tests/integration/brainstorm-e2e.test.ts` — 15/15.
- `tests/lib/ingest/ast-ts.test.ts` — 4/4.
- `tests/lib/ingest/ast-treesitter.test.ts` — 9/9.

---

## Brainstorm skill v2 + OptionCards UI (2026-04-15)

- `archviber-brainstorm` skill rewritten: batched WHAT/HOW/DEPS flow, externalDeps event stream, novice/expert mode, multi-select / ordered / allowCustom / allowIndifferent fields.
- Persistent per-session brainstorm state under `.archviber/brainstorm-state/<sessionId>.json`: atomic tmp+rename, Zod schema, `applyExternalDepsEvents` with periodic compaction (every 20 events), `formatStateForPrompt` prefix injection.
- OptionCards component rewrite: checkboxes, rank badges, custom text input, indifferent-mutex-with-others.
- ChatPanel `handleFormSubmission` now updates `choiceSelections` without emitting user chat bubble; route.ts accepts top-level `formSubmission`.
- Hardening: force `json:user-choice` blocks + corrected form-submission format spec.

### Commits

```
4d7f611 feat(skill): brainstorm v2 — batched WHAT/HOW/DEPS + externalDeps event stream + multi-select/ordered/allowIndifferent/allowCustom
599cc6b feat(chat): multi-select / ordered / custom / indifferent option cards for brainstorm v2
3cc374d feat(brainstorm): persistent per-session state with event compaction and prompt injection
0697faf fix(skill): force json:user-choice blocks + correct form-submission format spec
```

---

## CC-native scaffolds (2026-04-15)

- `src/lib/cc-native-scaffold.ts` — 4 scratch dirs under `%TEMP%`:
  - `archviber-cc-canvas-chat/` — brainstorm/design/iterate phases
  - `archviber-cc-build-orchestrator/` — dispatches builders + reviewers
  - `archviber-cc-builder/` — per-block builder subagent
  - `archviber-cc-reviewer/` — wave / PR reviewer
- Each scaffold ships `CLAUDE.md` + `.claude/skills/<name>/SKILL.md` (canvas action JSON, brainstorm v2, harness-gen 11-field, review-checklist 8-item).
- Persistent-agent + session-storage reliability hardening; sessions persistence API + claude-cli resolver.
- Retrying chat-fetch + rolling history compressor for long conversations.
- `SCAFFOLD_VERSION = 6` (bumped after skill v2 + force-JSON-blocks hardening).

### Commits

```
79bcb5f feat: CC-native scaffold for canvas + orchestrator + builder + reviewer agents
2dc3854 chore: persistent-agent + session-storage reliability
2d1cd11 feat: sessions persistence API + claude-cli resolver
0ed194b feat: retrying chat-fetch + rolling history compressor
```

---

## Dev preview page (2026-04-15)

- `src/app/dev/option-cards-preview/page.tsx` at `http://localhost:3000/dev/option-cards-preview`: 8 OptionCards variants for visual verification of brainstorm v2 form rendering.

### Commits

```
9ddde69 feat(dev): OptionCards preview page at /dev/option-cards-preview for brainstorm v2 verification
```

---

## Still open (end of 2026-04-15)

1. **Push** — commits on `phase1-w1-cleanup` not yet pushed (user confirmation required per CLAUDE.md).
2. Manual browser retest of carousel + rank-badge UI on `/dev/option-cards-preview` and a live brainstorm flow.
3. Cross-process mutex for brainstorm state (in-process suffices for local dev).
4. Brainstorm SHOULD-FIX not applied: features array clobber vs union-merge, roundCount regression on LLM hallucination, event log unbounded below compaction threshold.
5. N1 defense-in-depth comment on `parseAssistantControlComments`.
6. ReactMarkdown `urlTransform` explicit whitelist to `https?:` + `mailto:`.
7. Pre-existing tsc error in `tests/e2e/demo-sessions.spec.ts:208`.
