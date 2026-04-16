/**
 * Code anchors — W2.D4.
 *
 * Consumes a FactGraph (W2.D2) + ClusterResult (W2.D3) and emits, per cluster,
 * a single `CodeAnchor` matching `codeAnchorSchema` (runtime zod schema in
 * `src/lib/ir/schema.ts`). Each cluster becomes exactly one anchor group —
 * downstream (the block materializer) wraps this as the singleton element of
 * `irBlock.code_anchors`.
 *
 * Scope: pure graph → anchor. No LLM (W2.D5), no IR-block construction, no fs.
 */

import type { CodeAnchor } from '@/lib/ir'
import type {
  FactEdge,
  FactGraph,
  FactNodeId,
  FactSymbolNode,
} from './facts'
import { isModuleNode, isSymbolNode } from './facts'
import type { ClusterResult, FactCluster } from './cluster'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClusterAnchorEntry {
  /** FactCluster.id this anchor belongs to. */
  clusterId: string
  /** Shape matches `codeAnchorSchema` in `src/lib/ir/schema.ts`. */
  anchor: CodeAnchor
}

export interface CodeAnchorDiagnostics {
  /**
   * Clusters where no members had any exports — anchor still emitted, files
   * populated with `symbols: []`. Informational only.
   */
  clustersWithNoExports: number
  /**
   * Clusters where `primary_entry` could not be resolved to a file in the
   * anchor's `files` array. Expected to stay at `0` in practice thanks to the
   * preserve-primary rule; any non-zero value indicates a bug or a cluster
   * whose `primaryEntry` is not among its `memberIds` (graph inconsistency).
   */
  orphanedPrimaryEntries: number
}

export interface CodeAnchorResult {
  /** One anchor per cluster, in the same order as `clusters.clusters`. */
  entries: ClusterAnchorEntry[]
  /**
   * Fraction of clusters whose anchor has at least one file in `files`.
   * `0` when there are zero clusters.
   */
  coverage: number
  diagnostics: CodeAnchorDiagnostics
}

export interface BuildCodeAnchorsOptions {
  /**
   * Cap on how many files per cluster anchor. Top-ranked files win (see
   * ranking below). Default: unlimited (all filter-surviving members).
   */
  maxFilesPerCluster?: number
  /**
   * Cap on how many symbols per file. Default: 20. Prevents 500-symbol
   * modules (e.g. a prelude file) from bloating the anchor.
   */
  maxSymbolsPerFile?: number
  /**
   * Skip files whose basename matches `.test.*` / `.spec.*` or starts with
   * `_`. Default: true. The cluster's `primaryEntry` is NEVER filtered out —
   * it's preserved even when it matches these patterns.
   */
  excludeTestFiles?: boolean
}

const DEFAULT_MAX_SYMBOLS_PER_FILE = 20

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Regex for test/spec basenames: `foo.test.ts`, `bar.spec.tsx`, etc. */
const TEST_SPEC_RE = /\.(test|spec)\.[jt]sx?$/i

/** Posix basename. */
function basename(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx < 0 ? p : p.slice(idx + 1)
}

/** True when the file should be skipped by the default test-file filter. */
function isFilteredFile(filePath: string): boolean {
  const base = basename(filePath)
  if (base.length === 0) return false
  if (base.startsWith('_')) return true
  if (TEST_SPEC_RE.test(base)) return true
  return false
}

/** Lex ascending string comparator. */
function cmpLex(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

// ---------------------------------------------------------------------------
// Per-graph indexes (built once per buildCodeAnchors call)
// ---------------------------------------------------------------------------

interface GraphIndex {
  /** moduleId → filePath. */
  moduleIdToPath: Map<FactNodeId, string>
  /** filePath → moduleId (reverse lookup). */
  pathToModuleId: Map<string, FactNodeId>
  /** moduleId → ordered list of its contained FactSymbolNode, already deduped by builder. */
  moduleToSymbols: Map<FactNodeId, FactSymbolNode[]>
}

function indexGraph(graph: FactGraph): GraphIndex {
  const moduleIdToPath = new Map<FactNodeId, string>()
  const pathToModuleId = new Map<string, FactNodeId>()
  const moduleToSymbols = new Map<FactNodeId, FactSymbolNode[]>()

  for (const node of graph.nodes.values()) {
    if (isModuleNode(node)) {
      moduleIdToPath.set(node.id, node.filePath)
      pathToModuleId.set(node.filePath, node.id)
      moduleToSymbols.set(node.id, [])
    }
  }

  // Walk `contains` edges to populate per-module symbol lists. Preserve edge
  // order (which itself mirrors parser emission order) so output is
  // deterministic without extra sorting.
  for (const edge of graph.edges) {
    if (edge.kind !== 'contains') continue
    const target = graph.nodes.get(edge.target)
    if (!target || !isSymbolNode(target)) continue
    const bucket = moduleToSymbols.get(edge.source)
    if (!bucket) continue
    bucket.push(target)
  }

  return { moduleIdToPath, pathToModuleId, moduleToSymbols }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

interface RankedFile {
  moduleId: FactNodeId
  filePath: string
  /** Count of OTHER cluster members importing from this file (hub-ness). */
  inClusterInbound: number
  /** Whether this is the cluster's primaryEntry — always ranked first. */
  isPrimary: boolean
}

/**
 * Build a `moduleId → inboundCountFromOtherMembers` map restricted to a single
 * cluster. For a cluster with N members the full-graph edge scan is O(|E|);
 * callers typically invoke this once per cluster at ingest time. Acceptable
 * for repos in the thousands-of-edges range (matches cluster.ts precedent).
 */
function computeInClusterInbound(
  edges: readonly FactEdge[],
  memberSet: ReadonlySet<FactNodeId>,
): Map<FactNodeId, number> {
  const counts = new Map<FactNodeId, number>()
  for (const edge of edges) {
    if (edge.kind !== 'import') continue
    if (edge.source === edge.target) continue
    if (!memberSet.has(edge.source) || !memberSet.has(edge.target)) continue
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1)
  }
  return counts
}

/**
 * Rank comparator implementing:
 *   1. primary first
 *   2. desc inClusterInbound
 *   3. asc filePath length
 *   4. asc filePath lex
 */
function compareRank(a: RankedFile, b: RankedFile): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
  if (a.inClusterInbound !== b.inClusterInbound) {
    return b.inClusterInbound - a.inClusterInbound
  }
  if (a.filePath.length !== b.filePath.length) {
    return a.filePath.length - b.filePath.length
  }
  return cmpLex(a.filePath, b.filePath)
}

// ---------------------------------------------------------------------------
// Per-cluster anchor construction
// ---------------------------------------------------------------------------

interface BuildOneAnchorArgs {
  cluster: FactCluster
  graph: FactGraph
  index: GraphIndex
  excludeTestFiles: boolean
  maxFilesPerCluster: number | undefined
  maxSymbolsPerFile: number
}

interface BuiltAnchor {
  anchor: CodeAnchor
  /** True when no member in this cluster contributed any symbol. */
  noExports: boolean
  /** True when the cluster has a non-empty memberIds but primary_entry is not among files. Should never be true thanks to preserve-primary. */
  orphanedPrimary: boolean
}

function buildOneAnchor(args: BuildOneAnchorArgs): BuiltAnchor {
  const {
    cluster,
    graph,
    index,
    excludeTestFiles,
    maxFilesPerCluster,
    maxSymbolsPerFile,
  } = args

  const memberSet = new Set<FactNodeId>(cluster.memberIds)
  const inboundCounts = computeInClusterInbound(graph.edges, memberSet)

  // 1. Resolve primary_entry's moduleId (if any).
  const primaryFilePath = cluster.primaryEntry
  const primaryModuleId = primaryFilePath
    ? (index.pathToModuleId.get(primaryFilePath) ?? null)
    : null

  // 2. Filter members — but NEVER drop primaryModuleId.
  const ranked: RankedFile[] = []
  for (const memberId of cluster.memberIds) {
    const filePath = index.moduleIdToPath.get(memberId)
    if (!filePath) continue
    const isPrimary = memberId === primaryModuleId
    if (!isPrimary && excludeTestFiles && isFilteredFile(filePath)) continue
    ranked.push({
      moduleId: memberId,
      filePath,
      inClusterInbound: inboundCounts.get(memberId) ?? 0,
      isPrimary,
    })
  }

  // 3. Sort deterministically.
  ranked.sort(compareRank);

  // 4. Apply maxFilesPerCluster cap (primary already sorted first).
  const capped =
    typeof maxFilesPerCluster === 'number' && maxFilesPerCluster >= 0
      ? ranked.slice(0, maxFilesPerCluster)
      : ranked

  // If a cap of 0 was set but we still have a primary, preserve the primary
  // at index 0 (0 is an unusual caller choice — document rather than error).
  // We treat `maxFilesPerCluster: 0` literally: emit zero files. Callers who
  // want "primary only" should pass `1`.

  // 5. Materialize anchor files.
  let noExports = true
  const anchorFiles: CodeAnchor['files'] = capped.map((rf) => {
    const symbols = index.moduleToSymbols.get(rf.moduleId) ?? []
    // Symbol names, capped and deduped in insertion order. The builder already
    // dedupes per module, but be defensive in case callers pass a graph built
    // by some other path.
    const seenNames = new Set<string>()
    const symbolNames: string[] = []
    const lineStarts: number[] = []
    const lineEnds: number[] = []
    for (const sym of symbols) {
      if (!sym.name) continue
      if (seenNames.has(sym.name)) continue
      seenNames.add(sym.name)
      if (symbolNames.length < maxSymbolsPerFile) {
        symbolNames.push(sym.name)
      }
      if (sym.lineRange) {
        lineStarts.push(sym.lineRange.start)
        lineEnds.push(sym.lineRange.end)
      }
    }
    if (symbolNames.length > 0) noExports = false

    // lines aggregation: min(start), max(end) iff we saw any lineRange on any
    // symbol (not restricted to those that survived the maxSymbols cap — we
    // want the file's extent, not the snippet-cap's extent).
    const hasLines = lineStarts.length > 0
    const file: CodeAnchor['files'][number] = hasLines
      ? {
          path: rf.filePath,
          symbols: symbolNames,
          lines: {
            start: Math.min(...lineStarts),
            end: Math.max(...lineEnds),
          },
        }
      : {
          path: rf.filePath,
          symbols: symbolNames,
        }
    return file
  })

  // 6. Resolve primary_entry against the emitted files. Fall back to the first
  // file by rank if the literal primaryFilePath slipped out (e.g. due to
  // `maxFilesPerCluster: 0` pruning).
  const emittedPathSet = new Set(anchorFiles.map((f) => f.path))
  let finalPrimary: string | undefined
  if (primaryFilePath && emittedPathSet.has(primaryFilePath)) {
    finalPrimary = primaryFilePath
  } else if (anchorFiles.length > 0) {
    finalPrimary = anchorFiles[0].path
  } else {
    finalPrimary = undefined
  }

  // Only count as "orphaned" when a primary was expected but got lost; the
  // maxFilesPerCluster=0 case is a deliberate caller choice to suppress files
  // entirely and must not trip this diagnostic. (reviewer S2.)
  const orphanedPrimary =
    cluster.memberIds.length > 0 &&
    primaryFilePath !== '' &&
    finalPrimary === undefined &&
    (maxFilesPerCluster ?? Infinity) > 0

  const anchor: CodeAnchor =
    finalPrimary !== undefined
      ? { files: anchorFiles, primary_entry: finalPrimary }
      : { files: anchorFiles }

  return { anchor, noExports: noExports && anchorFiles.length > 0, orphanedPrimary }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Build per-cluster `CodeAnchor`s from a FactGraph + ClusterResult.
 *
 * Determinism: output entry order mirrors `clusters.clusters`. File order
 * within each anchor is determined by the stable rank comparator. Same input
 * → byte-identical output.
 *
 * TODO(W2.D5): the LLM naming pass in `src/lib/ingest/name.ts` will consume
 * these anchors (clusterId + file count + symbol sample) as naming context.
 */
export function buildCodeAnchors(
  graph: FactGraph,
  clusters: ClusterResult,
  options?: BuildCodeAnchorsOptions,
): CodeAnchorResult {
  const excludeTestFiles = options?.excludeTestFiles ?? true
  const maxSymbolsPerFile = options?.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS_PER_FILE
  const maxFilesPerCluster = options?.maxFilesPerCluster

  const index = indexGraph(graph)

  const entries: ClusterAnchorEntry[] = []
  let clustersWithFiles = 0
  let clustersWithNoExports = 0
  let orphanedPrimaryEntries = 0

  for (const cluster of clusters.clusters) {
    const built = buildOneAnchor({
      cluster,
      graph,
      index,
      excludeTestFiles,
      maxFilesPerCluster,
      maxSymbolsPerFile,
    })
    entries.push({ clusterId: cluster.id, anchor: built.anchor })
    if (built.anchor.files.length > 0) clustersWithFiles++
    if (built.noExports) clustersWithNoExports++
    if (built.orphanedPrimary) orphanedPrimaryEntries++
  }

  const coverage = entries.length === 0 ? 0 : clustersWithFiles / entries.length

  return {
    entries,
    coverage,
    diagnostics: {
      clustersWithNoExports,
      orphanedPrimaryEntries,
    },
  }
}

/**
 * Map cluster id → anchor. Handy for downstream code that wants to look up a
 * single cluster's anchor cheaply without re-scanning `entries`.
 */
export function anchorByClusterId(result: CodeAnchorResult): Map<string, CodeAnchor> {
  const out = new Map<string, CodeAnchor>()
  for (const { clusterId, anchor } of result.entries) {
    out.set(clusterId, anchor)
  }
  return out
}

// Exported purely so tests / ad-hoc scripts can inspect the default symbol cap
// without scraping source. Not part of the stable API surface.
export const _internals = {
  DEFAULT_MAX_SYMBOLS_PER_FILE,
  isFilteredFile,
} as const

// Explicit type re-exports so consumers need only import from this module.
export type { CodeAnchor }
