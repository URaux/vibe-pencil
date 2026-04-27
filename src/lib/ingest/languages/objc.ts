/**
 * Objective-C language adapter.
 *
 * Uses `tree-sitter-objc.wasm` (present in tree-sitter-wasms/out/).
 * Pre-flight: loadParser() throws if wasm is absent.
 *
 * Extracts:
 *   import_directive (#import) → ParsedImport
 *   class_interface             → class (always exported)
 *   category_interface          → class (always exported)
 *   protocol_declaration        → interface (always exported)
 *   instance_method_declaration → function (with parentClass)
 *   class_method_declaration    → function (with parentClass)
 *
 * Visibility: ObjC has no formal visibility — all @interface decls are exported.
 *
 * inferTechStack:
 *   UIKit imports     → 'ObjC/UIKit'
 *   Foundation import → 'ObjC/Foundation'
 *   default           → 'ObjC'
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

function resolveObjcWasm(): string {
  return path.join(resolveWasmDir(), 'tree-sitter-objc.wasm')
}

let initPromise: Promise<void> | null = null
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  if (cachedParser) return cachedParser

  const objcWasmPath = resolveObjcWasm()
  if (!existsSync(objcWasmPath)) {
    throw new Error(
      `ObjC language adapter: tree-sitter-objc.wasm not found at ${objcWasmPath}. ` +
        'Upgrade tree-sitter-wasms to a version that includes Objective-C support.',
    )
  }

  if (!initPromise) {
    const runtimeWasm = resolveRuntimeWasm()
    initPromise = Parser.init({
      locateFile: (name: string) => (name === 'tree-sitter.wasm' ? runtimeWasm : name),
    })
  }
  await initPromise

  const bytes = await readFile(objcWasmPath)
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

export interface ObjcParsedSymbol extends ParsedSymbol {
  parentClass?: string
}

interface ObjcBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: ObjcParsedSymbol[]
}

/** Extract header path from #import "Foo.h" or #import <UIKit/UIKit.h>. */
function extractImportPath(node: TsNode): string | null {
  for (const child of node.namedChildren) {
    if (!child) continue
    if (
      child.type === 'string_literal' ||
      child.type === 'system_lib_string' ||
      child.type === 'string'
    ) {
      return child.text.replace(/^["<]|[">]$/g, '')
    }
  }
  // Fallback: raw text parse
  const text = node.text.trim()
  const m = text.match(/#import\s+["<](.+?)[">]/)
  return m ? m[1] : null
}

/** Get the selector text from a method_declaration's selector field. */
function extractMethodName(node: TsNode): string {
  // Try field 'selector'
  const selNode = node.childForFieldName('selector')
  if (selNode) return selNode.text.replace(/:$/, '')

  // Fallback: find method_selector or keyword
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'method_selector' || child.type === 'selector') {
      return child.text.replace(/:$/, '')
    }
    if (child.type === 'keyword_declarator') {
      return child.text.replace(/:$/, '')
    }
  }
  return ''
}

function extractObjc(root: TsNode): ObjcBundle {
  const imports: ParsedImport[] = []
  const symbolMap = new Map<string, ObjcParsedSymbol>()

  function addSymbol(name: string, kind: SymbolKind, exported: boolean, parentClass?: string): void {
    if (!name || symbolMap.has(name)) return
    const sym: ObjcParsedSymbol = { name, kind, exported }
    if (parentClass) sym.parentClass = parentClass
    symbolMap.set(name, sym)
  }

  function visit(node: TsNode): void {
    switch (node.type) {
      case 'import_directive':
      case 'preproc_import': {
        const from = extractImportPath(node)
        if (from) imports.push({ from, names: ['*'] })
        break
      }

      case 'class_interface':
      case 'category_interface': {
        // @interface ClassName [CategoryName]
        const nameNode =
          node.childForFieldName('name') ??
          node.namedChildren.find((c) => c?.type === 'type_identifier')
        const name = nameNode?.text ?? ''
        if (name) addSymbol(name, 'class', true)

        // Extract methods inside
        for (const child of node.namedChildren) {
          if (!child) continue
          if (
            child.type === 'instance_method_declaration' ||
            child.type === 'class_method_declaration'
          ) {
            const methodName = extractMethodName(child)
            if (methodName) addSymbol(`${name}_${methodName}`, 'function', true, name)
          }
        }
        return
      }

      case 'protocol_declaration': {
        const nameNode =
          node.childForFieldName('name') ??
          node.namedChildren.find((c) => c?.type === 'type_identifier')
        const name = nameNode?.text ?? ''
        if (name) addSymbol(name, 'interface', true)
        return
      }

      case 'class_implementation': {
        // @implementation — extract method definitions
        const nameNode =
          node.childForFieldName('name') ??
          node.namedChildren.find((c) => c?.type === 'type_identifier')
        const className = nameNode?.text ?? ''

        for (const child of node.namedChildren) {
          if (!child) continue
          if (
            child.type === 'instance_method_definition' ||
            child.type === 'class_method_definition'
          ) {
            const methodName = extractMethodName(child)
            if (methodName && className) {
              addSymbol(`${className}_${methodName}`, 'function', true, className)
            }
          }
        }
        return
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

function inferObjcStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  if (allFrom.some((s) => s.includes('UIKit'))) return 'ObjC/UIKit'
  if (allFrom.some((s) => s.includes('Foundation'))) return 'ObjC/Foundation'
  return 'ObjC'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const objcAdapter: LanguageAdapter = {
  id: 'objc',
  fileExtensions: ['.m'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractObjc(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'objc' as const,
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferObjcStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
