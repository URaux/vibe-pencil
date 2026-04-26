/**
 * TypeScript / TSX / JS / JSX language adapter — W2.D1.
 *
 * Wraps the existing tree-sitter extraction logic from `../ast-treesitter`
 * behind the `LanguageAdapter` interface. Behavior is byte-identical to the
 * inline `extractJsLike` path in `parseTreeSitterFile`.
 *
 * Parser lifecycle: one lazy `Parser` instance per adapter. Grammar is loaded
 * once per process via the module-level `loadLanguage` cache in
 * `../ast-treesitter` (shared with the legacy entry-point).
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM path resolution (shared helper pattern from ast-treesitter.ts)
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
// Lazy parser init (mirrors ast-treesitter pattern but scoped to this module)
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser
  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-typescript.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// AST extraction (mirrors extractJsLike from ast-treesitter.ts exactly)
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const f = s[0]; const l = s[s.length - 1]
    if ((f === '"' || f === "'" || f === '`') && f === l) return s.slice(1, -1)
  }
  return s
}

function extractBindingNames(node: TsNode): string[] {
  if (node.type === 'identifier' || node.type === 'property_identifier') return [node.text]
  if (node.type === 'object_pattern' || node.type === 'array_pattern') {
    const out: string[] = []
    for (const c of node.namedChildren) {
      if (!c) continue
      if (c.type === 'shorthand_property_identifier_pattern' || c.type === 'identifier') {
        out.push(c.text)
      } else if (c.type === 'pair_pattern') {
        const v = c.childForFieldName('value')
        if (v) out.push(...extractBindingNames(v))
      } else if (c.type === 'rest_pattern' || c.type === 'assignment_pattern') {
        const inner = c.namedChildren[0]
        if (inner) out.push(...extractBindingNames(inner))
      } else {
        out.push(...extractBindingNames(c))
      }
    }
    return out
  }
  return []
}

function collectDeclarationSymbols(
  node: TsNode,
  addSymbol: (name: string | null | undefined, kind: SymbolKind) => void,
  onExport?: (name: string) => void,
): void {
  switch (node.type) {
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const n = node.childForFieldName('name')
      if (n) { addSymbol(n.text, 'class'); onExport?.(n.text) }
      return
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const n = node.childForFieldName('name')
      if (n) { addSymbol(n.text, 'function'); onExport?.(n.text) }
      return
    }
    case 'interface_declaration': {
      const n = node.childForFieldName('name')
      if (n) { addSymbol(n.text, 'interface'); onExport?.(n.text) }
      return
    }
    case 'type_alias_declaration': {
      const n = node.childForFieldName('name')
      if (n) { addSymbol(n.text, 'type'); onExport?.(n.text) }
      return
    }
    case 'enum_declaration': {
      const n = node.childForFieldName('name')
      if (n) { addSymbol(n.text, 'const'); onExport?.(n.text) }
      return
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const c of node.namedChildren) {
        if (!c || c.type !== 'variable_declarator') continue
        const nameNode = c.childForFieldName('name')
        if (!nameNode) continue
        for (const id of extractBindingNames(nameNode)) {
          addSymbol(id, 'const'); onExport?.(id)
        }
      }
      return
    }
  }
}

function handleExport(
  node: TsNode,
  exports: string[],
  addSymbol: (name: string | null | undefined, kind: SymbolKind) => void,
): void {
  const decl = node.childForFieldName('declaration')
  if (decl) collectDeclarationSymbols(decl, addSymbol, (name) => exports.push(name))

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && !c.isNamed && c.text === 'default') { exports.push('default'); break }
  }

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
      exports.push(`* from ${src ? stripQuotes(src.text) : ''}`)
    }
  }
}

function extractJsLike(root: TsNode): { imports: ParsedImport[]; exports: string[]; symbols: ParsedSymbol[] } {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ParsedSymbol>()

  const addSymbol = (name: string | null | undefined, kind: SymbolKind) => {
    if (!name) return
    if (!symbolMap.has(name)) symbolMap.set(name, { name, kind })
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    if (child.type === 'import_statement') {
      const src = child.childForFieldName('source')
      const from = src ? stripQuotes(src.text) : ''
      const names: string[] = []
      for (const c of child.namedChildren) {
        if (!c) continue
        if (c.type === 'identifier') {
          names.push('default')
        } else if (c.type === 'import_clause') {
          for (const cc of c.namedChildren) {
            if (!cc) continue
            if (cc.type === 'identifier') names.push('default')
            else if (cc.type === 'namespace_import') names.push('*')
            else if (cc.type === 'named_imports') {
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

    if (child.type === 'export_statement') {
      handleExport(child, exports, addSymbol)
      continue
    }

    collectDeclarationSymbols(child, addSymbol)
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferTypeScriptStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s === 'next' || s.startsWith('next/'))) return 'TypeScript/Next.js'
  if (allFrom.some((s) => s === 'express' || s.startsWith('express/'))) return 'TypeScript/Express'
  if (allFrom.some((s) => s === 'react' || s.startsWith('react/'))) return 'TypeScript/React'
  if (allFrom.some((s) => s === 'vue' || s.startsWith('vue/'))) return 'TypeScript/Vue'
  return 'TypeScript'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const tsAdapter: LanguageAdapter = {
  id: 'typescript',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const root = tree.rootNode
    const { imports, exports, symbols } = extractJsLike(root)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'typescript',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferTypeScriptStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
