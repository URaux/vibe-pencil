/**
 * Verification-only — parseTsProject + buildFactGraph + clusterFactGraph +
 * buildCodeAnchors on archviber/src. Asserts structural contracts and prints
 * a summary sample for eyeballing.
 */

import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { parseTsProject } from '../../../src/lib/ingest/ast-ts'
import { buildFactGraph, loadTsconfigPathAliases } from '../../../src/lib/ingest/facts'
import { clusterFactGraph } from '../../../src/lib/ingest/cluster'
import { buildCodeAnchors } from '../../../src/lib/ingest/code-anchors'

describe('code-anchors — verification on archviber/src', () => {
  const archviberRoot = path.resolve(__dirname, '../../..')
  const srcDir = path.join(archviberRoot, 'src')

  it('emits one anchor per cluster with near-total coverage', async () => {
    const parsed = await parseTsProject(srcDir)
    const pathAliases = loadTsconfigPathAliases(archviberRoot) ?? undefined
    const graph = buildFactGraph({
      projectRoot: archviberRoot,
      modules: parsed.modules,
      pathAliases,
    })

    const clusters = clusterFactGraph(graph)
    const result = buildCodeAnchors(graph, clusters)

    // eslint-disable-next-line no-console
    console.log('[code-anchors-verify] totalModules:', graph.stats.modules)
    // eslint-disable-next-line no-console
    console.log('[code-anchors-verify] numClusters:', clusters.clusters.length)
    // eslint-disable-next-line no-console
    console.log(
      '[code-anchors-verify] coverage:',
      result.coverage.toFixed(4),
      'entries:',
      result.entries.length,
    )
    // eslint-disable-next-line no-console
    console.log('[code-anchors-verify] diagnostics:', result.diagnostics)

    // Sample — first 3 entries.
    for (const e of result.entries.slice(0, 3)) {
      // eslint-disable-next-line no-console
      console.log(
        `[code-anchors-verify]   ${e.clusterId} files=${e.anchor.files.length} primary=${e.anchor.primary_entry ?? '—'} symbols=${e.anchor.files.reduce((n, f) => n + f.symbols.length, 0)}`,
      )
    }

    // ---- Contracts ----------------------------------------------------------
    expect(result.entries.length).toBe(clusters.clusters.length)
    expect(result.coverage).toBeGreaterThanOrEqual(0.9)
    expect(result.diagnostics.orphanedPrimaryEntries).toBe(0)

    for (const e of result.entries) {
      expect(e.anchor.files.length).toBeGreaterThanOrEqual(1)
      if (e.anchor.primary_entry !== undefined) {
        const paths = e.anchor.files.map((f) => f.path)
        expect(paths).toContain(e.anchor.primary_entry)
      }
    }
  }, 60_000)
})
