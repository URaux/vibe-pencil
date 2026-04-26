/**
 * C++ language adapter — Phase 3 / lang-cpp.
 *
 * Wires `tree-sitter-cpp.wasm` (from `tree-sitter-wasms`, no new dep) behind
 * the `LanguageAdapter` interface. Extracts:
 *   - preproc_include → ParsedImport (path child; strips quotes/brackets)
 *   - class_specifier / struct_specifier / union_specifier / enum_specifier → SymbolKind 'class'
 *   - function_definition (top-level) → 'function'
 *   - methods inside field_declaration_list of a class/struct → 'function' with attributes.parentClass
 *   - namespace_definition → 'class'
 *   - template_declaration wrapping any of the above → unwrap to inner, capture as inner kind
 *
 * Visibility: ALL named top-level decls are exported. Names starting with `_` are NOT exported.
 *
 * inferTechStack scans includes for Qt / Boost / OpenCV / Eigen / GoogleTest.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors go.ts)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-cpp.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — C++-specific parent class attribute
// ---------------------------------------------------------------------------

export interface CppParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Owning class/struct name for methods defined inside a field_declaration_list */
    parentClass?: string
  }
}

// ---------------------------------------------------------------------------
// C++ AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

/** Exported = non-underscore-prefixed names (C++ header convention). */
function isExported(name: string): boolean {
  if (!name) return false
  return !name.startsWith('_')
}

/**
 * Strip surrounding quotes or angle brackets from an include path literal.
 * e.g. `"foo.h"` → `foo.h`, `<vector>` → `vector`
 */
function stripIncludeDelimiters(raw: string): string {
  const t = raw.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('<') && t.endsWith('>'))
  ) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Extract the name of a named node that has a `name` field or whose first
 * named child of type `type_identifier` / `identifier` / `namespace_identifier`
 * gives the name.
 */
function extractName(node: TsNode): string | null {
  // Most C++ specifiers expose a `name` field.
  const nameField = node.childForFieldName('name')
  if (nameField) return nameField.text || null

  // Fallback: first named child that is an identifier-ish node.
  for (const c of node.namedChildren) {
    if (!c) continue
    if (
      c.type === 'type_identifier' ||
      c.type === 'identifier' ||
      c.type === 'namespace_identifier'
    ) {
      return c.text || null
    }
  }
  return null
}

/**
 * Extract the function name from a function_definition node.
 * The declarator chain can be: function_declarator > destructor_name | qualified_identifier | identifier
 */
function extractFunctionName(node: TsNode): string | null {
  const declField = node.childForFieldName('declarator')
  if (!declField) return null
  return extractDeclaratorName(declField)
}

function extractDeclaratorName(decl: TsNode): string | null {
  if (decl.type === 'function_declarator') {
    const inner = decl.childForFieldName('declarator')
    if (inner) return extractDeclaratorName(inner)
  }
  if (
    decl.type === 'identifier' ||
    decl.type === 'type_identifier' ||
    decl.type === 'destructor_name'
  ) {
    return decl.text || null
  }
  if (decl.type === 'qualified_identifier') {
    // last segment after '::'
    const scope = decl.childForFieldName('name')
    if (scope) return scope.text || null
    // fallback: last named child
    const children = decl.namedChildren.filter(Boolean)
    if (children.length > 0) return children[children.length - 1]!.text || null
  }
  if (decl.type === 'pointer_declarator' || decl.type === 'reference_declarator') {
    for (const c of decl.namedChildren) {
      if (!c) continue
      const n = extractDeclaratorName(c)
      if (n) return n
    }
  }
  return decl.text || null
}

interface CppBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: CppParsedSymbol[]
}

/**
 * Walk the members inside a class/struct/union field_declaration_list and
 * emit method symbols with parentClass set.
 */
function extractMethods(body: TsNode, parentClass: string, symbolMap: Map<string, CppParsedSymbol>): void {
  for (const child of body.namedChildren) {
    if (!child) continue
    // Methods are function_definition nodes directly inside the body.
    if (child.type === 'function_definition') {
      const name = extractFunctionName(child)
      if (!name) continue
      const key = `${parentClass}::${name}`
      if (symbolMap.has(key)) continue
      symbolMap.set(key, {
        name,
        kind: 'function',
        attributes: { parentClass },
      })
    }
    // template_declaration wrapping a method
    if (child.type === 'template_declaration') {
      const inner = unwrapTemplate(child)
      if (inner && inner.type === 'function_definition') {
        const name = extractFunctionName(inner)
        if (!name) continue
        const key = `${parentClass}::${name}`
        if (symbolMap.has(key)) continue
        symbolMap.set(key, {
          name,
          kind: 'function',
          attributes: { parentClass },
        })
      }
    }
  }
}

/**
 * Unwrap a template_declaration to its inner declaration (the node after
 * the template parameter list). Returns null if none found.
 */
function unwrapTemplate(templateNode: TsNode): TsNode | null {
  // template_declaration structure: 'template' parameters <inner>
  // The inner declaration is the last named child that is not template_parameter_list.
  for (let i = templateNode.namedChildren.length - 1; i >= 0; i--) {
    const c = templateNode.namedChildren[i]
    if (!c) continue
    if (c.type !== 'template_parameter_list') return c
  }
  return null
}

function extractCpp(root: TsNode): CppBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, CppParsedSymbol>()

  const addSymbol = (sym: CppParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
    if (isExported(sym.name)) exports.push(sym.name)
  }

  const handleTopLevel = (child: TsNode) => {
    switch (child.type) {
      case 'preproc_include': {
        // child has a `path` field: string_literal or system_lib_string
        const pathNode = child.childForFieldName('path')
        if (!pathNode) break
        const raw = pathNode.text
        const from = stripIncludeDelimiters(raw)
        if (from) imports.push({ from, names: ['*'] })
        break
      }

      case 'class_specifier':
      case 'struct_specifier':
      case 'union_specifier':
      case 'enum_specifier': {
        const name = extractName(child)
        if (!name) break
        addSymbol({ name, kind: 'class' })
        // Extract methods from the body (field_declaration_list)
        const body = child.childForFieldName('body')
        if (body && body.type === 'field_declaration_list') {
          extractMethods(body, name, symbolMap)
        }
        break
      }

      case 'function_definition': {
        const name = extractFunctionName(child)
        if (!name) break
        addSymbol({ name, kind: 'function' })
        break
      }

      case 'namespace_definition': {
        const name = extractName(child)
        if (!name) break
        addSymbol({ name, kind: 'class' })
        break
      }

      case 'template_declaration': {
        const inner = unwrapTemplate(child)
        if (!inner) break
        // Recurse by handling the inner node as if it were top-level.
        handleTopLevel(inner)
        break
      }

      default:
        break
    }
  }

  for (const child of root.namedChildren) {
    if (!child) continue
    handleTopLevel(child)
  }

  return {
    imports,
    exports,
    symbols: Array.from(symbolMap.values()),
  }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/Qt(Widgets|Core|Gui|Network|Quick|Qml|Sql|Test|Xml|Concurrent|OpenGL|Svg|PrintSupport|Multimedia|Bluetooth|WebEngine|Sensors|SerialPort|Charts|DataVisualization|3DCore|3DRender|3DInput|3DLogic|3DAnimation|3DExtras)/i, 'C++/Qt'],
  [/^Qt/, 'C++/Qt'],
  [/boost\//i, 'C++/Boost'],
  [/opencv|cv\.h|cv2/i, 'C++/OpenCV'],
  [/eigen/i, 'C++/Eigen'],
  [/gtest|gmock/i, 'C++/GoogleTest'],
]

function inferCppStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'C++'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const cppAdapter: LanguageAdapter = {
  id: 'cpp',
  fileExtensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractCpp(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'cpp',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferCppStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
