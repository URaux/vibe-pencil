import { describe, it, expect } from 'vitest'
import { topoSort } from '@/lib/topo-sort'

describe('topo-sort', () => {
  it('groups independent nodes into same wave', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const edges: any[] = []
    const waves = topoSort(nodes, edges)

    expect(waves).toEqual([['a', 'b', 'c']])
  })

  it('builds dependencies before callers', () => {
    // a calls b calls c -> c must build first, then b, then a
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const waves = topoSort(nodes, edges)

    expect(waves).toEqual([['c'], ['b'], ['a']])
  })

  it('parallelizes independent branches', () => {
    // gw calls svc1 & svc2, both call db -> db first, then svc1+svc2, then gw
    const nodes = [{ id: 'db' }, { id: 'svc1' }, { id: 'svc2' }, { id: 'gw' }]
    const edges = [
      { source: 'gw', target: 'svc1' },
      { source: 'gw', target: 'svc2' },
      { source: 'svc1', target: 'db' },
      { source: 'svc2', target: 'db' },
    ]
    const waves = topoSort(nodes, edges)

    expect(waves[0]).toEqual(['db'])
    expect(waves[1].sort()).toEqual(['svc1', 'svc2'])
    expect(waves[2]).toEqual(['gw'])
  })
})
