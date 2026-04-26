import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM path helpers
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
  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-ruby.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Ruby AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

export interface RubyParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

interface RubyBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: RubyParsedSymbol[]
}

/** Strip surrounding quotes from a string node's text. */
function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '')
}

/** Extract the name node from a `class` or `module` node. Ruby grammar:
 *  - class: name field is a `constant` or `scope_resolution` node
 *  - module: name field is a `constant` or `scope_resolution` node
 */
function getClassName(node: TsNode): string | null {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return null
  // scope_resolution like Foo::Bar — use the last identifier
  if (nameNode.type === 'scope_resolution') {
    const last = nameNode.namedChildren[nameNode.namedChildren.length - 1]
    return last ? last.text : nameNode.text
  }
  return nameNode.text
}

/** Walk a class/module body and extract method definitions. */
function extractMethods(bodyNode: TsNode | null, ownerName: string): RubyParsedSymbol[] {
  if (!bodyNode) return []
  const methods: RubyParsedSymbol[] = []
  const seen = new Set<string>()

  for (const child of bodyNode.namedChildren) {
    if (!child) continue

    if (child.type === 'method') {
      const n = child.childForFieldName('name')
      if (!n || seen.has(n.text)) continue
      seen.add(n.text)
      methods.push({ name: n.text, kind: 'function' as SymbolKind, attributes: { parentClass: ownerName } })
    }

    if (child.type === 'singleton_method') {
      // class << self pattern: the receiver is the owner
      const n = child.childForFieldName('name')
      const obj = child.childForFieldName('object')
      const receiver = obj ? obj.text : ownerName
      if (!n || seen.has(n.text)) continue
      seen.add(n.text)
      methods.push({ name: n.text, kind: 'function' as SymbolKind, attributes: { parentClass: receiver } })
    }
  }
  return methods
}

/** Find the body node inside a class or module. */
function getBodyNode(node: TsNode): TsNode | null {
  // Ruby tree-sitter grammar: class and module use `body` field
  const body = node.childForFieldName('body')
  if (body) return body
  // Fallback: look for body_statement child
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'body_statement' || c.type === 'then') return c
  }
  return null
}

function extractRuby(root: TsNode): RubyBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, RubyParsedSymbol>()

  const addSymbol = (sym: RubyParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string) => {
    if (!name.startsWith('_')) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'class': {
        const name = getClassName(child)
        if (!name) break
        addSymbol({ name, kind: 'class' as SymbolKind })
        maybeExport(name)
        const body = getBodyNode(child)
        for (const m of extractMethods(body, name)) {
          addSymbol(m)
        }
        break
      }

      case 'module': {
        const name = getClassName(child)
        if (!name) break
        addSymbol({ name, kind: 'class' as SymbolKind })
        maybeExport(name)
        const body = getBodyNode(child)
        for (const m of extractMethods(body, name)) {
          addSymbol(m)
        }
        break
      }

      case 'method': {
        const n = child.childForFieldName('name')
        if (!n) break
        addSymbol({ name: n.text, kind: 'function' as SymbolKind })
        maybeExport(n.text)
        break
      }

      case 'singleton_method': {
        const n = child.childForFieldName('name')
        const obj = child.childForFieldName('object')
        if (!n) break
        const receiver = obj ? obj.text : '<singleton>'
        addSymbol({ name: n.text, kind: 'function' as SymbolKind, attributes: { parentClass: receiver } })
        maybeExport(n.text)
        break
      }

      case 'assignment': {
        // Top-level SCREAMING_CASE constant: left side is a constant node
        const left = child.childForFieldName('left')
        if (!left) break
        if (left.type === 'constant') {
          const name = left.text
          // Constants start with uppercase letter — SCREAMING_CASE first letter
          if (/^[A-Z]/.test(name)) {
            addSymbol({ name, kind: 'const' as SymbolKind })
            maybeExport(name)
          }
        }
        break
      }

      case 'call': {
        // require / require_relative calls
        const method = child.childForFieldName('method')
        if (!method) break
        if (method.text !== 'require' && method.text !== 'require_relative') break

        const args = child.childForFieldName('arguments')
        if (!args) break
        for (const arg of args.namedChildren) {
          if (!arg) continue
          if (arg.type === 'string' || arg.type === 'string_literal') {
            const raw = stripQuotes(arg.text)
            imports.push({ from: raw, names: ['*'] })
          }
        }
        break
      }
    }
  }

  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^rails($|\/)/, 'Ruby/Rails'],
  [/^action_controller($|\/)/, 'Ruby/Rails'],
  [/^active_record($|\/)/, 'Ruby/Rails'],
  [/^sinatra($|\/)/, 'Ruby/Sinatra'],
  [/^rack($|\/)/, 'Ruby/Rack'],
]

function inferRubyStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Ruby'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const rubyAdapter: LanguageAdapter = {
  id: 'ruby',
  fileExtensions: ['.rb'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractRuby(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'ruby',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferRubyStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
