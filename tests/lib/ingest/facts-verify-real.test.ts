/**
 * Verification-only smoke test — runs parseTsProject on archviber/src itself,
 * then buildFactGraph + cache round-trip, and prints/asserts real-world counts.
 *
 * Separate from facts.test.ts so the main test file stays hermetic.
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, it, expect } from 'vitest'

import { parseTsProject } from '../../../src/lib/ingest/ast-ts'
import { buildFactGraph, loadTsconfigPathAliases } from '../../../src/lib/ingest/facts'
import {
  defaultFactsCachePath,
  isCacheValid,
  readCachedFactGraph,
  writeCachedFactGraph,
} from '../../../src/lib/ingest/facts-cache'

describe('facts — verification on archviber/src', () => {
  const archviberRoot = path.resolve(__dirname, '../../..')
  const srcDir = path.join(archviberRoot, 'src')

  it('builds a non-trivial graph with sensible counts and a fast cache hit', async () => {
    const parsed = await parseTsProject(srcDir)

    let relativeImportsCount = 0
    let packageImportsCount = 0
    for (const m of parsed.modules) {
      for (const imp of m.imports) {
        if (imp.from.startsWith('.') || imp.from.startsWith('/')) relativeImportsCount++
        else packageImportsCount++
      }
    }

    const pathAliases = loadTsconfigPathAliases(archviberRoot) ?? undefined
    const graph = buildFactGraph({ projectRoot: archviberRoot, modules: parsed.modules, pathAliases })

    // eslint-disable-next-line no-console
    console.log('[facts-verify] parsed modules:', parsed.modules.length)
    // eslint-disable-next-line no-console
    console.log('[facts-verify] stats:', graph.stats)
    // eslint-disable-next-line no-console
    console.log(
      `[facts-verify] relative imports in parser output: ${relativeImportsCount}, package imports: ${packageImportsCount}`,
    )
    // eslint-disable-next-line no-console
    console.log(
      `[facts-verify] resolved ratio: ${((graph.stats.imports / Math.max(1, relativeImportsCount)) * 100).toFixed(1)}% (${graph.stats.imports}/${relativeImportsCount})`,
    )

    // Sanity thresholds.
    expect(graph.stats.modules).toBeGreaterThanOrEqual(98)
    expect(graph.stats.symbols).toBeGreaterThan(200)
    // With @/* alias resolution on, hundreds of import edges should land.
    expect(graph.stats.imports).toBeGreaterThan(200)

    // Cache round-trip + hot-hit timing.
    const mtimes: Record<string, number> = {}
    for (const m of parsed.modules) {
      const abs = m.file.replace(/\\/g, '/')
      const rel = path.posix.normalize(path.relative(archviberRoot, abs).replace(/\\/g, '/'))
      const s = await fs.stat(m.file)
      mtimes[rel] = s.mtimeMs
    }

    const cachePath = defaultFactsCachePath(archviberRoot)
    try {
      const t0 = performance.now()
      await writeCachedFactGraph(cachePath, graph, mtimes)
      const t1 = performance.now()

      const t2 = performance.now()
      const cached = await readCachedFactGraph(cachePath)
      expect(cached).not.toBeNull()
      const valid = await isCacheValid(cached!, archviberRoot)
      const t3 = performance.now()

      // eslint-disable-next-line no-console
      console.log(`[facts-verify] cache write: ${(t1 - t0).toFixed(1)}ms`)
      // eslint-disable-next-line no-console
      console.log(`[facts-verify] cache read+validate: ${(t3 - t2).toFixed(1)}ms (valid=${valid})`)

      expect(valid).toBe(true)
      // Hot-hit cost budget: 50ms on a ~100-module repo per PLAN.md. Give 2x
      // headroom for slow CI / cold FS cache.
      expect(t3 - t2).toBeLessThan(100)
    } finally {
      // Always clean up the cache — we don't want real-repo side-effects.
      try {
        await fs.unlink(cachePath)
      } catch {
        /* swallow */
      }
    }
  }, 60_000)
})
