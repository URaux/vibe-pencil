import { buildSystemContext } from './context-engine'
import type { Locale } from './i18n'

interface PromptTemplateInput {
  architecture_yaml: string
  selected_nodes?: string[]
  project_context?: string
  user_feedback?: string
  locale?: Locale // defaults to 'en' if not provided
  workDir?: string
  nodeName?: string
  skillContent?: string
}

function formatSelectedNodeContext(input: PromptTemplateInput): string | undefined {
  const parts: string[] = []
  if (input.selected_nodes?.length) {
    parts.push(`Selected nodes: ${input.selected_nodes.join(', ')}`)
  }
  if (input.project_context) {
    parts.push(`Project context: ${input.project_context}`)
  }
  if (input.user_feedback) {
    parts.push(`User feedback: ${input.user_feedback}`)
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

export function buildAll(input: PromptTemplateInput) {
  const locale = input.locale ?? 'en'
  return buildSystemContext({
    agentType: 'build',
    task: 'implement',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
    taskParams: {
      nodeName: input.nodeName ?? 'entire project',
      workDir: input.workDir ?? process.cwd(),
      waveInfo: 'Full project build — produce a phased implementation plan for the full architecture and call out any missing components.',
    },
  })
}

export function buildNode(input: PromptTemplateInput) {
  const locale = input.locale ?? 'en'
  return buildSystemContext({
    agentType: 'build',
    task: 'implement',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
    taskParams: {
      nodeName: input.nodeName ?? (input.selected_nodes?.join(', ') ?? 'selected node'),
      workDir: input.workDir ?? process.cwd(),
    },
  })
}

export function buildSubgraph(input: PromptTemplateInput) {
  const locale = input.locale ?? 'en'
  return buildSystemContext({
    agentType: 'build',
    task: 'implement',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
    taskParams: {
      nodeName: input.selected_nodes?.join(', ') ?? 'selected subgraph',
      workDir: input.workDir ?? process.cwd(),
      waveInfo: 'Design and sequence the selected subgraph so the resulting plan is coherent, minimal, and buildable.',
    },
  })
}

export function analyzeProject(input: PromptTemplateInput) {
  const locale = input.locale ?? 'en'
  return buildSystemContext({
    agentType: 'canvas',
    task: 'analyze',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
  })
}

export function refactorNode(input: PromptTemplateInput) {
  const locale = input.locale ?? 'en'
  return buildSystemContext({
    agentType: 'build',
    task: 'refactor',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
    taskParams: {
      nodeName: input.nodeName ?? (input.selected_nodes?.join(', ') ?? 'selected node'),
      workDir: input.workDir ?? process.cwd(),
    },
  })
}
