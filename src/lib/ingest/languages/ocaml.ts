/**
 * OCaml language adapter.
 *
 * Wires `tree-sitter-ocaml.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts from top-level `compilation_unit` children:
 *
 *   open_module / include_module  → ParsedImport
 *   module_definition             → 'class' (module_name from module_binding)
 *   type_definition               → 'class' (type_constructor from type_binding)
 *   value_definition with params  → 'function' (value_name from let_binding)
 *   value_definition without param→ 'const'
 *   value_specification (.mli)    → exported symbol name only
 *
 * Visibility: OCaml exports everything at module level by default (unless
 * constrained by a .mli interface). For v1, all top-level items = exported.
 *
 * inferTechStack: 'core' / 'async' imports → OCaml/Jane Street;
 *                 'lwt' imports → OCaml/Lwt; default 'OCaml'.
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-ocaml.wasm')
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

function firstChildOfType(node: TsNode, type: string): TsNode | null {
  for (const c of node.namedChildren) {
    if (c && c.type === type) return c
  }
  return null
}

function processOpenOrInclude(node: TsNode, imports: ParsedImport[]): void {
  // open_module / include_module → child module_path → module_name
  const modulePath = firstChildOfType(node, 'module_path')
  const name = modulePath
    ? (firstChildOfType(modulePath, 'module_name') ?? modulePath).text.trim()
    : node.text.replace(/^(open|include)\s+/, '').trim()
  if (name) imports.push({ from: name, names: ['*'] })
}

function processModuleDefinition(node: TsNode, symbols: ParsedSymbol[]): void {
  // module_definition → module_binding → module_name
  const binding = firstChildOfType(node, 'module_binding')
  if (!binding) return
  const nameNode = firstChildOfType(binding, 'module_name')
  const name = nameNode?.text ?? ''
  if (!name) return
  symbols.push({
    name,
    kind: 'class' as SymbolKind,
    exported: true,
    line: node.startPosition.row + 1,
  })
}

function processTypeDefinition(node: TsNode, symbols: ParsedSymbol[]): void {
  // type_definition → type_binding → type_constructor
  const binding = firstChildOfType(node, 'type_binding')
  if (!binding) return
  const nameNode = firstChildOfType(binding, 'type_constructor')
  const name = nameNode?.text ?? ''
  if (!name) return
  symbols.push({
    name,
    kind: 'class' as SymbolKind,
    exported: true,
    line: node.startPosition.row + 1,
  })
}

function processValueDefinition(node: TsNode, symbols: ParsedSymbol[]): void {
  // value_definition → let_binding → value_name + optional parameter children
  const binding = firstChildOfType(node, 'let_binding')
  if (!binding) return
  const nameNode = firstChildOfType(binding, 'value_name')
  const name = nameNode?.text ?? ''
  if (!name) return

  // Has parameters → function; otherwise → const
  const hasParams = binding.namedChildren.some((c) => c && c.type === 'parameter')
  const kind: SymbolKind = hasParams ? 'function' : 'const'

  symbols.push({
    name,
    kind,
    exported: true,
    line: node.startPosition.row + 1,
  })
}

function processValueSpecification(node: TsNode, symbols: ParsedSymbol[]): void {
  // value_specification (in .mli interface files): val name : type
  // The first identifier child is the name.
  for (const c of node.namedChildren) {
    if (c && c.type === 'value_name') {
      symbols.push({
        name: c.text,
        kind: 'function' as SymbolKind,
        exported: true,
        line: node.startPosition.row + 1,
      })
      return
    }
  }
}

function extractOcaml(root: TsNode): {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
} {
  const imports: ParsedImport[] = []
  const symbols: ParsedSymbol[] = []

  for (const node of root.namedChildren) {
    if (!node) continue
    switch (node.type) {
      case 'open_module':
      case 'include_module':
        processOpenOrInclude(node, imports)
        break
      case 'module_definition':
        processModuleDefinition(node, symbols)
        break
      case 'type_definition':
        processTypeDefinition(node, symbols)
        break
      case 'value_definition':
        processValueDefinition(node, symbols)
        break
      case 'value_specification':
        processValueSpecification(node, symbols)
        break
    }
  }

  const exports = symbols.filter((s) => s.exported).map((s) => s.name)
  return { imports, exports, symbols }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferOcamlStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s === 'Core' || s === 'Async' || s.startsWith('Core_'))) {
    return 'OCaml/Jane Street'
  }
  if (allFrom.some((s) => s === 'Lwt' || s.toLowerCase() === 'lwt')) {
    return 'OCaml/Lwt'
  }
  return 'OCaml'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const ocamlAdapter: LanguageAdapter = {
  id: 'ocaml',
  fileExtensions: ['.ml', '.mli'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractOcaml(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'ocaml' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferOcamlStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
