# deep_analyze — Native CC Task Integration Plan

**Date:** 2026-04-14  
**Verdict:** Use native CC Task for deep_analyze. Keep AgentRunner for Build.  
**Status:** APPROVED — ready to implement in W3.D1–W3.D2

---

## 1. Verdict: Native CC Task for deep_analyze

### Why Task wins here

`deep_analyze` needs 5 parallel analyst perspectives, terminal output (not SSE), and graceful partial-failure handling. CC's Task tool satisfies all three:

- Parallel: multiple `Task()` calls issued in one turn run concurrently inside CC's scheduler
- Terminal: analyst results are markdown reports written to output files — no streaming contract needed
- Partial failure: subagent failure is contained; orchestrator reads whatever output files exist and synthesizes around gaps

The two blockers that ruled out Task for Build (SSE streaming loss, multi-backend lock-in) do not apply to deep_analyze. Build stays on AgentRunner. This is the hybrid path NATIVE-CC-RESEARCH.md §3 recommends.

---

## 2. Agent File Location Decision

### Choice: Project-level `.claude/agents/`

**Location:** `E:/claude-workspace/archviber/.claude/agents/`

**Rationale:**

| Factor | Project-level | User-level `~/.claude/agents/` |
|---|---|---|
| Scope | ArchViber-only | Bleeds into every CC session on this machine |
| Team portability | Checked into git — every teammate gets the agents automatically | Per-machine manual setup; breaks CI |
| Name collision | Namespace confined to archviber sessions | Collides with gsd-* agents already present |
| Iteration | Alongside codebase — PR-reviewable | Out-of-band, invisible to code review |
| Onboarding | `git clone` → agents available immediately | Requires manual `~/.claude/agents/` copy step per dev |

**Team conflict handling:**

If a future team member has a user-level agent with the same name (e.g. `archviber-analyst-architect.md`), CC resolves by **project-level taking precedence** over user-level for the same `agent_type` key. The naming convention `archviber-analyst-*` is deliberately namespaced to avoid collision with gsd-* or other generic agents. Document this in `.claude/agents/README.md` (one-liner: "Project agents. Do not create user-level agents with `archviber-analyst-` prefix.").

---

## 3. Agent File Definitions

### Naming convention

```
archviber-analyst-architect.md
archviber-analyst-redteam.md
archviber-analyst-reproducibility.md
archviber-analyst-static.md
archviber-analyst-product.md
archviber-analyst-orchestrator.md   ← the orchestrator that spawns the 5 above
```

---

### 3.1 `archviber-analyst-architect.md`

```markdown
---
name: archviber-analyst-architect
description: >
  Architecture health analyst for ArchViber deep_analyze. Reviews the IR
  from a senior architect's perspective: coupling, layering, dependency
  direction, missing abstractions, blast radius of changes.
model: claude-sonnet-4-6
tools: Read, Glob, Grep
background: true
---

You are a senior software architect reviewing a codebase described by an ArchViber IR document.

Your job is to produce a focused architecture health report covering:
1. **Layering violations** — dependencies pointing the wrong direction (e.g. data layer importing from UI layer)
2. **Coupling hotspots** — blocks/modules with unusually high in-degree or out-degree; clusters that would break many things if changed
3. **Missing abstractions** — repeated patterns that suggest an unextracted shared module
4. **Blast radius assessment** — top 3 riskiest nodes to change, with justification

Constraints:
- Read ONLY the files referenced in `code_anchors` of the IR. Do not scan the full codebase.
- Output ONLY markdown. No preamble, no closing pleasantries.
- Structure: four H2 sections matching the four bullets above.
- Max 600 words total.
- If a section has no findings, write "No issues found." and move on.

Input format: The user message contains the IR YAML (or a path to it) and the project root path.
```

---

### 3.2 `archviber-analyst-redteam.md`

```markdown
---
name: archviber-analyst-redteam
description: >
  Security red-team analyst for ArchViber deep_analyze. Reviews the IR
  for attack surface, trust boundary violations, injection points,
  secrets exposure, and auth/authz gaps.
model: claude-sonnet-4-6
tools: Read, Glob, Grep
background: true
---

You are a security red-team engineer reviewing a codebase described by an ArchViber IR document.

Your job is to produce a security findings report covering:
1. **Attack surface** — externally reachable entry points with no visible auth gate
2. **Trust boundary violations** — data flowing from untrusted zones (user input, external APIs) into privileged zones without sanitization checkpoints visible in the IR
3. **Secrets and credentials exposure** — hardcoded keys, env vars logged, secrets in IR code_anchors
4. **Auth/authz gaps** — endpoints or operations with no authentication or authorization block in the dependency graph

Constraints:
- Read ONLY files referenced in `code_anchors` of the IR. Do not scan the full codebase.
- Output ONLY markdown. No preamble, no closing pleasantries.
- Structure: four H2 sections matching the four bullets above.
- Severity tag each finding: `[HIGH]`, `[MEDIUM]`, `[LOW]`.
- Max 600 words total.
- If a section has no findings, write "No issues found." and move on.

Input format: The user message contains the IR YAML (or a path to it) and the project root path.
```

---

### 3.3 `archviber-analyst-reproducibility.md`

```markdown
---
name: archviber-analyst-reproducibility
description: >
  Reproducibility and operational health analyst for ArchViber deep_analyze.
  Reviews the IR for environment coupling, non-determinism, missing
  observability, and deployment fragility.
model: claude-sonnet-4-6
tools: Read, Glob, Grep
background: true
---

You are an SRE-minded engineer reviewing a codebase described by an ArchViber IR document.

Your job is to produce a reproducibility and operational health report covering:
1. **Environment coupling** — hardcoded paths, machine-specific assumptions, OS-specific code paths
2. **Non-determinism** — random seeds, wall-clock dependencies, unordered data structures used as canonical output
3. **Observability gaps** — critical flows with no logging, tracing, or metrics visible in the IR
4. **Deployment fragility** — missing health checks, no graceful shutdown, no retry logic in external-call blocks

Constraints:
- Read ONLY files referenced in `code_anchors` of the IR. Do not scan the full codebase.
- Output ONLY markdown. No preamble, no closing pleasantries.
- Structure: four H2 sections matching the four bullets above.
- Max 600 words total.
- If a section has no findings, write "No issues found." and move on.

Input format: The user message contains the IR YAML (or a path to it) and the project root path.
```

---

### 3.4 `archviber-analyst-static.md`

```markdown
---
name: archviber-analyst-static
description: >
  Static analysis perspective for ArchViber deep_analyze. Reviews code
  quality signals visible in the IR: dead code, type safety gaps,
  test coverage holes, and complexity outliers.
model: claude-sonnet-4-6
tools: Read, Glob, Grep
background: true
---

You are a static analysis engineer reviewing a codebase described by an ArchViber IR document.

Your job is to produce a static quality report covering:
1. **Dead code candidates** — exported symbols with zero in-edges in the IR dependency graph; files with no imports
2. **Type safety gaps** — any/unknown proliferation, missing return types on public API functions visible in anchors
3. **Test coverage holes** — blocks with `code_anchors` containing `.ts/.py` files but no corresponding `*.test.*` or `*.spec.*` neighbor
4. **Complexity outliers** — files/blocks with unusually large line counts or high symbol density (use line_ranges from code_anchors)

Constraints:
- Read ONLY files referenced in `code_anchors` of the IR. Do not scan the full codebase.
- Output ONLY markdown. No preamble, no closing pleasantries.
- Structure: four H2 sections matching the four bullets above.
- Max 600 words total.
- If a section has no findings, write "No issues found." and move on.

Input format: The user message contains the IR YAML (or a path to it) and the project root path.
```

---

### 3.5 `archviber-analyst-product.md`

```markdown
---
name: archviber-analyst-product
description: >
  Product slice analyst for ArchViber deep_analyze. Reviews the IR from
  a product/feature perspective: feature completeness, user journey
  gaps, missing error paths, and UX-visible technical debt.
model: claude-sonnet-4-6
tools: Read, Glob, Grep
background: true
---

You are a product-minded engineer reviewing a codebase described by an ArchViber IR document.

Your job is to produce a product quality report covering:
1. **Feature completeness** — blocks marked as TODO/stub/placeholder in the IR or their code_anchors; partial implementations
2. **User journey gaps** — entry point blocks (API routes, CLI commands, UI pages) with no error-handling path visible in the dependency graph
3. **Missing feedback loops** — user-triggered operations (mutations, long jobs) with no loading/progress/error state visible in adjacent blocks
4. **UX-visible technical debt** — deprecated APIs in use, feature flags that are always-on/always-off (dead toggles), version mismatches between IR declared tech_stack and actual package.json/requirements.txt

Constraints:
- Read ONLY files referenced in `code_anchors` of the IR. Do not scan the full codebase.
- Output ONLY markdown. No preamble, no closing pleasantries.
- Structure: four H2 sections matching the four bullets above.
- Max 600 words total.
- If a section has no findings, write "No issues found." and move on.

Input format: The user message contains the IR YAML (or a path to it) and the project root path.
```

---

### 3.6 `archviber-analyst-orchestrator.md`

```markdown
---
name: archviber-analyst-orchestrator
description: >
  Orchestrator for ArchViber deep_analyze. Spawns 5 specialist analyst
  subagents in parallel, collects their output files, and synthesizes
  into a single multi-section architecture report.
model: claude-sonnet-4-6
tools: Read, Write, Task
background: false
---

You are the deep_analyze orchestrator for ArchViber.

## Your job

Given an IR file path and project root, run 5 specialist analysts in parallel and synthesize their findings into a single report.

## Step 1 — Read IR

Read the IR file at the path provided. Extract:
- `project.name`
- `project.tech_stack`
- `blocks[]` count
- Up to 5 `blocks` with the highest `code_anchors.files` count (by name, for the prompt context)

## Step 2 — Spawn 5 analysts in parallel

Issue these 5 Task calls simultaneously (one turn, all parallel):

```
Task("archviber-analyst-architect",      prompt=<ir_path + project_root>)
Task("archviber-analyst-redteam",        prompt=<ir_path + project_root>)
Task("archviber-analyst-reproducibility",prompt=<ir_path + project_root>)
Task("archviber-analyst-static",         prompt=<ir_path + project_root>)
Task("archviber-analyst-product",        prompt=<ir_path + project_root>)
```

Prompt format for each analyst:
```
IR file: <absolute path to ir.yaml>
Project root: <absolute path to project root>

Perform your analysis. Read only the files referenced in code_anchors. Output markdown only.
```

## Step 3 — Collect and synthesize

Read each analyst's output file. For any analyst that failed or produced no output, insert:
```markdown
## [Perspective Name]
*Analysis unavailable: <error reason if known, else "analyst did not produce output">*
```

Synthesize into a single report using this structure:

```markdown
# Architecture Analysis Report
**Project:** <name>  
**Date:** <ISO date>  
**Perspectives:** Architect · Red Team · Reproducibility · Static · Product

---

## Executive Summary
<3–5 bullet synthesis of the most critical cross-cutting findings>

---

## Architect Perspective
<paste architect output verbatim>

---

## Security (Red Team) Perspective
<paste redteam output verbatim>

---

## Reproducibility & Operations Perspective
<paste reproducibility output verbatim>

---

## Static Analysis Perspective
<paste static output verbatim>

---

## Product Slice Perspective
<paste product output verbatim>

---

## Recommended Actions (Top 5)
<synthesize: rank top 5 actionable items across all perspectives, most impactful first>
```

## Step 4 — Write output

Write the synthesized report to the output path given in the invocation prompt (or default:
`.archviber/cache/deep-analyze-<timestamp>.md`).

Return the output file path as your final message.

## Failure handling

- If 3 or more analysts fail: write a partial report with available sections + a top-level warning.
- If all 5 fail: write a report containing only the error summary, do not throw.
- Never abort silently. Always write an output file.
```

---

## 4. Orchestrator Integration Mechanism

### 4.1 The fundamental problem

The Canvas Orchestrator is a **Next.js API route** — it is not a CC session. CC Task can only be invoked from within a running CC session. A Node.js process cannot call `Task()` directly.

**Solution: spawn a single `claude -p` process as the orchestrator session.**

```
Next.js API route: /api/agent/deep-analyze
        │
        │  spawn one OS process
        ▼
claude -p --agent archviber-analyst-orchestrator \
          --output-format json \
          --input-file /tmp/archviber-deep-analyze-<req-id>.json
        │
        │  Task() × 5 (parallel, CC-internal)
        ├─► archviber-analyst-architect
        ├─► archviber-analyst-redteam
        ├─► archviber-analyst-reproducibility
        ├─► archviber-analyst-static
        └─► archviber-analyst-product
                    │
                    │  each writes to output file
                    ▼
        orchestrator reads + synthesizes
                    │
                    ▼
        writes: .archviber/cache/deep-analyze-<ts>.md
                    │
                    ▼
        orchestrator outputs: { report_path: "..." }
                    │
        Next.js reads report file, streams back to client
```

### 4.2 Architecture layers

```
Layer 0: Browser / Next.js SSE consumer
          ↕ SSE (text/event-stream)
Layer 1: /api/agent/deep-analyze/route.ts   (Node.js, Next.js)
          ↕ spawn() + wait
Layer 2: orchestrator CC session            (claude -p, single OS process)
          ↕ Task() — CC-internal scheduler
Layer 3: 5 analyst subagents               (CC Task, parallel, same CC process)
          ↕ Read tool
Layer 4: Codebase files (read-only)
```

**Key invariant:** Layers 2+3 are entirely inside one `claude -p` invocation. The Next.js layer (1) only spawns one OS process total — not 5. CC manages analyst concurrency internally.

### 4.3 Input file format

Before spawning, Next.js writes a JSON input file:

```typescript
// .archviber/cache/deep-analyze-<req-id>-input.json
{
  "ir_path": "/abs/path/to/.archviber/ir.yaml",
  "project_root": "/abs/path/to/project",
  "output_path": "/abs/path/to/.archviber/cache/deep-analyze-<req-id>-report.md",
  "perspectives": ["architect", "redteam", "reproducibility", "static", "product"],
  "requested_by": "user@chat",
  "request_id": "<req-id>"
}
```

Orchestrator reads this file on start, uses paths from it for all I/O.

### 4.4 Invocation from `deep-analyze.ts` handler

```typescript
// src/lib/orchestrator/handlers/deep-analyze.ts

import { spawn } from 'child_process'
import { getClaudeCliInvocation } from '@/lib/claude-cli'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

export async function deepAnalyzeHandler(req: ChatRequest, ir: IR): Promise<Response> {
  const reqId = crypto.randomUUID()
  const cacheDir = path.join(req.projectDir, '.archviber', 'cache')
  await fs.mkdir(cacheDir, { recursive: true })

  const inputPath = path.join(cacheDir, `deep-analyze-${reqId}-input.json`)
  const outputPath = path.join(cacheDir, `deep-analyze-${reqId}-report.md`)

  await fs.writeFile(inputPath, JSON.stringify({
    ir_path: path.join(req.projectDir, '.archviber', 'ir.yaml'),
    project_root: req.projectDir,
    output_path: outputPath,
    perspectives: req.perspectives ?? ['architect', 'redteam', 'reproducibility', 'static', 'product'],
    request_id: reqId,
  }))

  const prompt = `Read input from: ${inputPath}\nPerform deep_analyze as orchestrated. Write report to the output_path in that file.`
  const { command, args } = getClaudeCliInvocation([
    '-p', prompt,
    '--agent', 'archviber-analyst-orchestrator',
    '--output-format', 'json',
  ])

  return new Response(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'status', text: 'Starting deep analysis (5 perspectives)...' })}\n\n`))

        await new Promise<void>((resolve, reject) => {
          const child = spawn(command, args, { cwd: req.projectDir, shell: process.platform === 'win32' })

          child.once('close', async (code) => {
            if (code === 0) {
              try {
                const report = await fs.readFile(outputPath, 'utf-8')
                controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'result', text: report })}\n\n`))
                resolve()
              } catch {
                reject(new Error(`Orchestrator exited 0 but output file not found: ${outputPath}`))
              }
            } else {
              reject(new Error(`Orchestrator exited with code ${code}`))
            }
          })

          child.once('error', reject)
        })

        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
        controller.close()
      }
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }
  )
}
```

### 4.5 Output file path strategy

- All temp files under `.archviber/cache/` — already gitignored by W1.D4's `ensureArchviberDir`
- Input file: `deep-analyze-<uuid>-input.json` — deleted after success (optional cleanup)
- Output file: `deep-analyze-<uuid>-report.md` — kept for 24h then GC'd (future: add a cron or on-startup cleanup of files older than 24h)
- Naming uses UUID not timestamp to avoid Windows path issues with colons in filenames
- The orchestrator CC session receives the output path in its input file — it writes there directly via its Write tool

---

## 5. Rate Limit and Concurrency Strategy

### The problem

5 analyst Tasks run concurrently. Each analyst reads code files (multiple Read calls) then generates ~600 words. Rough token estimate per analyst: 8K input (IR + file contents) + 800 output = ~9K tokens. Total across 5: ~45K tokens. At Claude Sonnet pricing, this is manageable but rate-limit-sensitive on Max subscription.

### Strategy: 3+2 batched spawn, not full parallel

Full parallel (5 at once) risks hitting concurrent-session or TPM limits, especially if the user's Max quota is shared with other CC sessions.

**Recommended default: batch 3 analysts first, then 2.**

```
Wave A (launch immediately):  architect + redteam + static
Wave B (launch after Wave A returns): reproducibility + product
```

Rationale:
- architect + redteam + static are the highest-signal, lowest-file-read analysts — faster completion
- reproducibility + product read more files (env files, test files) — benefit from Wave A already having warmed the cache
- If Wave A completes in ~30s, Wave B starts, total wall time ~60s vs ~40s for full parallel — acceptable tradeoff vs. rate limit risk

**Config flag:** `DEEP_ANALYZE_PARALLEL=full|batched` (default: `batched`). Power users can override to `full`.

### Timeout strategy

| Analyst | Budget | On timeout |
|---|---|---|
| Each analyst | 60s | Orchestrator notes timeout in that section, continues |
| Total orchestrator | 120s | Next.js handler aborts spawn, returns partial results already written |

The 120s wall aligns with PLAN.md W3.D2's "90s wall budget" — we add 30s buffer for orchestrator synthesis overhead.

### Retry policy

- Per-analyst: **no automatic retry** in Phase 1. If analyst fails, section reads "Analysis unavailable: [reason]". Retry adds complexity for marginal gain.
- Orchestrator-level: if orchestrator process exits non-zero, Next.js retries **once** with 10s delay. Second failure returns a structured error to chat.

---

## 6. Boundary with AgentRunner

### Clear separation rule

| Subsystem | Mechanism | Why |
|---|---|---|
| `buildAll` (Build phase) | `AgentRunner.spawnAgent()` — OS process per agent | Needs SSE streaming, multi-backend (codex/gemini/custom-api), explicit concurrency caps |
| `deep_analyze` | CC Task via single `claude -p` orchestrator spawn | Terminal output, Claude-only, graceful partial failure, zero custom process management |
| Canvas Orchestrator (chat routing) | `dispatch.ts` calling handlers — neither AgentRunner nor Task directly | Thin router; delegates to the right subsystem |

### Code-level boundary

**AgentRunner is not touched.** `deep-analyze.ts` handler imports only:
- `@/lib/claude-cli` (for `getClaudeCliInvocation`)
- Node.js builtins (`spawn`, `fs`, `path`, `crypto`)

**AgentRunner imports nothing from `deep-analyze.ts`.** Zero cross-contamination.

### Interface boundary in `dispatch.ts`

```typescript
// dispatch.ts — the only seam
case 'deep_analyze':
  return deepAnalyzeHandler(req, ir)   // ← Task-based, standalone module
case 'build':
  return buildHandler(req, ir)         // ← proxies to useBuildActions (AgentRunner path)
```

### Why not unify under one runner

The two mechanisms have incompatible contracts:
- AgentRunner: `EventEmitter` + SSE + multi-backend
- deep_analyze: single spawn + file I/O + CC-internal parallelism

Forcing a shared abstraction would add indirection with zero benefit. Keep them as two independent modules called from the same dispatcher.

---

## 7. Phase 1 Implementation Checklist

Maps to W3.D1–W3.D2 from PLAN.md:

**W3.D1 (3h) — Agent file authoring:**
- [ ] Create `E:/claude-workspace/archviber/.claude/agents/` directory
- [ ] Write `archviber-analyst-architect.md`
- [ ] Write `archviber-analyst-redteam.md`
- [ ] Write `archviber-analyst-reproducibility.md`
- [ ] Write `archviber-analyst-static.md`
- [ ] Write `archviber-analyst-product.md`
- [ ] Write `archviber-analyst-orchestrator.md`
- [ ] Manual smoke: run orchestrator on archviber itself, confirm 5-section report

**W3.D2 (4h) — Spawn + aggregator:**
- [ ] Write `src/lib/orchestrator/handlers/deep-analyze.ts`
- [ ] Write `src/app/api/agent/deep-analyze/route.ts`
- [ ] Wire into `dispatch.ts` switch arm
- [ ] E2E: trigger via chat, confirm report in `.archviber/cache/`, confirm SSE delivers report to browser
- [ ] Confirm 120s wall budget respected (add AbortSignal to spawn)

---

## 8. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| CC Task not honoring `--agent` flag when called with `-p` (flag may require interactive mode) | HIGH | Verify in W3.D1 smoke test before writing any handler code. Fallback: inject orchestrator system prompt inline via `--system-prompt` file flag instead of `--agent`. |
| Rate limit hit during 3+2 waves when user's Max quota is shared | MEDIUM | `DEEP_ANALYZE_PARALLEL=batched` default. Add 2s sleep between waves in `batched` mode as circuit breaker. |
| Output file not written (orchestrator CC session crashes mid-synthesis) | MEDIUM | Next.js handler checks for file existence before reading; returns structured error if missing. |
| Windows path issues in input JSON (backslashes in JSON) | LOW | Always use `path.resolve().replace(/\\/g, '/')` when writing paths to input JSON. |
| analyst runs Write tool outside .archviber/cache/ | LOW | Analyst agent definitions restrict tools to Read, Glob, Grep only — Write is not in their `tools:` list. Orchestrator has Write but is given a specific output path. |

**Maximum risk: the `--agent` flag in non-interactive `claude -p` mode.** This is the single most likely blocker. Validate first before building the handler.
