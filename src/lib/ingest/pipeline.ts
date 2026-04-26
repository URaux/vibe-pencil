/**
 * Combined polyglot ingest pipeline — W2.D7.
 *
 * Walks a project, dispatches each file to the correct LanguageAdapter via
 * the registry, and aggregates per-file `FactInputModule` into a `FactGraph`
 * via the existing `buildFactGraph`.
 *
 * Inputs:
 *   - projectRoot — absolute path
 *   - opts.skipDirs — top-level directory names to skip (default: node_modules, .git, .next, dist, out, .archviber, __pycache__)
 *   - opts.maxFiles — hard cap (default 5_000) to keep walks bounded on huge repos
 *
 * Returns the FactGraph plus per-file diagnostics.
 *
 * Side-effect: imports `./languages/register-defaults` to ensure built-in
 * adapters are registered before the registry is queried.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import './languages/register-defaults'
import { findAdapter } from './languages/registry'
import { buildFactGraph, type FactGraph, type FactInputModule, type FactLanguage } from './facts'

export interface IngestPipelineOptions {
  /** Top-level directory names to skip during the walk. */
  skipDirs?: ReadonlySet<string>
  /** Hard cap on files visited. */
  maxFiles?: number
  /** Optional path-alias map forwarded to buildFactGraph. */
  pathAliases?: Record<string, string[]>
}

export interface IngestDiagnostics {
  filesVisited: number
  filesParsed: number
  filesSkippedNoAdapter: number
  filesFailedParse: Array<{ file: string; error: string }>
  byLanguage: Record<string, number>
  walkMs: number
  parseMs: number
}

export interface IngestResult {
  graph: FactGraph
  modules: FactInputModule[]
  diagnostics: IngestDiagnostics
}

const DEFAULT_SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  '.archviber',
  '__pycache__',
  '.venv',
  'venv',
  'target',
])

const DEFAULT_MAX_FILES = 5_000

async function walkProject(
  root: string,
  skip: ReadonlySet<string>,
  maxFiles: number,
): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]

  while (stack.length > 0) {
    if (out.length >= maxFiles) break
    const dir = stack.pop() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue
        stack.push(full)
      } else if (e.isFile()) {
        out.push(full)
        if (out.length >= maxFiles) break
      }
    }
  }
  return out
}

export async function ingestPolyglotProject(
  projectRoot: string,
  opts: IngestPipelineOptions = {},
): Promise<IngestResult> {
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES

  const diagnostics: IngestDiagnostics = {
    filesVisited: 0,
    filesParsed: 0,
    filesSkippedNoAdapter: 0,
    filesFailedParse: [],
    byLanguage: {},
    walkMs: 0,
    parseMs: 0,
  }

  const walkStart = Date.now()
  const allFiles = await walkProject(projectRoot, skipDirs, maxFiles)
  diagnostics.walkMs = Date.now() - walkStart
  diagnostics.filesVisited = allFiles.length

  const modules: FactInputModule[] = []

  // Cache parsers by adapter id so we don't reload WASM per-file.
  const parserByAdapter = new Map<string, Awaited<ReturnType<NonNullable<ReturnType<typeof findAdapter>>['loadParser']>>>()

  const parseStart = Date.now()
  for (const file of allFiles) {
    const adapter = findAdapter(file)
    if (!adapter) {
      diagnostics.filesSkippedNoAdapter += 1
      continue
    }

    let parser = parserByAdapter.get(adapter.id)
    if (!parser) {
      try {
        parser = await adapter.loadParser()
        parserByAdapter.set(adapter.id, parser)
      } catch (err) {
        diagnostics.filesFailedParse.push({
          file,
          error: err instanceof Error ? err.message : String(err),
        })
        continue
      }
    }

    let source: string
    try {
      source = await fs.readFile(file, 'utf8')
    } catch (err) {
      diagnostics.filesFailedParse.push({
        file,
        error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    try {
      const tree = parser.parse(source)
      const mod = adapter.extractFacts(tree, path.relative(projectRoot, file))
      tree.delete()
      modules.push(mod)
      diagnostics.filesParsed += 1
      diagnostics.byLanguage[adapter.id] = (diagnostics.byLanguage[adapter.id] ?? 0) + 1
    } catch (err) {
      diagnostics.filesFailedParse.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  diagnostics.parseMs = Date.now() - parseStart

  // Build per-path language map for buildFactGraph; only include known FactLanguages.
  const KNOWN: ReadonlySet<FactLanguage> = new Set([
    'typescript',
    'tsx',
    'javascript',
    'jsx',
    'python',
    'go',
    'java',
    'rust',
    'cpp',
  ])
  const languageByPath = new Map<string, FactLanguage>()
  for (const m of modules) {
    const lang = m.language as string | undefined
    if (lang && KNOWN.has(lang as FactLanguage)) {
      languageByPath.set(m.file, lang as FactLanguage)
    }
  }

  const graph = buildFactGraph({
    projectRoot,
    modules,
    languageByPath,
    pathAliases: opts.pathAliases,
  })

  return { graph, modules, diagnostics }
}
