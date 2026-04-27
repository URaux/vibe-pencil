/**
 * Zig language adapter.
 *
 * Wires `tree-sitter-zig.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts from top-level declarations only:
 *
 *   @import() call        → ParsedImport (string arg is the module path)
 *   function_declaration  → 'function' symbol; 'pub' modifier → exported
 *   variable_declaration:
 *     value = struct_declaration → 'class' symbol
 *     value = enum_declaration   → 'class' symbol
 *     otherwise                  → 'const' symbol
 *
 * Visibility: top-level node has an unnamed 'pub' token child → exported.
 *
 * inferTechStack: 'std' import → 'Zig'; default 'Zig'.
 */

import * as path from 'node:path'
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-zig.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function isPublic(node: TsNode): boolean {
  for (const c of node.children) {
    if (c && !c.isNamed && c.type === 'pub') return true
  }
  return false
}

/** Extract the string content from a `string` AST node. */
function extractStringContent(stringNode: TsNode): string {
  const content = stringNode.namedChildren.find((c) => c && c.type === 'string_content')
  return content ? content.text : stringNode.text.replace(/^"|"$/g, '')
}

/** Try to extract an @import ParsedImport from a `variable_declaration`. Returns null if not @import. */
function tryExtractImport(node: TsNode): ParsedImport | null {
  // RHS is the last named child that isn't an identifier/keyword
  const valueNode = node.namedChildren.find((c) => c && c.type === 'builtin_function')
  if (!valueNode) return null

  const builtinId = valueNode.namedChildren.find((c) => c && c.type === 'builtin_identifier')
  if (!builtinId || builtinId.text !== '@import') return null

  const args = valueNode.namedChildren.find((c) => c && c.type === 'arguments')
  if (!args) return null

  const strNode = args.namedChildren.find((c) => c && c.type === 'string')
  if (!strNode) return null

  const modulePath = extractStringContent(strNode)
  // The bound name is the identifier in the variable_declaration
  const nameNode = node.namedChildren.find((c) => c && c.type === 'identifier')
  const bindName = nameNode ? nameNode.text : '*'

  return { from: modulePath, names: [bindName] }
}

/**
 * Determine what kind of symbol a `variable_declaration` produces.
 * Returns null when it's an @import (handled separately).
 */
function classifyVarDecl(
  node: TsNode,
): { name: string; kind: SymbolKind } | null {
  // Skip @import declarations
  if (node.namedChildren.some((c) => c && c.type === 'builtin_function')) return null

  const nameNode = node.namedChildren.find((c) => c && c.type === 'identifier')
  if (!nameNode) return null

  const structNode = node.namedChildren.find((c) => c && c.type === 'struct_declaration')
  if (structNode) return { name: nameNode.text, kind: 'class' }

  const enumNode = node.namedChildren.find((c) => c && c.type === 'enum_declaration')
  if (enumNode) return { name: nameNode.text, kind: 'class' }

  return { name: nameNode.text, kind: 'const' }
}

interface ZigBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

function extractZig(root: TsNode): ZigBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ParsedSymbol>()

  const addSymbol = (sym: ParsedSymbol) => {
    if (!symbolMap.has(sym.name)) symbolMap.set(sym.name, sym)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'variable_declaration': {
        const imp = tryExtractImport(child)
        if (imp) {
          imports.push(imp)
          break
        }
        const classified = classifyVarDecl(child)
        if (!classified) break
        addSymbol({ name: classified.name, kind: classified.kind })
        if (isPublic(child)) exports.push(classified.name)
        break
      }

      case 'function_declaration': {
        const nameNode = child.namedChildren.find((c) => c && c.type === 'identifier')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'function' as SymbolKind })
        if (isPublic(child)) exports.push(nameNode.text)
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferZigStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  // 'std' is the Zig standard library; any project using it is plain Zig.
  if (allFrom.some((s) => s === 'std')) return 'Zig'
  return 'Zig'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const zigAdapter: LanguageAdapter = {
  id: 'zig',
  fileExtensions: ['.zig'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractZig(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'zig',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferZigStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
