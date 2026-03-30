# Agent Harness — Design Spec

## Overview

Transform Vibe Pencil's agent execution from raw CLI spawning into a structured multi-level agent orchestration system with identity, skills, isolation, and run tracking.

## Agent Levels

MVP: two levels only. Container level deferred until real pain emerges.

### Project-Level Agent
- **Identity:** Project manager / architect. Full canvas visibility.
- **workDir:** `config.workDir` (project root)
- **Skills:** core + architect (fixed)
- **Runs as:** Prologue before wave execution (not inside buildAll waves)
- **Purpose:** Decompose goals, coordinate modules, make architecture decisions

### Module-Level Agent
- **Identity:** Implementer. Focused on a single block node.
- **workDir:** `config.workDir/<containerName>/<moduleName>` (resolved from canvas hierarchy)
- **Skills:** core + node-specified skills (configurable per node)
- **Runs as:** Inside buildAll waves (existing topological sort)
- **Purpose:** Write code for a specific component

## Isolation Strategy

**Directory-based isolation + wave-ordered sequencing.**

### resolveWorkDir

```typescript
function resolveWorkDir(
  node: Node<CanvasNodeData>,
  allNodes: Node<CanvasNodeData>[],
  baseDir: string
): string {
  if (node.type === 'container') {
    return path.join(baseDir, sanitizeName(node.data.name))
  }
  // block node — find parent container
  const parent = node.parentId ? allNodes.find(n => n.id === node.parentId) : null
  if (parent) {
    return path.join(baseDir, sanitizeName(parent.data.name), sanitizeName(node.data.name))
  }
  return path.join(baseDir, sanitizeName(node.data.name))
}
```

### buildAll Signature Change

```typescript
// Before:
buildAll(waves, prompts, backend, workDir, maxParallel, model)

// After:
buildAll(waves, prompts, backend, workDirs: Map<string, string>, maxParallel, model)
```

Each node gets its own resolved workDir. The `/api/agent/spawn` route and `useBuildActions` hook updated accordingly.

### Wave Information Passing

After each wave completes, collect a change summary (list of modified files from agent output) and inject into the next wave's dynamic prompt as context. Cheap, no new infrastructure — just string concatenation.

### Post-Wave Gate

After each wave, optionally run a lint/typecheck command (configurable). If it fails, halt the build and report errors. Default: skip (no gate configured).

## Prompt Architecture

**Hybrid: config files (static) + prompt (dynamic)**

### Static Config (written to workDir before spawn)

For each agent run, write config to a run-scoped path:

```
<workDir>/.vibe-agent/<runId>/
  CLAUDE.md       — for Claude Code
  AGENTS.md       — for Codex
  GEMINI.md       — for Gemini CLI
```

Contents assembled by merging skills:

```markdown
# Agent Identity

You are a [level] agent for the [projectName] project.
Role: [persona description]

# Skills

[concatenated skill markdown files]

# Constraints

- Only modify files within your working directory
- [level-specific constraints]
```

The agent is spawned with `cwd` set to the run-scoped path (which contains the config file). The actual project files are referenced via absolute paths in the prompt.

**Alternative (simpler MVP):** Write config directly to workDir as `CLAUDE.md`. Accept the overwrite risk since waves are sequential (no concurrent agents in same directory within a wave). Add run-scoped paths in v2 if concurrency becomes an issue.

### Dynamic Prompt (passed via stdin/args)

```
Task: [specific instruction]
Context:
  - Full canvas YAML
  - Target node details (name, description, techStack)
  - Previous wave results (changed files, summaries)
Output: Implement the code. Keep changes focused on [target].
```

## Skill Library

### Directory Structure

```
skills/
  core/
    code-style.md         — coding conventions
    error-handling.md     — error handling patterns
  architect/
    planning.md           — requirement decomposition
    architecture.md       — system design principles
  frontend/
    react-patterns.md     — React best practices
    tailwind.md           — Tailwind CSS conventions
  backend/
    api-design.md         — REST API conventions
    database.md           — database patterns
  testing/
    tdd.md                — test-driven development
    vitest.md             — Vitest configuration
```

### Skill Assignment

Container and block nodes gain a `skills` field in their data:

```typescript
interface BlockNodeData {
  // ... existing fields
  skills?: string[]  // e.g. ["frontend", "testing"]
}

interface ContainerNodeData {
  // ... existing fields
  skills?: string[]  // inherited by child blocks unless overridden
}
```

### Skill Resolution

```typescript
function resolveSkills(node, allNodes): string[] {
  const nodeSkills = node.data.skills ?? []
  // Inherit from parent container if block has no skills specified
  if (node.type === 'block' && nodeSkills.length === 0 && node.parentId) {
    const parent = allNodes.find(n => n.id === node.parentId)
    return ['core', ...(parent?.data.skills ?? [])]
  }
  return ['core', ...nodeSkills]
}
```

### Skill Merging

```typescript
async function mergeSkills(categories: string[]): Promise<string> {
  const sections: string[] = []
  for (const category of categories) {
    const dir = path.join(SKILLS_DIR, category)
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      sections.push(fs.readFileSync(path.join(dir, file), 'utf-8'))
    }
  }
  return sections.join('\n\n---\n\n')
}
```

Skills are merged server-side in the `/api/agent/spawn` route. Never sent to client.

### Skill UI

In the node edit dialog, add a multi-select for skill categories. Shows available categories from the `skills/` directory. Stored in node data.

## AgentRun Record

Track each agent execution for observability:

```typescript
interface AgentRun {
  runId: string
  nodeId: string
  level: 'project' | 'module'
  parentRunId?: string      // project run that spawned this module run
  backend: AgentBackend
  model?: string
  workDir: string
  skillSet: string[]        // resolved skill categories
  status: 'running' | 'done' | 'error'
  startedAt: string
  completedAt?: string
  changedFiles?: string[]   // extracted from agent output
  exitCode?: number | null
}
```

Stored in memory (Map) on AgentRunner. Not persisted to disk in MVP. Accessible via a new `/api/agent/runs` GET endpoint for the dashboard to show build history.

## Per-Session Backend Memory

```typescript
interface ChatSession {
  // ... existing fields
  backend?: AgentBackend    // last-used backend for this session
  model?: string            // last-used model for this session
}
```

On `switchChatSession`: if the target session has a stored backend/model, apply it to config. On manual backend/model change: update current session's record.

New sessions inherit global default (no backend field set).

## Spawn Flow (Complete)

```
1. Determine agent level (project or module)
2. resolveWorkDir(node, allNodes, config.workDir)
3. mkdir -p workDir
4. resolveSkills(node, allNodes) → skill categories
5. mergeSkills(categories) → skill markdown
6. Write CLAUDE.md/AGENTS.md/GEMINI.md to workDir
7. Generate dynamic prompt (task + context + previous wave results)
8. spawnAgent(nodeId, prompt, backend, workDir, model)
9. Track as AgentRun
10. On completion: extract changed files, pass to next wave
11. Post-wave gate (optional lint/typecheck)
```

## Build All Flow (Updated)

```
1. Project-level prologue (optional — if project agent is configured)
   - Spawn project agent with full canvas context
   - Wait for completion
   - Extract architecture decisions / file structure plan
2. For each wave:
   a. Resolve workDirs for all nodes in wave
   b. Write config files to each workDir
   c. Generate prompts (include previous wave results)
   d. Spawn agents in parallel (up to maxParallel)
   e. Wait for wave completion
   f. Collect change summaries
   g. Run post-wave gate if configured
   h. If gate fails: halt build, report errors
3. Build complete — update all node statuses
```

## API Changes

### Modified
- `POST /api/agent/spawn` — accept `workDirs` map for buildAll, resolve skills and write config files
- `GET /api/agent/stream` — include run metadata in events

### New
- `GET /api/agent/runs` — list recent AgentRun records
- `GET /api/skills` — list available skill categories and their files

## Not Implementing (YAGNI)

- Container-level agents (add when needed)
- Skill versioning / priority / conflict detection (manifest model deferred)
- Run persistence to disk (in-memory only for MVP)
- Cleanup / retention policy for workDirs (manual for now)
- Inter-agent communication beyond wave summary passing

## Dependencies

- Existing: AgentRunner, prompt-templates, Zustand store, i18n
- New files: skills/ directory with starter skill markdown files
- Modified: agent-runner.ts (buildAll signature), spawn route, useBuildActions hook, types.ts (skills field), node edit dialog

## Testing

- Unit: resolveWorkDir, resolveSkills, mergeSkills
- Unit: AgentRun record creation and status tracking
- Integration: spawn route with skill injection
- Manual: full build flow with skills applied, verify CLAUDE.md content
