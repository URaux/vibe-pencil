import { t } from '@/lib/i18n'
import type { BuildStatus, ContainerColor, ProjectConfig, VPNodeType } from '@/lib/types'

const nodeTypeKeyByType: Record<VPNodeType, string> = {
  container: 'container',
  block: 'block',
}

export function getNodeTypeLabel(type: string | null | undefined) {
  if (!type) {
    return t('nodes')
  }

  return t(nodeTypeKeyByType[type as VPNodeType] ?? 'nodes')
}

export function getBuildStatusLabel(status: BuildStatus) {
  return t(status)
}

export const CONTAINER_COLOR_OPTIONS: ContainerColor[] = [
  'blue',
  'green',
  'purple',
  'amber',
  'rose',
  'slate',
]

export const CONTAINER_COLOR_STYLES: Record<
  ContainerColor,
  { background: string; border: string; title: string }
> = {
  blue: {
    background: 'bg-blue-50',
    border: 'border-blue-300',
    title: 'bg-blue-500',
  },
  green: {
    background: 'bg-green-50',
    border: 'border-green-300',
    title: 'bg-green-500',
  },
  purple: {
    background: 'bg-purple-50',
    border: 'border-purple-300',
    title: 'bg-purple-500',
  },
  amber: {
    background: 'bg-amber-50',
    border: 'border-amber-300',
    title: 'bg-amber-500',
  },
  rose: {
    background: 'bg-rose-50',
    border: 'border-rose-300',
    title: 'bg-rose-500',
  },
  slate: {
    background: 'bg-slate-50',
    border: 'border-slate-300',
    title: 'bg-slate-500',
  },
}

export function getContainerColorClasses(color: string | null | undefined) {
  return CONTAINER_COLOR_STYLES[(color as ContainerColor) ?? 'blue'] ?? CONTAINER_COLOR_STYLES.blue
}

export function formatContainerColorLabel(color: ContainerColor) {
  return color.charAt(0).toUpperCase() + color.slice(1)
}

const backendLabels: Record<ProjectConfig['agent'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
}

export function getAgentBackendLabel(backend: ProjectConfig['agent']) {
  return backendLabels[backend] ?? backend
}
