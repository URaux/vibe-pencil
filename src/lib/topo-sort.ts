interface TopoNode {
  id: string
}

export interface TopoEdge {
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

/**
 * Given an edge list, return all transitive downstream dependents of a node.
 * "Downstream" means nodes that depend on the given node (directly or transitively).
 *
 * Edge direction convention (from topoSort above):
 *   adjacency.get(edge.target)?.push(edge.source)
 *   inDegree.set(edge.source, ...)
 * This means edge.source has higher inDegree = later wave = depends on edge.target.
 * So in the UI: edge.source -> edge.target means edge.source depends on edge.target.
 *
 * Therefore: downstream dependents of X are nodes where X appears as edge.target.
 * We collect edge.source for each such edge, then recurse.
 */
export function getDownstreamDependents(
  nodeId: string,
  allNodeIds: string[],
  edges: TopoEdge[]
): string[] {
  // Build reverse adjacency: target -> [sources that depend on it]
  const dependents = new Map<string, string[]>()
  for (const id of allNodeIds) dependents.set(id, [])
  for (const edge of edges) {
    dependents.get(edge.target)?.push(edge.source)
  }

  const visited = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.pop()!
    for (const dep of dependents.get(current) ?? []) {
      if (!visited.has(dep)) {
        visited.add(dep)
        queue.push(dep)
      }
    }
  }
  return Array.from(visited)
}
