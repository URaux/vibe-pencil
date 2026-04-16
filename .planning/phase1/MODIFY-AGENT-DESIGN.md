# Modify Agent v0.1 — Design Spec

**Scope**: Phase 1 ships **rename only**. Intent DSL structured for move/extract/split/merge in Phase 2 with **zero breaking change**.

---

## 1. End-to-end flow

```
user message ─► orchestrator classify ─► intent=modify
                                              │
                                              ▼
                                       plan(userMsg, ir)
                                     ┌────────┴────────┐
                                     ▼                 ▼
                               Intent (rename)   ClarifyingQ → chat
                                     │
                                     ▼
                            resolve code_anchors from IR
                                     │
                                     ▼
                            codemod(intent, repo) via ts-morph
                                     │
                                     ▼
                            sandbox(diff)  [git worktree + tsc + vitest]
                                     │
                          ┌──────────┴──────────┐
                       pass                    fail
                          │                      │
                          ▼                      ▼
                 pr(diff, summary)      explain failure + suggest
                          │                      │
                          ▼                      ▼
                   return PR URL           return error message
```

All streamed to the client as SSE events (`{type: 'plan'|'diff'|'sandbox'|'pr'|'error'}`).

---

## 2. Intent DSL

`src/lib/modify/intent.ts`:

```typescript
export type ModifyIntent =
  | RenameIntent
  | MoveIntent              // Phase 2, typed in Phase 1 so handler can reject cleanly
  | ExtractIntent           // Phase 2
  | SplitIntent             // Phase 2
  | MergeIntent             // Phase 2

export interface RenameIntent {
  verb: 'rename'
  target: SymbolRef         // what to rename
  newName: string           // must be valid identifier or filename depending on target.kind
  scope?: 'file' | 'project' // default 'project'; 'file' limits rename to declaration file
  dryRun?: boolean
}

// Phase 2 stubs — handler returns "not supported in Phase 1" for these verbs
export interface MoveIntent   { verb: 'move'; target: SymbolRef; toFile: string }
export interface ExtractIntent{ verb: 'extract'; sourceFile: string; range: LineRange; newSymbolName: string; newFile?: string }
export interface SplitIntent  { verb: 'split'; blockId: string; groups: Array<{name: string; symbols: string[]}> }
export interface MergeIntent  { verb: 'merge'; blockIds: string[]; newName: string }

export interface SymbolRef {
  kind: 'file' | 'class' | 'function' | 'type' | 'variable' | 'interface' | 'enum'
  // At least ONE of:
  blockId?: string          // resolve via IR code_anchors
  filePath?: string         // repo-relative
  symbolName?: string       // if blockId given, narrows within block; if filePath given, within that file
}

export interface LineRange { file: string; start: number; end: number }
```

Rationale: all 5 verbs share shape `{verb, ...verb-specific-fields}`; classifier + planner can produce any shape, dispatcher pattern-matches on `verb`. Adding new verbs = new interface, no migration.

---

## 3. Planning (user message → Intent)

`src/lib/modify/plan.ts`:

```typescript
export async function planIntent(
  userMessage: string,
  ir: IR,
  opts: { locale: Locale; llm: LLMConfig }
): Promise<ModifyIntent | ClarifyingQuestion> {
  const systemPrompt = PLAN_SYSTEM_PROMPT              // see §3.1 below
  const userPrompt = renderPlanUser(userMessage, ir)
  const raw = await oneShot(opts.llm, systemPrompt, userPrompt, { maxTokens: 500 })
  const parsed = tryParseJson(raw)
  const intent = modifyIntentSchema.safeParse(parsed)
  if (!intent.success) return clarifyFromParseError(parsed, intent.error)

  const resolved = await resolveSymbolRef(intent.data.target, ir)
  if (!resolved) return { ask: `I couldn't find ${describe(intent.data.target)}. Which file?` }

  return { ...intent.data, target: resolved }
}
```

### 3.1 Plan system prompt (condensed)

```text
You plan code modifications for ArchViber.

INPUT: a user message + a summary of the project's IR.
OUTPUT: a single JSON object matching ModifyIntent schema. No prose.

Supported verb in v0.1: "rename".
If the user requests move/extract/split/merge, still emit the JSON — the executor
will reject it politely.

For rename:
  - target.kind: infer from context ("file" if path, "class"/"function" based on naming)
  - target.blockId OR target.filePath OR target.symbolName must be set
  - newName: exact new identifier or filename
  - scope: "project" (default) or "file"

If you cannot determine the target unambiguously, output:
  { "clarify": "question to ask the user" }

Output JSON only. No code blocks, no commentary.
```

### 3.2 Symbol resolution

`resolveSymbolRef` walks IR `code_anchors`:

```typescript
async function resolveSymbolRef(ref: SymbolRef, ir: IR): Promise<SymbolRef | null> {
  if (ref.filePath) {
    // verify file exists in some block's code_anchors.files
    for (const block of ir.blocks) {
      if (block.code_anchors.files.includes(ref.filePath)) return { ...ref, blockId: block.id }
    }
    return ref  // file not anchored yet; still valid, codemod will check disk
  }

  if (ref.blockId) {
    const block = ir.blocks.find(b => b.id === ref.blockId)
    if (!block) return null
    if (ref.symbolName) {
      const sym = block.code_anchors.symbols.find(s => s.name === ref.symbolName)
      if (!sym) return null
      return { ...ref, filePath: sym.file }
    }
    return { ...ref, filePath: block.code_anchors.primary_entry ?? block.code_anchors.files[0] }
  }

  if (ref.symbolName) {
    // project-wide search by symbol name
    const matches = ir.blocks.flatMap(b =>
      b.code_anchors.symbols.filter(s => s.name === ref.symbolName).map(s => ({block: b, sym: s}))
    )
    if (matches.length === 0) return null
    if (matches.length > 1) return null  // ambiguous → caller emits clarify
    return { ...ref, blockId: matches[0].block.id, filePath: matches[0].sym.file }
  }

  return null
}
```

---

## 4. Codemod — ts-morph rename

`src/lib/modify/codemods/rename.ts`:

```typescript
import { Project, Node, SourceFile, SyntaxKind } from 'ts-morph'
import { join } from 'path'

export interface CodemodResult {
  success: boolean
  changedFiles: string[]
  diff: string            // unified diff for PR body
  errorMessage?: string
}

export async function applyRename(
  projectRoot: string,
  intent: RenameIntent
): Promise<CodemodResult> {
  const project = new Project({
    tsConfigFilePath: join(projectRoot, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  })

  try {
    if (intent.target.kind === 'file') {
      return renameFile(project, intent)
    }
    return renameSymbol(project, intent)
  } catch (err) {
    return { success: false, changedFiles: [], diff: '', errorMessage: String(err) }
  }
}

function renameSymbol(project: Project, intent: RenameIntent): CodemodResult {
  const src = project.getSourceFile(intent.target.filePath!)
  if (!src) return fail(`File not found: ${intent.target.filePath}`)

  const declNode = findDeclaration(src, intent.target.symbolName!, intent.target.kind)
  if (!declNode) return fail(`Symbol ${intent.target.symbolName} not found in ${intent.target.filePath}`)

  // ts-morph rename: finds all references across the project, renames consistently
  declNode.rename(intent.newName)
  project.saveSync()
  return collectChanges(project)
}

function renameFile(project: Project, intent: RenameIntent): CodemodResult {
  const src = project.getSourceFile(intent.target.filePath!)
  if (!src) return fail(`File not found: ${intent.target.filePath}`)
  // move() updates all imports referencing the old path
  const newPath = join(src.getDirectory().getPath(), intent.newName)
  src.move(newPath)
  project.saveSync()
  return collectChanges(project)
}

function findDeclaration(src: SourceFile, name: string, kind: SymbolRef['kind']): Node | null {
  switch (kind) {
    case 'class':     return src.getClass(name) ?? null
    case 'function':  return src.getFunction(name) ?? null
    case 'type':      return src.getTypeAlias(name) ?? null
    case 'interface': return src.getInterface(name) ?? null
    case 'enum':      return src.getEnum(name) ?? null
    case 'variable':  return src.getVariableDeclaration(name) ?? null
    default:          return null
  }
}

function collectChanges(project: Project): CodemodResult {
  const changed = project.getSourceFiles().filter(f => !f.isSaved() || f.getFullText().length > 0)
  const diff = generateUnifiedDiff(project)  // uses `simple-git` diff on the worktree
  return { success: true, changedFiles: changed.map(f => f.getFilePath()), diff }
}
```

### Why ts-morph not a custom AST walker

ts-morph's `.rename()` internally uses TypeScript's LanguageService, which already handles:
- cross-file references via imports
- re-exports (`export { Foo }` and `export * from`)
- destructured imports (`import { Foo as Bar }`)
- JSX component usage

Hand-rolling this would take 3–5 days and still miss edge cases. Cost of ts-morph dep is justified.

---

## 5. Sandbox validation

`src/lib/modify/sandbox.ts`:

```typescript
export interface SandboxResult {
  passed: boolean
  tscOk: boolean
  vitestOk: boolean
  output: string          // combined stdout+stderr, last 10KB
  wallMs: number
}

export async function runSandbox(
  projectRoot: string,
  diff: string,
  opts: { timeoutMs?: number } = {}
): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const started = Date.now()
  const worktreeDir = join(projectRoot, '.archviber', 'sandbox', `run-${Date.now()}`)

  try {
    // 1. create git worktree at HEAD
    await execGit(projectRoot, ['worktree', 'add', '--detach', worktreeDir])

    // 2. apply diff
    await applyUnifiedDiff(worktreeDir, diff)

    // 3. run tsc --noEmit (fastest signal)
    const tscRes = await execWithTimeout('npx tsc --noEmit', worktreeDir, timeoutMs / 2)
    if (tscRes.code !== 0) {
      return finish({ passed: false, tscOk: false, vitestOk: false, output: tscRes.output, wallMs: Date.now() - started })
    }

    // 4. run vitest run (skip if no vitest config)
    if (existsSync(join(worktreeDir, 'vitest.config.ts'))) {
      const vitestRes = await execWithTimeout('npx vitest run', worktreeDir, timeoutMs / 2)
      return finish({
        passed: vitestRes.code === 0,
        tscOk: true,
        vitestOk: vitestRes.code === 0,
        output: vitestRes.output,
        wallMs: Date.now() - started,
      })
    }
    return finish({ passed: true, tscOk: true, vitestOk: true, output: tscRes.output, wallMs: Date.now() - started })

  } finally {
    await execGit(projectRoot, ['worktree', 'remove', '--force', worktreeDir]).catch(() => {})
  }
}
```

### Windows-specific notes
- Git worktrees work on Windows but fail if project is inside a junction → `project-handoff` memory mentions junction setup; sandbox path explicitly uses `.archviber/sandbox/` inside project root (same drive, no cross-junction).
- If worktree creation fails, fall back to **in-place dirty-tree rejection**: refuse to apply if `git status --porcelain` non-empty; else `git stash && apply && run && stash pop`.

---

## 6. PR generation

`src/lib/modify/pr.ts`:

```typescript
export interface PrResult {
  branchName: string
  commitSha: string
  pushedRemote?: string
  prUrl?: string          // only if `gh` CLI available & remote is GitHub
  diffSummary: string
}

export async function generatePr(
  projectRoot: string,
  diff: string,
  intent: RenameIntent,
  sandbox: SandboxResult
): Promise<PrResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const branch = `archviber/modify-${intent.verb}-${ts}`
  const commitMsg = buildCommitMessage(intent, sandbox)

  await execGit(projectRoot, ['checkout', '-b', branch])
  await applyUnifiedDiff(projectRoot, diff)
  await execGit(projectRoot, ['add', '-A'])
  await execGit(projectRoot, ['commit', '-m', commitMsg])
  const sha = (await execGit(projectRoot, ['rev-parse', 'HEAD'])).stdout.trim()

  // try to push if a remote exists
  let pushedRemote: string | undefined
  let prUrl: string | undefined
  const remotes = (await execGit(projectRoot, ['remote'])).stdout.trim().split('\n').filter(Boolean)
  if (remotes.includes('origin')) {
    try {
      await execGit(projectRoot, ['push', '-u', 'origin', branch])
      pushedRemote = 'origin'
      // try gh pr create (optional; silently skip if unavailable)
      if (await hasGhCli()) {
        const pr = await execCmd('gh', ['pr', 'create', '--title', intent.verb, '--body', commitMsg, '--draft'])
        prUrl = extractUrl(pr.stdout)
      }
    } catch { /* non-fatal */ }
  }

  // switch back
  await execGit(projectRoot, ['checkout', '-'])

  return { branchName: branch, commitSha: sha, pushedRemote, prUrl, diffSummary: summarizeDiff(diff) }
}

function buildCommitMessage(intent: RenameIntent, sandbox: SandboxResult): string {
  return [
    `refactor: rename ${describe(intent.target)} → ${intent.newName}`,
    '',
    `Verified in sandbox: tsc=${sandbox.tscOk ? 'pass' : 'fail'}, vitest=${sandbox.vitestOk ? 'pass' : 'skip'}, wall=${sandbox.wallMs}ms`,
    '',
    `Scope: ${intent.scope ?? 'project'}`,
    '',
    'Generated by ArchViber Modify Agent v0.1',
  ].join('\n')
}
```

Failure to push is **not fatal** — local branch still created, user can push manually.

---

## 7. Failure handling + explanations

Every failure point emits a user-facing message. No silent drops.

| Failure site | User sees | Next step |
|---|---|---|
| `planIntent` parse fail | "I couldn't understand the rename target. Did you mean X or Y?" | inline clarify |
| `resolveSymbolRef` not found | "Couldn't locate `FooService` in the indexed code. Is the IR up to date? Run Re-ingest." | button: Re-ingest |
| `applyRename` ts-morph throws | "Rename failed: {err.message}. This often means the symbol shadows another or crosses .d.ts boundaries." | suggest manual edit |
| `runSandbox` tsc fail | "Rename type-checks failed:\n{last 20 lines of tsc output}" | show diff anyway, ask if apply anyway |
| `runSandbox` vitest fail | "Tests broke after rename. First failure: {name}. Diff still available." | show diff, confirm |
| `generatePr` commit fails | "Couldn't commit (working tree dirty?). Stash or commit your changes first." | show git status |
| Push fails | "Local branch created ({branch}), but push to origin failed: {err}. Push manually with: git push -u origin {branch}" | — |

All failure messages go through the localizer (i18n) in W2.D10.

---

## 8. Integration surface

### API route — `src/app/api/agent/modify/route.ts`

```typescript
export async function POST(request: Request) {
  const { message, irOverride } = await request.json()
  const ir = irOverride ?? await loadIr(resolveProjectRoot())
  if (!ir) return Response.json({ error: 'No IR loaded' }, { status: 400 })

  return sse(async emit => {
    const intent = await planIntent(message, ir, { locale, llm: directApiConfig() })
    if ('ask' in intent) { emit({type:'clarify', question: intent.ask}); return }
    if (intent.verb !== 'rename') {
      emit({type:'error', error: `${intent.verb} is not supported in Phase 1; Phase 2 adds move/extract/split/merge.`})
      return
    }
    emit({type:'plan', intent})

    const codemod = await applyRename(ir.project.root, intent)
    if (!codemod.success) { emit({type:'error', error: codemod.errorMessage}); return }
    emit({type:'diff', diff: codemod.diff, files: codemod.changedFiles})

    const sandbox = await runSandbox(ir.project.root, codemod.diff)
    emit({type:'sandbox', result: sandbox})
    if (!sandbox.passed) { emit({type:'error', error: 'Sandbox failed', detail: sandbox.output.slice(-2048)}); return }

    const pr = await generatePr(ir.project.root, codemod.diff, intent, sandbox)
    emit({type:'pr', pr})

    // Append to IR audit_log
    const updated = appendAudit(ir, {actor: 'modify@0.1.0', action: 'modify', commit: pr.commitSha, summary: `rename ${describe(intent.target)} → ${intent.newName}`})
    await saveIr(ir.project.root, updated)
  })
}
```

### Client — chat panel handler
Subscribe to SSE stream, render per-event:
- `plan` → "Planning rename of X → Y…"
- `diff` → collapsible diff viewer
- `sandbox` → green/red checkmark with timing
- `pr` → clickable link + branch name
- `clarify` / `error` → inline assistant message

---

## 9. Test plan for W2.D10

1. **Unit**: `planIntent` with 5 canned prompts → exact Intent shape
2. **Unit**: `resolveSymbolRef` with ambiguous name → null
3. **Integration**: run `applyRename` on a throwaway fixture repo → verify 3 imports updated
4. **Integration**: `runSandbox` with a deliberately broken rename → `tscOk=false`
5. **E2E**: spin dev server, POST to `/api/agent/modify`, collect SSE, assert `pr.branchName` present

---

## 10. Hooks for future verbs (Phase 2 merge points)

- `move` → add `src/lib/modify/codemods/move.ts`, ts-morph `.move()` of a symbol's declaration file (uses ts-morph's `moveToDirectory` on SourceFile subset)
- `extract` → add `src/lib/modify/codemods/extract.ts`, wraps a line range into a new function/file
- `split` / `merge` → diagram-level: split a block's `code_anchors.files` across 2 blocks + update IR; no codemod required (block-metadata op only)

All four verbs reuse the same `plan → codemod → sandbox → pr` pipeline. Only `codemod` is verb-specific.
