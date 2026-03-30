import { buildSystemContext } from './context-engine'
import type { Locale } from './i18n'

interface PromptTemplateInput {
  architecture_yaml: string
  selected_nodes?: string[]
  project_context?: string
  user_feedback?: string
  locale?: Locale // defaults to 'en' if not provided
}

function formatContext(input: PromptTemplateInput) {
  return [
    'Architecture YAML:',
    input.architecture_yaml,
    '',
    `Selected nodes: ${input.selected_nodes?.join(', ') || 'none'}`,
    `Project context: ${input.project_context || 'none provided'}`,
    `User feedback: ${input.user_feedback || 'none provided'}`,
  ].join('\n')
}

function buildPrompt(
  title: string,
  task: string,
  input: PromptTemplateInput
) {
  const locale = input.locale ?? 'en'
  const systemContext = buildSystemContext({ locale, role: 'build' })

  return [
    systemContext,
    '',
    `Task: ${title}`,
    task,
    '',
    formatContext(input),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildAll(input: PromptTemplateInput) {
  return buildPrompt(
    'Build entire project',
    'Produce a phased implementation plan for the full architecture and call out any missing components.',
    input
  )
}

export function buildNode(input: PromptTemplateInput) {
  return buildPrompt(
    'Build selected node',
    'Focus on the selected node set, describe how to implement it, and note upstream or downstream dependencies.',
    input
  )
}

export function buildSubgraph(input: PromptTemplateInput) {
  return buildPrompt(
    'Build selected subgraph',
    'Design and sequence the selected subgraph so the resulting plan is coherent, minimal, and buildable.',
    input
  )
}

export function analyzeProject(input: PromptTemplateInput) {
  return buildPrompt(
    'Analyze project',
    'Review the architecture, identify structural risks, and recommend the simplest viable improvements.',
    input
  )
}

export function refactorNode(input: PromptTemplateInput) {
  return buildPrompt(
    'Refactor selected node',
    'Propose a refactor plan for the selected node set that reduces complexity while preserving behavior.',
    input
  )
}
