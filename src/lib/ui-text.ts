import type { BuildStatus, NodeType, ProjectConfig } from '@/lib/types'

export const nodeTypeLabels: Record<NodeType, string> = {
  service: '服务',
  frontend: '前端',
  api: '接口',
  database: '数据库',
  queue: '消息队列',
  external: '外部服务',
}

export const buildStatusLabels: Record<BuildStatus, string> = {
  idle: '未开始',
  building: '构建中',
  done: '就绪',
  error: '需要关注',
}

export const agentBackendLabels: Record<ProjectConfig['agent'], string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

export function getNodeTypeLabel(type: string | null | undefined) {
  if (!type) {
    return '节点'
  }

  return nodeTypeLabels[type as NodeType] ?? '节点'
}
