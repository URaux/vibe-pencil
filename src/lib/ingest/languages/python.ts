/**
 * Python language adapter — W2.D2.
 *
 * Wraps the existing Python extraction logic from `../ast-treesitter` behind
 * the `LanguageAdapter` interface and extends it with:
 *   - method-vs-function discrimination (nested under class → 'method')
 *   - decorator annotation on function/method facts via `attributes.decorators`
 *   - `inferTechStack` scanning imports for known Python frameworks
 *
 * WASM: `tree-sitter-python.wasm` from `tree-sitter-wasms` (no new dep).
 */

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
// Lazy parser (singleton per module)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-python.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — carries optional decorator list
// ---------------------------------------------------------------------------

export interface PythonParsedSymbol extends ParsedSymbol {
  /** present on functions/methods decorated with e.g. @app.get */
  attributes?: {
    decorators?: string[]
    /** 'method' when nested directly inside a class body */
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// Python AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function extractAssignNames(node: TsNode): string[] {
  if (node.type === 'identifier') return [node.text]
  if (
    node.type === 'pattern_list' ||
    node.type === 'tuple_pattern' ||
    node.type === 'list_pattern'
  ) {
    const out: string[] = []
    for (const c of node.namedChildren) {
      if (c) out.push(...extractAssignNames(c))
    }
    return out
  }
  return []
}

/** Collect decorator strings from a `decorated_definition` node. */
function collectDecorators(decoratedNode: TsNode): string[] {
  const out: string[] = []
  for (const c of decoratedNode.namedChildren) {
    if (!c || c.type !== 'decorator') continue
    // decorator text starts with '@' already in Python grammar
    out.push(c.text)
  }
  return out
}

interface PyBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: PythonParsedSymbol[]
}

/** Walk a class body and extract method definitions. */
function extractMethods(classNode: TsNode, className: string): PythonParsedSymbol[] {
  const methods: PythonParsedSymbol[] = []
  const body = classNode.childForFieldName('body')
  if (!body) return methods

  const seen = new Set<string>()
  for (const child of body.namedChildren) {
    if (!child) continue

    let target = child
    let decorators: string[] = []

    if (child.type === 'decorated_definition') {
      decorators = collectDecorators(child)
      const def = child.childForFieldName('definition')
      if (!def) continue
      target = def
    }

    if (
      target.type === 'function_definition' ||
      target.type === 'async_function_definition'
    ) {
      const n = target.childForFieldName('name')
      if (!n || seen.has(n.text)) continue
      seen.add(n.text)
      const sym: PythonParsedSymbol = {
        name: n.text,
        kind: 'function' as SymbolKind,
        attributes: {
          parentClass: className,
          ...(decorators.length > 0 ? { decorators } : {}),
        },
      }
      methods.push(sym)
    }
  }
  return methods
}

function extractPython(root: TsNode): PyBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, PythonParsedSymbol>()

  const addSymbol = (sym: PythonParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string) => {
    if (!name.startsWith('_')) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'import_statement': {
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'dotted_name') {
            imports.push({ from: c.text, names: ['*'] })
          } else if (c.type === 'aliased_import') {
            const nameNode = c.childForFieldName('name')
            const aliasNode = c.childForFieldName('alias')
            imports.push({
              from: nameNode ? nameNode.text : '',
              names: [aliasNode ? aliasNode.text : '*'],
            })
          }
        }
        break
      }

      case 'import_from_statement': {
        const moduleNode = child.childForFieldName('module_name')
        const from = moduleNode ? moduleNode.text : ''
        const names: string[] = []
        for (const c of child.namedChildren) {
          if (!c || c === moduleNode) continue
          if (c.type === 'dotted_name') {
            names.push(c.text)
          } else if (c.type === 'aliased_import') {
            const aliasNode = c.childForFieldName('alias')
            const nameNode = c.childForFieldName('name')
            names.push(aliasNode ? aliasNode.text : nameNode ? nameNode.text : '')
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
        if (!n) break
        addSymbol({ name: n.text, kind: 'class' })
        maybeExport(n.text)
        // Emit methods as separate symbols
        for (const m of extractMethods(child, n.text)) {
          addSymbol(m)
        }
        break
      }

      case 'function_definition':
      case 'async_function_definition': {
        const n = child.childForFieldName('name')
        if (!n) break
        addSymbol({ name: n.text, kind: 'function' })
        maybeExport(n.text)
        break
      }

      case 'decorated_definition': {
        const decorators = collectDecorators(child)
        const def = child.childForFieldName('definition')
        if (!def) break
        const n = def.childForFieldName('name')
        if (!n) break
        const kind: SymbolKind = def.type === 'class_definition' ? 'class' : 'function'
        const sym: PythonParsedSymbol = {
          name: n.text,
          kind,
          ...(decorators.length > 0 ? { attributes: { decorators } } : {}),
        }
        addSymbol(sym)
        maybeExport(n.text)
        // If decorated class, still extract methods
        if (def.type === 'class_definition') {
          for (const m of extractMethods(def, n.text)) {
            addSymbol(m)
          }
        }
        break
      }

      case 'expression_statement': {
        for (const c of child.namedChildren) {
          if (!c || c.type !== 'assignment') continue
          const left = c.childForFieldName('left')
          if (!left) continue
          for (const id of extractAssignNames(left)) {
            addSymbol({ name: id, kind: 'const' })
            maybeExport(id)
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
  [/^fastapi($|\.|:)/, 'Python/FastAPI'],
  [/^django($|\.|:)/, 'Python/Django'],
  [/^flask($|\.|:)/, 'Python/Flask'],
  [/^starlette($|\.|:)/, 'Python/Starlette'],
  [/^tornado($|\.|:)/, 'Python/Tornado'],
  [/^aiohttp($|\.|:)/, 'Python/aiohttp'],
]

function inferPythonStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Python'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const pythonAdapter: LanguageAdapter = {
  id: 'python',
  fileExtensions: ['.py', '.pyi'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractPython(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'python',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferPythonStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
