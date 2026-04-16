import { describe, it, expect } from 'vitest'

import { buildFactGraph, type FactInputModule, type FactGraph } from '../../../src/lib/ingest/facts'
import { clusterFactGraph } from '../../../src/lib/ingest/cluster'

/**
 * W2.D3 hermetic tests — synthesized FactInputModule fixtures run through
 * `buildFactGraph` so the cluster tests exercise the public API end-to-end
 * without touching disk or coupling to a specific parser.
 */

const ROOT = 'C:/fake-project'
const abs = (rel: string): string => `${ROOT}/${rel}`

function buildGraph(mods: FactInputModule[]): FactGraph {
  return buildFactGraph({ projectRoot: ROOT, modules: mods })
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Dense import ring among a list of sibling modules under `dir`. */
function denseRing(dir: string, names: readonly string[]): FactInputModule[] {
  return names.map((name, i) => ({
    file: abs(`${dir}/${name}.ts`),
    imports: names
      .filter((_, j) => j !== i)
      .map((other) => ({ from: `./${other}`, names: [other] })),
    exports: [name],
    symbols: [{ name, kind: 'const' }],
  }))
}

// ---------------------------------------------------------------------------
// 1. Empty graph
// ---------------------------------------------------------------------------

describe('clusterFactGraph — edge cases', () => {
  it('returns an empty result on an empty graph and does not throw', () => {
    const graph = buildGraph([])
    const result = clusterFactGraph(graph)
    expect(result.clusters).toEqual([])
    expect(result.moduleToCluster.size).toBe(0)
    expect(result.modularity).toBe(0)
    expect(result.diagnostics).toEqual({
      isolatedModules: 0,
      smallClustersBefore: 0,
      smallClustersAfter: 0,
    })
  })

  it('makes every module a singleton cluster when there are zero edges', () => {
    const mods: FactInputModule[] = ['a', 'b', 'c'].map((n) => ({
      file: abs(`src/${n}.ts`),
      imports: [],
      exports: [n],
      symbols: [{ name: n, kind: 'const' }],
    }))
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)

    expect(result.clusters.length).toBe(3)
    for (const c of result.clusters) expect(c.size).toBe(1)
    // All below default minClusterSize=2, none have neighbors → all remain.
    expect(result.diagnostics.smallClustersAfter).toBe(3)
    expect(result.diagnostics.isolatedModules).toBe(3)
    expect(result.moduleToCluster.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 2. Two obvious layers
// ---------------------------------------------------------------------------

describe('clusterFactGraph — partitioning', () => {
  it('separates two densely connected layers with a single cross-edge', () => {
    const mods: FactInputModule[] = [
      ...denseRing('src/a', ['a1', 'a2', 'a3']),
      ...denseRing('src/b', ['b1', 'b2', 'b3']),
    ]
    // Add the single cross-edge a1 → b1.
    mods[0].imports.push({ from: '../b/b1', names: ['b1'] })

    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)

    expect(result.clusters.length).toBe(2)
    const sizes = result.clusters.map((c) => c.size).sort()
    expect(sizes).toEqual([3, 3])

    // Each cluster's members all share the same dir prefix.
    const dirs = result.clusters.map((c) => c.pathPrefix).sort()
    expect(dirs).toEqual(['src/a', 'src/b'])

    // Modularity should be strong when the graph is cleanly separable.
    expect(result.modularity).toBeGreaterThan(0.1)
  })
})

// ---------------------------------------------------------------------------
// 3. Small cluster merge
// ---------------------------------------------------------------------------

describe('clusterFactGraph — merge', () => {
  it('merges a singleton connected to a larger cluster into that cluster', () => {
    const mods: FactInputModule[] = [
      ...denseRing('src/a', ['a1', 'a2', 'a3', 'a4']),
      {
        file: abs('src/a/c.ts'),
        imports: [{ from: './a1', names: ['a1'] }],
        exports: ['c'],
        symbols: [{ name: 'c', kind: 'const' }],
      },
    ]

    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)

    // Exactly one cluster containing all 5 modules.
    expect(result.clusters.length).toBe(1)
    expect(result.clusters[0].size).toBe(5)
    expect(result.diagnostics.smallClustersAfter).toBe(0)
  })

  it('leaves a truly isolated module as a singleton', () => {
    const mods: FactInputModule[] = [
      ...denseRing('src/a', ['a1', 'a2', 'a3']),
      // {z} has zero imports & is not imported by anyone.
      {
        file: abs('src/z.ts'),
        imports: [],
        exports: ['z'],
        symbols: [{ name: 'z', kind: 'const' }],
      },
    ]

    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)

    // 1 cluster of 3 + 1 singleton = 2 clusters.
    expect(result.clusters.length).toBe(2)
    const sizes = result.clusters.map((c) => c.size).sort()
    expect(sizes).toEqual([1, 3])
    expect(result.diagnostics.smallClustersAfter).toBe(1)
    expect(result.diagnostics.isolatedModules).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4. Stable cluster IDs (the determinism invariant)
// ---------------------------------------------------------------------------

describe('clusterFactGraph — determinism', () => {
  it('produces byte-identical output on two runs over the same FactGraph', () => {
    const mods: FactInputModule[] = [
      ...denseRing('src/a', ['a1', 'a2', 'a3']),
      ...denseRing('src/b', ['b1', 'b2', 'b3']),
      ...denseRing('src/c', ['c1', 'c2', 'c3', 'c4']),
    ]
    // Sprinkle cross-edges to make communities non-trivial.
    mods[0].imports.push({ from: '../b/b1', names: ['b1'] })
    mods[3].imports.push({ from: '../c/c1', names: ['c1'] })

    const graph = buildGraph(mods)
    const r1 = clusterFactGraph(graph)
    const r2 = clusterFactGraph(graph)

    // Serialize for deep structural comparison.
    const ser = (r: ReturnType<typeof clusterFactGraph>) =>
      JSON.stringify({
        clusters: r.clusters,
        moduleToCluster: Array.from(r.moduleToCluster.entries()).sort(),
        modularity: r.modularity,
        diagnostics: r.diagnostics,
      })

    expect(ser(r1)).toBe(ser(r2))

    // Also assert the array order itself matches — not just set equality.
    expect(r1.clusters.map((c) => c.id)).toEqual(r2.clusters.map((c) => c.id))
  })

  it('exposes cluster IDs in the `cluster:<hex>` shape', () => {
    const mods: FactInputModule[] = denseRing('src/a', ['a1', 'a2', 'a3'])
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)
    for (const c of result.clusters) {
      expect(c.id).toMatch(/^cluster:[0-9a-f]{12}$/)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. PathPrefix extraction
// ---------------------------------------------------------------------------

describe('clusterFactGraph — pathPrefix', () => {
  it('extracts the longest common directory prefix including subdirs', () => {
    const mods: FactInputModule[] = [
      {
        file: abs('src/lib/ingest/a.ts'),
        imports: [{ from: './b', names: ['b'] }, { from: './sub/c', names: ['c'] }],
        exports: ['a'],
        symbols: [{ name: 'a', kind: 'const' }],
      },
      {
        file: abs('src/lib/ingest/b.ts'),
        imports: [{ from: './a', names: ['a'] }],
        exports: ['b'],
        symbols: [{ name: 'b', kind: 'const' }],
      },
      {
        file: abs('src/lib/ingest/sub/c.ts'),
        imports: [{ from: '../a', names: ['a'] }],
        exports: ['c'],
        symbols: [{ name: 'c', kind: 'const' }],
      },
    ]
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)
    expect(result.clusters.length).toBe(1)
    expect(result.clusters[0].pathPrefix).toBe('src/lib/ingest')
  })

  it('returns undefined when members have no common directory', () => {
    // Build two modules with completely disjoint directories, linked by an import.
    const mods: FactInputModule[] = [
      {
        file: abs('alpha/a.ts'),
        imports: [{ from: '../beta/b', names: ['b'] }],
        exports: ['a'],
        symbols: [{ name: 'a', kind: 'const' }],
      },
      {
        file: abs('beta/b.ts'),
        imports: [{ from: '../alpha/a', names: ['a'] }],
        exports: ['b'],
        symbols: [{ name: 'b', kind: 'const' }],
      },
    ]
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)
    expect(result.clusters.length).toBe(1)
    expect(result.clusters[0].pathPrefix).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 6. PrimaryEntry tie-break
// ---------------------------------------------------------------------------

describe('clusterFactGraph — primaryEntry tie-break', () => {
  it('prefers shortest filePath when inbound counts tie', () => {
    // Build 2 clusters; in cluster A, modules `short.ts` and `longer-name.ts`
    // both receive exactly 1 import from cluster B.
    const mods: FactInputModule[] = [
      // Cluster A (tightly coupled).
      {
        file: abs('src/a/short.ts'),
        imports: [{ from: './longer-name', names: ['x'] }],
        exports: ['x'],
        symbols: [{ name: 'x', kind: 'const' }],
      },
      {
        file: abs('src/a/longer-name.ts'),
        imports: [{ from: './short', names: ['x'] }],
        exports: ['y'],
        symbols: [{ name: 'y', kind: 'const' }],
      },
      // Cluster B — two modules, each importing one of A's modules.
      {
        file: abs('src/b/b1.ts'),
        imports: [
          { from: '../a/short', names: ['x'] },
          { from: './b2', names: ['b2'] },
        ],
        exports: [],
        symbols: [{ name: 'b1', kind: 'const' }],
      },
      {
        file: abs('src/b/b2.ts'),
        imports: [
          { from: '../a/longer-name', names: ['y'] },
          { from: './b1', names: ['b1'] },
        ],
        exports: [],
        symbols: [{ name: 'b2', kind: 'const' }],
      },
    ]
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)

    // Find cluster A by its pathPrefix.
    const clusterA = result.clusters.find((c) => c.pathPrefix === 'src/a')
    expect(clusterA).toBeDefined()
    // Both A-members have external-inbound=1 (tie). Shortest filePath wins.
    // 'src/a/short.ts' (14) < 'src/a/longer-name.ts' (20).
    expect(clusterA?.primaryEntry).toBe('src/a/short.ts')
  })
})

// ---------------------------------------------------------------------------
// 7. Modularity score range
// ---------------------------------------------------------------------------

describe('clusterFactGraph — modularity', () => {
  it('returns a finite modularity in [-1, 1]', () => {
    const mods: FactInputModule[] = [
      ...denseRing('src/a', ['a1', 'a2', 'a3']),
      ...denseRing('src/b', ['b1', 'b2', 'b3']),
    ]
    const graph = buildGraph(mods)
    const result = clusterFactGraph(graph)
    expect(Number.isFinite(result.modularity)).toBe(true)
    expect(result.modularity).toBeGreaterThanOrEqual(-1)
    expect(result.modularity).toBeLessThanOrEqual(1)
  })
})
