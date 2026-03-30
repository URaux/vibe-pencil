import fs from 'fs'
import path from 'path'
import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/lib/types'
import type { AgentBackend } from '@/lib/agent-runner'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

export function listSkillCategories(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return []

  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort()
}

export function resolveSkills(
  node: Node<CanvasNodeData>,
  allNodes: Node<CanvasNodeData>[]
): string[] {
  const nodeSkills = ((node.data as { skills?: string[] }).skills ?? []).filter(Boolean)

  if (node.type === 'block' && nodeSkills.length === 0 && node.parentId) {
    const parent = allNodes.find((candidate) => candidate.id === node.parentId)
    const parentSkills = ((parent?.data as { skills?: string[] } | undefined)?.skills ?? []).filter(
      Boolean
    )
    return ['core', ...parentSkills]
  }

  return ['core', ...nodeSkills]
}

export async function mergeSkills(categories: string[]): Promise<string> {
  const sections: string[] = []

  for (const category of categories) {
    const dir = path.join(SKILLS_DIR, category)
    if (!fs.existsSync(dir)) continue

    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort()
    for (const file of files) {
      sections.push(fs.readFileSync(path.join(dir, file), 'utf-8'))
    }
  }

  return sections.join('\n\n---\n\n')
}

export async function writeAgentConfig(
  workDir: string,
  skillContent: string,
  level: 'project' | 'module',
  projectName: string,
  backend: AgentBackend
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
