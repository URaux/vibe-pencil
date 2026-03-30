import { describe, expect, it } from 'vitest'
import { canvasToYaml, yamlToCanvas } from '@/lib/schema-engine'

describe('schema-engine', () => {
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
      position: { x: 24, y: 72 },
      data: {
        name: 'Web App',
        description: 'User-facing application',
        status: 'idle' as const,
        techStack: 'Next.js 16',
      },
    },
    {
      id: 'block-api',
      type: 'block',
      position: { x: 460, y: 140 },
      data: {
        name: 'API Gateway',
        description: 'Gateway',
        status: 'idle' as const,
      },
    },
  ]

  const edges = [
    { id: 'edge-1', source: 'block-web', target: 'block-api', type: 'sync', label: 'HTTPS' },
  ]

  it('serializes the new container/block format', () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project')

    expect(yaml).toContain('containers:')
    expect(yaml).toContain('name: Application Layer')
    expect(yaml).toContain('techStack: Next.js 16')
    expect(yaml).toContain('id: ungrouped')
    expect(yaml).not.toContain('position:')
  })

  it('includes connected blocks when exporting a selected subgraph', () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project', ['block-web'])

    expect(yaml).toContain('Web App')
    expect(yaml).toContain('API Gateway')
    expect(yaml).toContain('edge-1')
  })

  it('parses the new format back into canvas nodes', async () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project')
    const canvas = await yamlToCanvas(yaml)

    expect(canvas.nodes.some((node) => node.type === 'container')).toBe(true)
    expect(canvas.nodes.some((node) => node.type === 'block' && node.parentId === 'container-app')).toBe(true)
    expect(canvas.edges).toEqual([
      expect.objectContaining({
        source: 'block-web',
        target: 'block-api',
        type: 'sync',
        label: 'HTTPS',
      }),
    ])
  })

  it('migrates the legacy grouped format', async () => {
    const legacyYaml = `
project: Legacy Project
nodes:
  services:
    - id: svc-1
      name: User Service
      description: Handles users
      status: idle
  frontends:
    - id: fe-1
      name: Web App
      description: Client
      status: idle
edges:
  - id: edge-1
    sourceId: fe-1
    targetId: svc-1
    type: sync
`

    const canvas = await yamlToCanvas(legacyYaml)

    expect(canvas.nodes.some((node) => node.type === 'container' && node.data.name === 'Services')).toBe(true)
    expect(canvas.nodes.some((node) => node.type === 'block' && node.id === 'svc-1')).toBe(true)
    expect(canvas.edges[0]).toEqual(
      expect.objectContaining({
        source: 'fe-1',
        target: 'svc-1',
        type: 'sync',
      })
    )
  })
})
