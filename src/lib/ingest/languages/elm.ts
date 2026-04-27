/**
 * Elm language adapter — phase3/lang-elm.
 *
 * Parses `.elm` files via `tree-sitter-elm.wasm` (present in tree-sitter-wasms).
 *
 * Mapping:
 *   module_declaration         → sets exposed name set for exports
 *   import_clause              → ParsedImport
 *   value_declaration          → 'function' (has params) or 'const' (no params)
 *   type_declaration           → 'class' (custom type / union type)
 *   type_alias_declaration     → 'class'
 *
 * Visibility: only names in the module's exposing list are exported.
 *   `exposing (..)` double-dot wildcard exports everything.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM path resolution
// ---------------------------------------------------------------------------

function resolveWasmDir(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('tree-sitter-wasms/package.json')
    return path.join(path.dirname(pkgPath), 'out')
  } catch {
    return path.join(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out')
  }
}

function resolveRuntimeWasm(): string {
  try {
    const req = createRequire(import.meta.url)
    const pkgPath = req.resolve('web-tree-sitter/package.json')
    return path.join(path.dirname(pkgPath), 'tree-sitter.wasm')
  } catch {
    return path.join(process.cwd(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm')
  }
}

// ---------------------------------------------------------------------------
// Lazy parser singleton
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  const elmWasmPath = path.join(resolveWasmDir(), 'tree-sitter-elm.wasm')

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(elmWasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  // Throws "Incompatible language version" when wasm ABI is too old
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/**
 * Parse an exposing_list node.
 * Returns null for (..) wildcard (expose everything), or a Set of exposed names.
 */
function parseExposingList(node: TsNode): Set<string> | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && (c.type === 'double_dot' || c.text === '..')) return null
  }
  const exposed = new Set<string>()
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'exposed_value' || c.type === 'exposed_type') {
      const nameNode = c.namedChildren.find(
        (n) => n && (n.type === 'lower_case_identifier' || n.type === 'upper_case_identifier'),
      )
      if (nameNode) {
        exposed.add(nameNode.text)
      } else {
        const match = c.text.match(/^(\w+)/)
        if (match) exposed.add(match[1])
      }
    }
  }
  return exposed
}

/** Extract import path from import_clause. */
function parseImportFrom(node: TsNode): string {
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'upper_case_qid' || c.type === 'upper_case_identifier') return c.text
  }
  const m = node.text.match(/^import\s+([\w.]+)/)
  return m ? m[1] : ''
}

/** Collect imported names from import_clause. */
function parseImportNames(node: TsNode): string[] {
  for (const c of node.namedChildren) {
    if (!c || c.type !== 'exposing_list') continue
    for (let i = 0; i < c.childCount; i++) {
      const cc = c.child(i)
      if (cc && (cc.type === 'double_dot' || cc.text === '..')) return ['*']
    }
    const names: string[] = []
    for (const ec of c.namedChildren) {
      if (!ec) continue
      if (ec.type === 'exposed_value' || ec.type === 'exposed_type') {
        const nn = ec.namedChildren.find(
          (n) => n && (n.type === 'lower_case_identifier' || n.type === 'upper_case_identifier'),
        )
        if (nn) {
          names.push(nn.text)
        } else {
          const m2 = ec.text.match(/^(\w+)/)
          if (m2) names.push(m2[1])
        }
      }
    }
    return names.length > 0 ? names : ['*']
  }
  return ['*']
}

/**
 * Determine function vs const from value_declaration.
 * A function_declaration_left with >1 namedChildren has parameters → function.
 */
function valueKind(node: TsNode): SymbolKind {
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'function_declaration_left') {
      return c.namedChildCount > 1 ? 'function' : 'const'
    }
  }
  return 'const'
}

/** Get the declared name from value_declaration. */
function valueName(node: TsNode): string | null {
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'function_declaration_left') {
      const nameNode = c.namedChildren.find((n) => n && n.type === 'lower_case_identifier')
      return nameNode ? nameNode.text : null
    }
    if (c.type === 'lower_case_identifier') return c.text
  }
  return null
}

interface ElmBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

function extractElm(root: TsNode): ElmBundle {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, ParsedSymbol>()
  // null = expose everything; Set = explicit list (empty Set = module with no exposing clause)
  let exposedNames: Set<string> | null = new Set()

  const addSymbol = (name: string, kind: SymbolKind) => {
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'module_declaration': {
        for (const c of child.namedChildren) {
          if (!c || c.type !== 'exposing_list') continue
          exposedNames = parseExposingList(c)
        }
        break
      }

      case 'import_clause': {
        const from = parseImportFrom(child)
        const names = parseImportNames(child)
        if (from) imports.push({ from, names })
        break
      }

      case 'value_declaration': {
        const name = valueName(child)
        if (name) addSymbol(name, valueKind(child))
        break
      }

      case 'type_declaration':
      case 'type_alias_declaration': {
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'upper_case_identifier') {
            addSymbol(c.text, 'class')
            break
          }
        }
        break
      }
    }
  }

  // Build exports from the exposing list
  const exports: string[] = []
  if (exposedNames === null) {
    // expose-all wildcard
    for (const name of symbolMap.keys()) exports.push(name)
  } else {
    for (const name of exposedNames) {
      if (symbolMap.has(name)) exports.push(name)
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferElmStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s === 'elm-spa' || s.startsWith('Spa') || s.startsWith('ElmSpa')))
    return 'Elm/SPA'
  if (allFrom.some((s) => s === 'Browser' || s.startsWith('Browser.'))) return 'Elm/Browser'
  return 'Elm'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const elmAdapter: LanguageAdapter = {
  id: 'elm',
  fileExtensions: ['.elm'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractElm(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'elm',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferElmStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
