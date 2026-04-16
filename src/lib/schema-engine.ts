import type { Edge, Node } from '@xyflow/react'
import { parse, stringify } from 'yaml'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'
import type {
  BlockSchema,
  BlockNodeData,
  CanvasNodeData,
  ContainerColor,
  ContainerNodeData,
  EdgeType,
} from '@/lib/types'

type CanvasNode = Node<CanvasNodeData>
type CanvasEdge = Edge

interface SerializedBlock {
  id: string
  name: string
  description: string
  status: string
  schema?: BlockSchema
  schemaRefs?: string[]
  schemaFieldRefs?: Record<string, string[]>
  techStack?: string
  summary?: string
  errorMessage?: string
}

interface SerializedContainer {
  id: string
  name: string
  color: string
  blocks: SerializedBlock[]
}

interface SerializedEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string
}

interface SchemaDocument {
  project: string
  containers: SerializedContainer[]
  edges: SerializedEdge[]
}

interface LegacySerializedNode {
  id: string
  name: string
  description: string
  status?: string
  techStack?: string
  summary?: string
  errorMessage?: string
}

interface LegacySerializedEdge extends SerializedEdge {
  sourceId?: string
  targetId?: string
}

interface LegacySchemaDocument {
  project?: string
  nodes?: Record<string, LegacySerializedNode[]>
  edges?: LegacySerializedEdge[]
}

const UNGROUPED_CONTAINER: SerializedContainer = {
  id: 'ungrouped',
  name: 'Ungrouped',
  color: 'slate',
  blocks: [],
}

const LEGACY_GROUP_MAP: Record<string, { containerName: string; color: ContainerColor }> = {
  services: { containerName: 'Services', color: 'purple' },
  frontends: { containerName: 'Frontend', color: 'blue' },
  apis: { containerName: 'API Gateway', color: 'green' },
  databases: { containerName: 'Data Layer', color: 'amber' },
  queues: { containerName: 'Message Queue', color: 'slate' },
  externals: { containerName: 'External', color: 'rose' },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getIncludedNodeIds(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedIds?: string[]
) {
  if (!selectedIds?.length) {
    return null
  }

  const included = new Set(selectedIds)

  for (const node of nodes) {
    if (included.has(node.id) && node.type === 'container') {
      for (const child of nodes) {
        if (child.parentId === node.id) {
          included.add(child.id)
        }
      }
    }
  }

  let changed = true

  while (changed) {
    changed = false

    for (const edge of edges) {
      if (!included.has(edge.source) && !included.has(edge.target)) {
        continue
      }

      if (!included.has(edge.source)) {
        included.add(edge.source)
        changed = true
      }

      if (!included.has(edge.target)) {
        included.add(edge.target)
        changed = true
      }
    }
  }

  for (const node of nodes) {
    if (node.type === 'block' && node.parentId && included.has(node.id)) {
      included.add(node.parentId)
    }
  }

  return included
}

function toSerializedBlock(node: Node<BlockNodeData>): SerializedBlock {
  return {
    id: node.id,
    name: node.data.name,
    description: node.data.description,
    status: node.data.status,
    ...(node.data.schema ? { schema: node.data.schema } : {}),
    ...(node.data.schemaRefs ? { schemaRefs: node.data.schemaRefs } : {}),
    ...(node.data.schemaFieldRefs ? { schemaFieldRefs: node.data.schemaFieldRefs } : {}),
    ...(node.data.techStack ? { techStack: node.data.techStack } : {}),
    ...(node.data.summary ? { summary: node.data.summary } : {}),
    ...(node.data.errorMessage ? { errorMessage: node.data.errorMessage } : {}),
  }
}

function normalizeEdgeType(type: string | undefined): EdgeType {
  return type === 'async' || type === 'bidirectional' ? type : 'sync'
}

function normalizeContainerColor(color: string | undefined): ContainerColor {
  if (
    color === 'blue' ||
    color === 'green' ||
    color === 'purple' ||
    color === 'amber' ||
    color === 'rose' ||
    color === 'slate'
  ) {
    return color
  }

  return 'blue'
}

function buildContainerNode(container: SerializedContainer): Node<ContainerNodeData> {
  return {
    id: container.id,
    type: 'container',
    position: { x: 0, y: 0 },
    style: { width: 400, height: 300 },
    data: {
      name: container.name,
      color: normalizeContainerColor(container.color),
      collapsed: false,
    },
  }
}

function buildBlockNode(
  block: SerializedBlock,
  containerId?: string
): Node<BlockNodeData> {
  return {
    id: block.id,
    type: 'block',
    position: { x: 0, y: 0 },
    ...(containerId ? { parentId: containerId, extent: 'parent' as const } : {}),
    data: {
      name: block.name,
      description: block.description,
      status:
        block.status === 'building' ||
        block.status === 'done' ||
        block.status === 'error'
          ? block.status
          : 'idle',
      ...(block.schema ? { schema: block.schema } : {}),
      ...(block.schemaRefs ? { schemaRefs: block.schemaRefs } : {}),
      ...(block.schemaFieldRefs ? { schemaFieldRefs: block.schemaFieldRefs } : {}),
      ...(block.techStack ? { techStack: block.techStack } : {}),
      ...(block.summary ? { summary: block.summary } : {}),
      ...(block.errorMessage ? { errorMessage: block.errorMessage } : {}),
    },
  }
}

function normalizeLegacyDocument(input: LegacySchemaDocument): SchemaDocument {
  const containers: SerializedContainer[] = []
  const nameToId = new Map<string, string>()

  for (const [group, entries] of Object.entries(input.nodes ?? {})) {
    const mapping = LEGACY_GROUP_MAP[group]

    if (!mapping || !Array.isArray(entries)) {
      continue
    }

    const containerId = `legacy-${group}`
    const blocks = entries
      .filter((entry): entry is LegacySerializedNode => isObject(entry))
      .map((entry, index) => {
        const id = entry.id || `${group}-${index + 1}`
        nameToId.set(entry.name, id)

        return {
          id,
          name: entry.name ?? id,
          description: entry.description ?? '',
          status: entry.status ?? 'idle',
          ...(entry.techStack ? { techStack: entry.techStack } : {}),
          ...(entry.summary ? { summary: entry.summary } : {}),
          ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
        }
      })

    containers.push({
      id: containerId,
      name: mapping.containerName,
      color: mapping.color,
      blocks,
    })
  }

  const edges = Array.isArray(input.edges)
    ? input.edges.map((edge, index) => ({
        id: edge.id || `edge-${index + 1}`,
        source: edge.sourceId || nameToId.get(edge.source) || edge.source,
        target: edge.targetId || nameToId.get(edge.target) || edge.target,
        type: edge.type || 'sync',
        ...(edge.label ? { label: edge.label } : {}),
      }))
    : []

  return {
    project: input.project || 'Untitled Project',
    containers,
    edges,
  }
}

function normalizeSchemaDocument(input: unknown): SchemaDocument {
  if (!isObject(input)) {
    return { project: 'Untitled Project', containers: [], edges: [] }
  }

  if (isObject(input.nodes)) {
    return normalizeLegacyDocument(input as LegacySchemaDocument)
  }

  const containers = Array.isArray(input.containers)
    ? input.containers
        .filter((entry): entry is SerializedContainer => isObject(entry))
        .map((entry, index) => ({
          id:
            typeof entry.id === 'string' && entry.id.trim()
              ? entry.id
              : `container-${index + 1}`,
          name:
            typeof entry.name === 'string' && entry.name.trim()
              ? entry.name
              : `Container ${index + 1}`,
          color: normalizeContainerColor(
            typeof entry.color === 'string' ? entry.color : undefined
          ),
          blocks: Array.isArray(entry.blocks)
            ? entry.blocks
                .filter((block): block is SerializedBlock => isObject(block))
                .map((block, blockIndex) => ({
                  id:
                    typeof block.id === 'string' && block.id.trim()
                      ? block.id
                      : `block-${index + 1}-${blockIndex + 1}`,
                  name:
                    typeof block.name === 'string' && block.name.trim()
                      ? block.name
                      : `Block ${blockIndex + 1}`,
                  description:
                    typeof block.description === 'string' ? block.description : '',
                  status: typeof block.status === 'string' ? block.status : 'idle',
                  ...(isObject(block.schema) ? { schema: block.schema as BlockSchema } : {}),
                  ...(Array.isArray(block.schemaRefs)
                    ? {
                        schemaRefs: block.schemaRefs.filter(
                          (ref): ref is string => typeof ref === 'string' && ref.trim().length > 0
                        ),
                      }
                    : {}),
                  ...(isObject(block.schemaFieldRefs)
                    ? {
                        schemaFieldRefs: Object.fromEntries(
                          Object.entries(block.schemaFieldRefs)
                            .filter(([tableName, fields]) =>
                              typeof tableName === 'string' &&
                              tableName.trim().length > 0 &&
                              Array.isArray(fields) &&
                              fields.some((field) => typeof field === 'string' && field.trim().length > 0)
                            )
                            .map(([tableName, fields]) => [
                              tableName,
                              fields
                                .filter((field) => typeof field === 'string' && field.trim().length > 0)
                                .map((field) => field.trim()),
                            ])
                        ),
                      }
                    : {}),
                  ...(typeof block.techStack === 'string'
                    ? { techStack: block.techStack }
                    : {}),
                  ...(typeof block.summary === 'string' ? { summary: block.summary } : {}),
                  ...(typeof block.errorMessage === 'string'
                    ? { errorMessage: block.errorMessage }
                    : {}),
                }))
            : [],
        }))
    : []

  const edges = Array.isArray(input.edges)
    ? input.edges
        .filter((entry): entry is SerializedEdge => isObject(entry))
        .map((edge, index) => ({
          id:
            typeof edge.id === 'string' && edge.id.trim()
              ? edge.id
              : `edge-${index + 1}`,
          source: typeof edge.source === 'string' ? edge.source : '',
          target: typeof edge.target === 'string' ? edge.target : '',
          type: typeof edge.type === 'string' ? edge.type : 'sync',
          ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
        }))
        .filter((edge) => edge.source && edge.target)
    : []

  return {
    project: typeof input.project === 'string' && input.project.trim() ? input.project : 'Untitled Project',
    containers,
    edges,
  }
}

export function canvasToYaml(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  projectName: string,
  selectedIds?: string[]
) {
  const includedIds = getIncludedNodeIds(nodes, edges, selectedIds)
  const filteredNodes = includedIds ? nodes.filter((node) => includedIds.has(node.id)) : nodes
  const filteredEdges = edges.filter(
    (edge) =>
      filteredNodes.some((node) => node.id === edge.source) &&
      filteredNodes.some((node) => node.id === edge.target)
  )

  const containers = filteredNodes.filter(
    (node): node is Node<ContainerNodeData> => node.type === 'container'
  )
  const blocks = filteredNodes.filter(
    (node): node is Node<BlockNodeData> => node.type === 'block'
  )
  const serializedContainers: SerializedContainer[] = containers.map((container) => ({
    id: container.id,
    name: container.data.name,
    color: container.data.color,
    blocks: blocks
      .filter((block) => block.parentId === container.id)
      .map(toSerializedBlock),
  }))

  const orphanBlocks = blocks.filter(
    (block) => !block.parentId || !containers.some((container) => container.id === block.parentId)
  )

  if (orphanBlocks.length > 0) {
    serializedContainers.push({
      ...UNGROUPED_CONTAINER,
      blocks: orphanBlocks.map(toSerializedBlock),
    })
  }

  const document: SchemaDocument = {
    project: projectName,
    containers: serializedContainers,
    edges: filteredEdges.map((edge, index) => ({
      id: edge.id || `edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
      type: edge.type ?? 'sync',
      ...(edge.label ? { label: String(edge.label) } : {}),
    })),
  }

  return stringify(document)
}

export function exportProjectJson(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  projectName: string,
  config: import('./types').ProjectConfig
): string {
  return JSON.stringify({
    projectName,
    config,
    canvas: { nodes, edges },
    exportedAt: new Date().toISOString(),
    version: '1.0',
  }, null, 2)
}

export function canvasToMermaid(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  projectName: string
): string {
  const containers = nodes.filter(
    (node): node is Node<ContainerNodeData> => node.type === 'container'
  )
  const blocks = nodes.filter(
    (node): node is Node<BlockNodeData> => node.type === 'block'
  )

  const lines: string[] = [`graph TB`]
  lines.push(`    %% ${projectName}`)

  // Build id-safe label map
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_')

  for (const container of containers) {
    const containerBlocks = blocks.filter((b) => b.parentId === container.id)
    if (containerBlocks.length === 0) {
      lines.push(`    ${safeId(container.id)}["${container.data.name}"]`)
    } else {
      lines.push(`    subgraph ${safeId(container.id)}["${container.data.name}"]`)
      for (const block of containerBlocks) {
        lines.push(`        ${safeId(block.id)}["${block.data.name}"]`)
      }
      lines.push(`    end`)
    }
  }

  // Orphan blocks (no parent container)
  const orphans = blocks.filter(
    (b) => !b.parentId || !containers.some((c) => c.id === b.parentId)
  )
  for (const block of orphans) {
    lines.push(`    ${safeId(block.id)}["${block.data.name}"]`)
  }

  // Edges
  for (const edge of edges) {
    const src = safeId(edge.source)
    const tgt = safeId(edge.target)
    const label = edge.label ? String(edge.label) : ''
    if (edge.type === 'async') {
      lines.push(label ? `    ${src} -.->|${label}| ${tgt}` : `    ${src} -.-> ${tgt}`)
    } else if (edge.type === 'bidirectional') {
      lines.push(label ? `    ${src} <-->|${label}| ${tgt}` : `    ${src} <--> ${tgt}`)
    } else {
      lines.push(label ? `    ${src} -->|${label}| ${tgt}` : `    ${src} --> ${tgt}`)
    }
  }

  return lines.join('\n')
}

export async function yamlToCanvas(yamlStr: string) {
  const document = normalizeSchemaDocument(parse(yamlStr) as unknown)
  const nodes: CanvasNode[] = []
  const nodeIds = new Set<string>()

  for (const container of document.containers) {
    nodes.push(buildContainerNode(container))
    nodeIds.add(container.id)

    for (const block of container.blocks) {
      nodes.push(buildBlockNode(block, container.id))
      nodeIds.add(block.id)
    }
  }

  const edges: CanvasEdge[] = document.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: normalizeEdgeType(edge.type),
      ...(edge.label ? { label: edge.label } : {}),
    }))

  return layoutArchitectureCanvas(nodes, edges)
}
