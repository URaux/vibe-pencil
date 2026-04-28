import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol } from '../ast-ts'

export type YamlFileType =
  | 'archviber-policy'
  | 'github-action'
  | 'project-config'
  | 'k8s-manifest'
  | 'docker-compose'
  | 'openapi-spec'
  | 'generic-config'

export interface YamlParsedSymbol extends ParsedSymbol {
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-yaml.wasm')
  if (!existsSync(wasmPath)) {
    throw new Error(`tree-sitter-yaml.wasm not found at ${wasmPath}`)
  }
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

function detectFileType(sourcePath: string, topLevelKeys: string[]): YamlFileType {
  const normalized = sourcePath.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()

  if (lower.includes('.archviber/') && (lower.endsWith('policy.yaml') || lower.endsWith('policy.yml'))) {
    return 'archviber-policy'
  }
  if (lower.includes('.github/workflows/') || lower.includes('.github/actions/')) {
    return 'github-action'
  }

  const keySet = new Set(topLevelKeys.map((k) => k.toLowerCase()))

  if (keySet.has('apiversion') && keySet.has('kind') && keySet.has('metadata')) {
    return 'k8s-manifest'
  }
  if (keySet.has('version') && keySet.has('services')) {
    return 'docker-compose'
  }
  if ((keySet.has('openapi') || keySet.has('swagger')) && keySet.has('info') && keySet.has('paths')) {
    return 'openapi-spec'
  }
  if (keySet.has('name') && (keySet.has('version') || keySet.has('dependencies'))) {
    return 'project-config'
  }

  return 'generic-config'
}

type TsNode = Parser.SyntaxNode

function getTopLevelKeys(root: TsNode): Array<{ key: string; line: number }> {
  const results: Array<{ key: string; line: number }> = []

  function findBlockMapping(node: TsNode): TsNode | null {
    if (node.type === 'block_mapping') return node
    for (const child of node.namedChildren) {
      if (!child) continue
      if (child.type === 'block_mapping') return child
      if (child.type === 'block_node' || child.type === 'document' || child.type === 'stream') {
        const found = findBlockMapping(child)
        if (found) return found
      }
    }
    return null
  }

  const mapping = findBlockMapping(root)
  if (!mapping) return results

  for (const child of mapping.namedChildren) {
    if (!child || child.type !== 'block_mapping_pair') continue
    const keyNode = child.childForFieldName('key') ?? child.namedChildren[0]
    if (!keyNode) continue
    const keyText = keyNode.text.trim().replace(/:$/, '')
    if (keyText) {
      results.push({ key: keyText, line: keyNode.startPosition.row + 1 })
    }
  }

  return results
}

function inferYamlStack(facts: FactInputModule[]): string {
  const allSymbols = facts.flatMap((f) => f.symbols as YamlParsedSymbol[])
  const keySet = new Set(allSymbols.map((s) => s.name.toLowerCase()))

  if (keySet.has('on') && (keySet.has('jobs') || keySet.has('steps'))) {
    return 'YAML/GitHub Actions'
  }
  if (keySet.has('apiversion') && keySet.has('kind')) {
    return 'YAML/Kubernetes'
  }
  if (keySet.has('services') && (keySet.has('version') || keySet.has('networks') || keySet.has('volumes'))) {
    return 'YAML/Docker Compose'
  }
  if (keySet.has('openapi') || keySet.has('swagger')) {
    return 'YAML/OpenAPI'
  }

  return 'YAML'
}

export const yamlAdapter: LanguageAdapter = {
  id: 'yaml',
  fileExtensions: ['.yaml', '.yml'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const topLevelEntries = getTopLevelKeys(tree.rootNode)
    const topLevelKeys = topLevelEntries.map((e) => e.key)

    const symbols: YamlParsedSymbol[] = topLevelEntries.map((entry) => ({
      name: entry.key,
      kind: 'const' as const,
      exported: true,
      line: entry.line,
    }))

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports: topLevelKeys,
      symbols,
      language: 'yaml',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferYamlStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
