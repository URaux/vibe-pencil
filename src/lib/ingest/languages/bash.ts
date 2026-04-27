/**
 * Bash language adapter.
 *
 * Uses `tree-sitter-bash.wasm` (present in tree-sitter-wasms/out/).
 * Pre-flight: loadParser() throws if wasm is absent.
 *
 * Extracts:
 *   source_command / command (source/.) → ParsedImport
 *   function_definition               → 'function' symbol
 *
 * Visibility: names starting with '_' are treated as private (not exported).
 * inferTechStack: bats/kcov imports → 'Bash/Testing'; default 'Bash'.
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

function resolveBashWasm(): string {
  return path.join(resolveWasmDir(), 'tree-sitter-bash.wasm')
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  const bashWasmPath = resolveBashWasm()
  if (!existsSync(bashWasmPath)) {
    throw new Error(
      `Bash language adapter: tree-sitter-bash.wasm not found at ${bashWasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes Bash support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(bashWasmPath)
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

export interface BashParsedSymbol extends ParsedSymbol {
  attributes?: Record<string, string>
}

function isExported(name: string): boolean {
  return !name.startsWith('_')
}

/** Extract the sourced path from a `source_command` or a `command` node for `.` builtin. */
function extractSourcePath(node: TsNode): string | null {
  // tree-sitter-bash represents `source file.sh` as:
  //   (source_command (word))
  // and `. file.sh` as:
  //   (command name: (command_name (word: ".")), argument: (word))
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'word' || child.type === 'string') {
      const text = child.text.replace(/^['"]|['"]$/g, '')
      if (text && text !== 'source' && text !== '.') return text
    }
    // command_name child for `.` builtin
    if (child.type === 'command_name') continue
  }
  return null
}

interface BashBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: BashParsedSymbol[]
}

function extractBash(root: TsNode): BashBundle {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, BashParsedSymbol>()

  function visit(node: TsNode): void {
    switch (node.type) {
      case 'source_command': {
        const src = extractSourcePath(node)
        if (src) imports.push({ from: src, names: ['*'] })
        break
      }

      case 'command': {
        // Handle `. file.sh` (dot builtin)
        const nameNode = node.childForFieldName('name')
        if (nameNode?.text === '.') {
          const src = extractSourcePath(node)
          if (src) imports.push({ from: src, names: ['*'] })
        }
        break
      }

      case 'function_definition': {
        // (function_definition name: (word) body: (compound_statement))
        const nameNode = node.childForFieldName('name')
        const name = nameNode?.text ?? ''
        if (!name) break
        const sym: BashParsedSymbol = {
          name,
          kind: 'function' as SymbolKind,
          exported: isExported(name),
          line: node.startPosition.row + 1,
        }
        const key = `${name}:${node.startPosition.row}`
        symbolMap.set(key, sym)
        break
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

function inferBashStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s.includes('bats') || s.includes('kcov'))) return 'Bash/Testing'
  return 'Bash'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const bashAdapter: LanguageAdapter = {
  id: 'bash',
  fileExtensions: ['.sh', '.bash'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractBash(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'bash' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferBashStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
