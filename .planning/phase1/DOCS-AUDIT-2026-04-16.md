# Phase 1 Docs Audit — 2026-04-16

## Summary verdict

The Phase 1 planning folder is usable, but it has clear drift: one superseded IR proposal is still presented as live, several handoff TODOs were already completed by later commits, and a few docs now contradict each other on status, routing, and naming details. The highest-risk issue is that the requested decision anchor `SESSION-HANDOFF-2026-04-16.md` does not exist, so the UID-vs-HASH selection is not stamped anywhere authoritative inside this folder yet.

## Superseded docs

- `IR-MIGRATOR-PROPOSAL-HASH.md`
  Recommended action: keep as historical design record only; add a top stamp such as `SUPERSEDED — UID selected 2026-04-16`. The user-requested pointer `SESSION-HANDOFF-2026-04-16.md` is currently missing, so the stamp should point to that handoff only after it exists, or point to this audit in the meantime.
- `W2-SPLIT-PROPOSAL-PRO.md`
  Recommended action: move to an `archive/` subdir or stamp `HISTORICAL — split proposal not adopted`. Actual execution followed the unsplit W2 track through `9ba8f46`, `d6482e8`, `722b4c9`, `07a8e2c`, `a3a4d38`.
- `W2-SPLIT-PROPOSAL-CON.md`
  Recommended action: move to `archive/` or stamp `HISTORICAL — debate closed`. It remains useful as rationale, but it no longer reflects an open planning choice.
- `PR-DRAFT-2026-04-15.md`
  Recommended action: keep, but stamp `BASELINE DRAFT — superseded in part by PR-DRAFT-2026-04-16.md` to avoid reviewers treating it as the latest branch state.

## Contradictions

- `PLAN.md:286` says `handlePersistentChat` is "already written but disabled" and that persistent chat becomes live only when "`VIBE_CHAT_PERSISTENT=1`" is flipped. `demo-runs/FINDINGS.md:11-16` says "Persistent Claude Code path is live" and "Session fix ... verified functionally through the app." Correct doc: `demo-runs/FINDINGS.md`. `PLAN.md` Hook C is stale.
- `SESSION-HANDOFF-2026-04-15.md:24` says `IR schema v1.0 + Zod validation`. `IR-SCHEMA.md:3` says `Version: 0.1.0`, and `PROGRESS.md:27` names commit `1f940c2 feat(ir): add canonical IR schema v0.1...`. Correct doc: `IR-SCHEMA.md` / `PROGRESS.md`. The handoff uses the wrong version label.
- `PROGRESS.md:7` says existing `node.id` uses `crypto.randomUUID()`. `IR-MIGRATOR-PROPOSAL-UID.md:31,45,49,308,360` says existing IDs are "nanoid-style" and that `addNode()` / `addCanvasEdge()` use `nanoid(21)`. Correct side: `PROGRESS.md`. Repo code also matches it: `src/hooks/useCanvasActions.ts:40,210` and `src/lib/store.ts:415-416` use `crypto.randomUUID()`.
- `DEEP-ANALYZE-ROUTE-TASK.md:19` says deep-analyze should use native Task because the Build blockers do not apply. `DEEP-ANALYZE-ROUTE-AGENTRUNNER.md:319-321` says "no change needed" because `PLAN.md` W3.D2 and `ORCHESTRATOR-ROUTING.md` already route deep-analyze via `agentRunner`, and that the Task recommendation is superseded. Correct side: `DEEP-ANALYZE-ROUTE-AGENTRUNNER.md`, because it aligns with `PLAN.md` and `ORCHESTRATOR-ROUTING.md`.

## Completed-but-still-listed TODOs

- `SESSION-HANDOFF-2026-04-15-evening.md:48` still lists `Tree-sitter stub — install web-tree-sitter + grammar wasm and replace parseWithStub`. Completed by `81a97db feat(ingest): real web-tree-sitter parser for TS/TSX/JS/JSX/Python/Go`.
- `PROGRESS.md:284` and `SESSION-HANDOFF-2026-04-15-evening.md:45` still list `roundCount` regression as open. Completed by `028ff98 fix(brainstorm+chat): monotonic roundCount + ReactMarkdown url allow-list`.
- `PROGRESS.md:286` and `SESSION-HANDOFF-2026-04-15-evening.md:47` still list explicit `ReactMarkdown urlTransform` allow-list as open. Completed by `028ff98 fix(brainstorm+chat): monotonic roundCount + ReactMarkdown url allow-list`.
- `PROGRESS.md:285` and `SESSION-HANDOFF-2026-04-15-evening.md:46` still list the `N1 defense-in-depth` comment on `parseAssistantControlComments` as open. Completed by `f961de8 feat(brainstorm): token-based event-log compaction + N1 security note`.
- `PROGRESS.md:281` and `SESSION-HANDOFF-2026-04-15-evening.md:42` still list `Push ... not yet pushed`. Stale per later git history: `62f09a9 Phase 1 · W1 + W2.D1-D5 + harness audit (#1)` exists after those handoffs, and `git branch -vv` now shows the current working branch is `feat/brainstorm-per-backend-prompt`, not an unpushed `phase1-w1-cleanup`.
- `SESSION-HANDOFF-2026-04-15.md:97-100` still lists brainstorm blockers around dedupe/schema mismatch and regex parsing. Completed by later commits in the provided log: `11d8df1 fix(brainstorm): regex nesting, tech_preferences deep-merge, serialized RMW` and `92bd673 fix(brainstorm): align externalDeps dedup + schema with skill spec`.

## Naming drift

- IR version naming drifts between `SESSION-HANDOFF-2026-04-15.md` (`IR schema v1.0 + Zod validation`) and the canonical spec/commits (`IR-SCHEMA.md` version `0.1.0`, commit `1f940c2 feat(ir): add canonical IR schema v0.1...`).
- Repository path casing drifts across docs: examples include `E:/claude-workspace/archviber` in `PLAN.md`, `PR-DRAFT-2026-04-16.md`, and demo artifacts vs the actual working path `E:/claude-workspace/ArchViber`. This is harmless on Windows but makes copy-paste and grep-based audits noisier.
- PR scope naming drifts between `PR-DRAFT-2026-04-15.md` (`phase1-w1-cleanup` → `master`) and `PR-DRAFT-2026-04-16.md` (`feat/brainstorm-per-backend-prompt` at HEAD `a3354b7...`). The newer draft is explicit that the older one is baseline-only, but the filenames alone do not communicate that split clearly.

## Orphans

- `PR-DRAFT-2026-04-16.md`
  Finding: no inbound references were found under `.planning/phase1`, and `git log -- .planning/phase1/PR-DRAFT-2026-04-16.md` returned no history. It currently reads like an orphan working draft.
- `demo-runs/screenshots/*.png`
  Finding: these are artifact files referenced by machine-generated JSON manifests under `demo-runs/`, but not by live planning docs. They are useful evidence, but they are not active planning documents.
- Missing anchor rather than orphan: `SESSION-HANDOFF-2026-04-16.md` is referenced by the user as the intended decision record for UID selection, but that file does not exist in `.planning/phase1`. This leaves the HASH-vs-UID decision without a local canonical pointer.

## Recommended cleanup commit plan

- Stamp superseded decision docs first: `IR-MIGRATOR-PROPOSAL-HASH.md`, both `W2-SPLIT-PROPOSAL-*.md`, and the older PR draft.
- Add or backfill `SESSION-HANDOFF-2026-04-16.md` so the UID decision has a canonical local reference.
- Prune stale open-items from `PROGRESS.md` and the two 2026-04-15 handoffs using the post-2026-04-15 commit history as source of truth.
- Normalize naming drift in one pass: IR version label, repo path casing, and "current PR draft vs baseline PR draft" wording.
- Decide whether `demo-runs/` is planning evidence or artifact storage; if it is artifact storage, move it under a clearly non-planning subtree in a later cleanup.
