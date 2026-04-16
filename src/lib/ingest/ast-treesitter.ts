/**
 * AST backend — tree-sitter (web-tree-sitter, wasm).
 *
 * Polyglot companion to `ast-ts.ts` (ts-morph, authoritative for TS).
 * Handles TS/TSX/JS/JSX/Python/Go for W2.D3+ ingestion of non-TS repos.
 *
 * Output shape mirrors `ParsedModule` from `ast-ts.ts`: the `TreeSitterParseResult`
 * augments it with a `language` tag and `warnings` for non-fatal notes.
 *
 * This module is server-only — it reads wasm grammars from `node_modules` via
 * `fs.readFile`. Do NOT import it from client components.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { ParsedImport, ParsedSymbol, SymbolKind } from './ast-ts'

type TsNode = Parser.SyntaxNode
type TsLanguage = Parser.Language

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TreeSitterLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'python'
  | 'go'

export interface TreeSitterParseResult {
  /** Absolute, normalized (forward-slash) path to the source file. */
  file: string
  language: TreeSitterLanguage
  imports: ParsedImport[]
  /** Exported binding names (including `default`). */
  exports: string[]
  symbols: ParsedSymbol[]
  /** Non-fatal notes — e.g. "parse had syntax errors but recovered". */
  warnings: string[]
}

/**
 * Reserved for languages whose grammar mapping exists in `LANGUAGE_EXTENSIONS`
 * but no extractor is wired up yet. Currently unused (all six listed languages
 * have extractors); kept for forward-compat when adding e.g. Rust or Java.
 */
export class TreeSitterNotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TreeSitterNotImplementedError'
  }
}

/** Thrown for unsupported file extensions. */
export class UnsupportedLanguageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedLanguageError'
  }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export const LANGUAGE_EXTENSIONS: Readonly<Record<string, TreeSitterLanguage>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
}

/**
 * Best-effort language detection from a filesystem path. Returns `undefined`
 * for unsupported extensions so callers can decide whether to skip or error.
 * `.d.ts` is intentionally unsupported — declaration files go through ts-morph.
 */
export function detectLanguage(filePath: string): TreeSitterLanguage | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.d.ts')) return undefined
  const ext = path.extname(lower)
  return LANGUAGE_EXTENSIONS[ext]
}

// ---------------------------------------------------------------------------
// Grammar loading (lazy, singleton-guarded)
// ---------------------------------------------------------------------------

/**
 * Map language id → wasm filename inside `tree-sitter-wasms/out/`. JSX uses
 * the JavaScript grammar (JavaScript grammar includes JSX); TSX has its own
 * grammar distinct from TypeScript.
 */
const GRAMMAR_WASM: Record<TreeSitterLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
}

let parserInitPromise: Promise<void> | null = null
const languageCache = new Map<TreeSitterLanguage, Promise<TsLanguage>>()
let wasmDirCache: string | null = null
let runtimeWasmPathCache: string | null = null

function resolveTreeSitterWasmsDir(): string {
  if (wasmDirCache) return wasmDirCache
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('tree-sitter-wasms/package.json')
    wasmDirCache = path.join(path.dirname(pkgPath), 'out')
    return wasmDirCache
  } catch {
    wasmDirCache = path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out')
    return wasmDirCache
  }
}

function resolveRuntimeWasmPath(): string {
  if (runtimeWasmPathCache) return runtimeWasmPathCache
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('web-tree-sitter/package.json')
    runtimeWasmPathCache = path.join(path.dirname(pkgPath), 'tree-sitter.wasm')
    return runtimeWasmPathCache
  } catch {
    runtimeWasmPathCache = path.join(
      process.cwd(),
      'node_modules',
      'web-tree-sitter',
      'tree-sitter.wasm',
    )
    return runtimeWasmPathCache
  }
}

async function ensureParserInit(): Promise<void> {
  if (!parserInitPromise) {
    const runtimeWasm = resolveRuntimeWasmPath()
    // `locateFile` is consulted by emscripten to find `tree-sitter.wasm`
    // relative to the JS shim. In Node we override it to return an absolute
    // filesystem path so it works regardless of cwd.
    parserInitPromise = Parser.init({
      locateFile: (name: string) => {
        if (name === 'tree-sitter.wasm') return runtimeWasm
        return name
      },
    })
  }
  await parserInitPromise
}

async function loadLanguage(lang: TreeSitterLanguage): Promise<TsLanguage> {
  let cached = languageCache.get(lang)
  if (!cached) {
    cached = (async () => {
      await ensureParserInit()
      const wasmPath = path.join(resolveTreeSitterWasmsDir(), GRAMMAR_WASM[lang])
      const bytes = await readFile(wasmPath)
      return Parser.Language.load(new Uint8Array(bytes))
    })()
    languageCache.set(lang, cached)
  }
  return cached
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Parse a single source file via tree-sitter. Returns imports/exports/symbols
 * in a shape compatible with `ast-ts.ts`'s `ParsedModule`.
 *
 * Async because grammar wasms are loaded lazily on first use per language.
 */
export async function parseTreeSitterFile(
  filePath: string,
  source: string,
): Promise<TreeSitterParseResult> {
  const language = detectLanguage(filePath)
  if (!language) {
    throw new UnsupportedLanguageError(
      `tree-sitter backend: unsupported extension for ${filePath}`,
    )
  }

  const lang = await loadLanguage(language)
  const parser = new Parser()
  parser.setLanguage(lang)

  const warnings: string[] = []
  const tree = parser.parse(source)
  if (!tree) {
    parser.delete()
    throw new Error(`tree-sitter: parser returned null for ${filePath}`)
  }

  const root = tree.rootNode as TsNode
  if (root.hasError) {
    warnings.push('tree-sitter: source contained syntax errors (parser recovered)')
  }

  let imports: ParsedImport[] = []
  let exports: string[] = []
  let symbols: ParsedSymbol[] = []

  try {
    switch (language) {
      case 'typescript':
      case 'tsx':
      case 'javascript':
      case 'jsx': {
        const r = extractJsLike(root)
        imports = r.imports
        exports = r.exports
        symbols = r.symbols
        break
      }
      case 'python': {
        const r = extractPython(root)
        imports = r.imports
        exports = r.exports
        symbols = r.symbols
        break
      }
      case 'go': {
        const r = extractGo(root)
        imports = r.imports
        exports = r.exports
        symbols = r.symbols
        break
      }
    }
  } finally {
    tree.delete()
    parser.delete()
  }

  return {
    file: normalizePath(filePath),
    language,
    imports,
    exports,
    symbols,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// JS / TS / TSX / JSX extraction
// ---------------------------------------------------------------------------

interface ExtractionBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

function extractJsLike(root: TsNode): ExtractionBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ParsedSymbol>()

  const addSymbol = (name: string | null | undefined, kind: SymbolKind) => {
    if (!name) return
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    // --- imports -----------------------------------------------------------
    if (child.type === 'import_statement') {
      const src = child.childForFieldName('source')
      const from = src ? stripStringQuotes(src.text) : ''
      const names: string[] = []
      // `import defaultName from '...'` — default import appears as an
      // identifier child adjacent to the `import` keyword.
      // `import * as ns from '...'` — namespace_import node
      // `import { a, b as c } from '...'` — named_imports node
      for (const c of child.namedChildren) {
        if (!c) continue
        if (c.type === 'identifier') {
          names.push('default')
        } else if (c.type === 'import_clause') {
          for (const cc of c.namedChildren) {
            if (!cc) continue
            if (cc.type === 'identifier') {
              names.push('default')
            } else if (cc.type === 'namespace_import') {
              names.push('*')
            } else if (cc.type === 'named_imports') {
              for (const spec of cc.namedChildren) {
                if (!spec || spec.type !== 'import_specifier') continue
                const nm = spec.childForFieldName('name')
                if (nm) names.push(nm.text)
              }
            }
          }
        } else if (c.type === 'namespace_import') {
          names.push('*')
        } else if (c.type === 'named_imports') {
          for (const spec of c.namedChildren) {
            if (!spec || spec.type !== 'import_specifier') continue
            const nm = spec.childForFieldName('name')
            if (nm) names.push(nm.text)
          }
        }
      }
      imports.push({ from, names })
      continue
    }

    // --- export statements -------------------------------------------------
    if (child.type === 'export_statement') {
      handleJsExport(child, exports, addSymbol)
      continue
    }

    // --- non-exported top-level declarations -------------------------------
    collectJsDeclarationSymbols(child, addSymbol)
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

function handleJsExport(
  node: TsNode,
  exports: string[],
  addSymbol: (name: string | null | undefined, kind: SymbolKind) => void,
): void {
  // Forms:
  //   export default <expr|decl>
  //   export <declaration>
  //   export { a, b as c } [from '...']
  //   export * from '...'
  const decl = node.childForFieldName('declaration')
  if (decl) {
    collectJsDeclarationSymbols(decl, addSymbol, (name) => exports.push(name))
  }

  // `export default ...`
  // tree-sitter marks the `default` keyword as an anonymous child; detect via
  // presence of a `default` keyword token.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && !c.isNamed && c.text === 'default') {
      exports.push('default')
      break
    }
  }

  // `export { a, b as c }` / `export * from ...`
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'export_clause') {
      for (const spec of c.namedChildren) {
        if (!spec || spec.type !== 'export_specifier') continue
        const alias = spec.childForFieldName('alias')
        const name = spec.childForFieldName('name')
        const exported = alias ?? name
        if (exported) exports.push(exported.text)
      }
    } else if (c.type === 'namespace_export') {
      const src = node.childForFieldName('source')
      exports.push(`* from ${src ? stripStringQuotes(src.text) : ''}`)
    }
  }
}

function collectJsDeclarationSymbols(
  node: TsNode,
  addSymbol: (name: string | null | undefined, kind: SymbolKind) => void,
  onExport?: (name: string) => void,
): void {
  switch (node.type) {
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const n = node.childForFieldName('name')
      if (n) {
        addSymbol(n.text, 'class')
        onExport?.(n.text)
      }
      return
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const n = node.childForFieldName('name')
      if (n) {
        addSymbol(n.text, 'function')
        onExport?.(n.text)
      }
      return
    }
    case 'interface_declaration': {
      const n = node.childForFieldName('name')
      if (n) {
        addSymbol(n.text, 'interface')
        onExport?.(n.text)
      }
      return
    }
    case 'type_alias_declaration': {
      const n = node.childForFieldName('name')
      if (n) {
        addSymbol(n.text, 'type')
        onExport?.(n.text)
      }
      return
    }
    case 'enum_declaration': {
      // ast-ts's SymbolKind doesn't have 'enum'; fall back to 'const' so the
      // shape stays parity with ts-morph backend (which also doesn't emit enums).
      const n = node.childForFieldName('name')
      if (n) {
        addSymbol(n.text, 'const')
        onExport?.(n.text)
      }
      return
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const c of node.namedChildren) {
        if (!c || c.type !== 'variable_declarator') continue
        const nameNode = c.childForFieldName('name')
        if (!nameNode) continue
        for (const id of extractJsBindingNames(nameNode)) {
          addSymbol(id, 'const')
          onExport?.(id)
        }
      }
      return
    }
  }
}

function extractJsBindingNames(node: TsNode): string[] {
  // Handles identifiers, object/array destructuring (shallow, one level deep
  // is sufficient for top-level exports in practice).
  if (node.type === 'identifier' || node.type === 'property_identifier') {
    return [node.text]
  }
  if (node.type === 'object_pattern' || node.type === 'array_pattern') {
    const out: string[] = []
    for (const c of node.namedChildren) {
      if (!c) continue
      if (c.type === 'shorthand_property_identifier_pattern' || c.type === 'identifier') {
        out.push(c.text)
      } else if (c.type === 'pair_pattern') {
        const v = c.childForFieldName('value')
        if (v) out.push(...extractJsBindingNames(v))
      } else if (c.type === 'rest_pattern' || c.type === 'assignment_pattern') {
        const inner = c.namedChildren[0]
        if (inner) out.push(...extractJsBindingNames(inner))
      } else {
        out.push(...extractJsBindingNames(c))
      }
    }
    return out
  }
  return []
}

// ---------------------------------------------------------------------------
// Python extraction
// ---------------------------------------------------------------------------

function extractPython(root: TsNode): ExtractionBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ParsedSymbol>()
  const addSymbol = (name: string, kind: SymbolKind) => {
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }

  // Python export convention: any module-level binding not starting with `_`
  // is considered exported. This matches PEP 8 conventions in the absence of
  // `__all__` (which we skip for simplicity — can be layered in later).
  const maybeExport = (name: string) => {
    if (!name.startsWith('_')) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue
    switch (child.type) {
      case 'import_statement': {
        // `import a, b.c as d`
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'dotted_name') {
            imports.push({ from: c.text, names: ['*'] })
          } else if (c.type === 'aliased_import') {
            const name = c.childForFieldName('name')
            const alias = c.childForFieldName('alias')
            imports.push({
              from: name ? name.text : '',
              names: [alias ? alias.text : '*'],
            })
          }
        }
        break
      }
      case 'import_from_statement': {
        const moduleNode = child.childForFieldName('module_name')
        const from = moduleNode ? moduleNode.text : ''
        const names: string[] = []
        // Subsequent named children after module are the imported names.
        for (const c of child.namedChildren) {
          if (!c || c === moduleNode) continue
          if (c.type === 'dotted_name') {
            names.push(c.text)
          } else if (c.type === 'aliased_import') {
            const alias = c.childForFieldName('alias')
            const name = c.childForFieldName('name')
            names.push(alias ? alias.text : name ? name.text : '')
          } else if (c.type === 'wildcard_import') {
            names.push('*')
          }
        }
        imports.push({ from, names })
        break
      }
      case 'future_import_statement': {
        imports.push({ from: '__future__', names: ['*'] })
        break
      }
      case 'class_definition': {
        const n = child.childForFieldName('name')
        if (n) {
          addSymbol(n.text, 'class')
          maybeExport(n.text)
        }
        break
      }
      case 'function_definition':
      case 'async_function_definition':
      case 'decorated_definition': {
        const target =
          child.type === 'decorated_definition'
            ? child.childForFieldName('definition') ?? child
            : child
        const n = target.childForFieldName('name')
        if (!n) break
        const kind: SymbolKind =
          target.type === 'class_definition' ? 'class' : 'function'
        addSymbol(n.text, kind)
        maybeExport(n.text)
        break
      }
      case 'expression_statement': {
        // Module-level assignments — treat identifiers on LHS as const bindings.
        for (const c of child.namedChildren) {
          if (!c || c.type !== 'assignment') continue
          const left = c.childForFieldName('left')
          if (!left) continue
          for (const id of extractPythonAssignNames(left)) {
            addSymbol(id, 'const')
            maybeExport(id)
          }
        }
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

function extractPythonAssignNames(node: TsNode): string[] {
  if (node.type === 'identifier') return [node.text]
  if (node.type === 'pattern_list' || node.type === 'tuple_pattern' || node.type === 'list_pattern') {
    const out: string[] = []
    for (const c of node.namedChildren) {
      if (c) out.push(...extractPythonAssignNames(c))
    }
    return out
  }
  return []
}

// ---------------------------------------------------------------------------
// Go extraction
// ---------------------------------------------------------------------------

function extractGo(root: TsNode): ExtractionBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ParsedSymbol>()
  const addSymbol = (name: string, kind: SymbolKind) => {
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }
  // Go export rule: identifier starts with uppercase letter → exported.
  const maybeExport = (name: string) => {
    const first = name[0]
    if (first && first >= 'A' && first <= 'Z') exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue
    switch (child.type) {
      case 'import_declaration': {
        for (const spec of child.descendantsOfType('import_spec')) {
          const pathNode = spec.childForFieldName('path')
          const nameNode = spec.childForFieldName('name')
          const from = pathNode ? stripStringQuotes(pathNode.text) : ''
          const alias = nameNode ? nameNode.text : '*'
          imports.push({ from, names: [alias] })
        }
        break
      }
      case 'function_declaration': {
        const n = child.childForFieldName('name')
        if (n) {
          addSymbol(n.text, 'function')
          maybeExport(n.text)
        }
        break
      }
      case 'method_declaration': {
        const n = child.childForFieldName('name')
        if (n) {
          addSymbol(n.text, 'function')
          maybeExport(n.text)
        }
        break
      }
      case 'type_declaration': {
        for (const spec of child.namedChildren) {
          if (!spec) continue
          if (spec.type === 'type_spec' || spec.type === 'type_alias') {
            const n = spec.childForFieldName('name')
            if (!n) continue
            const typeField = spec.childForFieldName('type')
            const kind: SymbolKind =
              typeField && typeField.type === 'struct_type'
                ? 'class'
                : typeField && typeField.type === 'interface_type'
                  ? 'interface'
                  : 'type'
            addSymbol(n.text, kind)
            maybeExport(n.text)
          }
        }
        break
      }
      case 'const_declaration':
      case 'var_declaration': {
        for (const spec of child.namedChildren) {
          if (!spec) continue
          if (spec.type !== 'const_spec' && spec.type !== 'var_spec') continue
          // const/var_spec has one or more `name` fields.
          for (const n of spec.childrenForFieldName('name')) {
            if (!n) continue
            addSymbol(n.text, 'const')
            maybeExport(n.text)
          }
        }
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.split('\\').join('/')
}

function stripStringQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      return s.slice(1, -1)
    }
  }
  return s
}

// Re-export shared types so consumers can unify against this backend.
export type { SymbolKind, ParsedImport, ParsedSymbol }
