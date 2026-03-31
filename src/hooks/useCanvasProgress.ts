import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import { useAppStore } from '@/lib/store'
import type { BlockNodeData, CanvasNodeData, ContainerColor, ContainerNodeData } from '@/lib/types'

export interface ContainerProgress {
  id: string
  name: string
  color: ContainerColor
  total: number
  done: number      // status === 'done' || status === 'imported'
  building: number  // status === 'building'
  error: number     // status === 'error'
  blocked: number   // status === 'blocked'
  errorNodes: Array<{ id: string; name: string; error?: string }>
  buildingNodes: Array<{ id: string; name: string }>
  progress: number  // 0-1
}

export interface CanvasProgress {
  totalBlocks: number
  doneBlocks: number
  buildingBlocks: number
  errorBlocks: number
  percentage: number  // 0-100
  containers: ContainerProgress[]
  errorNodes: Array<{ id: string; name: string; error?: string }>
  buildingNodes: Array<{ id: string; name: string }>
}

function isBlockNode(node: Node<CanvasNodeData>): node is Node<BlockNodeData> {
  return node.type === 'block'
}

function isContainerNode(node: Node<CanvasNodeData>): node is Node<ContainerNodeData> {
  return node.type === 'container'
}

export function useCanvasProgress(): CanvasProgress {
  const nodes = useAppStore((state) => state.nodes)

  return useMemo(() => {
    const blocks = nodes.filter(isBlockNode)
    const containers = nodes.filter(isContainerNode)

    const totalBlocks = blocks.length
    const doneBlocks = blocks.filter(
      (b) => b.data.status === 'done' || (b.data.status as string) === 'imported'
    ).length
    const buildingBlocks = blocks.filter((b) => b.data.status === 'building').length
    const errorBlocks = blocks.filter((b) => b.data.status === 'error').length
    const percentage = totalBlocks === 0 ? 0 : Math.round((doneBlocks / totalBlocks) * 100)

    const containerProgresses: ContainerProgress[] = containers.map((container) => {
      const childBlocks = blocks.filter((b) => b.parentId === container.id)
      const done = childBlocks.filter(
        (b) => b.data.status === 'done' || (b.data.status as string) === 'imported'
      ).length
      const building = childBlocks.filter((b) => b.data.status === 'building').length
      const error = childBlocks.filter((b) => b.data.status === 'error').length
      const blocked = childBlocks.filter((b) => b.data.status === 'blocked').length
      const total = childBlocks.length
      const progress = total === 0 ? 0 : done / total

      const errorNodes = childBlocks
        .filter((b) => b.data.status === 'error')
        .map((b) => ({ id: b.id, name: b.data.name, error: b.data.errorMessage }))

      const buildingNodes = childBlocks
        .filter((b) => b.data.status === 'building')
        .map((b) => ({ id: b.id, name: b.data.name }))

      return {
        id: container.id,
        name: (container.data as ContainerNodeData).name,
        color: (container.data as ContainerNodeData).color,
        total,
        done,
        building,
        error,
        blocked,
        errorNodes,
        buildingNodes,
        progress,
      }
    })

    // Orphan blocks (no parent container)
    const orphanBlocks = blocks.filter((b) => !b.parentId)
    if (orphanBlocks.length > 0) {
      const done = orphanBlocks.filter(
        (b) => b.data.status === 'done' || (b.data.status as string) === 'imported'
      ).length
      const building = orphanBlocks.filter((b) => b.data.status === 'building').length
      const error = orphanBlocks.filter((b) => b.data.status === 'error').length
      const blocked = orphanBlocks.filter((b) => b.data.status === 'blocked').length
      const total = orphanBlocks.length

      containerProgresses.push({
        id: '__orphan__',
        name: '(ungrouped)',
        color: 'slate',
        total,
        done,
        building,
        error,
        blocked,
        errorNodes: orphanBlocks
          .filter((b) => b.data.status === 'error')
          .map((b) => ({ id: b.id, name: b.data.name, error: b.data.errorMessage })),
        buildingNodes: orphanBlocks
          .filter((b) => b.data.status === 'building')
          .map((b) => ({ id: b.id, name: b.data.name })),
        progress: total === 0 ? 0 : done / total,
      })
    }

    const allErrorNodes = blocks
      .filter((b) => b.data.status === 'error')
      .map((b) => ({ id: b.id, name: b.data.name, error: b.data.errorMessage }))

    const allBuildingNodes = blocks
      .filter((b) => b.data.status === 'building')
      .map((b) => ({ id: b.id, name: b.data.name }))

    return {
      totalBlocks,
      doneBlocks,
      buildingBlocks,
      errorBlocks,
      percentage,
      containers: containerProgresses,
      errorNodes: allErrorNodes,
      buildingNodes: allBuildingNodes,
    }
  }, [nodes])
}
