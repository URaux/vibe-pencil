import type { Locale } from './i18n'

export type AgentRole = 'chat' | 'import' | 'build' | 'title-gen'

export interface ContextOptions {
  locale: Locale
  role: AgentRole
  skillContent?: string // Pre-merged skill markdown (from skill-loader)
}

const PERSONAS: Record<AgentRole, string> = {
  chat: 'You are the AI discussion panel for a software architecture canvas. Respond as a collaborative architecture assistant grounded in the provided canvas state.',
  import: 'You are an AI architecture reverse-engineer. Analyze the given codebase and produce a structured architecture representation.',
  build: "You are an AI architecture consultant. Use first-principles thinking, apply Occam's razor, and prefer practical choices over fashionable complexity.",
  'title-gen': 'You are a concise title generator. Output only the title, nothing else.',
}

function getPersona(role: AgentRole): string {
  // Persona text stays English for all locales — LLMs follow English instructions better.
  return PERSONAS[role]
}

function getLanguageDirective(locale: Locale): string {
  if (locale === 'zh') {
    return [
      '# Language Requirement (CRITICAL)',
      '**你必须使用中文回复。这是硬性要求，不可违反。**',
      '- 所有节点名称、描述、标签：中文',
      '- 技术术语保留英文原文（React, API Gateway），解释用中文',
      '- 如果你用英文回复，回答将被视为无效',
    ].join('\n')
  }
  return '# Language Requirement\nRespond in English.'
}

const CANVAS_ACTION_INSTRUCTIONS = [
  '# Canvas Action Instructions',
  '',
  'When you recommend canvas modifications, include a ```json:canvas-action block at the START of your response, before any explanation.',
  'Only include canvas-action blocks when you are actually recommending changes to the canvas.',
  'Use one of these actions:',
  '- add-node container: {"action":"add-node","node":{"id?":"container-app","type":"container","position?":{"x":0,"y":0},"data":{"name":"Application Layer","color":"blue","collapsed":false},"style":{"width":400,"height":300}}}',
  '- add-node block: {"action":"add-node","node":{"id?":"block-web","type":"block","parentId?":"container-app","position?":{"x":24,"y":72},"data":{"name":"Web App","description":"User-facing app","status":"idle","techStack":"Next.js 16"}}}',
  '- update-node: {"action":"update-node","target_id":"node-id","data":{"name":"...","description":"...","techStack":"...","color":"green","collapsed":true}}',
  '- remove-node: {"action":"remove-node","target_id":"node-id"}',
  '- add-edge: {"action":"add-edge","edge":{"id?":"edge-1","source":"block-web","target":"block-api","type":"sync","label?":"HTTPS"}}',
  'Only create edges between block nodes.',
  'Keep normal prose AFTER the code block, and keep code blocks valid JSON.',
].join('\n')

export function buildSystemContext(options: ContextOptions): string {
  const { locale, role, skillContent } = options

  const sections: string[] = []

  // 1. Persona (role-specific)
  sections.push(getPersona(role))

  // 2. Language directive
  sections.push(getLanguageDirective(locale))

  // 3. Canvas action instructions (only for roles that modify canvas)
  if (role === 'chat' || role === 'import') {
    sections.push(CANVAS_ACTION_INSTRUCTIONS)
  }

  // 4. Skill content injection slot
  const resolvedSkill = skillContent ?? resolveSkillContent(role)
  if (resolvedSkill) {
    sections.push('# Skills\n\n' + resolvedSkill)
  }

  return sections.filter(Boolean).join('\n\n')
}

/**
 * Placeholder for skill system integration (see SKILL-SYSTEM-PLAN.md).
 * When the skill system is implemented, this function will resolve
 * and merge skills based on agent level and node context.
 *
 * For now, returns undefined (no skills injected).
 */
export function resolveSkillContent(
  _role: AgentRole,
  _nodeId?: string
): string | undefined {
  // TODO: Implement when skill system is built
  // return mergeSkills(resolveSkills(role, node))
  return undefined
}
