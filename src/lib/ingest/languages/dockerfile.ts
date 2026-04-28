/**
 * Dockerfile language adapter.
 *
 * No tree-sitter-dockerfile.wasm is available in the bundle, so this adapter
 * uses a regex-based parser rather than a full AST. This is sufficient for the
 * config-only symbol extraction the registry needs.
 *
 * Symbol extraction:
 *   FROM <image> [AS <stage>] → const symbol named <stage> (or image slug if no AS)
 *   ENV <KEY> ...             → const symbol named KEY
 *   ARG <KEY>[=...]           → const symbol named KEY
 *   EXPOSE <port>             → const symbol named PORT_<port>
 *
 * All symbols are exported.
 *
 * inferTechStack: inferred from FROM base images:
 *   node* / npm*     → Node.js
 *   python*          → Python
 *   golang* / go*    → Go
 *   java* / openjdk* → Java
 *   ruby*            → Ruby
 *   nginx*           → Nginx
 *   alpine* / debian* / ubuntu* → Linux (base)
 *   scratch          → Scratch
 *   default          → Docker
 *
 * fileExtensions: ['Dockerfile', '.dockerfile']
 *   The registry is extended to match by basename when extname returns ''.
 */

import * as path from 'node:path'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol } from '../ast-ts'

export interface DockerfileParsedSymbol extends ParsedSymbol {
  exported?: boolean
  line?: number
}

// ---------------------------------------------------------------------------
// Regex-based Dockerfile parser
// ---------------------------------------------------------------------------

const FROM_RE = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i
const ENV_RE = /^ENV\s+([\w]+)/i
const ARG_RE = /^ARG\s+([\w]+)/i
const EXPOSE_RE = /^EXPOSE\s+(\d+)/i

function slugify(image: string): string {
  return image
    .replace(/[:@].*$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export interface DockerfileSymbolEntry {
  name: string
  line: number
  directive: 'FROM' | 'ENV' | 'ARG' | 'EXPOSE'
  /** Raw base image (only present for FROM directives). */
  image?: string
}

export function parseDockerfile(source: string): DockerfileSymbolEntry[] {
  const results: DockerfileSymbolEntry[] = []
  const seen = new Set<string>()

  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue

    const lineNum = i + 1

    const fromMatch = FROM_RE.exec(line)
    if (fromMatch) {
      const rawImage = fromMatch[1]
      const stageName = fromMatch[2] ?? slugify(rawImage)
      if (stageName && !seen.has(stageName)) {
        seen.add(stageName)
        results.push({ name: stageName, line: lineNum, directive: 'FROM', image: rawImage })
      }
      continue
    }

    const envMatch = ENV_RE.exec(line)
    if (envMatch) {
      const key = envMatch[1]
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ name: key, line: lineNum, directive: 'ENV' })
      }
      continue
    }

    const argMatch = ARG_RE.exec(line)
    if (argMatch) {
      const key = argMatch[1]
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ name: key, line: lineNum, directive: 'ARG' })
      }
      continue
    }

    const exposeMatch = EXPOSE_RE.exec(line)
    if (exposeMatch) {
      const symbolName = `PORT_${exposeMatch[1]}`
      if (!seen.has(symbolName)) {
        seen.add(symbolName)
        results.push({ name: symbolName, line: lineNum, directive: 'EXPOSE' })
      }
      continue
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const IMAGE_STACK_MAP: Array<[RegExp, string]> = [
  [/^(node|npm|yarn)/i, 'Node.js'],
  [/^(python|pip)/i, 'Python'],
  [/^(golang|go)\b/i, 'Go'],
  [/^(java|openjdk|eclipse-temurin)/i, 'Java'],
  [/^ruby/i, 'Ruby'],
  [/^nginx/i, 'Nginx'],
  [/^alpine/i, 'Alpine Linux'],
  [/^(debian|ubuntu)/i, 'Linux'],
  [/^scratch$/i, 'Scratch'],
]

function inferStackFromImage(image: string): string | null {
  const base = image.replace(/[:@].*$/, '').split('/').pop() ?? image
  for (const [re, label] of IMAGE_STACK_MAP) {
    if (re.test(base)) return label
  }
  return null
}

function inferDockerfileStack(facts: FactInputModule[]): string {
  const stacks = new Set<string>()
  for (const fact of facts) {
    for (const sym of fact.symbols) {
      const entry = sym as DockerfileParsedSymbol & { directive?: string; image?: string }
      if (entry.directive === 'FROM' && entry.image) {
        const inferred = inferStackFromImage(entry.image)
        if (inferred) stacks.add(inferred)
      }
    }
  }
  if (stacks.size === 0) return 'Docker'
  return Array.from(stacks).join(', ')
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const dockerfileAdapter: LanguageAdapter = {
  id: 'dockerfile',
  fileExtensions: ['Dockerfile', '.dockerfile'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const source = tree.rootNode.text
    const entries = parseDockerfile(source)

    const symbols: (DockerfileParsedSymbol & { directive: string; image?: string })[] = entries.map((e) => ({
      name: e.name,
      kind: 'const' as const,
      exported: true,
      line: e.line,
      directive: e.directive,
      image: e.image,
    }))

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports: entries.map((e) => e.name),
      symbols,
      language: 'dockerfile',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferDockerfileStack(facts)
  },

  async loadParser(): Promise<Parser> {
    throw new Error(
      'tree-sitter-dockerfile.wasm is not available. ' +
        'Dockerfile adapter uses regex-based extraction via parseDockerfile().'
    )
  },
}
