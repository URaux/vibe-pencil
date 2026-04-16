/**
 * Verification-only smoke test — runs parseTsProject + buildFactGraph +
 * clusterFactGraph on archviber/src itself and asserts structural properties
 * of the partition. Does NOT pin the specific partition — Louvain output is
 * sensitive to graph state — but guards against degenerate clustering.
 */

import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { parseTsProject } from '../../../src/lib/ingest/ast-ts'
import { buildFactGraph, loadTsconfigPathAliases } from '../../../src/lib/ingest/facts'
import { clusterFactGraph } from '../../../src/lib/ingest/cluster'

describe('cluster — verification on archviber/src', () => {
  const archviberRoot = path.resolve(__dirname, '../../..')
  const srcDir = path.join(archviberRoot, 'src')

  it('produces a sensible partition with no degenerate giant cluster', async () => {
    const parsed = await parseTsProject(srcDir)
    const pathAliases = loadTsconfigPathAliases(archviberRoot) ?? undefined
    const graph = buildFactGraph({ projectRoot: archviberRoot, modules: parsed.modules, pathAliases })

    const result = clusterFactGraph(graph)

    // eslint-disable-next-line no-console
    console.log('[cluster-verify] totalModules:', graph.stats.modules)
    // eslint-disable-next-line no-console
    console.log('[cluster-verify] numClusters:', result.clusters.length)
    // eslint-disable-next-line no-console
    console.log('[cluster-verify] modularity:', result.modularity.toFixed(4))
    // eslint-disable-next-line no-console
    console.log('[cluster-verify] diagnostics:', result.diagnostics)

    for (const c of result.clusters) {
      // eslint-disable-next-line no-console
      console.log(
        `[cluster-verify]   ${c.id} size=${c.size} prefix=${c.pathPrefix ?? '—'} entry=${c.primaryEntry}`,
      )
    }

    // Cluster count within a sane range.
    expect(result.clusters.length).toBeGreaterThanOrEqual(3)
    expect(result.clusters.length).toBeLessThanOrEqual(15)

    // Modularity should signal meaningful community structure.
    expect(result.modularity).toBeGreaterThan(0.2)

    // No cluster dominates the whole project.
    const totalModules = graph.stats.modules
    for (const c of result.clusters) {
      expect(c.size).toBeLessThan(totalModules * 0.6)
    }

    // Conservation: every module appears in exactly one cluster.
    const sumOfSizes = result.clusters.reduce((acc, c) => acc + c.size, 0)
    expect(sumOfSizes).toBe(totalModules)
    expect(result.moduleToCluster.size).toBe(totalModules)

    // No duplicate cluster IDs.
    const ids = new Set(result.clusters.map((c) => c.id))
    expect(ids.size).toBe(result.clusters.length)

    // Determinism invariant on the real graph.
    const again = clusterFactGraph(graph)
    expect(again.clusters.map((c) => c.id)).toEqual(result.clusters.map((c) => c.id))
    expect(again.clusters.map((c) => c.memberIds)).toEqual(result.clusters.map((c) => c.memberIds))
  }, 60_000)
})
