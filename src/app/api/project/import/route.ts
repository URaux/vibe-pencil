import fs from 'fs'
import type { Edge, Node } from '@xyflow/react'
import { extractAgentText, extractJsonObject } from '@/lib/agent-output'
import { buildSystemContext } from '@/lib/context-engine'
import { agentRunner } from '@/lib/agent-runner-instance'
import type { Locale } from '@/lib/i18n'
import type {
  BlockNodeData,
  BuildStatus,
  CanvasNodeData,
  ContainerColor,
  ContainerNodeData,
  EdgeType,
} from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportProjectRequest {
  dir: string
  backend?: 'claude-code' | 'codex' | 'gemini'
  locale?: Locale // NEW
}

interface JsonLike {
  [key: string]: unknown
}

interface ImportBlock {
  id?: string
  name?: string
  description?: string
  status?: string
  techStack?: string
  summary?: string
  errorMessage?: string
}

interface ImportContainer {
  id?: string
  name?: string
  color?: string
  blocks?: ImportBlock[]
}

interface ImportEdge {
  id?: string
  source?: string
  sourceId?: string
  target?: string
  targetId?: string
  type?: string
  label?: string
}

const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])
const VALID_CONTAINER_COLORS = new Set<ContainerColor>([
  'blue',
  'green',
  'purple',
  'amber',
  'rose',
  'slate',
])

const LEGACY_GROUP_MAP: Record<string, { containerName: string; color: ContainerColor }> = {
  services: { containerName: 'Services', color: 'purple' },
  frontends: { containerName: 'Frontend', color: 'blue' },
  apis: { containerName: 'API Gateway', color: 'green' },
  databases: { containerName: 'Data Layer', color: 'amber' },
  queues: { containerName: 'Message Queue', color: 'slate' },
  externals: { containerName: 'External', color: 'rose' },
}

function isObject(value: unknown): value is JsonLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getBackend(backend?: 'claude-code' | 'codex' | 'gemini') {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini') {
    return backend
  }

  const envBackend = process.env.VIBE_IMPORT_AGENT_BACKEND
  return envBackend === 'codex' || envBackend === 'gemini' ? envBackend : 'claude-code'
}

function buildPrompt(dir: string, locale: Locale = 'en') {
  return buildSystemContext({
    agentType: 'canvas',
    task: 'import',
    locale,
    taskParams: { dir: dir.trim() },
  })
}

async function waitForCompletion(agentId: string, timeoutMs = 300000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const status = agentRunner.getStatus(agentId)

    if (!status) {
      throw new Error('Import agent not found.')
    }

    if (status.status === 'done') {
      if (status.exitCode && status.exitCode !== 0 && !status.output.trim()) {
        throw new Error(
          `Agent exited with code ${status.exitCode}.${status.errorMessage ? ` ${status.errorMessage.slice(0, 200)}` : ''}`
        )
      }
      // Non-zero exit with output — attempt best-effort parse (deliberate: fall through)
      return status
    }

    if (status.status === 'error') {
      const code = status.exitCode
      const stderr = status.errorMessage?.slice(0, 300) ?? ''
      const parts = ['Import agent failed']
      if (code !== undefined && code !== null) parts.push(`(exit code ${code})`)
      if (stderr) parts.push(`: ${stderr}`)
      throw new Error(parts.join(''))
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  agentRunner.stopAgent(agentId)
  throw new Error('Import timed out after 5 minutes. Try a smaller project or a faster backend.')
}

function normalizeContainerColor(color: unknown): ContainerColor {
  return VALID_CONTAINER_COLORS.has(color as ContainerColor) ? (color as ContainerColor) : 'blue'
}

function normalizeBuildStatus(status: unknown): BuildStatus {
  return VALID_BUILD_STATUSES.has(status as BuildStatus) ? (status as BuildStatus) : 'idle'
}

function normalizeNewFormat(root: JsonLike) {
  const nodes: Node<CanvasNodeData>[] = []
  const nodeIds = new Set<string>()

  const containers = Array.isArray(root.containers) ? root.containers : []
  for (const [containerIndex, entry] of containers.entries()) {
    if (!isObject(entry)) {
      continue
    }

    const container = entry as ImportContainer
    const containerId =
      typeof container.id === 'string' && container.id.trim()
        ? container.id
        : `container-${containerIndex + 1}`

    nodes.push({
      id: containerId,
      type: 'container',
      position: { x: 0, y: 0 },
      style: { width: 400, height: 300 },
      data: {
        name:
          typeof container.name === 'string' && container.name.trim()
            ? container.name
            : `Container ${containerIndex + 1}`,
        color: normalizeContainerColor(container.color),
        collapsed: false,
      } satisfies ContainerNodeData,
    })
    nodeIds.add(containerId)

    const blocks = Array.isArray(container.blocks) ? container.blocks : []
    for (const [blockIndex, blockEntry] of blocks.entries()) {
      if (!isObject(blockEntry)) {
        continue
      }

      const block = blockEntry as ImportBlock
      const blockId =
        typeof block.id === 'string' && block.id.trim()
          ? block.id
          : `block-${containerIndex + 1}-${blockIndex + 1}`

      nodes.push({
        id: blockId,
        type: 'block',
        position: { x: 24, y: 72 },
        parentId: containerId,
        extent: 'parent',
        data: {
          name:
            typeof block.name === 'string' && block.name.trim() ? block.name : blockId,
          description: typeof block.description === 'string' ? block.description : '',
          status: normalizeBuildStatus(block.status),
          ...(typeof block.techStack === 'string' ? { techStack: block.techStack } : {}),
          ...(typeof block.summary === 'string' ? { summary: block.summary } : {}),
          ...(typeof block.errorMessage === 'string'
            ? { errorMessage: block.errorMessage }
            : {}),
        } satisfies BlockNodeData,
      })
      nodeIds.add(blockId)
    }
  }

  const edges = normalizeEdges(root.edges, nodeIds)
  return { nodes, edges }
}

function normalizeLegacyFormat(root: JsonLike) {
  const nodes: Node<CanvasNodeData>[] = []
  const nodeIds = new Set<string>()
  const nameToId = new Map<string, string>()

  const groups = isObject(root.nodes) ? root.nodes : {}
  let containerIndex = 0

  for (const [group, value] of Object.entries(groups)) {
    const mapping = LEGACY_GROUP_MAP[group]
    if (!mapping || !Array.isArray(value)) {
      continue
    }

    containerIndex += 1
    const containerId = `legacy-${group}`
    nodes.push({
      id: containerId,
      type: 'container',
      position: { x: 0, y: 0 },
      style: { width: 400, height: 300 },
      data: {
        name: mapping.containerName,
        color: mapping.color,
        collapsed: false,
      } satisfies ContainerNodeData,
    })
    nodeIds.add(containerId)

    for (const [blockIndex, blockEntry] of value.entries()) {
      if (!isObject(blockEntry)) {
        continue
      }

      const block = blockEntry as ImportBlock
      const blockId =
        typeof block.id === 'string' && block.id.trim()
          ? block.id
          : `block-${containerIndex}-${blockIndex + 1}`

      nameToId.set(typeof block.name === 'string' ? block.name : blockId, blockId)
      nodes.push({
        id: blockId,
        type: 'block',
        position: { x: 24, y: 72 },
        parentId: containerId,
        extent: 'parent',
        data: {
          name:
            typeof block.name === 'string' && block.name.trim() ? block.name : blockId,
          description: typeof block.description === 'string' ? block.description : '',
          status: normalizeBuildStatus(block.status),
          ...(typeof block.techStack === 'string' ? { techStack: block.techStack } : {}),
          ...(typeof block.summary === 'string' ? { summary: block.summary } : {}),
          ...(typeof block.errorMessage === 'string'
            ? { errorMessage: block.errorMessage }
            : {}),
        } satisfies BlockNodeData,
      })
      nodeIds.add(blockId)
    }
  }

  const edges = Array.isArray(root.edges)
    ? root.edges.flatMap((entry, index) => {
        if (!isObject(entry)) {
          return []
        }

        const edge = entry as ImportEdge
        const source = edge.sourceId || nameToId.get(edge.source ?? '') || edge.source
        const target = edge.targetId || nameToId.get(edge.target ?? '') || edge.target

        if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
          return []
        }

        return [
          {
            id:
              typeof edge.id === 'string' && edge.id.trim()
                ? edge.id
                : `edge-${index + 1}`,
            source,
            target,
            type: VALID_EDGE_TYPES.has(edge.type as EdgeType) ? (edge.type as EdgeType) : 'sync',
            ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
          } satisfies Edge,
        ]
      })
    : []

  return { nodes, edges }
}

function normalizeEdges(rawEdges: unknown, nodeIds: Set<string>) {
  if (!Array.isArray(rawEdges)) {
    return []
  }

  return rawEdges.flatMap((entry, index) => {
    if (!isObject(entry)) {
      return []
    }

    const edge = entry as ImportEdge
    if (
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target)
    ) {
      return []
    }

    return [
      {
        id:
          typeof edge.id === 'string' && edge.id.trim() ? edge.id : `edge-${index + 1}`,
        source: edge.source,
        target: edge.target,
        type: VALID_EDGE_TYPES.has(edge.type as EdgeType) ? (edge.type as EdgeType) : 'sync',
        ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
      } satisfies Edge,
    ]
  })
}

function normalizeCanvas(payload: unknown) {
  const root = isObject(payload) && isObject(payload.canvas) ? payload.canvas : payload
  if (!isObject(root)) {
    throw new Error('Agent did not return a JSON object.')
  }
  // Try new format first, fall back to legacy if no nodes produced
  let canvas = normalizeNewFormat(root)
  if (canvas.nodes.length === 0 && isObject(root.nodes)) {
    canvas = normalizeLegacyFormat(root)
  }
  if (canvas.nodes.length === 0) {
    throw new Error('Agent did not return any importable nodes.')
  }
  return canvas
}

export async function POST(request: Request) {
  const { dir, backend, locale } = (await request.json()) as ImportProjectRequest

  if (!dir?.trim()) {
    return Response.json({ error: 'Project directory path cannot be empty.' }, { status: 400 })
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return Response.json({ error: 'Project directory does not exist.' }, { status: 400 })
  }

  try {
    const agentId = agentRunner.spawnAgent(
      'project-import',
      buildPrompt(dir, locale),
      getBackend(backend),
      dir
    )
    const status = await waitForCompletion(agentId)
    const agentText = extractAgentText(status.output)
    const parsed = extractJsonObject(agentText)

    if (!parsed) {
      throw new Error('Could not parse structured JSON from the import agent output.')
    }

    const canvas = normalizeCanvas(parsed)
    return Response.json(canvas)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Project import failed.' },
      { status: 500 }
    )
  }
}
