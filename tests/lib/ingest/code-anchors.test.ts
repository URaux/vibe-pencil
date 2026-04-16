/**
 * W2.D4 hermetic tests — synthesize FactGraph + ClusterResult by hand.
 * Do NOT shell out to parseTsProject.
 */

import { describe, it, expect } from 'vitest'

import type {
  FactEdge,
  FactGraph,
  FactModuleNode,
  FactNodeId,
  FactSymbolNode,
  FactLanguage,
} from '../../../src/lib/ingest/facts'
import type { ClusterResult, FactCluster } from '../../../src/lib/ingest/cluster'
import {
  anchorByClusterId,
  buildCodeAnchors,
} from '../../../src/lib/ingest/code-anchors'
import { codeAnchorSchema } from '../../../src/lib/ir'

// ---------------------------------------------------------------------------
// Fixture helpers — hand-rolled FactGraph + ClusterResult (no parser, no fs).
// ---------------------------------------------------------------------------

function moduleId(relPath: string): FactNodeId {
  return `module:${relPath}`
}
function symbolId(relPath: string, name: string): FactNodeId {
  return `symbol:${relPath}::${name}`
}

interface FixtureSymbol {
  name: string
  lineRange?: { start: number; end: number }
}

interface FixtureModule {
  filePath: string
  language?: FactLanguage
  symbols?: FixtureSymbol[]
  /** Imports: specifier need not be realistic — we attach edges directly. */
  importsFromFilePath?: string[]
}

function makeGraph(mods: readonly FixtureModule[]): FactGraph {
  const nodes = new Map<FactNodeId, FactModuleNode | FactSymbolNode>()
  const edges: FactEdge[] = []

  for (const mod of mods) {
    const modNode: FactModuleNode = {
      kind: 'module',
      id: moduleId(mod.filePath),
      filePath: mod.filePath,
      language: mod.language ?? 'typescript',
    }
    nodes.set(modNode.id, modNode)

    for (const sym of mod.symbols ?? []) {
      const sid = symbolId(mod.filePath, sym.name)
      const symNode: FactSymbolNode = {
        kind: 'symbol',
        id: sid,
        filePath: mod.filePath,
        name: sym.name,
        symbolKind: 'const',
        ...(sym.lineRange ? { lineRange: sym.lineRange } : {}),
      }
      nodes.set(sid, symNode)
      edges.push({ kind: 'contains', source: modNode.id, target: sid })
    }
  }

  for (const mod of mods) {
    for (const targetPath of mod.importsFromFilePath ?? []) {
      edges.push({
        kind: 'import',
        source: moduleId(mod.filePath),
        target: moduleId(targetPath),
        specifier: `./fake/${targetPath}`,
        names: [],
      })
    }
  }

  let moduleCount = 0
  let symbolCount = 0
  let importCount = 0
  let containsCount = 0
  const byLanguage: Record<string, number> = {}
  for (const n of nodes.values()) {
    if (n.kind === 'module') {
      moduleCount++
      byLanguage[n.language] = (byLanguage[n.language] ?? 0) + 1
    } else {
      symbolCount++
    }
  }
  for (const e of edges) {
    if (e.kind === 'import') importCount++
    else containsCount++
  }

  return {
    nodes,
    edges,
    projectRoot: 'C:/fake-project',
    stats: {
      modules: moduleCount,
      symbols: symbolCount,
      imports: importCount,
      contains: containsCount,
      byLanguage,
    },
  }
}

function makeCluster(
  id: string,
  memberFilePaths: readonly string[],
  primaryEntry?: string,
): FactCluster {
  const memberIds = memberFilePaths.map(moduleId)
  return {
    id,
    memberIds,
    memberFiles: [...memberFilePaths],
    size: memberFilePaths.length,
    primaryEntry: primaryEntry ?? memberFilePaths[0] ?? '',
  }
}

function makeClusterResult(clusters: FactCluster[]): ClusterResult {
  const moduleToCluster = new Map<FactNodeId, string>()
  for (const c of clusters) for (const m of c.memberIds) moduleToCluster.set(m, c.id)
  return {
    clusters,
    moduleToCluster,
    modularity: 0,
    diagnostics: { isolatedModules: 0, smallClustersBefore: 0, smallClustersAfter: 0 },
  }
}

// ---------------------------------------------------------------------------
// 1. Empty clusters array
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — edge cases', () => {
  it('returns empty entries + coverage=0 on empty clusters, no throws', () => {
    const graph = makeGraph([])
    const clusters = makeClusterResult([])
    const result = buildCodeAnchors(graph, clusters)
    expect(result.entries).toEqual([])
    expect(result.coverage).toBe(0)
    expect(result.diagnostics.clustersWithNoExports).toBe(0)
    expect(result.diagnostics.orphanedPrimaryEntries).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Single cluster with 3 modules
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — happy path', () => {
  it('emits one entry with all 3 files, primary populated, each file has its symbols', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/a.ts', symbols: [{ name: 'alpha' }, { name: 'alpha2' }] },
      { filePath: 'src/b.ts', symbols: [{ name: 'beta' }] },
      { filePath: 'src/c.ts', symbols: [{ name: 'gamma' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster(
      'cluster:111',
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      'src/a.ts',
    )
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))

    expect(result.entries.length).toBe(1)
    const { anchor } = result.entries[0]
    expect(anchor.files.length).toBe(3)
    expect(anchor.primary_entry).toBe('src/a.ts')

    const byPath = new Map(anchor.files.map((f) => [f.path, f]))
    expect(byPath.get('src/a.ts')?.symbols).toEqual(['alpha', 'alpha2'])
    expect(byPath.get('src/b.ts')?.symbols).toEqual(['beta'])
    expect(byPath.get('src/c.ts')?.symbols).toEqual(['gamma'])
    expect(result.coverage).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3. primary_entry preserved under test-file filter
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — primary_entry preservation under filter', () => {
  it('keeps the primary file even if it matches the test-file filter', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/foo.test.ts', symbols: [{ name: 'primaryThing' }] },
      { filePath: 'src/other.ts', symbols: [{ name: 'other' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster(
      'cluster:222',
      ['src/foo.test.ts', 'src/other.ts'],
      'src/foo.test.ts',
    )
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))
    const { anchor } = result.entries[0]
    const paths = anchor.files.map((f) => f.path)
    expect(paths).toContain('src/foo.test.ts')
    expect(anchor.primary_entry).toBe('src/foo.test.ts')
    // The non-primary, non-filtered `src/other.ts` is also kept.
    expect(paths).toContain('src/other.ts')
  })
})

// ---------------------------------------------------------------------------
// 4. maxFilesPerCluster cap — keep primary + most-imported
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — maxFilesPerCluster cap', () => {
  it('keeps primary plus the 2 most-imported-within-cluster files', () => {
    // 10 modules. src/hub1.ts imported by 5 others, src/hub2.ts by 3, others by 0.
    const memberPaths = [
      'src/primary.ts',
      'src/hub1.ts',
      'src/hub2.ts',
      'src/m4.ts',
      'src/m5.ts',
      'src/m6.ts',
      'src/m7.ts',
      'src/m8.ts',
      'src/m9.ts',
      'src/m10.ts',
    ]
    const mods: FixtureModule[] = memberPaths.map((p) => ({
      filePath: p,
      symbols: [{ name: 'export_' + p.replace(/[^\w]/g, '_') }],
    }))
    // Wire imports: hub1 imported by m4..m8 (5 in-cluster inbound).
    const addImport = (from: string, to: string) => {
      const m = mods.find((x) => x.filePath === from)!
      m.importsFromFilePath = [...(m.importsFromFilePath ?? []), to]
    }
    for (const from of ['src/m4.ts', 'src/m5.ts', 'src/m6.ts', 'src/m7.ts', 'src/m8.ts']) {
      addImport(from, 'src/hub1.ts')
    }
    for (const from of ['src/m9.ts', 'src/m10.ts', 'src/m4.ts']) {
      addImport(from, 'src/hub2.ts')
    }
    const graph = makeGraph(mods)
    const cluster = makeCluster('cluster:333', memberPaths, 'src/primary.ts')
    const result = buildCodeAnchors(
      graph,
      makeClusterResult([cluster]),
      { maxFilesPerCluster: 3 },
    )
    const { anchor } = result.entries[0]
    expect(anchor.files.length).toBe(3)
    const paths = anchor.files.map((f) => f.path)
    expect(paths[0]).toBe('src/primary.ts')
    // The remaining 2 slots should be hub1 (5) and hub2 (3).
    expect(paths.slice(1).sort()).toEqual(['src/hub1.ts', 'src/hub2.ts'])
    expect(anchor.primary_entry).toBe('src/primary.ts')
  })
})

// ---------------------------------------------------------------------------
// 5. maxSymbolsPerFile cap
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — maxSymbolsPerFile cap', () => {
  it('truncates symbols per file to the cap', () => {
    const symbols: FixtureSymbol[] = []
    for (let i = 0; i < 30; i++) symbols.push({ name: `sym${i}` })
    const mods: FixtureModule[] = [{ filePath: 'src/big.ts', symbols }]
    const graph = makeGraph(mods)
    const cluster = makeCluster('cluster:444', ['src/big.ts'], 'src/big.ts')
    const result = buildCodeAnchors(
      graph,
      makeClusterResult([cluster]),
      { maxSymbolsPerFile: 5 },
    )
    const { anchor } = result.entries[0]
    expect(anchor.files[0].symbols.length).toBe(5)
    expect(anchor.files[0].symbols).toEqual(['sym0', 'sym1', 'sym2', 'sym3', 'sym4'])
  })
})

// ---------------------------------------------------------------------------
// 6. Test file exclusion default / opt-out
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — test-file filtering', () => {
  it('filters out *.test.ts by default (non-primary members)', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/main.ts', symbols: [{ name: 'main' }] },
      { filePath: 'src/foo.test.ts', symbols: [{ name: 'tx' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster(
      'cluster:555',
      ['src/main.ts', 'src/foo.test.ts'],
      'src/main.ts',
    )
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))
    const paths = result.entries[0].anchor.files.map((f) => f.path)
    expect(paths).not.toContain('src/foo.test.ts')
    expect(paths).toContain('src/main.ts')
  })

  it('keeps test files when excludeTestFiles=false', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/main.ts', symbols: [{ name: 'main' }] },
      { filePath: 'src/foo.test.ts', symbols: [{ name: 'tx' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster(
      'cluster:556',
      ['src/main.ts', 'src/foo.test.ts'],
      'src/main.ts',
    )
    const result = buildCodeAnchors(
      graph,
      makeClusterResult([cluster]),
      { excludeTestFiles: false },
    )
    const paths = result.entries[0].anchor.files.map((f) => f.path)
    expect(paths).toContain('src/foo.test.ts')
    expect(paths).toContain('src/main.ts')
  })
})

// ---------------------------------------------------------------------------
// 7. Lines aggregation
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — lines aggregation', () => {
  it('aggregates min/max across symbols with lineRange', () => {
    const mods: FixtureModule[] = [
      {
        filePath: 'src/ranged.ts',
        symbols: [
          { name: 'a', lineRange: { start: 10, end: 20 } },
          { name: 'b', lineRange: { start: 5, end: 15 } },
          { name: 'c', lineRange: { start: 25, end: 30 } },
        ],
      },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster('cluster:777', ['src/ranged.ts'], 'src/ranged.ts')
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))
    const file = result.entries[0].anchor.files[0]
    expect(file.lines).toEqual({ start: 5, end: 30 })
  })

  it('omits lines when no symbol has a lineRange', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/unranged.ts', symbols: [{ name: 'a' }, { name: 'b' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster('cluster:778', ['src/unranged.ts'], 'src/unranged.ts')
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))
    const file = result.entries[0].anchor.files[0]
    expect(file.lines).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 8. Schema validation round-trip
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — schema validation', () => {
  it('every emitted anchor parses against codeAnchorSchema', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/a.ts', symbols: [{ name: 'a', lineRange: { start: 1, end: 5 } }] },
      { filePath: 'src/b.ts', symbols: [] },
      { filePath: 'src/c.test.ts', symbols: [{ name: 'c' }] },
    ]
    const graph = makeGraph(mods)
    const clusters = makeClusterResult([
      makeCluster('cluster:901', ['src/a.ts', 'src/b.ts'], 'src/a.ts'),
      makeCluster('cluster:902', ['src/c.test.ts'], 'src/c.test.ts'),
    ])
    const result = buildCodeAnchors(graph, clusters)
    for (const { anchor } of result.entries) {
      const parsed = codeAnchorSchema.safeParse(anchor)
      expect(parsed.success).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Coverage computation — partial
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — coverage', () => {
  it('computes coverage as fraction of clusters with >= 1 file', () => {
    // 3 clusters: two populated, one with a member id that's missing from the graph
    // (simulating an empty cluster with no resolvable files).
    const mods: FixtureModule[] = [
      { filePath: 'src/a.ts', symbols: [{ name: 'a' }] },
      { filePath: 'src/b.ts', symbols: [{ name: 'b' }] },
    ]
    const graph = makeGraph(mods)
    const phantomCluster: FactCluster = {
      id: 'cluster:ghost',
      memberIds: [moduleId('src/phantom.ts')],
      memberFiles: ['src/phantom.ts'],
      size: 1,
      primaryEntry: 'src/phantom.ts',
    }
    const clusters = makeClusterResult([
      makeCluster('cluster:xyz1', ['src/a.ts'], 'src/a.ts'),
      makeCluster('cluster:xyz2', ['src/b.ts'], 'src/b.ts'),
      phantomCluster,
    ])
    const result = buildCodeAnchors(graph, clusters)
    expect(result.entries.length).toBe(3)
    expect(result.coverage).toBeCloseTo(2 / 3, 10)
    // The phantom cluster's anchor has no files and no primary_entry.
    const phantom = result.entries.find((e) => e.clusterId === 'cluster:ghost')!
    expect(phantom.anchor.files).toEqual([])
    expect(phantom.anchor.primary_entry).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 10. orphanedPrimaryEntries diagnostic — stays at 0 in realistic cases
// ---------------------------------------------------------------------------

describe('buildCodeAnchors — orphanedPrimaryEntries', () => {
  it('is 0 even when primary would be filtered (preserve-primary rule)', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/_private.ts', symbols: [{ name: 'x' }] },
      { filePath: 'src/other.ts', symbols: [{ name: 'y' }] },
    ]
    const graph = makeGraph(mods)
    const cluster = makeCluster(
      'cluster:orph1',
      ['src/_private.ts', 'src/other.ts'],
      'src/_private.ts',
    )
    const result = buildCodeAnchors(graph, makeClusterResult([cluster]))
    expect(result.diagnostics.orphanedPrimaryEntries).toBe(0)
    const { anchor } = result.entries[0]
    expect(anchor.primary_entry).toBe('src/_private.ts')
  })

  it('is 0 when every cluster resolves cleanly', () => {
    const mods: FixtureModule[] = [
      { filePath: 'src/a.ts', symbols: [{ name: 'a' }] },
    ]
    const graph = makeGraph(mods)
    const result = buildCodeAnchors(
      graph,
      makeClusterResult([makeCluster('cluster:a', ['src/a.ts'], 'src/a.ts')]),
    )
    expect(result.diagnostics.orphanedPrimaryEntries).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Bonus — anchorByClusterId helper
// ---------------------------------------------------------------------------

describe('anchorByClusterId helper', () => {
  it('maps cluster id → anchor', () => {
    const mods: FixtureModule[] = [{ filePath: 'src/a.ts', symbols: [{ name: 'a' }] }]
    const graph = makeGraph(mods)
    const result = buildCodeAnchors(
      graph,
      makeClusterResult([makeCluster('cluster:k', ['src/a.ts'], 'src/a.ts')]),
    )
    const map = anchorByClusterId(result)
    expect(map.size).toBe(1)
    const anchor = map.get('cluster:k')
    expect(anchor?.primary_entry).toBe('src/a.ts')
  })
})
