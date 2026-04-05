import type { Locale } from './i18n'
import type { SessionPhase } from './store'

export type AgentType = 'canvas' | 'build'

export type TaskType =
  | 'discuss'         // chat global mode
  | 'discuss-node'    // chat with selected node
  | 'import'          // reverse-engineer codebase
  | 'import-enhance'  // refine skeleton with pre-digested project data
  | 'analyze'         // review architecture
  | 'implement'       // build a node
  | 'refactor'        // refactor a node

export interface ContextOptions {
  agentType: AgentType
  task: TaskType
  locale: Locale
  skillContent?: string
  canvasYaml?: string
  selectedNodeContext?: string
  conversationHistory?: string
  taskParams?: Record<string, string>  // dir, workDir, nodeName, waveInfo, etc.
  codeContext?: string
  buildSummaryContext?: string
  sessionPhase?: SessionPhase
}

// ---------------------------------------------------------------------------
// L0: Language directive
// ---------------------------------------------------------------------------

function layerLanguage(locale: Locale): string {
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

// ---------------------------------------------------------------------------
// L1: Identity — single identity for both agent types
// ---------------------------------------------------------------------------

function layerIdentity(): string {
  return 'You are the AI assistant for ArchViber, a visual architecture editor. You help users design, analyze, and build software architectures.'
}

// ---------------------------------------------------------------------------
// L2: Conversation history (canvas agent discuss tasks only)
// ---------------------------------------------------------------------------

function layerHistory(history: string | undefined): string | null {
  if (!history) return null

  // Estimate tokens (~4 chars per token)
  const estimatedTokens = Math.ceil(history.length / 4)

  // If history is too long, keep only recent messages
  if (estimatedTokens > 8000) {
    const lines = history.split('\n')
    // Keep first 10 lines (initial context) + last 80 lines (recent messages)
    const firstMessages = lines.slice(0, 10).join('\n')
    const recentMessages = lines.slice(-80).join('\n')
    return [
      '# Conversation History',
      '',
      '(Earlier messages summarized)',
      firstMessages,
      '',
      '... (older messages omitted for brevity) ...',
      '',
      recentMessages,
    ].join('\n')
  }

  return '# Conversation History\n\n' + history
}

// ---------------------------------------------------------------------------
// L3: Canvas state
// ---------------------------------------------------------------------------

function layerCanvasState(
  canvasYaml: string | undefined,
  selectedNodeContext: string | undefined,
  buildSummaryContext: string | undefined,
  codeContext: string | undefined
): string | null {
  const parts: string[] = []

  if (canvasYaml) {
    parts.push(`# Architecture YAML\n\n${canvasYaml}`)
  }

  if (selectedNodeContext) {
    parts.push(`# Selected Node Context\n\n${selectedNodeContext}`)
  }

  if (buildSummaryContext) {
    parts.push(`# Build Summary\n\n${buildSummaryContext}`)
  }

  if (codeContext) {
    parts.push(`# Code Context (files from the built node)\n\n${codeContext}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

// ---------------------------------------------------------------------------
// L4: Task definition
// ---------------------------------------------------------------------------

function layerTask(task: TaskType, taskParams: Record<string, string> = {}): string {
  switch (task) {
    case 'discuss':
      return '# Task\n\nDiscuss the architecture with the user. Answer questions, suggest improvements, and help reason about the design.'

    case 'discuss-node':
      return '# Task\n\nDiscuss the selected node with the user. Focus on its responsibilities, implementation details, dependencies, and how it fits into the broader architecture.'

    case 'import': {
      const dir = taskParams.dir ?? '<unknown dir>'
      return [
        '# Task',
        '',
        `Reverse-engineer the codebase at: ${dir}`,
        'Analyze the project and produce a structured architecture representation as React Flow canvas data.',
        'Favor a compact but meaningful graph.',
      ].join('\n')
    }

    case 'import-enhance': {
      const dir = taskParams.dir ?? '<unknown dir>'
      const projectSummary = taskParams.projectSummary ?? ''
      const existingYaml = taskParams.existingYaml ?? ''
      return [
        '# Task',
        '',
        `Refine the architecture of the project at: ${dir}`,
        '',
        'A preliminary scan has already been performed. The project summary and initial skeleton are provided below.',
        'Your job is to:',
        '1. Add meaningful descriptions to each block',
        '2. Identify the correct tech stack for each block',
        '3. Fix any incorrect container groupings (split or merge as needed)',
        '4. Add missing edges that represent real data flows',
        '5. Remove any blocks that are too granular or redundant',
        '6. Add any major architectural components the scan missed',
        '',
        'DO NOT read files from the filesystem. All the information you need is in this prompt.',
        'DO NOT use any tools. Respond with JSON only.',
        '',
        '## Pre-analyzed Project Summary',
        '',
        projectSummary,
        '',
        '## Current Skeleton (to refine)',
        '',
        existingYaml,
      ].join('\n')
    }

    case 'analyze':
      return '# Task\n\nReview the architecture, identify structural risks, and recommend the simplest viable improvements.'

    case 'implement': {
      const nodeName = taskParams.nodeName ?? 'the target node'
      const workDir = taskParams.workDir ?? '<workDir>'
      const waveInfo = taskParams.waveInfo ? `\n\nWave context: ${taskParams.waveInfo}` : ''
      return `# Task\n\nImplement ${nodeName} in ${workDir}. Write all necessary files to make this node functional according to the architecture.${waveInfo}`
    }

    case 'refactor': {
      const nodeName = taskParams.nodeName ?? 'the target node'
      return `# Task\n\nRefactor ${nodeName}. Propose and apply a refactor plan that reduces complexity while preserving behavior.`
    }

    default:
      return '# Task\n\nAssist the user with their request.'
  }
}

// ---------------------------------------------------------------------------
// L5: Skills
// ---------------------------------------------------------------------------

function layerSkills(skillContent: string | undefined): string | null {
  if (!skillContent) return null
  return '# Skills\n\nFollow these skill instructions carefully.\n\n' + skillContent
}

// ---------------------------------------------------------------------------
// L6: Constraints
// ---------------------------------------------------------------------------

function layerConstraints(agentType: AgentType, taskParams: Record<string, string> = {}): string {
  if (agentType === 'canvas') {
    return [
      '# Constraints',
      '',
      'Do NOT modify any files on the filesystem.',
      'You may suggest canvas actions (add/update/remove nodes and edges) via structured JSON blocks.',
      'All suggestions are proposals — the user decides whether to apply them.',
    ].join('\n')
  }

  // build agent
  const workDir = taskParams.workDir ?? '<workDir>'
  return [
    '# Constraints',
    '',
    `Only modify files within: ${workDir}`,
    'Do not read or write files outside this directory.',
    'Do not modify the canvas YAML directly — your output is files on disk.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L7: Output format
// ---------------------------------------------------------------------------

const CANVAS_ACTION_INSTRUCTIONS = [
  '# Output Format',
  '',
  'Respond in Markdown.',
  '',
  'IMPORTANT: When the user describes a system, product, or project idea, you MUST generate the architecture as canvas-action blocks. Do not just describe it in text — draw it on the canvas.',
  'When generating or modifying the architecture, include ```json:canvas-action blocks at the START of your response, before any explanation.',
  'Always generate canvas-action blocks when: the user asks to design/build/create a system, the user describes requirements, or the user asks to add/modify components.',
  '',
  '## canvas-action format',
  '',
  'Each action is a separate fenced code block with the language tag `json:canvas-action`.',
  'Available actions: add-node, update-node, remove-node, add-edge.',
  '',
  '### Complete example',
  '',
  'If the user says "make a web app with API and database", you MUST output:',
  '',
  '````',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Frontend","color":"blue","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Backend","color":"green","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"container","data":{"name":"Data Layer","color":"purple","collapsed":false},"style":{"width":400,"height":200}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"frontend","data":{"name":"React App","description":"SPA frontend","status":"idle","techStack":"React"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"backend","data":{"name":"API Server","description":"REST API","status":"idle","techStack":"Node.js"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-node","node":{"type":"block","parentId":"data-layer","data":{"name":"PostgreSQL","description":"Main database","status":"idle","techStack":"PostgreSQL"}}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-edge","edge":{"source":"react-app","target":"api-server","type":"sync","label":"HTTPS"}}',
  '```',
  '',
  '```json:canvas-action',
  '{"action":"add-edge","edge":{"source":"api-server","target":"postgresql","type":"sync","label":"SQL"}}',
  '```',
  '````',
  '',
  'Then write your explanation text AFTER all the code blocks.',
  '',
  '### Action schemas',
  '',
  '- add-node container: `{"action":"add-node","node":{"type":"container","data":{"name":"...","color":"blue|green|purple|amber|rose|slate","collapsed":false},"style":{"width":400,"height":200}}}`',
  '- add-node block: `{"action":"add-node","node":{"type":"block","parentId":"<container-id>","data":{"name":"...","description":"...","status":"idle","techStack":"..."}}}`',
  '- update-node: `{"action":"update-node","target_id":"<node-id>","data":{"name":"..."}}`',
  '- remove-node: `{"action":"remove-node","target_id":"<node-id>"}`',
  '- add-edge: `{"action":"add-edge","edge":{"source":"<block-id>","target":"<block-id>","type":"sync|async|bidirectional","label":"..."}}`',
  '',
  'Node IDs are auto-generated from name as kebab-case (e.g., "React App" → "react-app", "Data Layer" → "data-layer").',
  '',
  'CRITICAL RULES:',
  '- You MUST include add-edge actions to connect related blocks. An architecture without edges is incomplete.',
  '- Every block that communicates with another block MUST have an edge.',
  '- Only create edges between block nodes (not containers).',
  '- Put ALL ```json:canvas-action blocks FIRST, then explanation text AFTER.',
  '- Each code block contains exactly ONE JSON action.',
  '- Do NOT skip canvas-action blocks. If the user describes a system, ALWAYS generate them.',
].join('\n')

function layerOutputFormat(agentType: AgentType, task: TaskType, locale: Locale, sessionPhase?: SessionPhase): string {
  if (task === 'import' || task === 'import-enhance') {
    const exampleContainerName = locale === 'zh' ? '客户端层' : 'Client Layer'
    const exampleBlockName = locale === 'zh' ? 'Web 应用' : 'Web App'
    const exampleBlockDesc = locale === 'zh' ? '用户交互界面' : 'User-facing application'

    return [
      '# Output Format',
      '',
      'Return structured JSON for React Flow and nothing else, unless you need a fenced ```json block.',
      'The preferred JSON shape is:',
      '{',
      '  "containers": [',
      '    {',
      '      "id": "container-client",',
      `      "name": "${exampleContainerName}",`,
      '      "color": "blue",',
      '      "blocks": [',
      '        {',
      '          "id": "block-web",',
      `          "name": "${exampleBlockName}",`,
      `          "description": "${exampleBlockDesc}",`,
      '          "status": "idle",',
      '          "techStack": "Next.js 16"',
      '        }',
      '      ]',
      '    }',
      '  ],',
      '  "edges": [',
      '    {',
      '      "id": "edge-1",',
      '      "source": "block-web",',
      '      "target": "block-api",',
      '      "type": "sync",',
      '      "label": "HTTPS"',
      '    }',
      '  ]',
      '}',
      'If you cannot produce the new format, the legacy shape with nodes.services/frontends/apis/databases/queues/externals is still accepted.',
      'Use only these edge types: sync, async, bidirectional.',
      'Use only these container colors: blue, green, purple, amber, rose, slate.',
    ].join('\n')
  }

  if (agentType === 'build') {
    return '# Output Format\n\nWrite files directly to the filesystem. Do not output file contents to stdout unless asked.'
  }

  // canvas agent in brainstorm phase: suppress canvas-action, guide Q&A style
  if (sessionPhase === 'brainstorm') {
    return [
      '# Output Format',
      '',
      'Respond in Markdown only. Do NOT generate any ```json:canvas-action blocks.',
      'Focus on understanding requirements, clarifying questions, and proposing design approaches.',
      'When you have enough information, summarize the proposed architecture in text.',
      'When the user is ready, they will click the "确认方案" button or type "方案确认" to transition to design mode. Do NOT tell them to switch modes manually or mention keyboard shortcuts — the system handles this automatically.',
      locale === 'zh'
        ? '当前处于需求讨论阶段。请通过提问和讨论来理解用户需求，不要直接生成架构。\n严格每次只问 1 个问题，不要同时问多个问题。等用户回答后再问下一个。如果有明确选项，用编号列出 2-4 个选项供用户选择（例如"1. 方案A 2. 方案B 3. 自定义"）。选项中不要混入问题。\n\n在你的第一次回复末尾，用 <!-- title: 项目标题 --> 格式输出标题（不超过15字，对用户不可见）。'
        : 'STRICTLY ask only 1 question per response. Do NOT ask multiple questions at once. Wait for the user\'s answer, then ask the next question. When there are clear options, list 2-4 numbered choices (e.g., "1. Option A  2. Option B  3. Custom input"). Do NOT mix questions into option lists.\n\nAt the end of your first response, output a title in <!-- title: Project Title --> format (max 15 chars, invisible to user).',
    ].filter(Boolean).join('\n')
  }

  // canvas agent: discuss, discuss-node, analyze — all support canvas actions
  return CANVAS_ACTION_INSTRUCTIONS
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

export function buildSystemContext(options: ContextOptions): string {
  const {
    agentType,
    task,
    locale,
    skillContent,
    canvasYaml,
    selectedNodeContext,
    conversationHistory,
    taskParams = {},
    codeContext,
    buildSummaryContext,
    sessionPhase,
  } = options

  // Canvas agent: no skills. Skills are a build agent feature.
  // Canvas uses flat prompts (brainstorm) or canvas-action format (design/iterate).
  const resolvedSkill = agentType === 'build'
    ? (skillContent ?? resolveSkillContent(agentType, task, taskParams.techStack, sessionPhase))
    : undefined

  // Brainstorm phase: use full layer stack but with brainstorm-specific L7.
  // This matches the original "silky" version that worked well.

  const layers: Array<string | null> = [
    layerLanguage(locale),                                                          // L0
    layerIdentity(),                                                                // L1
    task === 'discuss' || task === 'discuss-node'                                  // L2
      ? layerHistory(conversationHistory)
      : null,
    layerCanvasState(canvasYaml, selectedNodeContext, buildSummaryContext, codeContext), // L3
    layerTask(task, taskParams),                                                    // L4
    layerSkills(resolvedSkill),                                                       // L5
    layerConstraints(agentType, taskParams),                                        // L6
    layerOutputFormat(agentType, task, locale, sessionPhase),                       // L7
  ]

  return layers.filter(Boolean).join('\n\n')
}

/**
 * Resolve and merge skills for the given agent context.
 * Maps agent type + task to scope, then delegates to skill-loader.
 * Only works server-side (skill-loader uses fs).
 */
export function resolveSkillContent(
  agentType: AgentType,
  task?: TaskType,
  techStack?: string,
  _phase?: SessionPhase
): string | undefined {
  // Skills are only for build agents. Canvas agent uses flat prompts.
  if (agentType === 'canvas') return undefined

  // skill-loader uses 'fs' — only available server-side
  if (typeof window !== 'undefined') return undefined

  const scope: 'global' | 'node' =
    task === 'discuss' || task === 'import' || task === 'import-enhance' || task === 'analyze'
      ? 'global'
      : 'node'

  try {
    // Use eval('require') to prevent the bundler from analyzing this import
    // and pulling 'fs' into the client bundle
    // eslint-disable-next-line no-eval
    const loader = eval("require('./skill-loader')") as {
      resolveSkillContent: (agentType: 'canvas' | 'build', scope: 'global' | 'node', techStack?: string) => string | undefined
    }
    return loader.resolveSkillContent(agentType, scope, techStack)
  } catch {
    return undefined
  }
}
