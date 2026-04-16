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
  // Subagent-contract fields (optional; empty when caller hasn't computed them
  // yet, which makes the corresponding prompt section collapse).
  blockId?: string
  techStack?: string
  waveIndex?: number
  waveSize?: number
  waveTotal?: number
  siblingNames?: string[]
  writeScope?: string[]
  readOnlyScope?: string[]
  exposedSymbols?: string[]
  consumedSymbols?: string[]
  facts?: string
  shellAllowlist?: string[]
  validationCmd?: string
}

function pack(list?: string[]): string | undefined {
  if (!list || list.length === 0) return undefined
  return list.join('\n')
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
  const taskParams: Record<string, string> = {
    nodeName: input.nodeName ?? (input.selected_nodes?.join(', ') ?? 'selected node'),
    workDir: input.workDir ?? process.cwd(),
  }
  if (input.blockId) taskParams.blockId = input.blockId
  if (input.techStack) taskParams.techStack = input.techStack
  if (input.waveIndex) taskParams.waveIndex = String(input.waveIndex)
  if (input.waveSize) taskParams.waveSize = String(input.waveSize)
  if (input.waveTotal) taskParams.waveTotal = String(input.waveTotal)
  if (input.siblingNames?.length) taskParams.siblingNames = input.siblingNames.join(', ')
  const w = pack(input.writeScope); if (w) taskParams.writeScope = w
  const r = pack(input.readOnlyScope); if (r) taskParams.readOnlyScope = r
  const e = pack(input.exposedSymbols); if (e) taskParams.exposedSymbols = e
  const c = pack(input.consumedSymbols); if (c) taskParams.consumedSymbols = c
  if (input.facts) taskParams.facts = input.facts
  const s = pack(input.shellAllowlist); if (s) taskParams.shellAllowlist = s
  if (input.validationCmd) taskParams.validationCmd = input.validationCmd

  return buildSystemContext({
    agentType: 'build',
    task: 'implement',
    locale,
    canvasYaml: input.architecture_yaml,
    selectedNodeContext: formatSelectedNodeContext(input),
    skillContent: input.skillContent,
    taskParams,
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
