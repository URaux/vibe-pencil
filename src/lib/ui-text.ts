import { t } from '@/lib/i18n'
import type { BuildStatus, NodeType, ProjectConfig } from '@/lib/types'

const nodeTypeKeyByType: Record<NodeType, string> = {
  service: 'service',
  frontend: 'frontend',
  api: 'api',
  database: 'database',
  queue: 'queue',
  external: 'external',
}

export function getNodeTypeLabel(type: string | null | undefined) {
  if (!type) {
    return t('nodes')
  }

  return t(nodeTypeKeyByType[type as NodeType] ?? 'nodes')
}

export function getBuildStatusLabel(status: BuildStatus) {
  return t(status)
}

export function getAgentBackendLabel(backend: ProjectConfig['agent']) {
  return backend === 'claude-code' ? 'Claude Code' : 'Codex'
}
