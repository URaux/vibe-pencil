import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol } from '../ast-ts'

export type TomlFileType =
  | 'cargo-manifest'
  | 'pyproject'
  | 'netlify-config'
  | 'rust-toolchain'
  | 'generic-config'

export interface TomlParsedSymbol extends ParsedSymbol {
  exported?: boolean
  line?: number
}

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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-toml.wasm')
  if (!existsSync(wasmPath)) {
    throw new Error(`tree-sitter-toml.wasm not found at ${wasmPath}`)
  }
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

export function detectTomlFileType(sourcePath: string): TomlFileType {
  const base = path.basename(sourcePath).toLowerCase()
  if (base === 'cargo.toml') return 'cargo-manifest'
  if (base === 'pyproject.toml') return 'pyproject'
  if (base === 'netlify.toml') return 'netlify-config'
  if (base === 'rust-toolchain.toml') return 'rust-toolchain'
  return 'generic-config'
}

type TsNode = Parser.SyntaxNode

/** Extract the key text from a bare_key, quoted_key, or dotted_key node. */
function extractKeyText(keyNode: TsNode): string {
  if (keyNode.type === 'dotted_key') {
    // For dotted keys like [tool.poetry], use the first segment as the top-level key
    const firstKey = keyNode.namedChildren.find(
      (c) => c && (c.type === 'bare_key' || c.type === 'quoted_key'),
    )
    return firstKey ? firstKey.text.replace(/^["']|["']$/g, '') : keyNode.text
  }
  if (keyNode.type === 'quoted_key') {
    return keyNode.text.replace(/^["']|["']$/g, '')
  }
  return keyNode.text
}

function getTopLevelKeys(root: TsNode): Array<{ key: string; line: number }> {
  const results: Array<{ key: string; line: number }> = []
  const seen = new Set<string>()

  const add = (key: string, line: number) => {
    if (key && !seen.has(key)) {
      seen.add(key)
      results.push({ key, line })
    }
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    if (child.type === 'pair') {
      // Top-level key = value pair
      const keyNode = child.namedChildren[0]
      if (!keyNode) continue
      const key = extractKeyText(keyNode)
      add(key, keyNode.startPosition.row + 1)
    } else if (child.type === 'table') {
      // [section] or [[array-of-tables]]
      // The first named child is the key
      const keyNode = child.namedChildren[0]
      if (!keyNode) continue
      const key = extractKeyText(keyNode)
      add(key, keyNode.startPosition.row + 1)
    } else if (child.type === 'table_array_element') {
      // [[array]] tables
      const keyNode = child.namedChildren[0]
      if (!keyNode) continue
      const key = extractKeyText(keyNode)
      add(key, keyNode.startPosition.row + 1)
    }
  }

  return results
}

function inferTomlStack(facts: FactInputModule[]): string {
  const allKeys = new Set(facts.flatMap((f) => f.symbols.map((s) => s.name.toLowerCase())))
  const allFiles = facts.map((f) => path.basename(f.file).toLowerCase())

  if (allFiles.some((f) => f === 'cargo.toml') || (allKeys.has('package') && allKeys.has('dependencies'))) {
    return 'Rust/Cargo'
  }
  if (allFiles.some((f) => f === 'pyproject.toml') || allKeys.has('tool') || allKeys.has('project')) {
    return 'Python/pyproject'
  }
  if (allFiles.some((f) => f === 'netlify.toml') || allKeys.has('build') && allKeys.has('redirects')) {
    return 'Netlify'
  }

  return 'TOML'
}

export const tomlAdapter: LanguageAdapter = {
  id: 'toml',
  fileExtensions: ['.toml'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const entries = getTopLevelKeys(tree.rootNode)
    const keys = entries.map((e) => e.key)

    const symbols: TomlParsedSymbol[] = entries.map((entry) => ({
      name: entry.key,
      kind: 'const' as const,
      exported: true,
      line: entry.line,
    }))

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports: keys,
      symbols,
      language: 'toml',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferTomlStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
