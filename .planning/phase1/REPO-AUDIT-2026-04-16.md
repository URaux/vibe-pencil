# REPO-AUDIT-2026-04-16

## Summary verdict

Fresh-eyes verdict: the repo is in workable shape, but it still has one blocking server-side command-injection issue and a cluster of medium-severity trust-boundary / correctness problems in file-handling routes and build-state persistence. The highest-risk code is concentrated in `src/app/api/`, not the React surface. I did not find new `dangerouslySetInnerHTML` usage, user-driven `eval` execution, or obvious dead barrels in `src/lib/`; the only `eval` I found is the server-only bundler workaround in [src/lib/context-engine.ts](../../src/lib/context-engine.ts:1357). Cross-checking `.planning/phase1/` against code: the IR atomic-save claim does match `src/lib/ir/persist.ts:93-96`, and the brainstorm concurrent-writer mitigation also appears to be implemented via `updateBrainstormState(...)` in `src/app/api/chat/route.ts:109-125`.

Coverage notes by requested focus area:
- Security: one SEV1 and several SEV2 issues in route handlers; no fresh stored-XSS sink found in components.
- Correctness hot-spots: one real silent-failure bug and one concurrent-write race.
- Windows portability: one backend bootstrap drift issue plus one lower-severity path-joining issue.
- Performance cliffs: no new graph-algorithm cliff stood out in `src/lib/`; the main performance/test risk is a heavy verification test running in the default suite.
- Dead code / unused exports: no actionable dead barrel issue found beyond the intentionally narrow IR barrel.
- Test anti-patterns: one known-bad `process.chdir` pattern remains; one verification test is still too heavy for the main suite.
- Dependency hygiene: clean-machine backend bootstrapping is not reproducible from `package.json`.

## SEV1 findings (blocking or near-blocking) with fixes

- **SEV1 — PowerShell command injection in export route.** `src/app/api/project/export-code/route.ts:45-48` interpolates user-controlled `workDir` into a shell command passed to `execSync(...)`: `Compress-Archive -Path '${workDir}\\*' ...`. A path containing a single quote or PowerShell metacharacters can break out of the quoted string and execute arbitrary commands on the host. This is also Windows-shell-specific, so the route is both unsafe and non-portable.  
  **Fix:** remove shell-string construction entirely. Use a ZIP library from Node, or switch to `execFile`/`spawn` with explicit argv, `-NoProfile`, and a PowerShell script that uses `-LiteralPath`/validated paths only. Also reject non-normalized paths before archiving.

## SEV2 findings (should fix)

- **SEV2 — SSRF in skill import route.** `src/app/api/skills/add/route.ts:130-179` server-fetches any `http://` or `https://` URL supplied by the client, and the GitHub-directory path then fan-outs to additional server-side fetches. That allows the UI caller to make the server probe arbitrary internal hosts or metadata endpoints.  
  **Fix:** restrict remote imports to an allowlist (`github.com`, `raw.githubusercontent.com`, optionally `gist.githubusercontent.com`) or move arbitrary URL fetch to the client.

- **SEV2 — File-read route’s traversal guard is incorrect and the trust boundary is too wide.** `src/app/api/build/read-files/route.ts:52-75` accepts caller-supplied `workDir`, then “guards” each file with `filePath.startsWith(resolvedWorkDir)`. String-prefix checks are not a safe containment check (`/tmp/foo2` still starts with `/tmp/foo`), so sibling-prefix paths can bypass the comment’s intended traversal defense. Because `workDir` itself is also caller-controlled, the route is effectively a generic file-read primitive.  
  **Fix:** normalize to an allowed workspace root, then validate with `path.relative(root, candidate)` and reject any relative path that starts with `..` or is absolute.

- **SEV2 — Project save/load routes expose arbitrary host read/write via caller-chosen paths.** `src/app/api/project/save/route.ts:11-16`, `src/app/api/project/load/route.ts:9-13`, and `src/lib/project-store.ts:11-23` trust `dir` from the request and read/write `architect.json` there without any allowlist, root check, or prompt-time capability token. That is an unsafe IPC boundary for a browser-facing API.  
  **Fix:** restrict persistence to a known ArchViber workspace root or to previously user-approved directories, and validate paths before touching disk.

- **SEV2 — Hypothesis: `memory.json` writes can lose build summaries under parallel node completion.** `src/hooks/useAgentStatus.ts:248-259` fires one POST per completed node, while `src/app/api/project/memory/save/route.ts:37-55` does an unlocked read-modify-write merge. Two completions landing close together can both read the same old file, then whichever write finishes last drops the other node’s summary. This is the same class of race the planning notes previously called out for brainstorm state.  
  **Fix:** serialize writes per `memoryPath` (mutex/queue), or write per-node files and fold them on read, or do temp-file + rename around a locked merge step.

- **SEV2 — Autosave reports success even when the save failed.** `src/hooks/useAutoSave.ts:38-47` calls `fetch('/api/project/save', ...)` and unconditionally sets `saveState` to `'saved'` in `.finally(...)`. Network failures and HTTP 500s therefore look like successful saves, which is a correctness bug and makes data loss harder to spot.  
  **Fix:** check `res.ok`, treat rejected fetches / non-2xx as `'error'`, and only transition to `'saved'` on confirmed success.

- **SEV2 — Backend bootstrap is not reproducible from committed dependencies.** `src/lib/agent-runner.ts:53-61` and `src/lib/agent-runner.ts:86-97` fall back to `E:/tools/npm-global/...` for Gemini and Codex CLIs. `package.json:14-47` does not declare `@google/gemini-cli` or `@openai/codex`, so a clean checkout cannot reproduce those backends from the lockfile and instead depends on a machine-specific global path.  
  **Fix:** either vendor/declare the CLIs in `package.json` or fail fast with an explicit prerequisite check instead of silently depending on `E:/tools/npm-global`.

- **SEV2 — The default test suite still includes a heavy real-repo verification test with tight timing assertions.** `package.json:11-12` runs `vitest run` for the main test command, `vitest.config.ts:5-10` does not exclude verification tests, and `tests/lib/ingest/facts-verify-real.test.ts:22-98` parses the real repo, writes a cache file, and asserts a `<100ms` hot-hit budget. That is a predictable flake/performance trap for routine CI and local runs.  
  **Fix:** move verification tests behind a separate script/tag (`test:verify-real`), or exclude them from the default Vitest run.

## SEV3 findings (nits, defer OK)

- **SEV3 — Known-bad global CWD mutation is still in the suite.** `tests/integration/brainstorm-e2e.test.ts:65-82` uses `process.chdir(...)` in `beforeEach`/`afterEach`. That pattern leaks across concurrent tests and is already called out as broken in your task brief.  
  **Fix:** inject the root path into the code under test or run that coverage in a subprocess.

- **SEV3 — Skipped real-API test has no tracking reference.** `tests/lib/ingest/name-verify-real.test.ts:16-18` is permanently skipped unless an env var is present, but the file does not link to a ticket/script boundary explaining when it should run.  
  **Fix:** move it under an explicit verification script or annotate it with a tracking issue / owner.

- **SEV3 — Windows path construction is done with string concatenation.** `src/hooks/useAgentStatus.ts:19-20` returns ``${workDir}/${toProjectSlug(projectName)}`` instead of `path.join(...)`. This usually works on Windows, but it is brittle around UNC roots and makes portability hygiene worse than the rest of the repo’s path handling.  
  **Fix:** use `path.join` on the server side or a shared path helper.

- **SEV3 — Build-summary extraction failures disappear without any breadcrumb.** `src/app/api/agent/stream/route.ts:125-127` swallows `extractBuildSummary(...)` failures completely. When summaries stop appearing, there is no node/agent-level trace to debug the failure.  
  **Fix:** log a bounded warning with `agentId`/`nodeId` and the error message before continuing.

- **SEV3 — External IR watcher’s dirty heuristic is too broad.** `src/components/IrExternalWatcher.tsx:117-124` treats any non-empty canvas as “dirty”, even if the canvas exactly matches disk and nothing is unsaved. That over-promotes benign external edits into the destructive conflict dialog path.  
  **Fix:** compare against the autosave subsystem’s real dirty flag / last-saved revision instead of `nodes.length > 0 || edges.length > 0`.

## Positive notes

The repo is notably stronger than a typical fast-moving prototype in a few places: the prior stored-XSS path in option rendering appears to have been removed cleanly (`src/components/OptionCards.tsx:57-88` now renders React elements only), IR persistence really is temp-file + rename (`src/lib/ir/persist.ts:93-96`), and the chat route’s brainstorm-state persistence now rebases updates through `updateBrainstormState(...)` instead of blindly last-write-wins (`src/app/api/chat/route.ts:113-125`). Those are the kinds of fixes that usually get missed in early-stage apps.

## Recommended follow-up commits

- Replace `/api/project/export-code` shelling with a no-shell archiver path and add regression tests for quotes/spaces in `workDir`.
- Put hard path allowlists/capability checks around all disk-touching API routes (`project/*`, `build/read-files`, `project/memory/*`).
- Split verification tests out of the default Vitest suite and give them explicit scripts.
- Add per-file/per-session write serialization for `memory.json` and any other read-modify-write JSON stores.
- Make autosave/reporting paths surface real failure state instead of silently returning to “saved”.
- Decide whether Codex/Gemini CLIs are first-class repo dependencies or external prerequisites, then encode that decision in `package.json` plus startup checks.
