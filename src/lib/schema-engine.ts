import type { Edge, Node } from '@xyflow/react'
import { parse, stringify } from 'yaml'
import type { ArchitectNodeData, EdgeType, NodeType } from '@/lib/types'

type CanvasNode = Node<ArchitectNodeData>
type CanvasEdge = Edge

interface SerializedNode {
  id: string
  name: string
  description: string
  status: ArchitectNodeData['status']
  summary?: string
  errorMessage?: string
}

interface SerializedEdge {
  id: string
  source: string
  sourceId: string
  target: string
  targetId: string
  type: string
  label?: string
}

interface SchemaDocument {
  project: string
  nodes: Record<string, SerializedNode[]>
  edges: SerializedEdge[]
}

const NODE_TYPE_GROUPS: Record<NodeType, string> = {
  service: 'services',
  frontend: 'frontends',
  api: 'apis',
  database: 'databases',
  queue: 'queues',
  external: 'externals',
}

const GROUP_TYPE_LOOKUP = Object.fromEntries(
  Object.entries(NODE_TYPE_GROUPS).map(([type, group]) => [group, type as NodeType])
) as Record<string, NodeType>

function getIncludedNodeIds(edges: CanvasEdge[], selectedIds?: string[]) {
  if (!selectedIds?.length) {
    return null
  }

  const included = new Set(selectedIds)
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

  return included
}

function serializeNodes(nodes: CanvasNode[]) {
  const grouped = Object.values(NODE_TYPE_GROUPS).reduce<Record<string, SerializedNode[]>>(
    (acc, group) => {
      acc[group] = []
      return acc
    },
    {}
  )

  for (const node of nodes) {
    const group = NODE_TYPE_GROUPS[node.type as NodeType]

    if (!group) {
      continue
    }

    grouped[group].push({
      id: node.id,
      name: node.data.name,
      description: node.data.description,
      status: node.data.status,
      ...(node.data.summary ? { summary: node.data.summary } : {}),
      ...(node.data.errorMessage ? { errorMessage: node.data.errorMessage } : {}),
    })
  }

  return grouped
}

export function canvasToYaml(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  projectName: string,
  selectedIds?: string[]
) {
  const includedIds = getIncludedNodeIds(edges, selectedIds)
  const filteredNodes = includedIds ? nodes.filter((node) => includedIds.has(node.id)) : nodes
  const nodeMap = new Map(filteredNodes.map((node) => [node.id, node]))
  const filteredEdges = edges
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .map<SerializedEdge>((edge) => ({
      id: edge.id,
      source: nodeMap.get(edge.source)?.data.name ?? edge.source,
      sourceId: edge.source,
      target: nodeMap.get(edge.target)?.data.name ?? edge.target,
      targetId: edge.target,
      type: edge.type ?? 'sync',
      ...(edge.label ? { label: String(edge.label) } : {}),
    }))

  const document: SchemaDocument = {
    project: projectName,
    nodes: serializeNodes(filteredNodes),
    edges: filteredEdges,
  }

  return stringify(document)
}

export function yamlToCanvas(yamlStr: string) {
  const document = parse(yamlStr) as Partial<SchemaDocument> | null
  const nodesByName = new Map<string, string>()
  const nodes: CanvasNode[] = []
  let nodeIndex = 0

  for (const [group, entries] of Object.entries(document?.nodes ?? {})) {
    const type = GROUP_TYPE_LOOKUP[group]

    if (!type || !Array.isArray(entries)) {
      continue
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const serialized = entry as SerializedNode
      const id = serialized.id || `${type}-${nodeIndex + 1}`
      nodesByName.set(serialized.name, id)

      nodes.push({
        id,
        type,
        position: {
          x: (nodeIndex % 3) * 240,
          y: Math.floor(nodeIndex / 3) * 180,
        },
        data: {
          name: serialized.name,
          description: serialized.description,
          status: serialized.status ?? 'idle',
          ...(serialized.summary ? { summary: serialized.summary } : {}),
          ...(serialized.errorMessage ? { errorMessage: serialized.errorMessage } : {}),
        },
      })

      nodeIndex += 1
    }
  }

  const edges = Array.isArray(document?.edges)
    ? document.edges
        .filter((entry): entry is SerializedEdge => Boolean(entry && typeof entry === 'object'))
        .map((edge, index) => ({
          id: edge.id || `edge-${index + 1}`,
          source: edge.sourceId || nodesByName.get(edge.source) || edge.source,
          target: edge.targetId || nodesByName.get(edge.target) || edge.target,
          type: (edge.type || 'sync') as EdgeType,
          ...(edge.label ? { label: edge.label } : {}),
        }))
    : []

  return { nodes, edges }
}
