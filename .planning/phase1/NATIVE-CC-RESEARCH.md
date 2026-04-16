# Native CC Task Tool Feasibility Report

**Date:** 2026-04-14  
**Scope:** Can ArchViber replace its custom AgentRunner with Claude Code's native Task/subagent system?

---

## 1. CC Task Tool — Verified Facts

CC's Task tool (internally `TaskCreate`, formerly seen as `TaskOutput`) is a **first-class tool** available inside any `claude -p` / interactive session. Key facts extracted from changelog and session metadata:

- **Invocation:** The parent agent calls `Task(prompt, agent_type?)` from within a running CC session. The subagent runs in the same CC process context, not as a separate OS process.
- **Concurrency:** Multiple Task calls can be issued in the same turn. CC runs them in parallel within its internal scheduler — this is exactly the mechanism used in this session's "6 brainstorm agents" pattern.
- **Output retrieval:** Result is written to a file path; parent reads via `Read` tool. `TaskOutput` tool is deprecated. Token count, tool uses, and duration are included in results.
- **agent_type:** Agents defined in `~/.claude/agents/*.md` (or project `.claude/agents/`) can be referenced as `Task(agent_type)`. Agent definitions support `background: true`, `isolation: "worktree"`, `model:`, `tools:` filtering, and `memory:` scope.
- **Restriction syntax:** Agent frontmatter `tools:` can use `Task(agent_type)` notation to restrict which sub-agent types a given agent is allowed to spawn — composable sandboxing.
- **Hooks:** `TaskCreated` (blocking, fires before the task runs), `TaskCompleted`, `TeammateIdle` hooks exist for lifecycle management.
- **Failure handling:** Subagents that hit permission denial continue with alternative approaches rather than hard-aborting (recent improvement). Error blast radius is contained to the subagent's turn; the parent can read the output file and decide.
- **Billing:** Task calls are issued from within the parent CC session. CC uses the **same OAuth/subscription** as the parent — no separate API key, no separate billing line per subagent. However each subagent turn consumes its own input+output tokens against the same rate-limit pool.
- **Prefix cache:** Subagents share the parent's prompt cache tier. The system prompt injected by CC (including CLAUDE.md) is re-used across subagent calls in the same session, giving meaningful cache hits on repeated large-context builds.

**What Task cannot do natively:**
- Switch backend (Codex, Gemini, custom-api) — locked to Claude/CC
- Expose raw SSE to a third-party consumer (Next.js SSE route)
- Report per-subagent progress incrementally to the calling Next.js API route while still running

---

## 2. Scenario Analysis

### 2.1 Build Phase (`AgentRunner.buildAll` → wave-based parallel spawn)

**Current:** Next.js API spawns N `claude -p --output-format stream-json` child processes per wave. Each is an independent OS process. SSE events stream to the browser.

**If replaced with Task:**  
The orchestrator would be a single `claude -p` session that issues concurrent `Task()` calls per wave. CC manages the parallel execution internally.

**Feasibility: Partial / Not recommended for Phase 1**

Blockers:
1. **SSE bridge gap.** ArchViber's frontend relies on real-time per-agent SSE output (`output` events with incremental text). CC's Task tool writes final output to a file; there is no streaming output path from subagent to the Next.js SSE handler during execution. Rebuilding this streaming contract is significant scope.
2. **Backend lock-in.** `buildAll` currently supports claude-code / codex / gemini / custom-api. Replacing with Task drops codex/gemini/custom-api silently. This is a hard regression against the multi-backend design.
3. **Concurrency control.** `config.ts` caps at 5 parallel agents (`clampMaxParallel`). CC's own internal scheduler does not expose a user-configurable concurrency cap. Rate limit pooling becomes opaque.
4. **Net gain is low.** The existing `spawn()` approach is 80 lines of well-understood code. Task would replace it with a CC-internal mechanism that is harder to debug and monitor from outside.

Upside: Prefix cache reuse across wave agents would be genuine. But this is achievable today by pre-warming with `--resume` across spawns.

### 2.2 `deep_analyze` / Expert Squad (ephemeral multi-agent analysis)

**Current need:** Spawn 5-6 specialized analyst agents in parallel, synthesize results.

**If replaced with Task:**  
This maps almost perfectly onto CC's Task model. The orchestrator `claude -p` calls `Task(gsd-researcher)` × N in parallel, collects output file paths, synthesizes. No SSE streaming needed — analysis results are terminal.

**Feasibility: High — recommended**

- No SSE contract needed; synthesis happens inside the same CC session
- `agent_type` maps cleanly to ArchViber's analyst roles (security, scalability, data-flow, etc.)
- Failure handling is graceful: if one analyst fails, the orchestrator reads partial output and continues
- Token overhead: each analyst subagent gets its own context window, but the parent's cache hit on the shared canvas YAML amortizes the cost

Action: Define `archviber-analyst-*.md` agent files. The orchestrator prompt becomes a pure CC `claude -p` call that internally fans out with `Task()` and returns a synthesized result. Zero OS-process management code needed.

### 2.3 Canvas Orchestrator (persistent session, long-lived orchestrator)

**Current:** `PersistentAgent` class keeps a `claude` child process alive for 5 minutes, relays messages via stdin/stdout stream-json.

**If replaced with Task:**  
The persistent session *is already* a native CC session. The question is whether that session should use `Task()` to dispatch sub-analysis. This is orthogonal to the persistence fix — a persistent CC session can call `Task()` at any point.

**Feasibility: Compatible, but not a direct replacement**

- The "persistent session" concept (session kept warm between user turns) is not a CC Task — it is a long-running CC interactive session. CC does not natively expose an HTTP-callable persistent session to a Next.js server; `PersistentAgent.ts` is the correct bridge layer.
- However, *within* that persistent session, multi-step orchestration (e.g., "analyze this node then suggest refactor") can use `Task()` to fan out without spawning additional OS processes.
- Fixing the persistent session reliability problem (5-minute idle kill, stdin fragility) is a separate issue from Task adoption.

---

## 3. Recommendation

| Scenario | Adopt Task? | Reasoning |
|---|---|---|
| `buildAll` multi-wave | No (Phase 1) | SSE streaming loss + backend lock-in are blockers |
| `deep_analyze` expert squad | Yes | Clean fit; no streaming needed; eliminates spawn boilerplate |
| Canvas orchestrator persistence | No (orthogonal) | Persistence problem ≠ Task problem; can layer Task inside later |

**Hybrid path:** Keep `AgentRunner` for build. Add a dedicated `analyzeWithExperts()` function that calls `claude -p` once with a Task-dispatching system prompt, collecting analyst results. This adds CC Task benefits where they fit without touching the SSE pipeline or multi-backend support.

### Phase 1 Impact

Phase 1 plans that involve deep analysis or "brainstorm" steps should be authored as CC Task orchestrators (agent `.md` files + a single orchestrator prompt). Build plans remain on the existing `AgentRunner` path. Estimated scope change: +0.5 days to define analyst agent `.md` files; no changes to `agent-runner.ts` or the SSE pipeline.

---

## Summary

CC's Task tool is **real, concurrent, and production-ready** within a CC session. It is the right primitive for analysis/synthesis workloads where the output is a final document, not a stream. For ArchViber's build phase — which depends on per-agent SSE streaming, multi-backend support, and explicit concurrency caps — the existing OS-process model is simpler and more capable. The smart move is a targeted hybrid: adopt Task for `deep_analyze`-style expert squads, preserve `AgentRunner` for build.
