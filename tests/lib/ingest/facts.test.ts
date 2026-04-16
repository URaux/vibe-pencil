import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  buildFactGraph,
  isModuleNode,
  isSymbolNode,
  type FactInputModule,
  type FactGraph,
} from '../../../src/lib/ingest/facts'
import {
  defaultFactsCachePath,
  isCacheValid,
  readCachedFactGraph,
  rehydrateFactGraph,
  writeCachedFactGraph,
} from '../../../src/lib/ingest/facts-cache'

/**
 * W2.D2 smoke tests — built against handcrafted `FactInputModule[]` fixtures
 * so parser coupling is zero. Cache tests use `os.tmpdir()` — never the repo.
 */

// ---------------------------------------------------------------------------
// Synthesized fixtures
// ---------------------------------------------------------------------------

const ROOT = toPosix('C:/fake-project')

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function abs(rel: string): string {
  return `${ROOT}/${rel}`
}

/** A tiny synthetic project with relative + package + missing imports. */
function smallFixture(): FactInputModule[] {
  return [
    {
      file: abs('src/a.ts'),
      imports: [
        { from: './b', names: ['x'] },
        { from: 'react', names: ['default'] },
        { from: './nowhere', names: ['foo'] },
      ],
      exports: ['a'],
      symbols: [
        { name: 'a', kind: 'const' },
        { name: 'helper', kind: 'function' },
      ],
    },
    {
      file: abs('src/b.ts'),
      imports: [],
      exports: ['x'],
      symbols: [{ name: 'x', kind: 'const' }],
    },
    {
      file: abs('src/c.ts'),
      imports: [
        { from: './b', names: ['x'] },
        // Duplicate (source=c, target=b, specifier='./b') — second edge must
        // merge names, not create a new edge.
        { from: './b', names: ['x', 'y'] },
      ],
      exports: [],
      symbols: [],
    },
    {
      file: abs('src/nested/d.ts'),
      imports: [
        // Relative climb back to src/a.ts
        { from: '../a', names: ['a'] },
      ],
      exports: [],
      symbols: [{ name: 'Widget', kind: 'class' }],
    },
    // Directory-style import target: `src/lib/index.ts`
    {
      file: abs('src/lib/index.ts'),
      imports: [],
      exports: ['lib'],
      symbols: [{ name: 'lib', kind: 'const' }],
    },
    {
      file: abs('src/consumer.ts'),
      imports: [{ from: './lib', names: ['lib'] }],
      exports: [],
      symbols: [],
    },
    // File-over-directory preference: `src/foo.ts` AND `src/foo/index.ts`
    {
      file: abs('src/foo.ts'),
      imports: [],
      exports: [],
      symbols: [{ name: 'fooFile', kind: 'const' }],
    },
    {
      file: abs('src/foo/index.ts'),
      imports: [],
      exports: [],
      symbols: [{ name: 'fooIndex', kind: 'const' }],
    },
    {
      file: abs('src/foo-consumer.ts'),
      imports: [{ from: './foo', names: ['fooFile'] }],
      exports: [],
      symbols: [],
    },
  ]
}

// ---------------------------------------------------------------------------
// buildFactGraph tests
// ---------------------------------------------------------------------------

describe('buildFactGraph', () => {
  it('emits a well-formed empty graph for zero modules', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: [] })
    expect(graph.nodes.size).toBe(0)
    expect(graph.edges).toHaveLength(0)
    expect(graph.stats).toEqual({
      modules: 0,
      symbols: 0,
      imports: 0,
      contains: 0,
      byLanguage: {},
    })
    expect(graph.projectRoot).toBe(ROOT)
  })

  it('builds nodes, edges, and stats from a synthesized fixture', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    // 9 modules.
    expect(graph.stats.modules).toBe(9)

    // Symbols: a, helper, x, Widget, lib, fooFile, fooIndex → 7 symbols.
    expect(graph.stats.symbols).toBe(7)

    // Contains edges = symbols count.
    expect(graph.stats.contains).toBe(7)

    // Language stats — all typescript.
    expect(graph.stats.byLanguage).toEqual({ typescript: 9 })

    // Node sanity.
    let moduleCount = 0
    let symbolCount = 0
    for (const n of graph.nodes.values()) {
      if (isModuleNode(n)) moduleCount++
      else if (isSymbolNode(n)) symbolCount++
    }
    expect(moduleCount).toBe(9)
    expect(symbolCount).toBe(7)
  })

  it('resolves relative imports to existing modules', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    const importEdges = graph.edges.filter((e) => e.kind === 'import')

    // src/a.ts → src/b.ts (one resolved edge; the './nowhere' import is dropped)
    const aToB = importEdges.find(
      (e) => e.source === 'module:src/a.ts' && e.target === 'module:src/b.ts',
    )
    expect(aToB).toBeDefined()
    expect(aToB?.specifier).toBe('./b')
    expect(aToB?.names).toEqual(['x'])

    // src/nested/d.ts → src/a.ts (via `../a`)
    const dToA = importEdges.find(
      (e) => e.source === 'module:src/nested/d.ts' && e.target === 'module:src/a.ts',
    )
    expect(dToA).toBeDefined()
    expect(dToA?.specifier).toBe('../a')

    // src/consumer.ts → src/lib/index.ts (directory-style via `./lib`)
    const consumerToLib = importEdges.find(
      (e) => e.source === 'module:src/consumer.ts' && e.target === 'module:src/lib/index.ts',
    )
    expect(consumerToLib).toBeDefined()
    expect(consumerToLib?.specifier).toBe('./lib')
  })

  it('drops relative imports that do not match any module (no phantom nodes)', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    // No node for `src/nowhere.ts`.
    expect(graph.nodes.has('module:src/nowhere.ts')).toBe(false)
    expect(graph.nodes.has('module:src/nowhere')).toBe(false)

    // No edge from src/a.ts to any 'nowhere' target.
    const hasPhantom = graph.edges.some(
      (e) =>
        e.kind === 'import' &&
        e.source === 'module:src/a.ts' &&
        e.specifier === './nowhere',
    )
    expect(hasPhantom).toBe(false)
  })

  it('drops non-relative (package) imports', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    // No node for `react` and no import edge with specifier 'react'.
    expect(graph.nodes.has('module:react')).toBe(false)
    const reactEdge = graph.edges.find(
      (e) => e.kind === 'import' && e.specifier === 'react',
    )
    expect(reactEdge).toBeUndefined()
  })

  it('deduplicates imports by (source, target, specifier) and unions names', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    const cToBEdges = graph.edges.filter(
      (e) =>
        e.kind === 'import' &&
        e.source === 'module:src/c.ts' &&
        e.target === 'module:src/b.ts' &&
        e.specifier === './b',
    )
    expect(cToBEdges).toHaveLength(1)
    // Name union: ['x'] ∪ ['x','y'] = {x, y}
    expect(cToBEdges[0].names?.slice().sort()).toEqual(['x', 'y'])
  })

  it('prefers file over directory when both exist for the same specifier', () => {
    const graph = buildFactGraph({ projectRoot: ROOT, modules: smallFixture() })

    // src/foo-consumer.ts imports './foo' — both src/foo.ts and
    // src/foo/index.ts exist. The file wins.
    const edge = graph.edges.find(
      (e) =>
        e.kind === 'import' &&
        e.source === 'module:src/foo-consumer.ts' &&
        e.specifier === './foo',
    )
    expect(edge).toBeDefined()
    expect(edge?.target).toBe('module:src/foo.ts')
  })

  it('silently skips symbols with empty names (no phantom half-edges)', () => {
    const modules: FactInputModule[] = [
      {
        file: abs('src/bad.ts'),
        imports: [],
        exports: [],
        symbols: [
          { name: '', kind: 'const' },
          { name: 'ok', kind: 'const' },
        ],
      },
    ]
    const graph = buildFactGraph({ projectRoot: ROOT, modules })

    expect(graph.stats.symbols).toBe(1)
    expect(graph.nodes.has('symbol:src/bad.ts::ok')).toBe(true)
    // No symbol node with empty name.
    for (const n of graph.nodes.values()) {
      if (isSymbolNode(n)) expect(n.name).not.toBe('')
    }
  })

  it('normalizes Windows-style backslashes in file paths', () => {
    const modules: FactInputModule[] = [
      {
        file: `${ROOT}\\src\\win.ts`,
        imports: [],
        exports: [],
        symbols: [{ name: 'w', kind: 'const' }],
      },
    ]
    const graph = buildFactGraph({ projectRoot: ROOT, modules })
    expect(graph.nodes.has('module:src/win.ts')).toBe(true)
    expect(graph.nodes.has('symbol:src/win.ts::w')).toBe(true)
  })

  it('infers language from extension when not provided', () => {
    const modules: FactInputModule[] = [
      { file: abs('a.py'), imports: [], exports: [], symbols: [] },
      { file: abs('b.go'), imports: [], exports: [], symbols: [] },
      { file: abs('c.tsx'), imports: [], exports: [], symbols: [] },
      { file: abs('d.js'), imports: [], exports: [], symbols: [] },
    ]
    const graph = buildFactGraph({ projectRoot: ROOT, modules })
    expect(graph.stats.byLanguage).toEqual({
      python: 1,
      go: 1,
      tsx: 1,
      javascript: 1,
    })
  })

  it('honors the explicit `language` field on parser output', () => {
    const modules: FactInputModule[] = [
      {
        file: abs('mystery'),
        language: 'python',
        imports: [],
        exports: [],
        symbols: [],
      },
    ]
    const graph = buildFactGraph({ projectRoot: ROOT, modules })
    expect(graph.stats.byLanguage).toEqual({ python: 1 })
  })

  it('honors `languageByPath` override above module.language', () => {
    const absPath = abs('foo.ts')
    const override = new Map<string, 'python'>()
    override.set(absPath, 'python')
    const modules: FactInputModule[] = [
      { file: absPath, language: 'typescript', imports: [], exports: [], symbols: [] },
    ]
    const graph = buildFactGraph({
      projectRoot: ROOT,
      modules,
      languageByPath: override,
    })
    expect(graph.stats.byLanguage).toEqual({ python: 1 })
  })
})

// ---------------------------------------------------------------------------
// Cache tests (real temp dir; never the repo)
// ---------------------------------------------------------------------------

describe('facts-cache', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-facts-cache-'))
  })

  afterEach(async () => {
    // Best-effort cleanup; tests should not fail cleanup.
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* swallow */
    }
  })

  async function seedProject(files: Record<string, string>): Promise<{
    projectRoot: string
    mtimes: Record<string, number>
  }> {
    const projectRoot = tmpDir
    const mtimes: Record<string, number> = {}
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(projectRoot, rel)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
      const s = await fs.stat(full)
      // Use POSIX-style keys to match buildFactGraph output.
      mtimes[rel.replace(/\\/g, '/')] = s.mtimeMs
    }
    return { projectRoot, mtimes }
  }

  function buildSmallGraph(projectRoot: string): FactGraph {
    const modules: FactInputModule[] = [
      {
        file: path.join(projectRoot, 'src/a.ts'),
        imports: [{ from: './b', names: ['x'] }],
        exports: ['a'],
        symbols: [{ name: 'a', kind: 'const' }],
      },
      {
        file: path.join(projectRoot, 'src/b.ts'),
        imports: [],
        exports: ['x'],
        symbols: [{ name: 'x', kind: 'const' }],
      },
    ]
    return buildFactGraph({ projectRoot, modules })
  }

  it('returns null when the cache file does not exist', async () => {
    const cachePath = defaultFactsCachePath(tmpDir)
    const cached = await readCachedFactGraph(cachePath)
    expect(cached).toBeNull()
  })

  it('returns null when the cache file is corrupt JSON', async () => {
    const cachePath = defaultFactsCachePath(tmpDir)
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, '{ this is not json', 'utf8')
    const cached = await readCachedFactGraph(cachePath)
    expect(cached).toBeNull()
  })

  it('returns null when the payload fails schema checks', async () => {
    const cachePath = defaultFactsCachePath(tmpDir)
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify({ version: 99 }), 'utf8')
    const cached = await readCachedFactGraph(cachePath)
    expect(cached).toBeNull()
  })

  it('round-trips a graph with structural equality', async () => {
    const { projectRoot, mtimes } = await seedProject({
      'src/a.ts': 'export const a = 1',
      'src/b.ts': 'export const x = 2',
    })
    const graph = buildSmallGraph(projectRoot)
    const cachePath = defaultFactsCachePath(projectRoot)

    await writeCachedFactGraph(cachePath, graph, mtimes)

    const cached = await readCachedFactGraph(cachePath)
    expect(cached).not.toBeNull()
    expect(cached!.version).toBe(1)
    expect(cached!.projectRoot).toBe(projectRoot)
    expect(cached!.mtimes).toEqual(mtimes)
    expect(cached!.graph.stats).toEqual(graph.stats)
    expect(cached!.graph.edges).toEqual(graph.edges)

    // Rehydrated nodes match original Map contents.
    const rehydrated = rehydrateFactGraph(cached!)
    expect(rehydrated.nodes.size).toBe(graph.nodes.size)
    for (const [id, node] of graph.nodes) {
      expect(rehydrated.nodes.get(id)).toEqual(node)
    }
  })

  it('isCacheValid returns true for a pristine round-trip', async () => {
    const { projectRoot, mtimes } = await seedProject({
      'src/a.ts': 'export const a = 1',
      'src/b.ts': 'export const x = 2',
    })
    const graph = buildSmallGraph(projectRoot)
    const cachePath = defaultFactsCachePath(projectRoot)
    await writeCachedFactGraph(cachePath, graph, mtimes)

    const cached = await readCachedFactGraph(cachePath)
    expect(cached).not.toBeNull()
    const valid = await isCacheValid(cached!, projectRoot)
    expect(valid).toBe(true)
  })

  it('isCacheValid returns false when an mtime drifts', async () => {
    const { projectRoot, mtimes } = await seedProject({
      'src/a.ts': 'export const a = 1',
      'src/b.ts': 'export const x = 2',
    })
    const graph = buildSmallGraph(projectRoot)
    const cachePath = defaultFactsCachePath(projectRoot)
    await writeCachedFactGraph(cachePath, graph, mtimes)

    // Tamper with cached mtime — simulates file touched after cache write.
    const cached = await readCachedFactGraph(cachePath)
    expect(cached).not.toBeNull()
    cached!.mtimes['src/a.ts'] = cached!.mtimes['src/a.ts'] + 99_999
    const valid = await isCacheValid(cached!, projectRoot)
    expect(valid).toBe(false)
  })

  it('isCacheValid returns false when a tracked file is missing', async () => {
    const { projectRoot, mtimes } = await seedProject({
      'src/a.ts': 'export const a = 1',
    })
    // Register a non-existent file in mtimes.
    mtimes['src/missing.ts'] = Date.now()
    const graph = buildFactGraph({ projectRoot, modules: [] })
    const cachePath = defaultFactsCachePath(projectRoot)
    await writeCachedFactGraph(cachePath, graph, mtimes)

    const cached = await readCachedFactGraph(cachePath)
    expect(cached).not.toBeNull()
    const valid = await isCacheValid(cached!, projectRoot)
    expect(valid).toBe(false)
  })

  it('isCacheValid returns true for an empty mtimes map', async () => {
    const graph = buildFactGraph({ projectRoot: tmpDir, modules: [] })
    const cachePath = defaultFactsCachePath(tmpDir)
    await writeCachedFactGraph(cachePath, graph, {})
    const cached = await readCachedFactGraph(cachePath)
    expect(cached).not.toBeNull()
    const valid = await isCacheValid(cached!, tmpDir)
    expect(valid).toBe(true)
  })

  it('write is atomic — no lingering .tmp on success', async () => {
    const { projectRoot, mtimes } = await seedProject({
      'src/a.ts': 'export const a = 1',
    })
    const graph = buildSmallGraph(projectRoot)
    const cachePath = defaultFactsCachePath(projectRoot)
    await writeCachedFactGraph(cachePath, graph, mtimes)

    const dir = path.dirname(cachePath)
    const entries = await fs.readdir(dir)
    expect(entries).toContain('facts.json')
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false)
  })
})
