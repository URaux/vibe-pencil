/**
 * GraphQL schema language adapter.
 *
 * No tree-sitter-graphql.wasm in the bundle; uses regex-based parsing.
 * loadParser() throws a clear error if called.
 *
 * Symbol extraction from .graphql / .gql files:
 *   type Foo { ... }         → class  `Foo`
 *   interface Bar { ... }    → class  `Bar`
 *   union Baz = A | B        → class  `Baz`
 *   enum Status { ... }      → class  `Status`
 *   input CreateUserInput {  → class  `CreateUserInput`
 *   scalar Date              → const  `Date`
 *   Query/Mutation/Subscription top-level fields → fn  `<RootType>.<fieldName>`
 *
 * All symbols are exported (GraphQL schemas are public by definition).
 *
 * inferTechStack heuristics:
 *   relay / useFragment / useQuery imports → GraphQL/Relay
 *   apollo / useQuery / gql tag            → GraphQL/Apollo
 *   default                                → GraphQL
 */

import * as path from 'node:path'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// Extended symbol type
// ---------------------------------------------------------------------------

export interface GraphqlParsedSymbol extends ParsedSymbol {
  exported: boolean
  line: number
}

// ---------------------------------------------------------------------------
// Regex-based GraphQL parser
// ---------------------------------------------------------------------------

// Matches: type Foo, interface Foo, union Foo, enum Foo, input Foo
const TYPE_DEF_RE = /^(type|interface|union|enum|input)\s+(\w+)/

// Matches: scalar Foo
const SCALAR_RE = /^scalar\s+(\w+)/

// Matches opening of Query/Mutation/Subscription root types
const ROOT_TYPE_RE = /^(type)\s+(Query|Mutation|Subscription)\s*\{/

// Matches a top-level field line inside a root type block: fieldName(...): SomeType
const FIELD_RE = /^\s{0,4}(\w+)\s*(?:\([^)]*\))?\s*:/

export interface GraphqlSymbolEntry {
  name: string
  kind: SymbolKind
  line: number
}

export function parseGraphql(source: string): GraphqlSymbolEntry[] {
  const results: GraphqlSymbolEntry[] = []
  const seen = new Set<string>()
  const lines = source.split('\n')

  const add = (name: string, kind: SymbolKind, line: number) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    results.push({ name, kind, line })
  }

  let inRootType: string | null = null
  let depth = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    const lineNum = i + 1

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      if (inRootType !== null) {
        depth += (raw.match(/\{/g) ?? []).length
        depth -= (raw.match(/\}/g) ?? []).length
        if (depth <= 0) { inRootType = null; depth = 0 }
      }
      continue
    }

    if (inRootType !== null) {
      // Track brace depth to detect end of root type block
      depth += (raw.match(/\{/g) ?? []).length
      depth -= (raw.match(/\}/g) ?? []).length
      if (depth <= 0) { inRootType = null; depth = 0; continue }

      // Extract field definitions (skip __typename and meta fields)
      const fm = FIELD_RE.exec(raw)
      if (fm && !fm[1].startsWith('__')) {
        add(`${inRootType}.${fm[1]}`, 'fn', lineNum)
      }
      continue
    }

    // Check for root type opening (Query/Mutation/Subscription)
    const rootMatch = ROOT_TYPE_RE.exec(trimmed)
    if (rootMatch) {
      const typeName = rootMatch[2]
      add(typeName, 'class', lineNum)
      const openCount = (raw.match(/\{/g) ?? []).length
      const closeCount = (raw.match(/\}/g) ?? []).length
      if (openCount > closeCount) {
        // Multi-line block: enter root-type field-extraction mode
        inRootType = typeName
        depth = openCount - closeCount
      } else {
        // Inline single-line block: extract fields from the same line
        const bodyMatch = /\{([^}]*)\}/.exec(raw)
        if (bodyMatch) {
          for (const segment of bodyMatch[1].split(',')) {
            const fm = FIELD_RE.exec(' ' + segment.trim())
            if (fm && !fm[1].startsWith('__')) {
              add(`${typeName}.${fm[1]}`, 'fn', lineNum)
            }
          }
        }
      }
      continue
    }

    // scalar → const
    const scalarMatch = SCALAR_RE.exec(trimmed)
    if (scalarMatch) {
      add(scalarMatch[1], 'const', lineNum)
      continue
    }

    // type / interface / union / enum / input → class
    const typeMatch = TYPE_DEF_RE.exec(trimmed)
    if (typeMatch) {
      add(typeMatch[2], 'class', lineNum)
      continue
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const STACK_HINTS: Array<[RegExp, string]> = [
  [/relay|useFragment|useQuery.*relay/i, 'GraphQL/Relay'],
  [/apollo|useQuery|useMutation|gql\s*`/i, 'GraphQL/Apollo'],
]

function inferGraphqlStack(facts: FactInputModule[]): string {
  // Look for framework hints in export names or import specifiers
  const allNames = facts.flatMap((f) => [...f.exports, ...f.imports])
  for (const [re, label] of STACK_HINTS) {
    if (allNames.some((n) => re.test(n))) return label
  }
  return 'GraphQL'
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const graphqlAdapter: LanguageAdapter = {
  id: 'graphql',
  fileExtensions: ['.graphql', '.gql'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const source = tree.rootNode.text
    const entries = parseGraphql(source)

    const symbols: GraphqlParsedSymbol[] = entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      exported: true,
      line: e.line,
    }))

    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports: [],
      exports: entries.map((e) => e.name),
      symbols,
      language: 'graphql',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferGraphqlStack(facts)
  },

  async loadParser(): Promise<Parser> {
    throw new Error(
      'tree-sitter-graphql.wasm is not available. ' +
        'GraphQL adapter uses regex-based extraction via parseGraphql().'
    )
  },
}
