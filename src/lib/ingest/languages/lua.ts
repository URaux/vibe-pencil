/**
 * Lua language adapter — phase3/lang-lua.
 *
 * WASM: tree-sitter-lua.wasm from tree-sitter-wasms (no new dep).
 *
 * Node mappings:
 *   - function_definition_statement with dotted var (M.foo) → function, parentClass=M
 *   - function_definition_statement with plain identifier → function (exported)
 *   - local_function_definition_statement → function (NOT exported)
 *   - local_variable_declaration with require() RHS → ParsedImport
 *   - variable_assignment with ALL_CAPS or MixedCase name → const (exported)
 *
 * Visibility: 'local' keyword prefix → not exported; otherwise exported.
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-lua.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol type
// ---------------------------------------------------------------------------

export interface LuaParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// AST extraction helpers
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/** True if name looks like ALL_CAPS or MixedCase (not lowercase) */
function isConstName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name) || /^[A-Z][a-zA-Z0-9]*$/.test(name)
}

/** Extract require("module") string from an expression_list node. */
function extractRequireFrom(exprList: TsNode): string | null {
  for (const c of exprList.namedChildren) {
    if (!c || c.type !== 'call') continue
    const fn = c.namedChildren.find((x) => x?.type === 'variable')
    if (!fn || fn.text !== 'require') continue
    const args = c.namedChildren.find((x) => x?.type === 'argument_list')
    if (!args) continue
    // String may be direct child or inside an expression_list child
    const strDirect = args.namedChildren.find((x) => x?.type === 'string')
    if (strDirect) return strDirect.text.replace(/^["']|["']$/g, '')
    const exprChild = args.namedChildren.find((x) => x?.type === 'expression_list')
    if (exprChild) {
      const strNode = exprChild.namedChildren.find((x) => x?.type === 'string')
      if (strNode) return strNode.text.replace(/^["']|["']$/g, '')
    }
  }
  return null
}

interface LuaBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: LuaParsedSymbol[]
}

function extractLua(root: TsNode): LuaBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, LuaParsedSymbol>()

  const addSymbol = (sym: LuaParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'function_definition_statement': {
        // Plain top-level: single identifier child (function foo() ... end)
        const idNode = child.namedChildren.find((c) => c?.type === 'identifier')
        if (idNode) {
          addSymbol({ name: idNode.text, kind: 'function' as SymbolKind })
          exports.push(idNode.text)
          break
        }
        // Dotted method: variable child with multiple identifiers (M.foo)
        const varNode = child.namedChildren.find((c) => c?.type === 'variable')
        if (!varNode) break
        const identifiers = varNode.namedChildren.filter((c) => c?.type === 'identifier')
        if (identifiers.length >= 2) {
          const parentClass = identifiers[0]!.text
          const fnName = identifiers[identifiers.length - 1]!.text
          addSymbol({
            name: fnName,
            kind: 'function' as SymbolKind,
            attributes: { parentClass },
          })
          exports.push(fnName)
        }
        break
      }

      case 'local_function_definition_statement': {
        // local function name(...) — NOT exported
        const nameNode = child.namedChildren.find((c) => c?.type === 'identifier')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'function' as SymbolKind })
        // deliberately not pushed to exports
        break
      }

      case 'local_variable_declaration': {
        // Check RHS for require()
        const exprList = child.namedChildren.find((c) => c?.type === 'expression_list')
        if (exprList) {
          const from = extractRequireFrom(exprList)
          if (from) {
            const lastName = from.split('.').pop() ?? from
            imports.push({ from, names: [lastName] })
            break
          }
        }
        // Otherwise skip — local vars are not exported
        break
      }

      case 'variable_assignment': {
        // Only export ALL_CAPS or MixedCase globals → const
        const varList = child.namedChildren.find((c) => c?.type === 'variable_list')
        if (!varList) break
        for (const varNode of varList.namedChildren) {
          if (!varNode || varNode.type !== 'variable') continue
          const ids = varNode.namedChildren.filter((c) => c?.type === 'identifier')
          if (ids.length !== 1) continue // skip dotted assignments (M.VERSION)
          const name = ids[0]!.text
          if (isConstName(name)) {
            addSymbol({ name, kind: 'const' as SymbolKind })
            exports.push(name)
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
  [/^love($|\.)/, 'Lua/LÖVE'],
  [/^lapis($|\.)/, 'Lua/Lapis'],
  [/^ngx($|\.|_)|openresty/, 'Lua/OpenResty'],
]

function inferLuaStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Lua'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const luaAdapter: LanguageAdapter = {
  id: 'lua',
  fileExtensions: ['.lua'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractLua(tree.rootNode)
    return {
      file: sourcePath.split('\\').join('/'),
      imports,
      exports,
      symbols,
      language: 'lua' as never,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferLuaStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
