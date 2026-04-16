# Skill Passthrough Research: CC Skills → ArchViber Canvas Orchestrator

**Date**: 2026-04-14  
**Scope**: Feasibility only — no implementation

---

## 1. CC Skill Discovery & Loading Mechanism

### Storage location

CC skills live in `~/.claude/skills/`. Two structural formats coexist:

- **Flat skill dir**: `~/.claude/skills/<skill-name>/SKILL.md` — the standard format used by telegram-reply-style, resume, promptfolio-* skills.
- **Nested bundle dir**: `~/.claude/skills/<bundle-name>/<skill-name>/SKILL.md` — baoyu-skills uses this (19 sub-skills under one namespace directory).

### SKILL.md format

YAML frontmatter + markdown body. Key fields observed:

```yaml
---
name: skill-name
description: One-line trigger description (CC uses this for intent matching)
allowed-tools: Bash, Read, Edit   # optional
model: haiku                       # optional override
argument-hint: [build|edit|view]   # optional
---
# Skill body: instructions, steps, scripts
```

The `description` field is the critical one — CC reads it at session start to decide when to invoke the skill.

### Currently installed user skills (7 top-level entries)

| Skill | Format | Notes |
|---|---|---|
| `baoyu-skills/` | bundle (19 sub-skills) | image gen, article tools, social posting |
| `promptfolio-logout` | flat | auth/session |
| `promptfolio-search-people` | flat | platform search |
| `promptfolio-search-skills` | flat | platform search |
| `promptfolio-summarize` | flat + scripts | has `analysis-prompt.md` + shell scripts |
| `resume` | flat | PDF generation |
| `telegram-reply-style` | flat | format enforcement |

---

## 2. `claude -p` and Skill Inheritance

**Skills are auto-inherited — no extra flags needed.**

CC loads `~/.claude/skills/` unconditionally at session start for any `claude` invocation, including `claude -p` subprocess calls. The `cwd` provided to `spawn()` determines which `CLAUDE.md` and project-local `.claude/skills/` are loaded on top of the user's global skills. CC merges both layers (global user + project-local).

ArchViber's `cc-native-scaffold.ts` already exploits this: it creates a scratch workdir with a project-local `.claude/skills/archviber-canvas/SKILL.md` in it, then spawns `claude` with `cwd: SCAFFOLD_DIR`. The spawned subprocess therefore has BOTH the user's global skills AND the ArchViber canvas-editing skill available.

**Conclusion**: user's installed CC skills are already transparently available in every `claude -p` subprocess ArchViber spawns. Zero action needed to make them present.

---

## 3. ArchViber Current Skill Architecture

### Dual-track system (key distinction)

ArchViber has its **own** skill system (`E:/claude-workspace/archviber/skills/`) that is architecturally separate from CC skills:

- **ArchViber skills** (`archviber/skills/`): Markdown files with frontmatter, organized in `core/`, `architect/`, `frontend/`, `backend/`, `github/`, `local/`, `testing/` categories. Loaded by `skill-loader.ts` at Next.js server runtime. Injected as L5 ("Skills") layer in the 7-layer context engine. These instruct the AI on coding patterns, architecture principles, etc.
- **CC skills** (`~/.claude/skills/`): Separate. Currently only the project-local `archviber-canvas` skill is bridged (via `cc-native-scaffold.ts`) to the CC subprocess.

### `resolveHooks('build', 'node', ..., 'post-build')`

This is ArchViber's own hook system — **not related to CC skills**. Hook-type skills (frontmatter `type: hook`, `trigger: post-build`, `command: <template>`) in `archviber/skills/` are resolved and executed as post-build shell commands. Completely independent of CC.

### context-engine.ts L5 (skills layer)

`ContextOptions.skillContent?: string` is injected at position L5 in the 7-layer system prompt. The caller (e.g., `chat/route.ts`, `agent/stream/route.ts`) calls `resolveSkillContent(agentType, scope, techStack, phase)` from `skill-loader.ts` and passes the result in. This is ArchViber's own skill content, not user CC skills.

---

## 4. Gap Analysis

The user's CC skills (telegram-reply-style, resume, baoyu-*, promptfolio-*) are available to spawned `claude` subprocesses automatically. However:

1. The Canvas chat orchestrator does not know which user skills exist, so it cannot route intent to them or surface them in the UI.
2. There is no mechanism to trigger a user CC skill explicitly from Canvas (e.g., user says "summarize this as a social post" — should invoke baoyu-skills).
3. The Canvas orchestrator's routing (in `context-engine.ts`) is hardcoded to ArchViber tasks; it has no lookup path to user skill descriptions.

---

## 5. Passthrough Design Options

### Option A: Manifest injection at scaffold time (recommended)

**How it works**: When `ensureCanvasChatScaffold()` runs, scan `~/.claude/skills/` and append a "User Skills Available" section to the scaffolded `CLAUDE.md`. Each entry lists skill name + description. The spawned CC subprocess then has the skill list in its context and can decide to invoke them from user intent.

**Pros**: Zero new infrastructure. Leverages CC's native intent matching. Skills are already loaded — the CLAUDE.md entry just makes the orchestrator aware of what exists.  
**Cons**: Only works for canvas-chat (CC backend). Build agents use a different pathway. Skill list in CLAUDE.md adds ~200-500 tokens.

**Effort**: ~2–3 hours. Touch: `cc-native-scaffold.ts` (add scanner + CLAUDE.md section), no API changes.

### Option B: ArchViber skill index + Canvas UI layer

**How it works**: Add a server route `GET /api/skills/user-cc` that scans `~/.claude/skills/`, returns manifest (name, description, trigger keywords). Canvas UI shows a "Your Skills" panel. Orchestrator receives the list via `ContextOptions.skillContent` (the existing L5 injection point). For custom-api and Codex backends, skill content is injected as prompt text; for CC backend, handled by Option A.

**Pros**: Backend-agnostic. Works for all orchestrator backends (CC, Codex, Gemini, custom-api). UI discovery surfaces skills the user forgot they installed.  
**Cons**: Requires new API route + UI component + wiring into `context-engine.ts`. Medium complexity.

**Effort**: ~6–8 hours. Touch: new `app/api/skills/user-cc/route.ts`, `context-engine.ts` (L5 merge), Canvas UI panel.

### Recommendation

**Option A first, Option B later.**

Option A is a 2-hour win that immediately enables natural-language skill invocation for the CC backend (the default and most-used path). Option B becomes relevant if/when multi-backend parity is required or if the user explicitly wants a skill browser UI.

---

## 6. Implementation Complexity

| Option | Files Changed | Estimated Hours | Risk |
|---|---|---|---|
| A | `cc-native-scaffold.ts` | 2–3 h | Low — additive only |
| B | 1 new route + context-engine.ts + 1 UI component | 6–8 h | Medium — L5 injection must not bloat tokens |

---

## 7. Phase 1 Impact

**Recommendation: Optional in Phase 1, include Option A only.**

Rationale: The user's currently installed CC skills (telegram-reply-style, baoyu-*, promptfolio-*) are utility/content-creation skills, not architecture skills. They add value in the Canvas chat context ("generate a social post about this design"), but are not load-bearing for the core ArchViber canvas-editing flow. Including Option A (2–3 h) is low-risk and high-value without destabilizing the Phase 1 scope. Option B should be a Phase 2 item gated on user demand.

---

## Summary

CC skills (`~/.claude/skills/`) are **already automatically inherited** by any `claude -p` subprocess ArchViber spawns — no passthrough work is needed for them to be present. The gap is **awareness**: the Canvas orchestrator does not know the user's skill list, so it cannot route intent or surface skill options.

Option A (inject skill manifest into scaffolded CLAUDE.md) closes this gap in ~2–3 hours with minimal risk. Option B (full UI + multi-backend injection) is a Phase 2 item. Neither option is a Phase 1 blocker — the core canvas-editing flow works without it.
