import fs from 'fs'
import type { Edge, Node } from '@xyflow/react'
import { extractAgentText, extractJsonObject } from '@/lib/agent-output'
import { analyzeProject } from '@/lib/prompt-templates'
import { agentRunner } from '@/lib/agent-runner-instance'
import type { ArchitectNodeData, BuildStatus, EdgeType, NodeType } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportProjectRequest {
  dir: string
}

interface JsonLike {
  [key: string]: unknown
}

const VALID_NODE_TYPES = new Set<NodeType>(['service', 'frontend', 'api', 'database', 'queue', 'external'])
const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])

function isObject(value: unknown): value is JsonLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getBackend() {
  return process.env.VIBE_IMPORT_AGENT_BACKEND === 'codex' ? 'codex' : 'claude-code'
}

function buildPrompt(dir: string) {
  return [
    analyzeProject({
      architecture_yaml: 'No architecture YAML exists yet. Infer architecture directly from the current workspace.',
      project_context: `Import source directory: ${dir}`,
      user_feedback:
        'Reverse-engineer the current codebase into a React Flow architecture canvas. Favor a compact but meaningful graph.',
    }),
    '',
    'Return structured JSON for React Flow and nothing else, unless you need a fenced ```json block.',
    'The JSON shape must be:',
    '{',
    '  "nodes": [',
    '    {',
    '      "id": "frontend-app",',
    '      "type": "frontend",',
    '      "position": { "x": 0, "y": 0 },',
    '      "data": {',
    '        "name": "Frontend App",',
    '        "description": "What this part does",',
    '        "status": "idle"',
    '      }',
    '    }',
    '  ],',
    '  "edges": [',
    '    {',
    '      "id": "edge-1",',
    '      "source": "frontend-app",',
    '      "target": "api-gateway",',
    '      "type": "sync",',
    '      "label": "HTTPS"',
    '    }',
    '  ]',
    '}',
    'Use only these node types: service, frontend, api, database, queue, external.',
    'Use only these edge types: sync, async, bidirectional.',
  ].join('\n')
}

async function waitForCompletion(agentId: string, timeoutMs = 300000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const status = agentRunner.getStatus(agentId)

    if (!status) {
      throw new Error('未找到导入代理。')
    }

    if (status.status === 'done') {
      return status
    }

    if (status.status === 'error') {
      throw new Error(status.errorMessage ?? '项目导入失败。')
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  agentRunner.stopAgent(agentId)
  throw new Error('项目导入超时。')
}

function normalizeNodes(rawNodes: unknown): Node<ArchitectNodeData>[] {
  if (!Array.isArray(rawNodes)) {
    return []
  }

  return rawNodes.flatMap((entry, index) => {
    if (!isObject(entry)) {
      return []
    }

    const data = isObject(entry.data) ? entry.data : {}
    const type = VALID_NODE_TYPES.has(entry.type as NodeType) ? (entry.type as NodeType) : 'service'
    const id =
      typeof entry.id === 'string' && entry.id.trim() ? entry.id : `${type}-${index + 1}`
    const statusCandidate =
      typeof data.status === 'string'
        ? data.status
        : typeof entry.status === 'string'
          ? entry.status
          : 'idle'

    return [
      {
        id,
        type,
        position: {
          x: isObject(entry.position) && typeof entry.position.x === 'number' ? entry.position.x : (index % 3) * 240,
          y:
            isObject(entry.position) && typeof entry.position.y === 'number'
              ? entry.position.y
              : Math.floor(index / 3) * 180,
        },
        data: {
          name:
            typeof data.name === 'string'
              ? data.name
              : typeof entry.name === 'string'
                ? entry.name
                : id,
          description:
            typeof data.description === 'string'
              ? data.description
              : typeof entry.description === 'string'
                ? entry.description
                : '',
          status: VALID_BUILD_STATUSES.has(statusCandidate as BuildStatus)
            ? (statusCandidate as BuildStatus)
            : 'idle',
          ...(typeof data.summary === 'string' ? { summary: data.summary } : {}),
          ...(typeof data.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
        },
      },
    ]
  })
}

function normalizeEdges(rawEdges: unknown, nodeIds: Set<string>): Edge[] {
  if (!Array.isArray(rawEdges)) {
    return []
  }

  return rawEdges.flatMap((entry, index) => {
    if (!isObject(entry) || typeof entry.source !== 'string' || typeof entry.target !== 'string') {
      return []
    }

    if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
      return []
    }

    const type = VALID_EDGE_TYPES.has(entry.type as EdgeType) ? (entry.type as EdgeType) : 'sync'

    return [
      {
        id:
          typeof entry.id === 'string' && entry.id.trim() ? entry.id : `edge-${index + 1}`,
        source: entry.source,
        target: entry.target,
        type,
        ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
      },
    ]
  })
}

function normalizeCanvas(payload: unknown) {
  const root = isObject(payload) && isObject(payload.canvas) ? payload.canvas : payload

  if (!isObject(root)) {
    throw new Error('代理没有返回 JSON 对象。')
  }

  const nodes = normalizeNodes(root.nodes)

  if (nodes.length === 0) {
    throw new Error('代理没有返回可导入的节点。')
  }

  const edges = normalizeEdges(root.edges, new Set(nodes.map((node) => node.id)))

  return { nodes, edges }
}

export async function POST(request: Request) {
  const { dir } = (await request.json()) as ImportProjectRequest

  if (!dir?.trim()) {
    return Response.json({ error: '项目目录路径不能为空。' }, { status: 400 })
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return Response.json({ error: '项目目录不存在。' }, { status: 400 })
  }

  try {
    const agentId = agentRunner.spawnAgent('project-import', buildPrompt(dir), getBackend(), dir)
    const status = await waitForCompletion(agentId)
    const agentText = extractAgentText(status.output)
    const parsed = extractJsonObject(agentText)

    if (!parsed) {
      throw new Error('无法从代理输出中解析结构化 JSON。')
    }

    const canvas = normalizeCanvas(parsed)

    return Response.json(canvas)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '项目导入失败。' },
      { status: 500 }
    )
  }
}
