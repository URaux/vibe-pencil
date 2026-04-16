# deep_analyze Route — AgentRunner Advocacy Brief

**Date**: 2026-04-14  
**Position**: Anti-Task devil's advocate — use AgentRunner, not CC native Task  
**Verdict**: Implement deep_analyze via AgentRunner. Do not adopt CC Task for this route.

---

## 1. Verdict

Use `AgentRunner.runDeepAnalyze()` — a thin method added to the existing `AgentRunner` class in
`src/lib/agent-runner.ts`. Analyst prompts live as Markdown templates in
`src/lib/deep-analyze/perspectives/`. The orchestrator calls a single function. Zero new
abstractions, zero CC-specific lock-in.

---

## 2. Rebuttal of Task Recommendation

NATIVE-CC-RESEARCH.md §2.2 calls Task "almost a perfect fit" for deep_analyze on the grounds
that analysis results are terminal (no SSE contract needed) and failure is graceful. These are
true statements about Task's strengths. They are also true statements about AgentRunner.
The research conflates "Task has no blockers here" with "Task is the right choice." It is not.

### 2.1 Cognitive load — one agent abstraction, not two

AgentRunner already orchestrates parallel, ephemeral subagents. Build, Modify, and deep_analyze
are all dispatched through it. Introducing CC Task for deep_analyze only means developers must
reason about two parallel-execution models living in the same codebase: AgentRunner for build,
Task for analysis. Every new contributor asks: "Why does build use process spawning but
deep_analyze uses CC Task internals?" There is no good answer. Occam's Razor cuts Task.

### 2.2 Backend lock-in is a first-class constraint

AgentRunner already supports `claude-code`, `codex`, `gemini`, and `custom-api` via
`getCommand()`. ORCHESTRATOR-ROUTING.md §4.4 explicitly says deep_analyze "reuses agentRunner."
A team running ArchViber against a Gemini backend or a self-hosted model (xiaocaseai, Ollama)
would get zero analyst coverage the moment deep_analyze is moved to Task. This is a regression,
not a polish issue. CC Task is structurally incapable of dispatching to non-Claude backends.

### 2.3 SSE streaming is not "not needed" — it is deferred

NATIVE-CC-RESEARCH.md says Task is fine because "analysis results are terminal." This is
premature closure. Users watching 5 analysts run in parallel want live heartbeat: which analyst
finished, which is still running, what did security analyst say before scalability is done.
AgentRunner already emits `output` events incrementally from each child process. The Next.js SSE
handler already consumes those events. deep_analyze with AgentRunner streams partial analyst
output to the browser the moment it arrives — at zero additional cost. With CC Task, per-analyst
streaming is structurally unavailable; the parent only gets the final file. When someone asks
"why does build stream but deep_analyze shows a spinner for 90s?" the answer will be "because we
used Task." That is the wrong answer.

### 2.4 Concurrency control stays explicit

`AgentRunner.buildAll` uses `clampMaxParallel` from `config.ts` to cap concurrent processes.
deep_analyze should participate in the same budget — 5 analyst agents + any in-flight build
agents must not exceed the user's configured cap. CC Task's internal scheduler has no
user-configurable concurrency limit exposed to the Node.js layer. The rate-limit pool becomes
opaque. AgentRunner owns the concurrency knob; keep it there.

### 2.5 Debuggability and partial failure recovery

Each AgentRunner agent produces a running `info.output` buffer readable at any time via
`getStatus()`. On partial failure (2 of 5 analysts crash), the orchestrator has the partial
output of all 5 in memory and can assemble a degraded report immediately. CC Task failure
handling (NATIVE-CC-RESEARCH §1) says "subagents continue with alternative approaches rather
than hard-aborting" — meaning the parent gets a best-effort output file, but the error path is
inside the CC black box. There is no way to inspect per-analyst intermediate output, correlate
stderr to a specific analyst, or apply custom retry logic per-perspective. AgentRunner exposes
all of this.

### 2.6 Complex input size — Task parameter limits

Each analyst receives: IR YAML (~5–20 KB for a real project), relevant `code_anchors` (file
contents or excerpts), the perspective prompt, and conversational context. The total input
prompt per analyst is conservatively 15–30 KB. CC Task receives its input as a prompt string
passed in the agent invocation. There is no documented size limit for this parameter, but the
CC Task mechanism is not designed for multi-KB structured YAML blobs. AgentRunner writes large
inputs to stdin of the child process, which is the standard Unix pattern for unbounded input.
This is not a theoretical concern — the research doc notes that "large canvas YAML + IR +
history may exceed Task parameter limits" as a risk.

### 2.7 Team/multi-user concurrency

In a team scenario, multiple users trigger deep_analyze simultaneously. CC Task dispatches into
CC's own internal scheduler, which is process-scoped to the parent CC session. Multiple
concurrent web requests cannot safely share a single CC session. AgentRunner spawns independent
OS processes — horizontally scalable, isolated per request, no shared state. The
`maxParallel` cap in `clampMaxParallel` can be set per-request or per-user if needed.

---

## 3. Implementation — deep_analyze via AgentRunner

### 3.1 New method: `AgentRunner.runDeepAnalyze`

Add to `src/lib/agent-runner.ts`:

```typescript
export interface DeepAnalyzeContext {
  requestId: string
  ir: IR
  perspectives?: PerspectiveName[]  // default: all 5
  backend: AgentBackend
  model?: string
  workDir: string
  customApiConfig?: CustomApiConfig
}

export type PerspectiveName = 'security' | 'scalability' | 'maintainability' | 'coupling' | 'testability'

export interface AnalystResult {
  perspective: PerspectiveName
  output: string
  durationMs: number
  error?: string
}

export interface DeepAnalyzeResult {
  requestId: string
  analysts: AnalystResult[]
  aggregated: string   // synthesized markdown report
  partialFailures: number
}

async runDeepAnalyze(ctx: DeepAnalyzeContext): Promise<DeepAnalyzeResult> {
  const perspectives = ctx.perspectives ?? ALL_PERSPECTIVES
  const maxParallel = clampMaxParallel(perspectives.length)
  const tmpDir = path.join(os.tmpdir(), `archviber-analyze-${ctx.requestId}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  const agentIds = perspectives.map((p) => {
    const prompt = buildAnalystPrompt(p, ctx.ir)
    const nodeId = `analyst-${p}`
    return { perspective: p, agentId: this.spawnAgent(nodeId, prompt, ctx.backend, ctx.workDir, ctx.model, ctx.customApiConfig) }
  })

  // Wait for all, collect results (don't throw on individual failures)
  const results: AnalystResult[] = await Promise.all(
    agentIds.map(async ({ perspective, agentId }) => {
      const start = Date.now()
      try {
        const info = await this.waitForAgentSafe(agentId)
        const output = info.output
        fs.writeFileSync(path.join(tmpDir, `${perspective}.md`), output)
        return { perspective, output, durationMs: Date.now() - start }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { perspective, output: '', durationMs: Date.now() - start, error }
      }
    })
  )

  const aggregated = aggregateAnalystResults(results)
  fs.rmSync(tmpDir, { recursive: true, force: true })  // ephemeral cleanup

  return {
    requestId: ctx.requestId,
    analysts: results,
    aggregated,
    partialFailures: results.filter(r => r.error).length,
  }
}
```

`waitForAgentSafe` is `waitForAgent` with a `Promise.resolve` catch path — returns
`AgentProcessInfo` with empty output on failure instead of rejecting.

### 3.2 SSE streaming during analysis

`runDeepAnalyze` does not need to return early for streaming. The route handler at
`src/app/api/agent/deep-analyze/route.ts` attaches `agentRunner` event listeners before calling
`runDeepAnalyze`, forwarding `output` events per-analyst to the SSE stream:

```typescript
const stream = new TransformStream()
const writer = stream.writable.getWriter()

runner.on('output', ({ nodeId, text }) => {
  const perspective = nodeId.replace('analyst-', '')
  writer.write(encodeSSE({ type: 'analyst_output', perspective, text }))
})

runner.runDeepAnalyze(ctx).then((result) => {
  writer.write(encodeSSE({ type: 'deep_analyze_complete', result }))
  writer.close()
})

return new Response(stream.readable, { headers: SSE_HEADERS })
```

This is the same SSE pattern used by Build today. No new infrastructure.

---

## 4. Analyst Prompt Templates

**Location**: `src/lib/deep-analyze/perspectives/`

Five files, one per perspective. Each is a Markdown prompt template with frontmatter:

```
src/lib/deep-analyze/perspectives/
  security.md
  scalability.md
  maintainability.md
  coupling.md
  testability.md
```

Template shape (example `coupling.md`):

```markdown
---
perspective: coupling
version: 1
max_output_tokens: 1200
---

You are a software architect reviewing a system for excessive coupling and hidden dependencies.

You are given an IR (Intermediate Representation) of the project architecture below.
Focus ONLY on coupling concerns. Output a structured markdown section with:
1. A severity rating (critical / high / medium / low)
2. Top 3 coupling issues with specific block/module names from the IR
3. One concrete refactor recommendation per issue

Do not repeat the IR back. Be direct. Use the block names and code_anchors as given.

## IR Summary
{{ir_summary}}

## Code Anchors (relevant excerpts)
{{code_anchors}}
```

`buildAnalystPrompt(perspective, ir)` in `src/lib/deep-analyze/prompt-builder.ts` loads the
template, substitutes `{{ir_summary}}` (via `summarizeIr`) and `{{code_anchors}}` (top-10
anchors by degree), and returns the final prompt string. No CC agent file format required.

These templates are plain Markdown — readable, diffable, editable by anyone, testable with a
single `node -e "require('./prompt-builder').buildAnalystPrompt('coupling', testIr)"`.

---

## 5. Output Aggregation

After all 5 analysts finish (or fail):

**`src/lib/deep-analyze/aggregate.ts`**

```typescript
export function aggregateAnalystResults(results: AnalystResult[]): string {
  const sections = results.map(r => {
    if (r.error) return `## ${r.perspective}\n\n_Analysis unavailable: ${r.error}_\n`
    return `## ${r.perspective}\n\n${r.output.trim()}\n`
  })

  const failed = results.filter(r => r.error).length
  const header = failed > 0
    ? `> ${failed} of 5 analyses failed. Partial report below.\n\n`
    : ''

  return `# Architecture Review\n\n${header}${sections.join('\n---\n\n')}`
}
```

No synthesis LLM call in Phase 1. The 5 sections are concatenated into a single markdown
report. A synthesis pass (one LLM call to summarize across all 5) can be added in Phase 2 as
an opt-in `synthesize: true` flag on the route. Cost-justification deferred.

Intermediate results during run are written to `/tmp/archviber-analyze-<requestId>/*.md` and
cleaned up on completion. This gives a crash-recovery path: if the Next.js process dies mid-run,
partial analyst output files survive in `/tmp` and can be recovered manually.

---

## 6. Build-Side Boundary

`AgentRunner` owns process lifecycle. `deep_analyze` and `buildAll` share the same class
instance but operate on separate `agentId` namespaces (`analyst-*` vs node IDs). The concurrency
budget they share is the `maxParallel` cap from `clampMaxParallel`. This is intentional: a
deep_analyze triggered while a build is running will compete for the same slot limit, preventing
runaway parallelism. If isolation is needed later, introduce per-operation concurrency pools
(e.g. `deep_analyze` capped at 3 of the 5 slots). That is a one-line change to
`runDeepAnalyze`.

**Build side is untouched.** `buildAll`, `spawnAgent`, `stopAll`, all existing methods are
unchanged. `runDeepAnalyze` is an additive method. The `AgentRunner` interface grows by one
method; nothing breaks.

**Orchestrator side**: `deepAnalyzeHandler` in
`src/lib/orchestrator/handlers/deep-analyze.ts` instantiates or reuses the singleton
`AgentRunner`, constructs `DeepAnalyzeContext` from the request and IR, calls
`runner.runDeepAnalyze(ctx)`, and pipes the SSE stream back. It never touches Task.

---

## 7. Estimated Implementation Cost

| Task | Hours |
|---|---|
| Write 5 analyst prompt templates | 3h (same as PLAN.md W3.D1) |
| Add `runDeepAnalyze` + `waitForAgentSafe` to `agent-runner.ts` | 2h |
| `prompt-builder.ts` + `aggregate.ts` | 2h |
| `/api/agent/deep-analyze/route.ts` with SSE wiring | 2h |
| Unit tests (prompt builder, aggregator, partial failure) | 2h |
| **Total** | **11h** |

This is identical to PLAN.md W3.D2's 4h estimate plus the 3h prompt template work — the
difference is the SSE streaming wiring (+2h) and test coverage (+2h), both of which CC Task
would also require. CC Task saves ~0h here because the "no SSE" claim is actually a deferral
of streaming support, not its elimination.

---

## 8. What Changes If We Accept This Verdict

- PLAN.md W3.D2 description is already written as "reuses agentRunner" — **no change needed**.
- ORCHESTRATOR-ROUTING.md §4.4 already says "via existing agentRunner" — **no change needed**.
- NATIVE-CC-RESEARCH.md §2.2 recommendation ("Yes, use Task for deep_analyze") is superseded by
  this document.
- No `.claude/agents/archviber-analyst-*.md` files are created.
- No dependency on CC session context, CC hooks, or CC internal scheduler.

The codebase stays on one execution model. The analyst prompts live where they belong — in the
application source tree, version-controlled, testable, backend-agnostic.
