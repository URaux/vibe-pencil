/**
 * AST scaffold — TypeScript backend.
 *
 * Exposes a single pluggable entrypoint `parseTsProject(dir)` returning a
 * normalized `ParseResult`. Future backends (Python via tree-sitter, Go via
 * go/parser, etc.) must implement the same shape.
 *
 * Scope: W2.D1 — extract imports/exports/symbols per file. Edge building,
 * caching, clustering, and code_anchors are later days (W2.D2–W2.D4).
 */

import * as path from 'node:path'
import { Project, SourceFile, SyntaxKind } from 'ts-morph'

// ---------------------------------------------------------------------------
// Public types — pluggable interface shared across language backends
// ---------------------------------------------------------------------------

export type SymbolKind = 'class' | 'function' | 'interface' | 'type' | 'const'

export interface ParsedImport {
  /** Raw import specifier as written in source, e.g. `./foo` or `react`. */
  from: string
  /** Imported binding names. `default` and `*` are normalized as literal strings. */
  names: string[]
}

export interface ParsedSymbol {
  name: string
  kind: SymbolKind
}

export interface ParsedModule {
  /** Absolute, normalized (forward-slash) path to the source file. */
  file: string
  imports: ParsedImport[]
  /** Exported binding names (including `default`). */
  exports: string[]
  symbols: ParsedSymbol[]
}

export interface ParseResult {
  modules: ParsedModule[]
  rootDir: string
  durationMs: number
  /** Non-fatal issues — e.g. files we skipped. Parser-level fatal errors throw. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDES = ['node_modules', '.next', 'dist', 'build', 'out', '.archviber', 'output', 'workspace']

/**
 * Parse a TypeScript project rooted at `dir`. Includes `.ts` and `.tsx`,
 * skips `.d.ts`, node_modules, and common build output directories.
 */
export async function parseTsProject(dir: string): Promise<ParseResult> {
  const t0 = Date.now()
  const rootDir = path.resolve(dir)
  const warnings: string[] = []

  const project = new Project({
    // We don't need a real tsconfig — operate purely on source text so we
    // don't choke on projects with odd paths configurations.
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: false,
      noEmit: true,
    },
  })

  const globPatterns = [
    `${toGlob(rootDir)}/**/*.ts`,
    `${toGlob(rootDir)}/**/*.tsx`,
    `!${toGlob(rootDir)}/**/*.d.ts`,
    ...DEFAULT_EXCLUDES.map((ex) => `!${toGlob(rootDir)}/**/${ex}/**`),
  ]

  project.addSourceFilesAtPaths(globPatterns)

  const sourceFiles = project.getSourceFiles()
  const modules: ParsedModule[] = []

  for (const sf of sourceFiles) {
    try {
      modules.push(parseSourceFile(sf))
    } catch (err) {
      warnings.push(`parse failed: ${sf.getFilePath()} — ${(err as Error).message}`)
    }
  }

  return {
    modules,
    rootDir,
    durationMs: Date.now() - t0,
    warnings,
  }
}

function parseSourceFile(sf: SourceFile): ParsedModule {
  const file = normalizePath(sf.getFilePath())

  // --- imports -------------------------------------------------------------
  const imports: ParsedImport[] = []
  for (const decl of sf.getImportDeclarations()) {
    const from = decl.getModuleSpecifierValue()
    const names: string[] = []

    const defaultImport = decl.getDefaultImport()
    if (defaultImport) names.push('default')

    const namespaceImport = decl.getNamespaceImport()
    if (namespaceImport) names.push('*')

    for (const ni of decl.getNamedImports()) {
      names.push(ni.getName())
    }

    imports.push({ from, names })
  }

  // --- exports -------------------------------------------------------------
  // ts-morph's getExportedDeclarations returns a Map of name -> declarations.
  // This covers `export const`, `export function`, `export default`, re-exports.
  const exports: string[] = []
  for (const [name] of sf.getExportedDeclarations()) {
    exports.push(name)
  }

  // `export * from '...'` re-exports don't appear in getExportedDeclarations
  // because they're dynamic — record them as a marker.
  for (const decl of sf.getExportDeclarations()) {
    if (decl.isNamespaceExport() && decl.getModuleSpecifierValue()) {
      exports.push(`* from ${decl.getModuleSpecifierValue()}`)
    }
  }

  // --- symbols -------------------------------------------------------------
  // Dedup by name: a symbol like `export const foo = () => {}` surfaces both
  // via `getExportedDeclarations` and `getVariableStatements`. Destructured
  // `const { a, b } = obj` also emits one entry per binding name. We prefer
  // the richer entry from `getExportedDeclarations` when both sources exist.
  const symbolMap = new Map<string, ParsedSymbol>()

  // Pass 1: seed from exported declarations (authoritative kinds).
  for (const [name, decls] of sf.getExportedDeclarations()) {
    const decl = decls[0]
    if (!decl) continue
    const kind = inferSymbolKindFromNode(decl)
    if (kind && !symbolMap.has(name)) {
      symbolMap.set(name, { name, kind })
    }
  }

  const addIfAbsent = (name: string, kind: SymbolKind) => {
    if (!name) return
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }

  for (const c of sf.getClasses()) {
    const n = c.getName()
    if (n) addIfAbsent(n, 'class')
  }
  for (const fn of sf.getFunctions()) {
    const n = fn.getName()
    if (n) addIfAbsent(n, 'function')
  }
  for (const iface of sf.getInterfaces()) {
    addIfAbsent(iface.getName(), 'interface')
  }
  for (const ta of sf.getTypeAliases()) {
    addIfAbsent(ta.getName(), 'type')
  }
  for (const vs of sf.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      for (const bindingName of extractBindingNames(decl.getNameNode())) {
        addIfAbsent(bindingName, 'const')
      }
    }
  }

  const symbols = Array.from(symbolMap.values())

  return { file, imports, exports, symbols }
}

/**
 * Map a ts-morph declaration node to our normalized `SymbolKind`.
 * Returns `undefined` for nodes we don't track as top-level symbols
 * (e.g. re-exports of namespace bindings, enum members).
 */
function inferSymbolKindFromNode(node: import('ts-morph').Node): SymbolKind | undefined {
  switch (node.getKind()) {
    case SyntaxKind.ClassDeclaration:
      return 'class'
    case SyntaxKind.FunctionDeclaration:
      return 'function'
    case SyntaxKind.InterfaceDeclaration:
      return 'interface'
    case SyntaxKind.TypeAliasDeclaration:
      return 'type'
    case SyntaxKind.VariableDeclaration:
    case SyntaxKind.BindingElement:
      return 'const'
    default:
      return undefined
  }
}

/**
 * Extract identifier names from a variable declaration name node, walking
 * object/array binding patterns so destructured `const { a, b } = obj`
 * yields `['a', 'b']` rather than a single pattern-source entry.
 */
function extractBindingNames(nameNode: import('ts-morph').Node | undefined): string[] {
  if (!nameNode) return []
  const kind = nameNode.getKind()
  if (kind === SyntaxKind.Identifier) {
    return [nameNode.getText()]
  }
  if (
    kind === SyntaxKind.ObjectBindingPattern ||
    kind === SyntaxKind.ArrayBindingPattern
  ) {
    const out: string[] = []
    for (const el of nameNode.getChildrenOfKind(SyntaxKind.BindingElement)) {
      out.push(...extractBindingNames(el.getNameNode()))
    }
    return out
  }
  return []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.split('\\').join('/')
}

/**
 * ts-morph glob patterns expect forward slashes even on Windows. Convert the
 * absolute path so patterns like `C:/foo/**` work.
 */
function toGlob(p: string): string {
  return normalizePath(p).replace(/\/$/, '')
}

// Re-export SyntaxKind so downstream facts.ts (W2.D2) can reuse
// ts-morph primitives without re-importing.
export { SyntaxKind }
