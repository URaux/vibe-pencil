import { describe, expect, it } from 'vitest'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'

describe('layoutArchitectureCanvas', () => {
  it('assigns positions and sizes to containers and child blocks', async () => {
    const nodes = [
      {
        id: 'container-app',
        type: 'container',
        position: { x: 0, y: 0 },
        style: { width: 400, height: 300 },
        data: { name: 'Application Layer', color: 'blue', collapsed: false },
      },
      {
        id: 'block-web',
        type: 'block',
        parentId: 'container-app',
        extent: 'parent' as const,
        position: { x: 0, y: 0 },
        data: { name: 'Web App', description: 'Client app', status: 'idle' as const },
      },
      {
        id: 'block-api',
        type: 'block',
        parentId: 'container-app',
        extent: 'parent' as const,
        position: { x: 0, y: 0 },
        data: { name: 'API', description: 'Gateway', status: 'idle' as const },
      },
      {
        id: 'block-orphan',
        type: 'block',
        position: { x: 0, y: 0 },
        data: { name: 'Worker', description: 'Background task', status: 'idle' as const },
      },
    ]

    const edges = [
      { id: 'edge-1', source: 'block-web', target: 'block-api', type: 'sync' },
      { id: 'edge-2', source: 'block-api', target: 'block-orphan', type: 'async' },
    ]

    const canvas = await layoutArchitectureCanvas(nodes, edges)
    const container = canvas.nodes.find((node) => node.id === 'container-app')
    const childBlock = canvas.nodes.find((node) => node.id === 'block-web')
    const orphanBlock = canvas.nodes.find((node) => node.id === 'block-orphan')
    const intraContainerEdge = canvas.edges.find((edge) => edge.id === 'edge-1')
    const interContainerEdge = canvas.edges.find((edge) => edge.id === 'edge-2')

    expect(container?.position).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      })
    )
    expect(container?.style).toEqual(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      })
    )
    expect(childBlock?.position).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      })
    )
    expect(childBlock?.parentId).toBe('container-app')
    expect(orphanBlock?.position).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      })
    )
    expect(orphanBlock?.parentId).toBeUndefined()
    expect(intraContainerEdge?.sourceHandle).toBe('s-right')
    expect(intraContainerEdge?.targetHandle).toBe('t-left')
    expect(intraContainerEdge?.data).toEqual(
      expect.objectContaining({
        isIntraContainer: true,
      })
    )
    expect(interContainerEdge?.sourceHandle).toBe('s-bottom')
    expect(interContainerEdge?.targetHandle).toBe('t-top')
    expect(interContainerEdge?.data).toEqual(
      expect.objectContaining({
        isIntraContainer: false,
      })
    )
  })
})
