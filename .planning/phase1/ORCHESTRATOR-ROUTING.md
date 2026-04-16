# Canvas Orchestrator — Routing Layer Spec (Phase 1)

**Scope**: sit in front of `POST /api/chat/route.ts`, classify user intent into one of 5 routes, dispatch. Default **stateless** (one classifier call per request). Persistent mode pluggable via env flag when upstream session fix lands.

---

## 1. Five routes

| Intent | Handler | Canonical user phrasings |
|---|---|---|
| `design_edit` | existing chat flow with canvas-action skill (unchanged from today) | "add a block for auth", "connect Canvas to Store", "change container color" |
| `build` | `useBuildActions.buildAll / buildNode / buildSelected` (unchanged) | "build this", "implement Wave 1", "run build" |
| `modify` | new — Modify agent (see MODIFY-AGENT-DESIGN.md) | "rename FooService to BarService", "refactor X" (rename-only in Phase 1) |
| `deep_analyze` | new — ephemeral 5-perspective agent pool | "review the architecture", "any coupling issues?", "security audit" |
| `explain` | fallback — plain chat, no tool calls, read-only on IR | "what does this do?", "summarize", anything ambiguous |

---

## 2. Routing decision flow

```
user message ──► IR loaded? ──no──► explain
                     │yes
                     ▼
              classifier LLM call (300 tok, direct API)
                     │
                     ▼
              {intent, confidence, reason}
                     │
       ┌─────────┬──-─┼────────┬──────────┐
       ▼         ▼    ▼        ▼          ▼
   design_edit build modify deep_analyze explain
       │                │
       ▼                ▼
  (existing path)  sandbox+PR
                   pipeline

  if confidence < 0.7:
    → ask clarifying Q inline, don't dispatch
  if classifier fails (network/parse):
    → explain (logged as fallback)
```

Pseudocode:

```typescript
// src/lib/orchestrator/dispatch.ts
export async function dispatch(req: ChatRequest): Promise<Response> {
  const ir = await tryLoadIrForRequest(req)           // may be null for untyped prompts
  if (!ir) return explainHandler(req, null)

  const verdict = await classify(req.message, {
    irSummary: summarizeIr(ir, { maxTokens: 600 }),
    lastIntent: req.lastIntent,                        // soft hint, not authoritative
    locale: req.locale,
  })

  await logRouting(verdict, req)

  if (verdict.confidence < 0.7) {
    return clarifyHandler(req, verdict)                // streams: "Did you want to X or Y?"
  }

  switch (verdict.intent) {
    case 'design_edit':  return designEditHandler(req, ir)    // current /api/chat path
    case 'build':        return buildHandler(req, ir)         // proxies to /api/agent/spawn
    case 'modify':       return modifyHandler(req, ir)        // new: /api/agent/modify
    case 'deep_analyze': return deepAnalyzeHandler(req, ir)   // new: /api/agent/deep-analyze
    case 'explain':
    default:             return explainHandler(req, ir)
  }
}
```

---

## 3. Classifier prompt (single LLM call)

**Model**: cheap (deepseek-chat or claude-haiku). Max 300 output tokens. No tools. System prompt + user message only.

```text
# System
You are the intent classifier for ArchViber, a visual architecture editor.
Given a user message and a short summary of the current architecture, output ONLY a JSON
object matching this shape:

  {
    "intent": "design_edit" | "build" | "modify" | "deep_analyze" | "explain",
    "confidence": 0.0..1.0,
    "reason": "one short sentence"
  }

Definitions:
- design_edit: user wants to add/remove/modify diagram blocks, containers, or edges.
  Examples: "add an auth block", "connect X to Y", "rename the container".
- build: user wants to generate/write code for one or more blocks.
  Examples: "build this", "implement wave 2", "regenerate the API".
- modify: user wants to refactor EXISTING code (not the diagram) — rename, move,
  extract. In Phase 1 only RENAME is supported; treat move/extract/split/merge as
  modify with low confidence so the runtime can ask.
  Examples: "rename FooService to BarService", "refactor X.ts".
- deep_analyze: user wants a review/audit of architecture or code quality.
  Examples: "review the architecture", "any coupling issues?", "security audit".
- explain: information-only. User wants to understand something.
  Examples: "what does Canvas do?", "summarize the design".

Rules:
- If ambiguous between design_edit and modify: if the user refers to code identifiers
  (camelCase, file.ts, ClassName), prefer modify. If they refer to diagram entities
  (block/container names, "the API layer"), prefer design_edit.
- If the user asks "how" or "why" without imperative verbs, output explain.
- Output ONLY the JSON, no markdown, no prose.

# User
Message: "{user_message}"

Current architecture summary:
{ir_summary}

Last intent in session: {last_intent_or_none}
```

### IR summary shape (≤ 600 tokens)

```
project: ArchViber (typescript, nextjs,react)
containers: Frontend[blue], Core Libraries[purple], API Layer[green], Data Layer[amber]
blocks (17): Canvas Editor, Node Palette, Store, Context Engine, Schema Engine, ...
recent actions: 2026-04-14 import (412 files)
```

Generated by `summarizeIr(ir, {maxTokens})` — truncate blocks list to top 15 by degree.

### Output JSON schema (Zod validated)

```typescript
const verdictSchema = z.object({
  intent: z.enum(['design_edit', 'build', 'modify', 'deep_analyze', 'explain']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(200),
})
```

Parse failure → treat as `{intent: 'explain', confidence: 0.3, reason: 'classifier parse failed'}` and log.

---

## 4. Per-route dispatch logic

### 4.1 `design_edit`
- **Unchanged path**. Calls `handleDirectApiChat` / `handleCustomApiChat` / one-shot spawn as today, loading canvas-action skill, returns SSE stream.
- **IR interaction**: read IR summary into system prompt (addition). Actions emitted are applied via existing `canvas-action-types.ts` flow, then converted through `schemaDocumentToIr` before save.

### 4.2 `build`
- Dispatcher does NOT run build itself. Returns an event `{type:'build_proposal', waves, nodeIds}` to the client, which calls the existing `useBuildActions` helper. This keeps Build untouched as Phase 1 goals require.
- If LLM produced a natural-language build description (e.g. "build the API layer"), dispatcher computes the target node set (container children) and passes to client.

### 4.3 `modify`
- POSTs to new `/api/agent/modify` with `{intent: parsedIntent, ir}`.
- See MODIFY-AGENT-DESIGN.md §4 for the handler's internals.
- Streams plan → codemod diff → sandbox result → PR URL back to client.

### 4.4 `deep_analyze`
- POSTs to new `/api/agent/deep-analyze` with `{ir, perspectives?: string[]}` (default all 5).
- Handler spawns 5 agents in parallel (via existing `agentRunner`), each with one perspective prompt + relevant `code_anchors`. Reuses `maxParallel` from config.
- Streams per-perspective partial → final aggregated markdown.
- **Ephemeral**: no state written anywhere. Results flow back to chat as an assistant message; user can save manually if desired.

### 4.5 `explain`
- Plain chat, read-only. No skill injection. System prompt = "You are ArchViber explainer. Answer using only the IR summary and any referenced code_anchors file contents. Do not propose edits."
- Used as fallback for parse failures and low-confidence classifier output.

### 4.6 `clarify`
- Not a real route — a response shape. When confidence < 0.7, dispatcher streams:
  ```
  I'm not sure whether you want to {top_2_intents[0]} or {top_2_intents[1]}.
  Could you confirm? For example: "yes, rename the file" or "no, just explain it".
  ```
- User reply re-enters dispatch with `lastIntent` hint.

---

## 5. Compatibility changes to `src/app/api/chat/route.ts`

Current route flow (see lines 419–518):
```
POST → custom-api? → handleCustomApiChat
     → directConfig? → handleDirectApiChat
     → one-shot CLI spawn
```

Phase 1 change — introduce dispatcher in front, **feature-flagged**:

```typescript
// src/app/api/chat/route.ts (additions)
import { dispatch } from '@/lib/orchestrator/dispatch'

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  if (!payload.message?.trim()) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }

  // NEW: orchestrator gate — default ON after W3.D10 smoke; env-overridable
  const orchestratorEnabled = process.env.VIBE_ORCHESTRATOR !== '0'
  if (orchestratorEnabled) {
    try {
      return await dispatch(payload, request.signal)
    } catch (err) {
      console.warn('[orchestrator] fallthrough:', err)
      // fall through to legacy path
    }
  }

  // ... existing code unchanged ...
}
```

### Minimal-touch principle

- Do NOT rewrite `handleDirectApiChat` / `handleCustomApiChat` / `handlePersistentChat`. They become the implementation of the `design_edit` / `explain` routes and are called by dispatcher when those routes fire.
- `buildSystemContext` gains one optional param `orchestratorIntent?: Intent` — when set, adds a short line "You are handling intent=<intent>" to the system prompt. Backward-compatible.

### New files introduced

```
src/lib/orchestrator/
  classify.ts       // LLM call + Zod validation
  dispatch.ts       // switch + handlers-map
  handlers/
    design-edit.ts  // thin wrapper over existing handleDirectApiChat / handleCustomApiChat
    build.ts        // emits build_proposal SSE event
    modify.ts       // POSTs to /api/agent/modify
    deep-analyze.ts // POSTs to /api/agent/deep-analyze
    explain.ts      // plain LLM call, no tools
  summarize.ts      // IR → 600-token summary
  log.ts            // JSONL writer to .archviber/cache/classifier-log.jsonl

src/app/api/agent/modify/route.ts       // new — Phase 1
src/app/api/agent/deep-analyze/route.ts // new — Phase 1
```

---

## 6. Failure modes

| Failure | Behavior | Log |
|---|---|---|
| Classifier LLM timeout | 3s timeout → explain, confidence=0.3 | `classifier-log.jsonl` with `error: 'timeout'` |
| Classifier JSON parse fail | explain, confidence=0.3 | raw text captured in log |
| Classifier returns invalid intent | explain | log |
| Handler throws | surface error to chat, don't crash route | stack to console |
| `modify` handler rejects (no ts-morph match) | return explain-style message with ts-morph error + suggest manual fix | log |
| `deep_analyze` all 5 agents fail | return partial report: "Analysis unavailable: {errors}" | log |
| No IR present (brand-new project) | All intents except `design_edit` & `explain` → nudge: "Import a project or create blocks first." | — |

---

## 7. Hooks for parallel-research merges (待调研结论合并)

### Hook A — Native CC Task
If parallel research confirms native CC Task usability:
- `dispatch.ts` switch arms become 1-line `await ccTask('{intent-name}', {ir, request})` calls
- Eliminates custom subprocess handling in handlers for `modify` and `deep_analyze`
- Est. retrofit: 4h

### Hook B — Skill passthrough
If skill passthrough becomes viable:
- Add 6th intent `skill_invoke` to classifier enum
- Classifier output `{intent: 'skill_invoke', skill_name: 'telegram-reply-style', args: '...'}`
- Dispatcher adds a branch that shells out to the skill
- Est. retrofit: 2h; requires classifier prompt update + allowlist of skills

### Hook C — Persistent session
If persistent-session fix ships:
- `design_edit` and `explain` handlers gain `if (process.env.VIBE_CHAT_PERSISTENT === '1') return handlePersistentChat(...)` preamble
- Already written at `src/app/api/chat/route.ts:324` (currently commented out at 441)
- Est. retrofit: 30m (uncomment + env toggle)

---

## 8. Telemetry for Phase 1

`.archviber/cache/classifier-log.jsonl` — one line per request:

```json
{"ts":"2026-04-14T14:23:45Z","message_hash":"a1b2...","intent":"modify","confidence":0.88,"reason":"user references FooService","wall_ms":412,"ir_blocks":17}
```

Used by eval harness (W3.D8) to compute classifier accuracy against golden labels.
