/**
 * Clustering — W2.D3.
 *
 * Runs Louvain community detection on the module-module import subgraph of a
 * FactGraph and returns a stable, deterministic clustering. Downstream (W2.D4)
 * code anchors consume `FactCluster` as the unit of "layer".
 *
 * Scope: purely graph-structural. No LLM naming (W2.D5), no code_anchors
 * emission (W2.D4).
 */

import { createHash } from 'node:crypto'
import { UndirectedGraph } from 'graphology'
import louvain from 'graphology-communities-louvain'
import type { FactGraph, FactNodeId } from './facts'
import { isModuleNode } from './facts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A cluster ("layer" in product language) — a cohesive group of modules. */
export interface FactCluster {
  /** Stable ID hashed from the sorted member set. Format: `cluster:<12hex>`. */
  id: string
  /** Module FactNodeIds belonging to this cluster. Always sorted ascending for stability. */
  memberIds: FactNodeId[]
  /** Convenience: project-relative filePaths of the members, sorted. */
  memberFiles: string[]
  /** Member count. */
  size: number
  /** The "primary entry" — best representative file for this cluster. */
  primaryEntry: string
  /**
   * Structural "handle" — one short label derived from the longest common
   * directory prefix of members. e.g. `src/lib/ingest` for members sharing
   * that directory. Absent when no meaningful common prefix exists.
   */
  pathPrefix?: string
}

export interface ClusterDiagnostics {
  /**
   * Modules with no import edges in either direction. Each becomes its own
   * singleton cluster, then the merge-small pass absorbs it IF it has any
   * neighbor to absorb into — truly isolated modules stay as singletons.
   */
  isolatedModules: number
  /** Clusters below the min-size threshold before merging. */
  smallClustersBefore: number
  /** Clusters remaining below the min-size threshold after merging. */
  smallClustersAfter: number
}

export interface ClusterResult {
  clusters: FactCluster[]
  /** Map moduleFactNodeId → clusterId. Every module appears exactly once. */
  moduleToCluster: Map<FactNodeId, string>
  /** Modularity score reported by Louvain — for diagnostics. */
  modularity: number
  diagnostics: ClusterDiagnostics
}

export interface ClusterOptions {
  /** Minimum cluster size; clusters with fewer members get absorbed into a neighbor. Default 2. */
  minClusterSize?: number
  /** Resolution parameter passed to Louvain. Higher = more, smaller clusters. Default 1.0. */
  resolution?: number
  /** Deterministic seed for Louvain's RNG. Default 42. */
  seed?: number
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — no new deps.
// ---------------------------------------------------------------------------

/**
 * Mulberry32 — small, fast, deterministic 32-bit PRNG. Sufficient for Louvain's
 * randomWalk tie-breaking. Returns a function producing doubles in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** SHA-256 → 12 hex chars, prefixed with `cluster:`. */
function hashClusterId(sortedMemberIds: readonly FactNodeId[]): string {
  const h = createHash('sha256').update(sortedMemberIds.join('\n')).digest('hex')
  return `cluster:${h.slice(0, 12)}`
}

/**
 * Longest common directory prefix (POSIX) across filePaths.
 * - Splits each path on `/`, keeps only directory segments (drops the final
 *   file-name segment for non-dir paths).
 * - Returns `undefined` when the common prefix has zero segments OR when the
 *   input is empty.
 *
 * Examples:
 *   ['src/lib/a.ts', 'src/lib/b.ts']                    → 'src/lib'
 *   ['src/lib/a.ts', 'src/lib/sub/c.ts']                → 'src/lib'
 *   ['src/lib/a.ts', 'other/b.ts']                      → undefined
 *   ['src/lib/a.ts']                                    → 'src/lib'
 */
function longestCommonDirPrefix(filePaths: readonly string[]): string | undefined {
  if (filePaths.length === 0) return undefined
  const segmentLists = filePaths.map((p) => {
    const parts = p.split('/').filter((s) => s.length > 0)
    // Drop the file-name segment. A segment is treated as a file when it
    // contains a `.` AND it's the last segment. Anything without a dot is
    // kept (could be a directory or an extensionless file — LCP is stable
    // either way for our dir-prefix use case).
    if (parts.length > 0 && parts[parts.length - 1].includes('.')) {
      parts.pop()
    }
    return parts
  })
  const shortest = Math.min(...segmentLists.map((l) => l.length))
  const common: string[] = []
  for (let i = 0; i < shortest; i++) {
    const seg = segmentLists[0][i]
    if (segmentLists.every((l) => l[i] === seg)) {
      common.push(seg)
    } else {
      break
    }
  }
  if (common.length === 0) return undefined
  return common.join('/')
}

/**
 * Deterministic primaryEntry rule:
 *   1. Module in this cluster with the most inbound import edges from OTHER
 *      clusters (the "front door").
 *   2. Tie-break: shortest filePath (less nested).
 *   3. Tie-break: lexicographic filePath ascending.
 */
function pickPrimaryEntry(
  memberIds: readonly FactNodeId[],
  idToFilePath: ReadonlyMap<FactNodeId, string>,
  externalInbound: ReadonlyMap<FactNodeId, number>,
): string {
  if (memberIds.length === 1) {
    return idToFilePath.get(memberIds[0]) ?? ''
  }
  let bestId: FactNodeId = memberIds[0]
  let bestInbound = externalInbound.get(bestId) ?? 0
  let bestPath = idToFilePath.get(bestId) ?? ''

  for (let i = 1; i < memberIds.length; i++) {
    const candId = memberIds[i]
    const candInbound = externalInbound.get(candId) ?? 0
    const candPath = idToFilePath.get(candId) ?? ''

    if (candInbound > bestInbound) {
      bestId = candId
      bestInbound = candInbound
      bestPath = candPath
      continue
    }
    if (candInbound < bestInbound) continue
    // Inbound tied → shortest path wins.
    if (candPath.length < bestPath.length) {
      bestId = candId
      bestPath = candPath
      continue
    }
    if (candPath.length > bestPath.length) continue
    // Length tied → lexicographic ascending.
    if (candPath < bestPath) {
      bestId = candId
      bestPath = candPath
    }
  }
  return bestPath
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cluster a FactGraph by running Louvain on its undirected module-module
 * import subgraph.
 *
 * Determinism contract: running this twice on the same FactGraph (same node
 * Map, same edges array order) produces an identical ClusterResult — byte-
 * identical `clusters` array, identical `moduleToCluster`, identical ids.
 * Achieved via (a) sorted node insertion, (b) sorted edge insertion, (c)
 * seeded RNG, (d) ids derived from sorted member sets rather than Louvain's
 * internal community ids.
 */
export function clusterFactGraph(graph: FactGraph, options?: ClusterOptions): ClusterResult {
  const minClusterSize = options?.minClusterSize ?? 2
  const resolution = options?.resolution ?? 1.0
  const seed = options?.seed ?? 42

  // ---- Step 1: collect modules deterministically ---------------------------
  const moduleIds: FactNodeId[] = []
  const idToFilePath = new Map<FactNodeId, string>()
  for (const node of graph.nodes.values()) {
    if (isModuleNode(node)) {
      moduleIds.push(node.id)
      idToFilePath.set(node.id, node.filePath)
    }
  }
  moduleIds.sort()

  // Edge case: empty graph.
  if (moduleIds.length === 0) {
    return {
      clusters: [],
      moduleToCluster: new Map(),
      modularity: 0,
      diagnostics: { isolatedModules: 0, smallClustersBefore: 0, smallClustersAfter: 0 },
    }
  }

  // ---- Step 2: build undirected, weighted module-module subgraph ----------
  // Collapse multi-edges between the same pair by summing weight (count).
  // An import edge a→b or b→a both count toward weight(a,b).
  const pairKey = (u: FactNodeId, v: FactNodeId): string => (u < v ? `${u}\u0000${v}` : `${v}\u0000${u}`)
  const pairWeights = new Map<string, { u: FactNodeId; v: FactNodeId; w: number }>()
  const incidentDegree = new Map<FactNodeId, number>()
  /** For primaryEntry: count import edges that land on a target from a source in a DIFFERENT cluster. Filled later. */

  for (const edge of graph.edges) {
    if (edge.kind !== 'import') continue
    if (edge.source === edge.target) continue // self-loops ignored
    // Guard: both endpoints must be module nodes in our id set.
    if (!idToFilePath.has(edge.source) || !idToFilePath.has(edge.target)) continue
    const k = pairKey(edge.source, edge.target)
    const existing = pairWeights.get(k)
    if (existing) {
      existing.w += 1
    } else {
      pairWeights.set(k, { u: edge.source, v: edge.target, w: 1 })
    }
    incidentDegree.set(edge.source, (incidentDegree.get(edge.source) ?? 0) + 1)
    incidentDegree.set(edge.target, (incidentDegree.get(edge.target) ?? 0) + 1)
  }

  const isolatedModules = moduleIds.filter((id) => (incidentDegree.get(id) ?? 0) === 0).length

  // ---- Step 3: construct graphology UndirectedGraph with sorted insertion --
  interface NodeAttrs {
    community?: number
  }
  interface EdgeAttrs {
    weight: number
  }
  const g = new UndirectedGraph<NodeAttrs, EdgeAttrs>()

  for (const id of moduleIds) {
    g.addNode(id)
  }
  // Sort edge insertion deterministically: by (u, v) ascending.
  const sortedPairs = Array.from(pairWeights.values()).sort((a, b) => {
    const au = a.u < a.v ? a.u : a.v
    const av = a.u < a.v ? a.v : a.u
    const bu = b.u < b.v ? b.u : b.v
    const bv = b.u < b.v ? b.v : b.u
    if (au !== bu) return au < bu ? -1 : 1
    return av < bv ? -1 : 1
  })
  for (const { u, v, w } of sortedPairs) {
    g.addUndirectedEdge(u, v, { weight: w })
  }

  // ---- Step 4: run Louvain with seeded RNG --------------------------------
  const rng = mulberry32(seed)
  const detailed = louvain.detailed(g, {
    resolution,
    rng,
    getEdgeWeight: 'weight',
  })

  const communities = detailed.communities
  const modularity = Number.isFinite(detailed.modularity) ? detailed.modularity : 0

  // ---- Step 5: group members by community id ------------------------------
  // Louvain's community ids are integers but not stable across runs. We group
  // by them here purely as a partition; stable ids are derived later from the
  // sorted member set.
  const byCommunity = new Map<number, FactNodeId[]>()
  for (const id of moduleIds) {
    const cid = communities[id]
    const bucket = byCommunity.get(cid)
    if (bucket) bucket.push(id)
    else byCommunity.set(cid, [id])
  }

  const smallClustersBefore = Array.from(byCommunity.values()).filter(
    (m) => m.length < minClusterSize,
  ).length

  // ---- Step 6: merge small clusters into best-weighted neighbor -----------
  // Build adjacency-by-pair for weighted neighbor lookup.
  // partition[id] = communityKey. We reassign keys during merging.
  const partition = new Map<FactNodeId, number>()
  for (const [cid, members] of byCommunity) {
    for (const m of members) partition.set(m, cid)
  }

  // Helper: for a given small community, compute weighted sum to each OTHER community.
  const smallCommunityIds = Array.from(byCommunity.keys())
    .filter((cid) => {
      const arr = byCommunity.get(cid)
      return arr !== undefined && arr.length < minClusterSize
    })
    .sort((a, b) => a - b) // stable order

  for (const smallCid of smallCommunityIds) {
    const members = byCommunity.get(smallCid)
    if (!members || members.length === 0) continue
    if (members.length >= minClusterSize) continue // might have grown via absorption

    // Sum weights from every member to each other community by scanning all
    // stored pairs. Cheap enough at our scale (edges in the thousands).
    const weightTo = new Map<number, number>()
    for (const m of members) {
      for (const { u, v, w } of pairWeights.values()) {
        if (u !== m && v !== m) continue
        const other = u === m ? v : u
        const otherCid = partition.get(other)
        if (otherCid === undefined || otherCid === smallCid) continue
        weightTo.set(otherCid, (weightTo.get(otherCid) ?? 0) + w)
      }
    }

    if (weightTo.size === 0) continue // truly isolated — leave as singleton

    // Pick best neighbor: highest weight, tie-break on smallest community id
    // to keep determinism stable.
    let bestCid = -1
    let bestWeight = -1
    for (const [cid, w] of weightTo) {
      if (w > bestWeight || (w === bestWeight && cid < bestCid)) {
        bestCid = cid
        bestWeight = w
      }
    }

    if (bestCid < 0) continue

    // Merge: move all members into bestCid.
    const target = byCommunity.get(bestCid)
    if (!target) continue
    for (const m of members) {
      partition.set(m, bestCid)
      target.push(m)
    }
    byCommunity.delete(smallCid)
  }

  const smallClustersAfter = Array.from(byCommunity.values()).filter(
    (m) => m.length < minClusterSize,
  ).length

  // ---- Step 7: compute per-module inbound-from-other-cluster counts -------
  // Needed for primaryEntry. Uses the DIRECTED original import edges.
  const externalInbound = new Map<FactNodeId, number>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'import') continue
    if (edge.source === edge.target) continue
    const srcCid = partition.get(edge.source)
    const tgtCid = partition.get(edge.target)
    if (srcCid === undefined || tgtCid === undefined) continue
    if (srcCid === tgtCid) continue
    externalInbound.set(edge.target, (externalInbound.get(edge.target) ?? 0) + 1)
  }

  // ---- Step 8: materialize FactClusters with stable ids -------------------
  const clusters: FactCluster[] = []
  const moduleToCluster = new Map<FactNodeId, string>()

  // Process communities in a deterministic order: sort members first, then
  // order communities by their sorted memberIds lexicographically so the
  // output array itself is stable.
  const partitionsArr: FactNodeId[][] = []
  for (const members of byCommunity.values()) {
    const sortedMembers = [...members].sort()
    partitionsArr.push(sortedMembers)
  }
  partitionsArr.sort((a, b) => {
    // Compare element-by-element.
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    }
    return a.length - b.length
  })

  for (const memberIds of partitionsArr) {
    const memberFiles = memberIds
      .map((id) => idToFilePath.get(id) ?? '')
      .filter((p) => p.length > 0)
      .sort()
    const id = hashClusterId(memberIds)
    const primaryEntry = pickPrimaryEntry(memberIds, idToFilePath, externalInbound)
    const pathPrefix = longestCommonDirPrefix(memberFiles)

    const cluster: FactCluster = {
      id,
      memberIds,
      memberFiles,
      size: memberIds.length,
      primaryEntry,
      ...(pathPrefix !== undefined ? { pathPrefix } : {}),
    }
    clusters.push(cluster)
    for (const mid of memberIds) moduleToCluster.set(mid, id)
  }

  return {
    clusters,
    moduleToCluster,
    modularity,
    diagnostics: {
      isolatedModules,
      smallClustersBefore,
      smallClustersAfter,
    },
  }
}

// TODO(W2.D4): consume `ClusterResult` in `src/lib/ingest/code-anchors.ts` to
// populate `ir.code_anchors` per IR-SCHEMA §3.3 — one anchor group per cluster
// keyed by `FactCluster.id`, primary_entry = cluster.primaryEntry.
