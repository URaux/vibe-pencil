/**
 * FactGraph on-disk cache — W2.D2.
 *
 * Round-trip serialization of a `FactGraph` keyed by per-file mtimes.
 * Any single mtime mismatch invalidates the whole cache (Phase 1).
 * Incremental per-file invalidation is a follow-up (W2.D3+).
 *
 * Write pattern mirrors `src/lib/ir/persist.ts`: write to `.tmp`, then
 * atomically rename. Reads are tolerant — missing/corrupt files return null.
 */

import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import type {
  FactEdge,
  FactGraph,
  FactGraphStats,
  FactNode,
  FactNodeId,
} from './facts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CachedFactGraph {
  version: 1
  projectRoot: string
  /** Project-relative POSIX paths → mtimeMs. */
  mtimes: Record<string, number>
  graph: {
    nodes: Record<FactNodeId, FactNode>
    edges: FactEdge[]
    stats: FactGraphStats
  }
}

export const FACTS_CACHE_VERSION = 1 as const

/** Default cache path under the project: `.archviber/cache/facts.json`. */
export function defaultFactsCachePath(projectRoot: string): string {
  return path.join(projectRoot, '.archviber', 'cache', 'facts.json')
}

// ---------------------------------------------------------------------------
// Type guard for the on-disk payload — rejects malformed JSON without throwing.
// ---------------------------------------------------------------------------

function isCachedFactGraph(value: unknown): value is CachedFactGraph {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== FACTS_CACHE_VERSION) return false
  if (typeof v.projectRoot !== 'string') return false
  if (!v.mtimes || typeof v.mtimes !== 'object') return false
  if (!v.graph || typeof v.graph !== 'object') return false
  const g = v.graph as Record<string, unknown>
  if (!g.nodes || typeof g.nodes !== 'object') return false
  if (!Array.isArray(g.edges)) return false
  if (!g.stats || typeof g.stats !== 'object') return false
  return true
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read a cached FactGraph from disk. Returns `null` for missing files,
 * corrupt JSON, or schema mismatches — never throws.
 */
export async function readCachedFactGraph(
  cachePath: string,
): Promise<CachedFactGraph | null> {
  let raw: string
  try {
    raw = await fs.readFile(cachePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // Permission errors / unreadable files → treat as no cache. The caller
    // will rebuild and overwrite.
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isCachedFactGraph(parsed)) return null
  return parsed
}

// ---------------------------------------------------------------------------
// Writes (atomic)
// ---------------------------------------------------------------------------

/**
 * Write a FactGraph to disk atomically. Serializes `nodes` (Map) to a plain
 * object for JSON storage; `edges` and `stats` pass through untouched.
 *
 * `mtimes` should contain the same set of project-relative paths the
 * caller plans to validate against on the next read.
 */
export async function writeCachedFactGraph(
  cachePath: string,
  graph: FactGraph,
  mtimes: Record<string, number>,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })

  const nodes: Record<FactNodeId, FactNode> = {}
  for (const [id, node] of graph.nodes) {
    nodes[id] = node
  }

  const payload: CachedFactGraph = {
    version: FACTS_CACHE_VERSION,
    projectRoot: graph.projectRoot,
    mtimes,
    graph: {
      nodes,
      edges: graph.edges,
      stats: graph.stats,
    },
  }

  const json = JSON.stringify(payload)
  const tmpPath = `${cachePath}.tmp`

  try {
    await fs.writeFile(tmpPath, json, 'utf8')
    await fs.rename(tmpPath, cachePath)
  } catch (error) {
    // Best-effort cleanup of the partial tmp file.
    try {
      await fs.unlink(tmpPath)
    } catch {
      /* swallow */
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check whether every file listed in `cached.mtimes` still exists at the
 * same project-relative path AND has the same mtimeMs.
 *
 * Returns `false` on the first mismatch (early exit — not every stat is
 * executed if an early file fails). Returns `true` for an empty mtimes map
 * (degenerate but legal).
 *
 * This is a whole-graph validator; per-file incremental invalidation lands
 * in W2.D3.
 */
export async function isCacheValid(
  cached: CachedFactGraph,
  projectRoot: string,
): Promise<boolean> {
  const entries = Object.entries(cached.mtimes)
  for (const [relPath, expectedMtime] of entries) {
    const absPath = path.join(projectRoot, relPath)
    let statResult: Awaited<ReturnType<typeof fs.stat>>
    try {
      statResult = await fs.stat(absPath)
    } catch {
      return false
    }
    if (statResult.mtimeMs !== expectedMtime) return false
  }
  return true
}

/**
 * Rehydrate the cached payload into a live `FactGraph` (Map-based nodes).
 * Useful for callers that want the Map representation after a cache hit.
 */
export function rehydrateFactGraph(cached: CachedFactGraph): FactGraph {
  const nodes = new Map<FactNodeId, FactNode>()
  for (const [id, node] of Object.entries(cached.graph.nodes)) {
    nodes.set(id, node)
  }
  return {
    nodes,
    edges: cached.graph.edges,
    projectRoot: cached.projectRoot,
    stats: cached.graph.stats,
  }
}

// TODO(W2.D3): incremental invalidation — recompute only files whose mtime
// changed, keep the rest of the graph intact.
