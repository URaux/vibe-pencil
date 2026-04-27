import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol } from '../ast-ts'

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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-solidity.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

type TsNode = Parser.SyntaxNode

// Visibility: public/external → exported; internal/private → not.
function isExported(node: TsNode): boolean {
  for (const c of node.namedChildren) {
    if (!c) continue
    if (c.type === 'visibility' || c.type === 'state_mutability') continue
    if (c.type === 'public' || c.text === 'public' || c.text === 'external') return true
  }
  // Check for explicit visibility modifiers in children
  const visModifiers = ['public', 'external']
  for (const c of node.children) {
    if (!c) continue
    if (visModifiers.includes(c.text)) return true
  }
  return false
}

function getFieldName(node: TsNode, field: string): string | undefined {
  return node.childForFieldName(field)?.text
}

interface SolBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ParsedSymbol[]
}

function extractSolidity(root: TsNode): SolBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbols: ParsedSymbol[] = []
  const seen = new Set<string>()

  const addSym = (sym: ParsedSymbol) => {
    if (seen.has(sym.name)) return
    seen.add(sym.name)
    symbols.push(sym)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'import_directive': {
        // `import "path"` or `import {Foo} from "path"`
        const pathNode = child.namedChildren.find(
          (c) => c && (c.type === 'string' || c.type === 'path')
        )
        const from = pathNode ? pathNode.text.replace(/['"]/g, '') : child.text
        imports.push({ from, names: ['*'] })
        break
      }

      case 'contract_declaration': {
        const name = getFieldName(child, 'name') ?? child.namedChildren.find((c) => c?.type === 'identifier')?.text
        if (!name) break
        addSym({ name, kind: 'class' })
        // Contracts are always exported (top-level Solidity declarations are public by default)
        exports.push(name)
        // Extract function_definition children
        const body = child.childForFieldName('body')
        if (body) {
          for (const member of body.namedChildren) {
            if (!member) continue
            if (member.type === 'function_definition') {
              const fnName = getFieldName(member, 'name') ?? member.namedChildren.find((c) => c?.type === 'identifier')?.text
              if (!fnName) continue
              addSym({ name: fnName, kind: 'function', parentClass: name })
              if (isExported(member)) exports.push(fnName)
            } else if (member.type === 'state_variable_declaration') {
              const varName = member.namedChildren.find((c) => c?.type === 'identifier')?.text
              if (!varName) continue
              addSym({ name: varName, kind: 'const', parentClass: name })
              if (isExported(member)) exports.push(varName)
            }
          }
        }
        break
      }

      case 'library_declaration': {
        const name = getFieldName(child, 'name') ?? child.namedChildren.find((c) => c?.type === 'identifier')?.text
        if (!name) break
        addSym({ name, kind: 'class' })
        exports.push(name)
        break
      }

      case 'interface_declaration': {
        const name = getFieldName(child, 'name') ?? child.namedChildren.find((c) => c?.type === 'identifier')?.text
        if (!name) break
        addSym({ name, kind: 'interface' })
        exports.push(name)
        break
      }
    }
  }

  return { imports, exports, symbols }
}

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/@openzeppelin\//, 'Solidity/OpenZeppelin'],
  [/openzeppelin/, 'Solidity/OpenZeppelin'],
  [/hardhat/, 'Solidity/Hardhat'],
]

function inferSolidityStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Solidity'
}

export const solidityAdapter: LanguageAdapter = {
  id: 'solidity',
  fileExtensions: ['.sol'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractSolidity(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'solidity',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferSolidityStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
