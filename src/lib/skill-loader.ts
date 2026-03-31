import fs from 'fs'
import path from 'path'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  name: string
  description: string
  category: string
  source: 'local' | 'github' | 'team'
  tags: string[]
  scope: Array<'global' | 'node' | 'build'>
  priority: number
  /** Skill type: 'prompt' injects content into agent context; 'hook' runs a shell command. */
  type: 'prompt' | 'hook'
  /** When the hook should fire (hook-type skills only). */
  trigger?: 'post-build'
  /** Shell command template to execute (hook-type skills only). Supports {workDir} placeholder. */
  command?: string
}

export interface ResolvedSkill {
  metadata: SkillMetadata
  content: string
  reason: string
}

// ---------------------------------------------------------------------------
// TechStack → skill category mapping
// ---------------------------------------------------------------------------

const TECH_SKILL_MAP: Record<string, string[]> = {
  // frontend triggers
  'react': ['frontend'],
  'next': ['frontend'],
  'next.js': ['frontend'],
  'nextjs': ['frontend'],
  'vue': ['frontend'],
  'angular': ['frontend'],
  'tailwind': ['frontend'],
  'css': ['frontend'],
  'svelte': ['frontend'],
  'nuxt': ['frontend'],
  // backend triggers
  'node': ['backend'],
  'express': ['backend'],
  'fastapi': ['backend'],
  'django': ['backend'],
  'flask': ['backend'],
  'api': ['backend'],
  'rest': ['backend'],
  'graphql': ['backend'],
  'nestjs': ['backend'],
  'hono': ['backend'],
  'koa': ['backend'],
  // can match both
  'typescript': ['frontend', 'backend'],
  'javascript': ['frontend', 'backend'],
}

// ---------------------------------------------------------------------------
// Frontmatter parser (no yaml dependency — regex only)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { metadata: Partial<SkillMetadata>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { metadata: {}, body: content }

  const raw = match[1]
  const body = match[2]
  const metadata: Partial<SkillMetadata> = {}

  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()

    if (!key || !value) continue

    if (key === 'priority') {
      metadata.priority = parseInt(value, 10)
    } else if (key === 'tags' || key === 'scope') {
      // Parse inline YAML array: [a, b, c]
      const arrayMatch = value.match(/^\[(.*)\]$/)
      if (arrayMatch) {
        const items = arrayMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (key === 'tags') {
          metadata.tags = items
        } else {
          metadata.scope = items as Array<'global' | 'node' | 'build'>
        }
      }
    } else if (key === 'name') {
      metadata.name = value
    } else if (key === 'description') {
      metadata.description = value
    } else if (key === 'category') {
      metadata.category = value
    } else if (key === 'source') {
      metadata.source = value as 'local' | 'github' | 'team'
    } else if (key === 'type') {
      metadata.type = value as 'prompt' | 'hook'
    } else if (key === 'trigger') {
      metadata.trigger = value as 'post-build'
    } else if (key === 'command') {
      metadata.command = value
    }
  }

  return { metadata, body }
}

// ---------------------------------------------------------------------------
// Skill index cache
// ---------------------------------------------------------------------------

interface IndexedSkill {
  metadata: SkillMetadata
  filePath: string
}

let skillIndexCache: IndexedSkill[] | null = null

/**
 * Scan skills/ directory, parse frontmatter from each .md file.
 * Caches the result in memory.
 */
export function loadSkillIndex(): IndexedSkill[] {
  if (skillIndexCache) return skillIndexCache

  const index: IndexedSkill[] = []

  if (!fs.existsSync(SKILLS_DIR)) return index

  const categories = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const category of categories) {
    const dir = path.join(SKILLS_DIR, category)
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()

    for (const file of files) {
      const filePath = path.join(dir, file)
      const raw = fs.readFileSync(filePath, 'utf-8')
      const { metadata } = parseFrontmatter(raw)

      // Build a complete SkillMetadata with safe defaults
      const skillMeta: SkillMetadata = {
        name: metadata.name ?? path.basename(file, '.md'),
        description: metadata.description ?? '',
        category: metadata.category ?? category,
        source: metadata.source ?? 'local',
        tags: metadata.tags ?? [],
        scope: metadata.scope ?? ['global', 'node', 'build'],
        priority: metadata.priority ?? 50,
        type: metadata.type ?? 'prompt',
        ...(metadata.trigger !== undefined ? { trigger: metadata.trigger } : {}),
        ...(metadata.command !== undefined ? { command: metadata.command } : {}),
      }

      index.push({ metadata: skillMeta, filePath })
    }
  }

  // Sort by priority descending
  index.sort((a, b) => b.metadata.priority - a.metadata.priority)

  skillIndexCache = index
  return index
}

/**
 * Invalidate the skill index cache (call after hot reload).
 */
export function invalidateSkillIndex(): void {
  skillIndexCache = null
}

// ---------------------------------------------------------------------------
// Resolution logic
// ---------------------------------------------------------------------------

/**
 * Given agent type, scope, and optional techStack string,
 * return ResolvedSkill[] with reasons for inclusion.
 */
export function resolveSkillsForTask(
  agentType: 'canvas' | 'build',
  scope: 'global' | 'node',
  techStack?: string
): ResolvedSkill[] {
  const index = loadSkillIndex()
  const resolved: ResolvedSkill[] = []

  // Determine which categories to include from techStack
  const techCategories = new Set<string>()
  const techReasons = new Map<string, string>() // category → reason string

  if (techStack) {
    const lower = techStack.toLowerCase()
    for (const [keyword, cats] of Object.entries(TECH_SKILL_MAP)) {
      if (lower.includes(keyword)) {
        for (const cat of cats) {
          if (!techCategories.has(cat)) {
            // Use the original-cased keyword for the reason
            const displayKeyword = techStack.match(new RegExp(keyword, 'i'))?.[0] ?? keyword
            techCategories.add(cat)
            techReasons.set(cat, `techStack match: ${displayKeyword}`)
          }
        }
      }
    }
  }

  for (const skill of index) {
    const { metadata, filePath } = skill
    let reason: string | null = null

    // Hook-type skills are excluded from context injection; use resolveHooks() instead.
    if (metadata.type === 'hook') continue

    // 1. core/* — always included regardless of scope
    if (metadata.category === 'core') {
      reason = 'required'
    }

    // 2. architect/* — included for global scope (canvas agent global chat)
    if (!reason && metadata.category === 'architect' && scope === 'global') {
      reason = 'global scope'
    }

    // 3. frontend/backend — techStack inference (node + build scope)
    if (!reason && (agentType === 'build' || scope === 'node')) {
      if (techCategories.has(metadata.category)) {
        reason = techReasons.get(metadata.category) ?? 'techStack match'
      }
    }

    // 4. testing/* — always included for build agent
    if (!reason && metadata.category === 'testing' && agentType === 'build') {
      reason = 'build requirement'
    }

    if (reason !== null) {
      // Also verify the skill's own scope allows it
      const effectiveScope = agentType === 'build' ? 'build' : scope
      if (metadata.scope.includes(effectiveScope as 'global' | 'node' | 'build')) {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const { body } = parseFrontmatter(raw)
        resolved.push({ metadata, content: body.trim(), reason })
      }
    }
  }

  return resolved
}

/**
 * Return all hook-type skills matching the given trigger.
 * agentType and scope are reserved for future filtering.
 */
export function resolveHooks(
  _agentType: 'canvas' | 'build',
  _scope: 'global' | 'node',
  _techStack?: string,
  trigger: 'post-build' = 'post-build'
): ResolvedSkill[] {
  const index = loadSkillIndex()
  const hooks: ResolvedSkill[] = []

  for (const { metadata, filePath } of index) {
    if (metadata.type !== 'hook') continue
    if (metadata.trigger !== trigger) continue
    if (!metadata.command) continue

    const raw = fs.readFileSync(filePath, 'utf-8')
    const { body } = parseFrontmatter(raw)
    hooks.push({ metadata, content: body.trim(), reason: `hook: ${trigger}` })
  }

  return hooks
}

/**
 * Sort by priority desc, deduplicate by name, concat content with separators.
 */
export function mergeResolvedSkills(skills: ResolvedSkill[]): string {
  // Sort by priority descending
  const sorted = [...skills].sort((a, b) => b.metadata.priority - a.metadata.priority)

  // Deduplicate by name (highest priority wins since we sorted first)
  const seen = new Set<string>()
  const deduped = sorted.filter((s) => {
    if (seen.has(s.metadata.name)) return false
    seen.add(s.metadata.name)
    return true
  })

  return deduped
    .map((s) => `<!-- skill: ${s.metadata.name} (${s.reason}) -->\n${s.content}`)
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Public integration point — called by context-engine
// ---------------------------------------------------------------------------

/**
 * Resolve and merge skills for the given agent type, scope, and techStack.
 * Returns undefined if no skills are resolved (caller skips L5 injection).
 */
export function resolveSkillContent(
  agentType: 'canvas' | 'build',
  scope: 'global' | 'node',
  techStack?: string
): string | undefined {
  const skills = resolveSkillsForTask(agentType, scope, techStack)
  if (skills.length === 0) return undefined
  return mergeResolvedSkills(skills)
}

/**
 * Resolve a skill manifest (name + description only) for canvas agents.
 * Saves tokens vs. full skill content — full body is not needed for chat/discuss.
 * Build agents should still use resolveSkillContent() to get full instructions.
 */
export function resolveSkillManifest(
  agentType: 'canvas' | 'build',
  scope: 'global' | 'node',
  techStack?: string
): string | undefined {
  const skills = resolveSkillsForTask(agentType, scope, techStack)
  if (skills.length === 0) return undefined
  // Manifest: just name + description, not full content
  return skills
    .map(s => `- **${s.metadata.name}** (${s.metadata.category}): ${s.metadata.description.slice(0, 150)}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Legacy exports (kept for backward compatibility with existing callers)
// ---------------------------------------------------------------------------

export function listSkillCategories(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return []

  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
}

export async function mergeSkills(categories: string[]): Promise<string> {
  const sections: string[] = []

  for (const category of categories) {
    const dir = path.join(SKILLS_DIR, category)
    if (!fs.existsSync(dir)) continue

    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .sort()
    for (const file of files) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const { body } = parseFrontmatter(raw)
      sections.push(body.trim())
    }
  }

  return sections.join('\n\n---\n\n')
}

export async function writeAgentConfig(
  workDir: string,
  skillContent: string,
  level: 'project' | 'module',
  projectName: string,
  backend: import('@/lib/agent-runner').AgentBackend
): Promise<void> {
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true })
  }

  const persona =
    level === 'project'
      ? 'Project manager / architect. You have full canvas visibility and make architecture decisions.'
      : 'Module implementer. You are focused on a single component and write production code for it.'

  const constraints =
    level === 'project'
      ? '- Decompose the goal into modules\n- Coordinate architecture decisions\n- Produce a clear implementation plan'
      : '- Only modify files within your working directory\n- Keep changes focused on your assigned component\n- Do not edit unrelated modules'

  const content = `# Agent Identity

You are a ${level}-level agent for the **${projectName}** project.
Role: ${persona}

# Skills

${skillContent || '(no skills configured)'}

# Constraints

${constraints}
`

  if (backend === 'codex') {
    fs.writeFileSync(path.join(workDir, 'AGENTS.md'), content, 'utf-8')
    return
  }

  if (backend === 'gemini') {
    fs.writeFileSync(path.join(workDir, 'GEMINI.md'), content, 'utf-8')
    return
  }

  fs.writeFileSync(path.join(workDir, 'CLAUDE.md'), content, 'utf-8')
}
