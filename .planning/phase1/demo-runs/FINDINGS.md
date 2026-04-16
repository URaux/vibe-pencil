# Demo Run Findings — 2026-04-14 night session

## Environment

- Dev server: `npm run dev` running at http://localhost:3000 (Next.js webpack mode)
- Backend: `claude-code` (benefits from tonight's session fix landing)

## 1. Chat API smoke — PASS

Single-turn chat via `POST /api/chat` with minimal payload succeeded:

- Persistent CC session spawned (ccSessionId returned via SSE `session` event)
- Streaming chunk arrived, `done` event closed the stream
- End-to-end latency acceptable (~few seconds for a single short reply)

**Verdict**: chat plumbing works. Persistent Claude Code path is live. Session fix (task-mnyu9dam) verified functionally through the app, not just the isolated smoke script.

## 2. Self-import (ArchViber → ArchViber) — BUG CONFIRMED

Run: `self-import-2026-04-14T18-15-40-715Z.json`

- Scan: **18 nodes, 3 edges** in 62.5s
- Enhance: 33 progress events received, final `enhanced` payload → **0 nodes, 0 edges**
- Canvas replaced with empty state

**This reproduces the exact bug flagged in the strategic memo**: LLM enhance path completes without throwing but returns an empty canvas, silently wiping the skeleton. `ImportDialog.tsx` would then (per current code) swap canvas to empty.

## 3. Hermes-agent import (third-party Python project) — BUG CONFIRMED + SCAN COVERAGE GAP

Run: `self-import-2026-04-14T18-19-52-292Z.json` (clone of https://github.com/nousresearch/hermes-agent.git)

- Scan: **only 2 nodes, 0 edges** in 576ms
  - `container-infrastructure` container
  - `block-infrastructure-1` ("Entrypoint")
  - That's it. For a repo with acp_adapter, acp_registry, agent, batch_runner.py, cli.py, gateway, docker, docs — zero representation.
  - `scan.languages: {}` — scanner did not detect Python
  - `scan.entry_points: []`
  - `scan.directory_roles: {}`
- Enhance: 22 progress events, final `enhanced` → **0 nodes, 0 edges**

**Two distinct failures stacked**:
1. `project-scanner.ts` regex has no Python coverage path
2. Enhance path returns empty canvas (same bug as self-import)

## Why this matters for Phase 1 plan

Phase 1 W2 is specifically designed to fix this. The tree-sitter + ts-morph + graphology Louvain + LLM-only-naming pipeline replaces both of these broken stages:

- **tree-sitter** adds multi-language AST (solves Python scan coverage)
- **graphology Louvain** replaces regex-based container bucketing (solves misclassification)
- **LLM-only-for-naming** with strict Zod schema + fallback to cluster-based default names (solves the empty-canvas failure — worst case you get "Cluster A / B / C" labels, not wiped canvas)

The failures here are **evidence for** the W2 redesign, not a new problem to solve in W1.

## What's suitable as interview demo material from tonight

- Chat API smoke trace showing persistent CC session + streaming reply (useful narrative: "I fixed the persistent Claude Code session mechanism that was dying at round 3 due to stdin pipe protocol mismatch")
- Self-import failure trace with 33 progress events → empty canvas (useful narrative: "I ran reproducibility eval harness, quantified the drift, designed the W2 Ingest pipeline specifically to replace both stages")

Not suitable for demo: successful multi-session brainstorm → canvas → build-all flows. Need those when W2 Ingest is done and the canvas is actually populated from imports.

## Artifacts

- `self-import-2026-04-14T18-15-40-715Z.json` — ArchViber self-import raw trace
- `self-import-2026-04-14T18-19-52-292Z.json` — hermes-agent import raw trace
- `tests/demo/import-self-test.mjs` — reusable harness (takes `TARGET_DIR` + `BACKEND` env)
