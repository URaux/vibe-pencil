import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/lib/types'
import { assignAllEdgeHandles, assignHandles } from '@/lib/edge-utils'

describe('assignHandles', () => {
  it('uses horizontal handles for nodes in the same container', () => {
    const handles = assignHandles(
      {
        id: 'block-a',
        type: 'block',
        parentId: 'container-1',
        position: { x: 0, y: 0 },
        data: { name: 'A', description: '', status: 'idle' },
      },
      {
        id: 'block-b',
        type: 'block',
        parentId: 'container-1',
        position: { x: 200, y: 0 },
        data: { name: 'B', description: '', status: 'idle' },
      }
    )

    expect(handles).toEqual({ sourceHandle: 's-right', targetHandle: 't-left' })
  })

  it('uses vertical handles for cross-container edges when target is below', () => {
    const allNodes: Node<CanvasNodeData>[] = [
      {
        id: 'container-1',
        type: 'container',
        position: { x: 0, y: 0 },
        data: { name: 'C1', color: 'blue', collapsed: false },
      },
      {
        id: 'container-2',
        type: 'container',
        position: { x: 0, y: 400 },
        data: { name: 'C2', color: 'green', collapsed: false },
      },
      {
        id: 'block-a',
        type: 'block',
        parentId: 'container-1',
        position: { x: 24, y: 72 },
        data: { name: 'A', description: '', status: 'idle' },
      },
      {
        id: 'block-b',
        type: 'block',
        parentId: 'container-2',
        position: { x: 24, y: 72 },
        data: { name: 'B', description: '', status: 'idle' },
      },
    ]

    const handles = assignHandles(allNodes[2], allNodes[3], allNodes)

    expect(handles).toEqual({ sourceHandle: 's-bottom', targetHandle: 't-top' })
  })
})

describe('assignAllEdgeHandles', () => {
  it('assigns handles across the full edge list', () => {
    const nodes: Node<CanvasNodeData>[] = [
      {
        id: 'block-a',
        type: 'block',
        parentId: 'container-1',
        position: { x: 0, y: 0 },
        data: { name: 'A', description: '', status: 'idle' as const },
      },
      {
        id: 'block-b',
        type: 'block',
        parentId: 'container-1',
        position: { x: 200, y: 0 },
        data: { name: 'B', description: '', status: 'idle' as const },
      },
      {
        id: 'block-c',
        type: 'block',
        position: { x: 0, y: 240 },
        data: { name: 'C', description: '', status: 'idle' as const },
      },
    ]

    const edges = assignAllEdgeHandles(nodes, [
      { id: 'edge-1', source: 'block-a', target: 'block-b' },
      { id: 'edge-2', source: 'block-b', target: 'block-c' },
    ])

    expect(edges).toEqual([
      expect.objectContaining({
        id: 'edge-1',
        sourceHandle: 's-right',
        targetHandle: 't-left',
      }),
      expect.objectContaining({
        id: 'edge-2',
        sourceHandle: 's-bottom',
        targetHandle: 't-top',
      }),
    ])
  })
})
