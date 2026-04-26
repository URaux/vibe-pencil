/**
 * FactGraph builder — W2.D2.
 *
 * Consumes parser output (from `ast-ts.ts` and/or `ast-treesitter.ts`) and
 * produces a polyglot fact graph: modules + symbols as nodes, imports and
 * containment as edges. This is a fact layer, not a visualization model —
 * keep it tight.
 *
 * Scope: W2.D2 only. No clustering (W2.D3), no code_anchors (W2.D4),
 * no call edges (follow-up once tree-sitter emits call sites).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ParsedModule as TsParsedModule, ParsedSymbol, SymbolKind } from './ast-ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stable identifier for a node in the FactGraph.
 * Format: `module:<projectRelPath>` or `symbol:<projectRelPath>::<name>`.
 * Paths are always POSIX-style (forward slashes) for cross-platform stability.
 */
export type FactNodeId = string

export type FactLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'python'
  | 'go'
  | 'java'
  | 'rust'
  | 'cpp'

export interface FactModuleNode {
  kind: 'module'
  id: FactNodeId
  filePath: string
  language: FactLanguage
}

export interface FactSymbolNode {
  kind: 'symbol'
  id: FactNodeId
  filePath: string
  name: string
  symbolKind: SymbolKind
  lineRange?: { start: number; end: number }
}

export type FactNode = FactModuleNode | FactSymbolNode

export interface FactEdge {
  kind: 'import' | 'contains'
  source: FactNodeId
  target: FactNodeId
  /** For `import` edges: union of imported binding names seen across merged edges. */
  names?: string[]
  /** For `import` edges: raw specifier as written in source. */
  specifier?: string
}

export interface FactGraphStats {
  modules: number
  symbols: number
  imports: number
  contains: number
  byLanguage: Record<string, number>
}

export interface FactGraph {
  nodes: Map<FactNodeId, FactNode>
  edges: FactEdge[]
  /** Absolute project root, as provided by the caller. */
  projectRoot: string
  stats: FactGraphStats
}

/**
 * Input `ParsedModule` shape — a structural intersection of `ast-ts.ts`'s
 * `ParsedModule` and `ast-treesitter.ts`'s `TreeSitterParseResult`. Both
 * expose `file`, `imports`, `exports`, `symbols`; tree-sitter additionally
 * exposes `language`, which we accept when present.
 */
export interface FactInputModule {
  file: string
  imports: Array<{ from: string; names: string[] }>
  exports: string[]
  symbols: ParsedSymbol[]
  /** Present when input comes from the tree-sitter backend. */
  language?: FactLanguage
}

/**
 * tsconfig-style path alias map, e.g. `{ '@/*': ['./src/*'] }`.
 * Keys and values use the `*` wildcard convention from `tsconfig.compilerOptions.paths`.
 * Target paths are resolved against `projectRoot` (they may be relative like
 * `./src/*` or plain `src/*`).
 */
export type PathAliasMap = Record<string, string[]>

export interface BuildFactGraphInput {
  /** Absolute path to the project root. Used for computing relative paths. */
  projectRoot: string
  /** Parsed modules from either parser (ts-morph `ParsedModule` or tree-sitter `TreeSitterParseResult`). */
  modules: FactInputModule[]
  /**
   * Optional override: explicit language per file path. Keys must be
   * absolute (normalized) paths matching `module.file`. Takes precedence
   * over `module.language` and over extension-based inference.
   */
  languageByPath?: Map<string, FactLanguage>
  /**
   * Optional path aliases — same shape as `tsconfig.compilerOptions.paths`.
   * When a non-relative specifier matches an alias pattern, the resolver
   * tries each target in order and falls back to the standard ext/index
   * probe. Non-matching specifiers stay dropped per Phase 1 scope.
   */
  pathAliases?: PathAliasMap
}

/**
 * Non-fatal diagnostics surfaced alongside the graph for callers that want
 * to surface them. The builder itself never throws for recoverable issues
 * (e.g. empty symbol names) — they're recorded here and the offending row
 * is skipped.
 */
export interface FactGraphDiagnostics {
  skippedEmptyNames: number
  unresolvedRelativeImports: number
  droppedPackageImports: number
}

// Re-export for consumers that want to reason about parser input types.
export type { TsParsedModule, ParsedSymbol, SymbolKind }

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Convert any path string to POSIX form (forward slashes, normalized). */
export function toPosixPath(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/'))
}

/** Compute a project-relative POSIX path for `absFile` under `absRoot`. */
function projectRelative(absRoot: string, absFile: string): string {
  const rel = path.relative(absRoot, absFile)
  return toPosixPath(rel)
}

/** Stable module node id from a project-relative path. */
function moduleId(relPath: string): FactNodeId {
  return `module:${relPath}`
}

/** Stable symbol node id. `name` is trusted — caller must skip empty names. */
function symbolId(relPath: string, name: string): FactNodeId {
  return `symbol:${relPath}::${name}`
}

// ---------------------------------------------------------------------------
// Language inference
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Readonly<Record<string, FactLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.h': 'cpp',
}

function inferLanguage(
  filePath: string,
  explicit: FactLanguage | undefined,
): FactLanguage {
  if (explicit) return explicit
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.d.ts')) return 'typescript'
  const ext = path.extname(lower)
  return EXT_TO_LANGUAGE[ext] ?? 'typescript'
}

// ---------------------------------------------------------------------------
// Import specifier resolution
// ---------------------------------------------------------------------------

/** Extensions tried (in priority order) when resolving a relative import. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'] as const

const INDEX_CANDIDATES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.py',
  'index.go',
] as const

/** True if the specifier refers to a local path (relative or absolute). */
function isRelativeSpecifier(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('/') ||
    spec === '.' ||
    spec === '..'
  )
}

interface CompiledAlias {
  /** Prefix before `*` in the pattern, e.g. `@/` for `@/*`. Empty if no `*`. */
  prefix: string
  /** Suffix after `*`, e.g. `''` for `@/*`; rare in practice. */
  suffix: string
  /** True when the pattern had no `*` — exact match only. */
  exact: boolean
  /** Targets, with `*` → `(.*)` capture position marked. */
  targets: Array<{ prefix: string; suffix: string; exact: boolean }>
}

/** Compile a tsconfig-style alias map once so resolution per import stays cheap. */
function compileAliases(raw: PathAliasMap | undefined): CompiledAlias[] {
  if (!raw) return []
  const out: CompiledAlias[] = []
  for (const [pattern, targets] of Object.entries(raw)) {
    const star = pattern.indexOf('*')
    const exact = star < 0
    out.push({
      prefix: exact ? pattern : pattern.slice(0, star),
      suffix: exact ? '' : pattern.slice(star + 1),
      exact,
      targets: targets.map((t) => {
        const ts = t.indexOf('*')
        const texact = ts < 0
        return {
          prefix: texact ? t : t.slice(0, ts),
          suffix: texact ? '' : t.slice(ts + 1),
          exact: texact,
        }
      }),
    })
  }
  // Longest-prefix-first so `@/foo/*` beats `@/*`.
  out.sort((a, b) => b.prefix.length - a.prefix.length)
  return out
}

/**
 * Try resolving an alias-style specifier (e.g. `@/lib/store`) against the set
 * of known modules. Returns the matched project-relative path or null.
 */
function resolveAliasSpecifier(
  specifier: string,
  aliases: CompiledAlias[],
  moduleRelPaths: Set<string>,
): string | null {
  for (const alias of aliases) {
    let captured: string | null = null
    if (alias.exact) {
      if (specifier === alias.prefix) captured = ''
    } else if (
      specifier.startsWith(alias.prefix) &&
      specifier.endsWith(alias.suffix) &&
      specifier.length >= alias.prefix.length + alias.suffix.length
    ) {
      captured = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length)
    }
    if (captured === null) continue
    for (const target of alias.targets) {
      const expanded = target.exact ? target.prefix : `${target.prefix}${captured}${target.suffix}`
      // Normalize leading `./` and backslashes; targets are relative to projectRoot.
      const cleaned = toPosixPath(expanded.replace(/^\.\//, ''))
      if (cleaned.startsWith('..')) continue
      if (moduleRelPaths.has(cleaned)) return cleaned
      for (const ext of RESOLVE_EXTENSIONS) {
        const candidate = `${cleaned}${ext}`
        if (moduleRelPaths.has(candidate)) return candidate
      }
      for (const indexFile of INDEX_CANDIDATES) {
        const candidate = path.posix.join(cleaned, indexFile)
        if (moduleRelPaths.has(candidate)) return candidate
      }
    }
  }
  return null
}

/**
 * Resolve a relative import specifier to the project-relative path of an
 * existing module node, or `null` if nothing matches.
 *
 * Resolution order:
 *   1. Exact (if the specifier already has a known extension).
 *   2. Append each of `RESOLVE_EXTENSIONS` in order.
 *   3. Append `/index.{ts,tsx,js,jsx,py,go}`.
 *
 * A file candidate always beats a directory/index candidate.
 */
function resolveRelativeSpecifier(
  sourceRelPath: string,
  specifier: string,
  moduleRelPaths: Set<string>,
): string | null {
  const sourceDir = path.posix.dirname(sourceRelPath)
  const joinedRaw = path.posix.normalize(path.posix.join(sourceDir, specifier))
  // `path.posix.normalize('..')` can yield `..`; reject any path that climbs
  // above the project root — we only match modules inside the project.
  if (joinedRaw.startsWith('..')) return null

  // 1. Exact match (specifier with explicit extension).
  if (moduleRelPaths.has(joinedRaw)) return joinedRaw

  // 2. Try file candidates with each extension.
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${joinedRaw}${ext}`
    if (moduleRelPaths.has(candidate)) return candidate
  }

  // 3. Try index-file candidates (directory-style import).
  for (const indexFile of INDEX_CANDIDATES) {
    const candidate = path.posix.join(joinedRaw, indexFile)
    if (moduleRelPaths.has(candidate)) return candidate
  }

  return null
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface ImportEdgeKey {
  source: FactNodeId
  target: FactNodeId
  specifier: string
}

function importEdgeKey(k: ImportEdgeKey): string {
  return `${k.source}\u0000${k.target}\u0000${k.specifier}`
}

/**
 * Build a FactGraph from parser output.
 *
 * Deterministic in node/edge ordering given a deterministic input module
 * order — the caller controls ordering. Deduplicates symbols within a module
 * (two symbols with the same name collapse to the first). Deduplicates
 * import edges sharing (source, target, specifier) — names are unioned.
 */
export function buildFactGraph(input: BuildFactGraphInput): FactGraph {
  const { projectRoot, modules, languageByPath, pathAliases } = input
  const absRoot = projectRoot
  const compiledAliases = compileAliases(pathAliases)

  const nodes = new Map<FactNodeId, FactNode>()
  const containsEdges: FactEdge[] = []

  /** Project-relative POSIX path → moduleId. */
  const moduleRelPaths = new Set<string>()
  /** Language tally. */
  const byLanguage: Record<string, number> = {}

  // ---- Pass 1: emit module nodes and symbol nodes + contains edges --------
  // We do this before resolving imports so the import resolver can see every
  // module target in a single set lookup.

  // Pre-index per-module metadata for pass 2.
  interface PreppedModule {
    relPath: string
    modId: FactNodeId
    absFile: string
    imports: FactInputModule['imports']
  }
  const prepped: PreppedModule[] = []

  for (const mod of modules) {
    // `file` on the parser output is absolute (ts-morph yields absolute;
    // tree-sitter yields whatever the caller passed in, which should be
    // absolute). We normalize to POSIX and compute a project-relative path.
    const absFile = toPosixPath(mod.file)
    const relPath = projectRelative(absRoot, absFile)

    // Guard against duplicate modules for the same path — take first write.
    if (moduleRelPaths.has(relPath)) continue
    moduleRelPaths.add(relPath)

    const explicitLang = languageByPath?.get(absFile) ?? languageByPath?.get(mod.file)
    const language = inferLanguage(relPath, explicitLang ?? mod.language)
    byLanguage[language] = (byLanguage[language] ?? 0) + 1

    const modId = moduleId(relPath)
    const modNode: FactModuleNode = {
      kind: 'module',
      id: modId,
      filePath: relPath,
      language,
    }
    nodes.set(modId, modNode)

    // Emit symbol nodes + contains edges. Skip empty names silently (they
    // are recoverable parser quirks, e.g. anonymous default exports).
    const seenSymbols = new Set<string>()
    for (const sym of mod.symbols) {
      const name = sym?.name
      if (!name) continue
      if (seenSymbols.has(name)) continue
      seenSymbols.add(name)

      const sid = symbolId(relPath, name)
      const symNode: FactSymbolNode = {
        kind: 'symbol',
        id: sid,
        filePath: relPath,
        name,
        symbolKind: sym.kind,
      }
      nodes.set(sid, symNode)
      containsEdges.push({ kind: 'contains', source: modId, target: sid })
    }

    prepped.push({ relPath, modId, absFile, imports: mod.imports })
  }

  // ---- Pass 2: resolve import edges ---------------------------------------

  const importEdgeIndex = new Map<string, { edge: FactEdge; names: Set<string> }>()

  for (const mod of prepped) {
    for (const imp of mod.imports) {
      const specifier = imp.from
      if (!specifier) continue

      let targetRel: string | null = null
      if (isRelativeSpecifier(specifier)) {
        targetRel = resolveRelativeSpecifier(mod.relPath, specifier, moduleRelPaths)
      } else if (compiledAliases.length > 0) {
        targetRel = resolveAliasSpecifier(specifier, compiledAliases, moduleRelPaths)
      }
      // Package / stdlib imports that match no alias stay dropped — the
      // package graph is a Phase 2 concern.
      if (!targetRel) continue

      const targetId = moduleId(targetRel)
      const key = importEdgeKey({ source: mod.modId, target: targetId, specifier })

      const existing = importEdgeIndex.get(key)
      if (existing) {
        for (const n of imp.names) existing.names.add(n)
      } else {
        const names = new Set<string>(imp.names)
        const edge: FactEdge = {
          kind: 'import',
          source: mod.modId,
          target: targetId,
          specifier,
          // `names` is populated at finalization time from the Set.
          names: [],
        }
        importEdgeIndex.set(key, { edge, names })
      }
    }
  }

  // Finalize import edges — attach the de-duplicated names array.
  const importEdges: FactEdge[] = []
  for (const { edge, names } of importEdgeIndex.values()) {
    edge.names = Array.from(names)
    importEdges.push(edge)
  }

  const edges: FactEdge[] = [...containsEdges, ...importEdges]

  const stats: FactGraphStats = {
    modules: 0,
    symbols: 0,
    imports: importEdges.length,
    contains: containsEdges.length,
    byLanguage,
  }
  for (const node of nodes.values()) {
    if (node.kind === 'module') stats.modules++
    else stats.symbols++
  }

  return {
    nodes,
    edges,
    projectRoot: absRoot,
    stats,
  }
}

// ---------------------------------------------------------------------------
// Utility: type guard on FactNode kind (exported for consumers that reason
// about node variants without importing the discriminated-union tags directly).
// ---------------------------------------------------------------------------

export function isModuleNode(n: FactNode): n is FactModuleNode {
  return n.kind === 'module'
}

export function isSymbolNode(n: FactNode): n is FactSymbolNode {
  return n.kind === 'symbol'
}

// ---------------------------------------------------------------------------
// tsconfig.json helper
// ---------------------------------------------------------------------------

/**
 * Read `compilerOptions.paths` from `<projectRoot>/tsconfig.json` and return
 * it as a `PathAliasMap`. Returns `null` when the file is missing or has no
 * paths entry. Tolerant of JSON with trailing commas and line comments — uses
 * a cheap pre-processor rather than pulling in a JSONC dependency.
 *
 * This is intentionally synchronous: callers typically already read the file
 * once at ingest start-up, and the tsconfig is ≤ a few KB.
 */
export function loadTsconfigPathAliases(projectRoot: string): PathAliasMap | null {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.json')
  let raw: string
  try {
    raw = fs.readFileSync(tsconfigPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  // Strip UTF-8 BOM — editors like VS Code on Windows sometimes save with BOM;
  // JSON.parse rejects it, which would silently fall through to null and
  // disable every path alias. (reviewer B1.)
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  // Attempt strict parse first — most tsconfig.json files are valid JSON. Fall
  // back to a light JSONC-tolerant pass that strips only // line comments and
  // trailing commas. We deliberately do NOT strip /* */ block comments because
  // tsconfig path patterns contain `/*` sequences (e.g. `"@/*"`, `"**/*.ts"`)
  // that a naive block-comment stripper mangles.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const stripped = raw
      .replace(/\/\/[^\n]*/g, '')
      .replace(/,(\s*[}\]])/g, '$1')
    try {
      parsed = JSON.parse(stripped)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const co = (parsed as { compilerOptions?: unknown }).compilerOptions
  if (!co || typeof co !== 'object') return null
  const paths = (co as { paths?: unknown }).paths
  if (!paths || typeof paths !== 'object') return null
  const out: PathAliasMap = {}
  for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue
    const filtered = targets.filter((t): t is string => typeof t === 'string')
    if (filtered.length > 0) out[pattern] = filtered
  }
  return Object.keys(out).length > 0 ? out : null
}

// TODO(W2.D3): emit `call` edges once tree-sitter extractors yield call sites.
// TODO(W2.D4): consume FactGraph in `src/lib/ingest/code-anchors.ts` to populate
// `ir.code_anchors` per IR-SCHEMA §3.3.
