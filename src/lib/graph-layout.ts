import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'
import { assignAllEdgeHandles } from '@/lib/edge-utils'
import type { CanvasNodeData, ContainerNodeData } from '@/lib/types'

const elk = new ELK()

export const CONTAINER_PADDING = 60
export const CONTAINER_SIDE_PADDING = 30
export const BLOCK_WIDTH = 200
export const BLOCK_HEIGHT = 100
export const CONTAINER_MIN_WIDTH = 400
export const CONTAINER_MIN_HEIGHT = 180
export const COLLAPSED_CONTAINER_HEIGHT = 56

type CanvasNode = Node<CanvasNodeData>
type CanvasEdge = Edge

function cloneNode(node: CanvasNode): CanvasNode {
  return {
    ...node,
    position: { ...node.position },
    data: { ...node.data },
    ...(node.style ? { style: { ...node.style } } : {}),
  }
}

function cloneEdge(edge: CanvasEdge): CanvasEdge {
  return {
    ...edge,
    ...(edge.data ? { data: { ...edge.data } } : {}),
    ...(edge.style ? { style: { ...edge.style } } : {}),
  }
}

export async function layoutArchitectureCanvas(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
  const clonedNodes = nodes.map(cloneNode)
  const clonedEdges = edges.map(cloneEdge)
  const containers = clonedNodes.filter((node) => node.type === 'container')
  const visibleBlocks = clonedNodes.filter((node) => node.type === 'block' && !node.hidden)
  const containerIds = new Set(containers.map((node) => node.id))
  const visibleBlockMap = new Map(visibleBlocks.map((node) => [node.id, node]))
  const orphanIds = new Set<string>()

  const elkChildren: ElkNode[] = containers.map((container) => {
    const childBlocks = visibleBlocks.filter((node) => node.parentId === container.id)

    return {
      id: container.id,
      width: Math.max(
        CONTAINER_MIN_WIDTH,
        typeof container.style?.width === 'number' ? container.style.width : CONTAINER_MIN_WIDTH
      ),
      height:
        (container.data as ContainerNodeData).collapsed
          ? COLLAPSED_CONTAINER_HEIGHT
          : Math.max(
              CONTAINER_MIN_HEIGHT,
              typeof container.style?.height === 'number'
                ? container.style.height
                : CONTAINER_MIN_HEIGHT
            ),
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': `[top=${CONTAINER_PADDING},left=${CONTAINER_SIDE_PADDING},bottom=${CONTAINER_SIDE_PADDING},right=${CONTAINER_SIDE_PADDING}]`,
        'elk.spacing.nodeNode': '40',
        'elk.spacing.edgeNode': '20',
      },
      children: (container.data as ContainerNodeData).collapsed
        ? []
        : childBlocks.map((block) => ({
            id: block.id,
            width: BLOCK_WIDTH,
            height: BLOCK_HEIGHT,
          })),
    }
  })

  const containerMap = new Map(elkChildren.map((child) => [child.id, child]))
  const orphans = visibleBlocks.filter((node) => !node.parentId || !containerIds.has(node.parentId))

  for (const orphan of orphans) {
    orphanIds.add(orphan.id)
    elkChildren.push({ id: orphan.id, width: BLOCK_WIDTH, height: BLOCK_HEIGHT })
  }

  const visibleBlockIds = new Set(visibleBlocks.map((node) => node.id))
  const filteredEdges = clonedEdges.filter(
    (edge) => visibleBlockIds.has(edge.source) && visibleBlockIds.has(edge.target)
  )
  const rootEdges: ElkExtendedEdge[] = []

  for (const edge of filteredEdges) {
    const sourceBlock = visibleBlockMap.get(edge.source)
    const targetBlock = visibleBlockMap.get(edge.target)

    if (sourceBlock?.parentId && sourceBlock.parentId === targetBlock?.parentId) {
      const container = containerMap.get(sourceBlock.parentId)

      if (container) {
        container.edges = container.edges ?? []
        container.edges.push({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })
        continue
      }
    }

    rootEdges.push({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '60',
      'elk.spacing.edgeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: elkChildren,
    edges: rootEdges,
  }

  const layout = await elk.layout(graph)
  const positionMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()

  for (const child of layout.children ?? []) {
    if (containerIds.has(child.id)) {
      positionMap.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width,
        height: child.height,
      })

      for (const block of child.children ?? []) {
        positionMap.set(block.id, {
          x: block.x ?? 0,
          y: block.y ?? 0,
        })
      }

      continue
    }

    if (orphanIds.has(child.id)) {
      positionMap.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
      })
    }
  }

  const layoutNodes = clonedNodes.map((node) => {
    const position = positionMap.get(node.id)

    if (!position) {
      return node
    }

    if (node.type === 'container') {
      const containerData = node.data as ContainerNodeData

      return {
        ...node,
        position: { x: position.x, y: position.y },
        style: {
          ...node.style,
          width: Math.max(CONTAINER_MIN_WIDTH, position.width ?? CONTAINER_MIN_WIDTH),
          height: containerData.collapsed
            ? COLLAPSED_CONTAINER_HEIGHT
            : Math.max(CONTAINER_MIN_HEIGHT, position.height ?? CONTAINER_MIN_HEIGHT),
        },
      }
    }

    return {
      ...node,
      position: { x: position.x, y: position.y },
    }
  })

  return {
    nodes: layoutNodes,
    edges: assignAllEdgeHandles(
      layoutNodes,
      clonedEdges.map((edge) => {
        const sourceBlock = visibleBlockMap.get(edge.source)
        const targetBlock = visibleBlockMap.get(edge.target)
        const isIntraContainer =
          Boolean(sourceBlock?.parentId) && sourceBlock?.parentId === targetBlock?.parentId

        return {
          ...edge,
          data: {
            ...(edge.data ?? {}),
            isIntraContainer,
          },
        }
      })
    ),
  }
}
