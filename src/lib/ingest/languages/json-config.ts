/**
 * JSON config language adapter.
 *
 * Uses `tree-sitter-json.wasm` (present in tree-sitter-wasms/out/).
 *
 * JSON has no functions or classes. We treat top-level object keys as
 * 'const' symbols so the fact graph captures config shape.
 *
 * File-type heuristics (by path):
 *   package.json              → 'project-config'
 *   tsconfig*.json            → 'ts-config'
 *   .eslintrc*.json           → 'lint-config'
 *   .prettierrc*.json         → 'lint-config'
 *   jest.config*.json         → 'test-config'
 *   *.schema.json             → 'json-schema'
 *   default                   → 'json-data'
 *
 * Visibility: all top-level keys are exported (JSON is inherently public).
 *
 * inferTechStack (from package.json deps key presence):
 *   next      → Next.js
 *   react     → React
 *   fastify   → Node/Fastify
 *   express   → Node/Express
 *   default   → Node/Config
 */

import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol, SymbolKind } from '../ast-ts'

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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-json.wasm')
  if (!existsSync(wasmPath)) {
    throw new Error(
      `JSON adapter: tree-sitter-json.wasm not found at ${wasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes JSON support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// File-type detection
// ---------------------------------------------------------------------------

export type JsonFileType =
  | 'project-config'
  | 'ts-config'
  | 'lint-config'
  | 'test-config'
  | 'json-schema'
  | 'json-data'

export function detectJsonFileType(filePath: string): JsonFileType {
  const base = path.basename(filePath).toLowerCase()
  if (base === 'package.json') return 'project-config'
  if (base.startsWith('tsconfig') && base.endsWith('.json')) return 'ts-config'
  if ((base.startsWith('.eslintrc') || base.startsWith('.prettierrc')) && base.endsWith('.json')) return 'lint-config'
  if (base.startsWith('jest.config') && base.endsWith('.json')) return 'test-config'
  if (base.endsWith('.schema.json')) return 'json-schema'
  return 'json-data'
}

// ---------------------------------------------------------------------------
// Extended symbol type
// ---------------------------------------------------------------------------

export interface JsonParsedSymbol extends ParsedSymbol {
  /** Always true — all JSON top-level keys are considered exported. */
  exported: boolean
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function extractTopLevelKeys(root: TsNode): JsonParsedSymbol[] {
  // tree-sitter-json: document → value → object → pair*
  // pair: key: string, value: value
  const symbols: JsonParsedSymbol[] = []

  // Find the root object node (first value child of document)
  const docValue = root.namedChildren.find((c) => c && c.type === 'object')
  if (!docValue) return symbols

  for (const child of docValue.namedChildren) {
    if (!child || child.type !== 'pair') continue
    const keyNode = child.childForFieldName('key')
    if (!keyNode) continue
    // Key is a string node; strip surrounding quotes.
    const rawKey = keyNode.text
    const key = rawKey.startsWith('"') ? rawKey.slice(1, -1) : rawKey
    if (!key) continue
    symbols.push({
      name: key,
      kind: 'const' as SymbolKind,
      exported: true,
    })
  }
  return symbols
}

// ---------------------------------------------------------------------------
// Tech-stack inference (from package.json deps)
// ---------------------------------------------------------------------------

const STACK_PATTERNS: Array<[RegExp, string]> = [
  [/^next$/, 'Next.js'],
  [/^react$/, 'React'],
  [/^fastify$/, 'Node/Fastify'],
  [/^express$/, 'Node/Express'],
]

function inferJsonStack(facts: FactInputModule[]): string {
  // Only try to infer from project-config files; others just return Node/Config.
  const allSymbolNames = facts.flatMap((f) => f.symbols.map((s) => s.name))
  // We encoded the deps as child symbols via extractFacts on each package.json.
  // The adapter also records dep names as exports from package.json.
  // Simplest heuristic: check all export names for known dep identifiers.
  const allExports = facts.flatMap((f) => f.exports)
  for (const [pattern, label] of STACK_PATTERNS) {
    if (allExports.some((e) => pattern.test(e)) || allSymbolNames.some((n) => pattern.test(n))) {
      return label
    }
  }
  return 'Node/Config'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const jsonConfigAdapter: LanguageAdapter = {
  id: 'json',
  fileExtensions: ['.json'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const symbols = extractTopLevelKeys(tree.rootNode)
    const exports = symbols.map((s) => s.name)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports,
      symbols,
      language: 'json' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferJsonStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
