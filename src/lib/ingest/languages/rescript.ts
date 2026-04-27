/**
 * ReScript language adapter.
 *
 * Uses `tree-sitter-rescript.wasm` (present in tree-sitter-wasms/out/).
 * Pre-flight: loadParser() throws if wasm is absent.
 *
 * Extracts:
 *   open_statement / include_statement → ParsedImport
 *   external_declaration              → ParsedImport (FFI binding)
 *   module_declaration                → class
 *   type_declaration                  → class (type alias/abstract)
 *   let_declaration (fun body)        → function
 *   let_declaration (other)           → const
 *
 * Visibility:
 *   @@private attribute or underscore-prefixed name → not exported
 *   default (ReScript top-level) → exported
 *
 * inferTechStack:
 *   rescript-react imports → 'ReScript/React'
 *   default                → 'ReScript'
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

function resolveRescriptWasm(): string {
  return path.join(resolveWasmDir(), 'tree-sitter-rescript.wasm')
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  const rescriptWasmPath = resolveRescriptWasm()
  if (!existsSync(rescriptWasmPath)) {
    throw new Error(
      `ReScript language adapter: tree-sitter-rescript.wasm not found at ${rescriptWasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes ReScript support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(rescriptWasmPath)
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

interface RescriptBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

/** True if a declaration has @@private attribute or underscore-prefixed name. */
function isPrivate(node: TsNode, name: string): boolean {
  if (name.startsWith('_')) return true
  // Check for @@private decorator/attribute in siblings or the declaration itself
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'decorator' || child.type === 'attribute') {
      if (child.text.includes('@private') || child.text.includes('@@private')) return true
    }
  }
  return false
}

/** Check if a let_declaration body is a function expression. */
function isFunctionBody(node: TsNode): boolean {
  for (const child of node.namedChildren) {
    if (!child) continue
    if (
      child.type === 'function_expression' ||
      child.type === 'arrow_function' ||
      child.type === 'fun_expression' ||
      child.type === 'function'
    ) {
      return true
    }
  }
  return false
}

function extractRescript(root: TsNode): RescriptBundle {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, ParsedSymbol>()

  function addSymbol(name: string, kind: SymbolKind, exported: boolean): void {
    if (!name || symbolMap.has(name)) return
    symbolMap.set(name, { name, kind, exported })
  }

  function visit(node: TsNode): void {
    switch (node.type) {
      case 'open_statement': {
        // open Module.Path → import from "Module.Path" with '*'
        const modPath = node.namedChildren
          .filter((c) => c && c.type !== 'open')
          .map((c) => c?.text ?? '')
          .join('.')
          .replace(/^open\s+/, '')
          .trim()
        const cleaned = node.text.replace(/^open\s+/, '').trim()
        if (cleaned) imports.push({ from: cleaned, names: ['*'] })
        break
      }

      case 'include_statement': {
        const cleaned = node.text.replace(/^include\s+/, '').trim()
        if (cleaned) imports.push({ from: cleaned, names: ['*'] })
        break
      }

      case 'external_declaration': {
        // external name: type = "js_binding"  → FFI import
        const nameNode = node.childForFieldName('name') ?? node.namedChildren.find((c) => c?.type === 'value_identifier')
        const stringNode = node.namedChildren.find((c) => c?.type === 'string')
        if (stringNode) {
          const from = stringNode.text.replace(/^['"]|['"]$/g, '')
          const name = nameNode?.text ?? from
          if (from) imports.push({ from, names: [name] })
        }
        break
      }

      case 'module_declaration': {
        const nameNode = node.childForFieldName('name') ?? node.namedChildren.find((c) => c?.type === 'module_name')
        const name = nameNode?.text ?? ''
        if (name) addSymbol(name, 'class', !isPrivate(node, name))
        return
      }

      case 'type_declaration': {
        const nameNode = node.childForFieldName('name') ?? node.namedChildren.find((c) => c?.type === 'type_identifier')
        const name = nameNode?.text ?? ''
        if (name) addSymbol(name, 'class', !isPrivate(node, name))
        return
      }

      case 'let_declaration': {
        const nameNode =
          node.childForFieldName('name') ??
          node.namedChildren.find((c) => c && (c.type === 'value_identifier' || c.type === 'pattern'))
        const name = nameNode?.text ?? ''
        if (!name) break
        const kind: SymbolKind = isFunctionBody(node) ? 'function' : 'const'
        addSymbol(name, kind, !isPrivate(node, name))
        return
      }
    }

    for (const child of node.namedChildren) {
      if (child) visit(child)
    }
  }

  visit(root)

  const symbols = Array.from(symbolMap.values())
  const exports = symbols.filter((s) => s.exported).map((s) => s.name)
  return { imports, exports, symbols }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferRescriptStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s.includes('rescript-react') || s.includes('ReactDOM') || s.includes('React'))) {
    return 'ReScript/React'
  }
  return 'ReScript'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const rescriptAdapter: LanguageAdapter = {
  id: 'rescript',
  fileExtensions: ['.res', '.resi'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractRescript(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'rescript' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferRescriptStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
