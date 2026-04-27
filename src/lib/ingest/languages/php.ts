/**
 * PHP language adapter — phase3/lang-php.
 *
 * WASM: `tree-sitter-php.wasm` from `tree-sitter-wasms` (no new dep).
 * Extracts:
 *   - namespace_definition → class (container symbol)
 *   - class_declaration → class
 *   - interface_declaration → interface
 *   - trait_declaration → class
 *   - function_definition (top-level) → function
 *   - method_declaration nested inside class/trait → function with parentClass
 *   - namespace_use_declaration → ParsedImport
 *
 * Visibility: public (default in PHP global scope) → exported;
 * private/protected members are NOT exported.
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-php.wasm')
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

export interface PhpParsedSymbol extends ParsedSymbol {
  attributes?: {
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/** Returns true if visibility modifiers are absent (PHP public-by-default) or explicitly public. */
function isPublicMember(node: TsNode): boolean {
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'visibility_modifier') {
      const v = c.text
      return v !== 'private' && v !== 'protected'
    }
  }
  // No visibility_modifier → public by default
  return true
}

function extractMethods(bodyNode: TsNode | null, parentClass: string): PhpParsedSymbol[] {
  if (!bodyNode) return []
  const methods: PhpParsedSymbol[] = []
  for (const c of bodyNode.namedChildren) {
    if (!c) continue
    if (c.type !== 'method_declaration') continue
    // Skip private/protected methods
    if (!isPublicMember(c)) continue
    const nameNode = c.childForFieldName('name')
    if (!nameNode) continue
    methods.push({
      name: nameNode.text,
      kind: 'function' as SymbolKind,
      attributes: { parentClass },
    })
  }
  return methods
}

/** Extract the use-clause names from a namespace_use_declaration. */
function extractUseDeclaration(node: TsNode): ParsedImport[] {
  const imports: ParsedImport[] = []
  // namespace_use_declaration has namespace_use_clause children
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'namespace_use_clause') {
      // First named child is the qualified name
      const nameNode = c.namedChild(0)
      if (!nameNode) continue
      const from = nameNode.text
      // alias lives in namespace_aliasing_clause > name
      const aliasingClause = c.namedChildren.find((ch) => ch?.type === 'namespace_aliasing_clause')
      const aliasName = aliasingClause?.namedChildren.find((ch) => ch?.type === 'name')?.text
      const lastName = from.split('\\').pop() ?? from
      imports.push({ from, names: [aliasName ?? lastName] })
    } else if (c.type === 'qualified_name' || c.type === 'name') {
      // Simple `use Foo;`
      const from = c.text
      const lastName = from.split('\\').pop() ?? from
      imports.push({ from, names: [lastName] })
    }
  }
  return imports
}

interface PhpBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: PhpParsedSymbol[]
}

function extractPhp(root: TsNode): PhpBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, PhpParsedSymbol>()

  const addSymbol = (sym: PhpParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  function walkStatements(stmts: TsNode): void {
    for (const child of stmts.namedChildren) {
      if (!child) continue
      processNode(child)
    }
  }

  function processNode(child: TsNode): void {
    switch (child.type) {
      case 'namespace_definition': {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          addSymbol({ name: nameNode.text, kind: 'class' as SymbolKind })
          exports.push(nameNode.text)
        }
        // Walk children inside namespace body
        const body = child.childForFieldName('body')
        if (body) walkStatements(body)
        break
      }

      case 'namespace_use_declaration': {
        for (const imp of extractUseDeclaration(child)) {
          imports.push(imp)
        }
        break
      }

      case 'class_declaration':
      case 'trait_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'class' as SymbolKind })
        exports.push(nameNode.text)
        const body = child.childForFieldName('body') ?? child.childForFieldName('declaration_list')
        for (const m of extractMethods(body, nameNode.text)) {
          addSymbol(m)
        }
        break
      }

      case 'interface_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'interface' as SymbolKind })
        exports.push(nameNode.text)
        // Interface methods are inherently public
        const body = child.childForFieldName('body') ?? child.childForFieldName('declaration_list')
        if (body) {
          for (const c of body.namedChildren) {
            if (!c || c.type !== 'method_declaration') continue
            const mName = c.childForFieldName('name')
            if (mName) {
              addSymbol({ name: mName.text, kind: 'function' as SymbolKind, attributes: { parentClass: nameNode.text } })
            }
          }
        }
        break
      }

      case 'function_definition': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addSymbol({ name: nameNode.text, kind: 'function' as SymbolKind })
        exports.push(nameNode.text)
        break
      }
    }
  }

  walkStatements(root)
  return { imports, exports, symbols: Array.from(symbolMap.values()) }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^Illuminate\\|^Laravel\\/, 'PHP/Laravel'],
  [/^Symfony\\/, 'PHP/Symfony'],
  [/^Yii\\|^yii\\/, 'PHP/Yii'],
  [/^CodeIgniter\\/, 'PHP/CodeIgniter'],
  [/^WP_|^WordPress\\|^Wordpress\\/, 'PHP/WordPress'],
]

function inferPhpStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'PHP'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const phpAdapter: LanguageAdapter = {
  id: 'php',
  fileExtensions: ['.php'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractPhp(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'php' as never,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferPhpStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
