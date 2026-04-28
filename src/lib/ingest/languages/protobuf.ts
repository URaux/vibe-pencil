/**
 * Protobuf schema language adapter.
 *
 * No tree-sitter-proto.wasm in the bundle; uses regex-based parsing.
 * loadParser() throws a clear error if called.
 *
 * Symbol extraction from .proto files:
 *   message Foo { ... }        → class  `Foo`
 *   enum Status { ... }        → class  `Status`
 *   service UserService { ... }→ class  `UserService`
 *   rpc Method(...)returns(){} → fn     `ServiceName.Method`
 *   oneof field { ... }        → class  `ServiceName.field` (namespaced)
 *
 * All symbols are exported.
 *
 * inferTechStack: always 'Protobuf/gRPC' when service blocks exist,
 * otherwise 'Protobuf'.
 */

import * as path from 'node:path'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedSymbol, SymbolKind } from '../ast-ts'

export interface ProtobufParsedSymbol extends ParsedSymbol {
  exported: boolean
  line: number
}

export interface ProtobufSymbolEntry {
  name: string
  kind: SymbolKind
  line: number
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const MESSAGE_RE = /^message\s+(\w+)\s*\{?/
const ENUM_RE = /^enum\s+(\w+)\s*\{?/
const SERVICE_RE = /^service\s+(\w+)\s*\{?/
const RPC_RE = /^\s*rpc\s+(\w+)\s*\(/
const ONEOF_RE = /^\s*oneof\s+(\w+)\s*\{?/
const COMMENT_RE = /^\/\//
const BLOCK_OPEN_RE = /\{/g
const BLOCK_CLOSE_RE = /\}/g

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseProtobuf(source: string): ProtobufSymbolEntry[] {
  const results: ProtobufSymbolEntry[] = []
  const seen = new Set<string>()
  const lines = source.split('\n')

  const add = (name: string, kind: SymbolKind, line: number) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    results.push({ name, kind, line })
  }

  // Track current service context for rpc prefixing
  let currentService: string | null = null
  // Brace depth stack: each entry is depth-at-open for a named block
  const scopeStack: Array<{ name: string; type: 'service' | 'other'; depth: number }> = []
  let depth = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    const lineNum = i + 1

    if (!trimmed || COMMENT_RE.test(trimmed) || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      // Still track brace depth
      depth += (raw.match(BLOCK_OPEN_RE) ?? []).length
      depth -= (raw.match(BLOCK_CLOSE_RE) ?? []).length
      adjustScope(scopeStack, depth)
      currentService = topService(scopeStack)
      continue
    }

    // Count braces before processing to maintain depth
    const opens = (raw.match(BLOCK_OPEN_RE) ?? []).length
    const closes = (raw.match(BLOCK_CLOSE_RE) ?? []).length

    const serviceMatch = SERVICE_RE.exec(trimmed)
    if (serviceMatch) {
      const name = serviceMatch[1]
      add(name, 'class', lineNum)
      depth += opens - closes
      if (opens > closes) {
        scopeStack.push({ name, type: 'service', depth })
      }
      currentService = topService(scopeStack)
      continue
    }

    const rpcMatch = RPC_RE.exec(trimmed)
    if (rpcMatch && currentService) {
      const methodName = `${currentService}.${rpcMatch[1]}`
      add(methodName, 'fn', lineNum)
      depth += opens - closes
      adjustScope(scopeStack, depth)
      currentService = topService(scopeStack)
      continue
    }

    const messageMatch = MESSAGE_RE.exec(trimmed)
    if (messageMatch) {
      add(messageMatch[1], 'class', lineNum)
      depth += opens - closes
      if (opens > closes) {
        scopeStack.push({ name: messageMatch[1], type: 'other', depth })
      }
      currentService = topService(scopeStack)
      continue
    }

    const enumMatch = ENUM_RE.exec(trimmed)
    if (enumMatch) {
      add(enumMatch[1], 'class', lineNum)
      depth += opens - closes
      if (opens > closes) {
        scopeStack.push({ name: enumMatch[1], type: 'other', depth })
      }
      currentService = topService(scopeStack)
      continue
    }

    const oneofMatch = ONEOF_RE.exec(trimmed)
    if (oneofMatch && currentService) {
      const oneofName = `${currentService}.${oneofMatch[1]}`
      add(oneofName, 'class', lineNum)
      depth += opens - closes
      adjustScope(scopeStack, depth)
      currentService = topService(scopeStack)
      continue
    }

    depth += opens - closes
    adjustScope(scopeStack, depth)
    currentService = topService(scopeStack)
  }

  return results
}

function adjustScope(stack: Array<{ depth: number }>, depth: number) {
  while (stack.length > 0 && stack[stack.length - 1].depth > depth) {
    stack.pop()
  }
}

function topService(stack: Array<{ name: string; type: string }>): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === 'service') return stack[i].name
  }
  return null
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

function inferProtobufStack(facts: FactInputModule[]): string {
  const hasService = facts.some((f) =>
    f.symbols.some((s) => {
      const sym = s as ProtobufParsedSymbol
      // fn symbols (rpc methods) or class symbols named *Service indicate gRPC
      return s.kind === 'fn' || (s.kind === 'class' && s.name.endsWith('Service'))
    }),
  )
  return hasService ? 'Protobuf/gRPC' : 'Protobuf'
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const protobufAdapter: LanguageAdapter = {
  id: 'protobuf',
  fileExtensions: ['.proto'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const source = tree.rootNode.text
    const entries = parseProtobuf(source)

    const symbols: ProtobufParsedSymbol[] = entries.map((e) => ({
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
      language: 'protobuf',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferProtobufStack(facts)
  },

  async loadParser(): Promise<Parser> {
    throw new Error(
      'tree-sitter-proto.wasm is not available. ' +
        'Protobuf adapter uses regex-based extraction via parseProtobuf().'
    )
  },
}
