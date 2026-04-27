/**
 * Elixir language adapter — phase3/lang-elixir.
 * WASM: tree-sitter-elixir.wasm from tree-sitter-wasms (no new dep).
 * defmodule→class, def→function(exported), defp→function(not exported),
 * use/import→ParsedImport.
 */
import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

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
    initPromise = Parser.init({ locateFile: (n: string) => n === 'tree-sitter.wasm' ? runtimeWasm : n })
  }
  await initPromise
  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-elixir.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

export interface ElixirParsedSymbol extends ParsedSymbol {
  attributes?: { parentClass?: string }
}

type TsNode = Parser.SyntaxNode

function callIdentifier(node: TsNode): string | null {
  return node.namedChildren.find((c) => c?.type === 'identifier')?.text ?? null
}

function firstArg(node: TsNode): TsNode | null {
  const args = node.namedChildren.find((c) => c?.type === 'arguments')
  if (!args) return null
  return args.namedChildren.find((c) => c !== null) ?? null
}

function walkModuleBody(
  doBlock: TsNode,
  moduleName: string,
  symbols: Map<string, ElixirParsedSymbol>,
  imports: ParsedImport[],
  exports: string[],
): void {
  for (const child of doBlock.namedChildren) {
    if (!child || child.type !== 'call') continue
    const id = callIdentifier(child)
    if (!id) continue
    if (id === 'def' || id === 'defp') {
      const arg = firstArg(child)
      if (!arg) continue
      const fnName = arg.type === 'call'
        ? (arg.namedChildren.find((c) => c?.type === 'identifier')?.text ?? null)
        : arg.type === 'identifier' ? arg.text : null
      if (!fnName || symbols.has(fnName)) continue
      symbols.set(fnName, { name: fnName, kind: 'function' as SymbolKind, attributes: { parentClass: moduleName } })
      if (id === 'def') exports.push(fnName)
    } else if (id === 'use' || id === 'import') {
      const arg = firstArg(child)
      const modName = arg?.text ?? null
      if (modName) {
        const lastName = modName.split('.').pop() ?? modName
        imports.push({ from: modName, names: [lastName] })
      }
    }
  }
}

function extractElixir(root: TsNode): { imports: ParsedImport[]; exports: string[]; symbols: ElixirParsedSymbol[] } {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, ElixirParsedSymbol>()
  for (const child of root.namedChildren) {
    if (!child || child.type !== 'call') continue
    if (callIdentifier(child) !== 'defmodule') continue
    const arg = firstArg(child)
    const moduleName = arg?.text ?? null
    if (!moduleName) continue
    if (!symbolMap.has(moduleName)) {
      symbolMap.set(moduleName, { name: moduleName, kind: 'class' as SymbolKind })
      exports.push(moduleName)
    }
    const doBlock = child.namedChildren.find((c) => c?.type === 'do_block')
    if (doBlock) walkModuleBody(doBlock, moduleName, symbolMap, imports, exports)
  }
  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^Phoenix($|\.)/, 'Elixir/Phoenix'],
  [/^Ecto($|\.)/, 'Elixir/Ecto'],
  [/^GenStage($|\.)/, 'Elixir/GenStage'],
  [/^Broadway($|\.)/, 'Elixir/Broadway'],
]

export const elixirAdapter: LanguageAdapter = {
  id: 'elixir',
  fileExtensions: ['.ex', '.exs'],
  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractElixir(tree.rootNode)
    return { file: sourcePath.split('\\').join('/'), imports, exports, symbols, language: 'elixir' as never }
  },
  inferTechStack(facts: FactInputModule[]): string {
    const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
    for (const [pattern, label] of FRAMEWORK_PATTERNS) {
      if (allFrom.some((s) => pattern.test(s))) return label
    }
    return 'Elixir'
  },
  async loadParser(): Promise<Parser> { return getParser() },
}
