import { describe, it, expect } from 'vitest'
import { canvasToYaml, yamlToCanvas } from '@/lib/schema-engine'
import type { BuildStatus } from '@/lib/types'

describe('schema-engine', () => {
  const idleStatus: BuildStatus = 'idle'
  const nodes = [
    {
      id: 'svc-1',
      type: 'service',
      data: { name: 'UserService', description: 'User management', status: idleStatus },
      position: { x: 0, y: 0 },
    },
    {
      id: 'db-1',
      type: 'database',
      data: { name: 'UserDB', description: 'User data store', status: idleStatus },
      position: { x: 200, y: 0 },
    },
  ]

  const edges = [
    { id: 'e1', source: 'svc-1', target: 'db-1', type: 'sync', label: 'read/write' },
  ]

  it('converts canvas to YAML without positions', () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project')

    expect(yaml).toContain('name: UserService')
    expect(yaml).toContain('target: UserDB')
    expect(yaml).not.toContain('position')
  })

  it('converts canvas to YAML for selected nodes only', () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project', ['svc-1'])

    expect(yaml).toContain('UserService')
    expect(yaml).toContain('UserDB')
  })

  it('parses YAML back into canvas nodes and edges', () => {
    const yaml = canvasToYaml(nodes, edges, 'test-project')
    const canvas = yamlToCanvas(yaml)

    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toEqual([
      expect.objectContaining({
        source: 'svc-1',
        target: 'db-1',
        type: 'sync',
        label: 'read/write',
      }),
    ])
    expect(canvas.nodes.every((node) => 'position' in node)).toBe(true)
  })
})
