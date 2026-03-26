interface TopoNode {
  id: string
}

interface TopoEdge {
  source: string
  target: string
}

export function topoSort(nodes: TopoNode[], edges: TopoEdge[]) {
  const nodeIds = nodes.map((node) => node.id)
  const nodeOrder = new Map(nodeIds.map((id, index) => [id, index]))
  const inDegree = new Map(nodeIds.map((id) => [id, 0]))
  const adjacency = new Map(nodeIds.map((id) => [id, [] as string[]]))

  for (const edge of edges) {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) {
      continue
    }

    // Reverse source -> target into dependency -> caller.
    adjacency.get(edge.target)?.push(edge.source)
    inDegree.set(edge.source, (inDegree.get(edge.source) ?? 0) + 1)
  }

  let currentWave = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0)
  const waves: string[][] = []
  let visitedCount = 0

  while (currentWave.length > 0) {
    currentWave.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0))
    waves.push([...currentWave])
    visitedCount += currentWave.length

    const nextWave: string[] = []

    for (const nodeId of currentWave) {
      for (const dependentId of adjacency.get(nodeId) ?? []) {
        const nextDegree = (inDegree.get(dependentId) ?? 0) - 1
        inDegree.set(dependentId, nextDegree)

        if (nextDegree === 0) {
          nextWave.push(dependentId)
        }
      }
    }

    currentWave = nextWave
  }

  if (visitedCount !== nodeIds.length) {
    throw new Error('Cycle detected in graph')
  }

  return waves
}
