import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from './types'

/**
 * Given two block nodes, return the most suitable source/target handles for the edge.
 * Blocks inside the same container are laid out horizontally, while cross-container
 * connections use absolute position to determine the best direction.
 */
export function assignHandles(
  sourceNode: Node<CanvasNodeData>,
  targetNode: Node<CanvasNodeData>,
  allNodes?: Node<CanvasNodeData>[]
): { sourceHandle: string; targetHandle: string } {
  const sameContainer =
    Boolean(sourceNode.parentId) && sourceNode.parentId === targetNode.parentId

  if (sameContainer) {
    const deltaX = targetNode.position.x - sourceNode.position.x

    return deltaX >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' }
  }

  // Cross-container: compute absolute positions to determine best handle direction
  const nodeMap = allNodes ? new Map(allNodes.map((n) => [n.id, n])) : undefined

  function absoluteCenter(node: Node<CanvasNodeData>): { x: number; y: number } {
    let x = node.position.x
    let y = node.position.y
    if (node.parentId && nodeMap) {
      const parent = nodeMap.get(node.parentId)
      if (parent) {
        x += parent.position.x
        y += parent.position.y
      }
    }
    return { x: x + 100, y: y + 50 }
  }

  const srcCenter = absoluteCenter(sourceNode)
  const tgtCenter = absoluteCenter(targetNode)
  const dx = tgtCenter.x - srcCenter.x
  const dy = tgtCenter.y - srcCenter.y

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
      : { sourceHandle: 's-top', targetHandle: 't-bottom' }
  }

  return dx >= 0
    ? { sourceHandle: 's-right', targetHandle: 't-left' }
    : { sourceHandle: 's-left', targetHandle: 't-right' }
}

export function assignAllEdgeHandles(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[]
): Edge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  return edges.map((edge) => {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)

    if (!sourceNode || !targetNode) {
      return edge
    }

    const { sourceHandle, targetHandle } = assignHandles(sourceNode, targetNode, nodes)

    return {
      ...edge,
      sourceHandle,
      targetHandle,
    }
  })
}
