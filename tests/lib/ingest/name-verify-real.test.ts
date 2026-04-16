/**
 * Verification-only — GATED real-API test. Runs parseTsProject +
 * buildFactGraph + clusterFactGraph + buildCodeAnchors + nameClusters on
 * archviber/src. Skipped unless `VIBE_LLM_API_KEY` is set in the environment.
 */

import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { parseTsProject } from '../../../src/lib/ingest/ast-ts'
import { buildFactGraph, loadTsconfigPathAliases } from '../../../src/lib/ingest/facts'
import { clusterFactGraph } from '../../../src/lib/ingest/cluster'
import { buildCodeAnchors } from '../../../src/lib/ingest/code-anchors'
import { nameClusters } from '../../../src/lib/ingest/name'

const HAS_KEY = Boolean(process.env.VIBE_LLM_API_KEY)

describe.skipIf(!HAS_KEY)('name — verification on archviber/src (real API)', () => {
  const archviberRoot = path.resolve(__dirname, '../../..')
  const srcDir = path.join(archviberRoot, 'src')

  it(
    'names every cluster with >= 50% LLM success rate',
    async () => {
      const parsed = await parseTsProject(srcDir)
      const pathAliases = loadTsconfigPathAliases(archviberRoot) ?? undefined
      const graph = buildFactGraph({
        projectRoot: archviberRoot,
        modules: parsed.modules,
        pathAliases,
      })
      const clusters = clusterFactGraph(graph)
      const anchors = buildCodeAnchors(graph, clusters)

      const config = {
        apiBase: process.env.VIBE_LLM_API_BASE ?? 'https://api.anthropic.com/v1',
        apiKey: process.env.VIBE_LLM_API_KEY ?? '',
        model: process.env.VIBE_LLM_MODEL ?? 'claude-sonnet-4-6',
      }

      const started = Date.now()
      const result = await nameClusters(clusters, anchors, config, {
        timeoutMs: 20_000,
        concurrency: 4,
        projectName: 'archviber',
      })
      const elapsed = Date.now() - started

      // eslint-disable-next-line no-console
      console.log(`[name-verify] clusters: ${clusters.clusters.length}`)
      // eslint-disable-next-line no-console
      console.log(`[name-verify] diagnostics:`, result.diagnostics)
      // eslint-disable-next-line no-console
      console.log(`[name-verify] elapsed: ${elapsed}ms`)
      for (const [id, cn] of result.names) {
        // eslint-disable-next-line no-console
        console.log(
          `[name-verify]   ${id} [${cn.source}] "${cn.name}" (${cn.confidence.toFixed(2)})${cn.description ? ' — ' + cn.description : ''}`,
        )
      }

      // ---- Contracts ---------------------------------------------------------
      expect(result.names.size).toBe(clusters.clusters.length)
      const llmSuccessRate =
        clusters.clusters.length === 0
          ? 1
          : result.diagnostics.llmSuccesses / clusters.clusters.length
      expect(llmSuccessRate).toBeGreaterThanOrEqual(0.5)
      expect(elapsed).toBeLessThan(60_000)
    },
    90_000,
  )
})
