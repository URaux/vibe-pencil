/**
 * Nim language adapter.
 *
 * Pre-flight: tree-sitter-nim.wasm must be present in tree-sitter-wasms/out/.
 * loadParser() throws if the wasm file is absent.
 *
 * Extracts from top-level nodes:
 *   import_statement          → ParsedImport (each imported module path)
 *   type_declaration          → 'class' symbol
 *   proc_declaration (top)    → 'function'
 *   proc nested in type body  → 'function' with attributes.parentClass
 *
 * Visibility: '*' export marker after the proc/type name → exported.
 * inferTechStack: nimble framework hits → 'Nim'; default 'Nim'.
 */

import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader
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

function resolveNimWasm(): string {
  return path.join(resolveWasmDir(), 'tree-sitter-nim.wasm')
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  // Pre-flight: abort if wasm is absent rather than emitting a confusing ENOENT.
  const nimWasmPath = resolveNimWasm()
  if (!existsSync(nimWasmPath)) {
    throw new Error(
      `Nim language adapter: tree-sitter-nim.wasm not found at ${nimWasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes Nim support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(nimWasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// AST extraction helpers
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

export interface NimParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

function isExported(node: TsNode): boolean {
  // In Nim, exported procs/types have a '*' token immediately after the name.
  // e.g.: proc foo*() = ...   or   type Foo* = object
  // The '*' appears as an unnamed child of the declaration node.
  for (const child of node.children) {
    if (child && child.type === '*') return true
  }
  return false
}

function extractName(node: TsNode): string {
  // First named child or child with type 'identifier' is usually the name.
  for (const child of node.children) {
    if (child && child.type === 'identifier') return child.text
  }
  return node.namedChild(0)?.text ?? ''
}

function processImportStatement(node: TsNode, imports: ParsedImport[]): void {
  // import a, b, c   or   import a/b/c
  // Named children are identifiers or dotted paths.
  for (const child of node.namedChildren) {
    if (!child) continue
    const text = child.text.trim()
    if (text && text !== 'import') {
      imports.push({ from: text, names: ['*'] })
    }
  }
}

function processTypeDeclaration(
  node: TsNode,
  symbols: Map<string, NimParsedSymbol>,
  exported: boolean,
): void {
  const name = extractName(node)
  if (!name) return
  symbols.set(name, {
    name,
    kind: 'class' as SymbolKind,
    exported,
    line: node.startPosition.row + 1,
  })
}

function processProcDeclaration(
  node: TsNode,
  symbols: Map<string, NimParsedSymbol>,
  exported: boolean,
  parentClass?: string,
): void {
  const name = extractName(node)
  if (!name) return
  const sym: NimParsedSymbol = {
    name,
    kind: 'function' as SymbolKind,
    exported,
    line: node.startPosition.row + 1,
  }
  if (parentClass) {
    sym.attributes = { parentClass }
  }
  symbols.set(`${parentClass ?? ''}::${name}:${node.startPosition.row}`, sym)
}

function extractNim(root: TsNode): {
  imports: ParsedImport[]
  exports: string[]
  symbols: NimParsedSymbol[]
} {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, NimParsedSymbol>()

  for (const node of root.namedChildren) {
    if (!node) continue

    if (node.type === 'import_statement') {
      processImportStatement(node, imports)
      continue
    }

    if (node.type === 'type_declaration') {
      processTypeDeclaration(node, symbolMap, isExported(node))
      // Scan type body for nested proc declarations
      for (const child of node.children) {
        if (!child) continue
        if (child.type === 'proc_declaration') {
          const parentName = extractName(node)
          processProcDeclaration(child, symbolMap, isExported(child), parentName || undefined)
        }
      }
      continue
    }

    if (node.type === 'proc_declaration') {
      processProcDeclaration(node, symbolMap, isExported(node))
      continue
    }
  }

  const symbols = Array.from(symbolMap.values())
  const exports = symbols.filter((s) => s.exported).map((s) => s.name)

  return { imports, exports, symbols }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferNimStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  // Nimble framework markers
  if (allFrom.some((s) => s.includes('nimble') || s.includes('nimblepkg'))) return 'Nim/Nimble'
  return 'Nim'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const nimAdapter: LanguageAdapter = {
  id: 'nim',
  fileExtensions: ['.nim'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractNim(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'nim' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferNimStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
