/**
 * Java language adapter — W2.D8.
 *
 * Wires `tree-sitter-java.wasm` (from `tree-sitter-wasms`, no new dep).
 * Extracts:
 *   - package_declaration → captured into the synthetic packageName
 *   - import_declaration → ParsedImport per imported FQN
 *   - class_declaration → 'class' (extends/implements ignored at this layer)
 *   - interface_declaration → 'interface'
 *   - record_declaration → 'class' (Java 14+ data class shorthand)
 *   - enum_declaration → 'class' (no enum kind in our shared SymbolKind set)
 *   - method_declaration nested under a class/interface → 'function' with attributes.parentClass
 *
 * Visibility: a name is exported iff one of its modifiers is `public`. Java
 * package-private (no modifier) is treated as non-exported.
 */

import * as path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { LanguageAdapter, FactInputModule } from './types'
import type { ParsedImport, ParsedSymbol, SymbolKind } from '../ast-ts'

// ---------------------------------------------------------------------------
// WASM loader (mirrors python.ts / go.ts)
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

  const wasmPath = path.join(resolveWasmDir(), 'tree-sitter-java.wasm')
  const bytes = await readFile(wasmPath)
  const lang = await Parser.Language.load(new Uint8Array(bytes))
  const parser = new Parser()
  parser.setLanguage(lang)
  cachedParser = parser
  return parser
}

// ---------------------------------------------------------------------------
// Extended symbol — Java-specific receiver attribute
// ---------------------------------------------------------------------------

export interface JavaParsedSymbol extends ParsedSymbol {
  attributes?: {
    /** Owning class for methods; undefined for top-level type decls. */
    parentClass?: string
    /** Annotation list (e.g. ['@Override', '@GetMapping']) when present. */
    annotations?: string[]
  }
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

type TsNode = Parser.SyntaxNode

function modifiersInclude(node: TsNode | null, modifier: string): boolean {
  if (!node) return false
  // tree-sitter-java represents `public` / `private` / `static` etc. as
  // anonymous tokens — they appear in `children`, not `namedChildren`.
  // Annotations (`@Foo`) are NAMED children, but visibility keywords are not.
  for (const c of node.children) {
    if (!c) continue
    if (c.type === modifier) return true
  }
  return false
}

function findModifiers(decl: TsNode): TsNode | null {
  for (const c of decl.namedChildren) {
    if (c && c.type === 'modifiers') return c
  }
  return null
}

function collectAnnotations(modifiers: TsNode | null): string[] {
  if (!modifiers) return []
  const out: string[] = []
  for (const c of modifiers.namedChildren) {
    if (!c) continue
    if (c.type === 'marker_annotation' || c.type === 'annotation') {
      // Take the first identifier-style child as the annotation name; prefix with '@'.
      const name = c.childForFieldName('name')
      if (name) out.push('@' + name.text)
      else out.push(c.text)
    }
  }
  return out
}

function extractMethods(bodyNode: TsNode | null, parentClass: string): JavaParsedSymbol[] {
  if (!bodyNode) return []
  const methods: JavaParsedSymbol[] = []
  for (const c of bodyNode.namedChildren) {
    if (!c) continue
    if (c.type !== 'method_declaration') continue
    const name = c.childForFieldName('name')
    if (!name) continue
    const modifiers = findModifiers(c)
    const annotations = collectAnnotations(modifiers)
    const sym: JavaParsedSymbol = {
      name: name.text,
      kind: 'function' as SymbolKind,
      attributes: {
        parentClass,
        ...(annotations.length > 0 ? { annotations } : {}),
      },
    }
    methods.push(sym)
  }
  return methods
}

interface JavaBundle {
  imports: ParsedImport[]
  exports: string[]
  symbols: JavaParsedSymbol[]
  packageName: string | null
}

function extractJava(root: TsNode): JavaBundle {
  const imports: ParsedImport[] = []
  const exports: string[] = []
  const symbolMap = new Map<string, JavaParsedSymbol>()
  let packageName: string | null = null

  const addSymbol = (sym: JavaParsedSymbol) => {
    if (symbolMap.has(sym.name)) return
    symbolMap.set(sym.name, sym)
  }

  const maybeExport = (name: string, modifiers: TsNode | null) => {
    if (modifiersInclude(modifiers, 'public')) exports.push(name)
  }

  for (const child of root.namedChildren) {
    if (!child) continue

    switch (child.type) {
      case 'package_declaration': {
        // The packge name child can be a `scoped_identifier` or `identifier`.
        for (const c of child.namedChildren) {
          if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) {
            packageName = c.text
            break
          }
        }
        break
      }

      case 'import_declaration': {
        // Java imports look like: `import foo.bar.Baz;` or `import foo.bar.*;`
        // The path is a scoped_identifier or identifier child.
        let from = ''
        let isWildcard = false
        for (const c of child.namedChildren) {
          if (!c) continue
          if (c.type === 'scoped_identifier' || c.type === 'identifier') {
            from = c.text
          } else if (c.type === 'asterisk') {
            isWildcard = true
          }
        }
        if (from) {
          // Treat the LAST segment of the FQN as the imported "name" unless it's a wildcard.
          const segs = from.split('.')
          const last = segs[segs.length - 1]
          imports.push({
            from,
            names: [isWildcard ? '*' : last ?? '*'],
          })
        }
        break
      }

      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        const modifiers = findModifiers(child)
        const annotations = collectAnnotations(modifiers)
        const kind: SymbolKind = child.type === 'interface_declaration' ? 'interface' : 'class'
        const sym: JavaParsedSymbol = {
          name: nameNode.text,
          kind,
          ...(annotations.length > 0 ? { attributes: { annotations } } : {}),
        }
        addSymbol(sym)
        maybeExport(nameNode.text, modifiers)
        // Pull methods from the body
        const body = child.childForFieldName('body')
        for (const m of extractMethods(body, nameNode.text)) {
          addSymbol(m)
          // Methods inherit visibility from their own modifiers; not the class.
          // We inspect the method's own modifiers child in extractMethods (annotations only),
          // so do a separate pass for export detection here.
        }
        // Per-method exports
        if (body) {
          for (const c of body.namedChildren) {
            if (!c || c.type !== 'method_declaration') continue
            const mName = c.childForFieldName('name')
            if (!mName) continue
            const mMods = findModifiers(c)
            maybeExport(mName.text, mMods)
          }
        }
        break
      }
    }
  }

  return {
    imports,
    exports,
    symbols: Array.from(symbolMap.values()),
    packageName,
  }
}

// ---------------------------------------------------------------------------
// Tech-stack inference
// ---------------------------------------------------------------------------

const FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^org\.springframework\.boot($|\.)/, 'Java/Spring Boot'],
  [/^org\.springframework($|\.)/, 'Java/Spring'],
  [/^io\.quarkus($|\.)/, 'Java/Quarkus'],
  [/^io\.micronaut($|\.)/, 'Java/Micronaut'],
  [/^jakarta\.servlet($|\.)/, 'Java/Jakarta Servlet'],
  [/^javax\.servlet($|\.)/, 'Java/Servlet'],
  [/^org\.hibernate($|\.)/, 'Java/Hibernate'],
  [/^io\.netty($|\.)/, 'Java/Netty'],
  [/^io\.vertx($|\.)/, 'Java/Vert.x'],
]

function inferJavaStack(facts: FactInputModule[]): string {
  const allFrom = facts.flatMap((f) => f.imports.map((i) => i.from))
  for (const [pattern, label] of FRAMEWORK_PATTERNS) {
    if (allFrom.some((s) => pattern.test(s))) return label
  }
  return 'Java'
}

// ---------------------------------------------------------------------------
// Exported adapter
// ---------------------------------------------------------------------------

export const javaAdapter: LanguageAdapter = {
  id: 'java',
  fileExtensions: ['.java'],

  extractFacts(tree: Parser.Tree, sourcePath: string): FactInputModule {
    const { imports, exports, symbols } = extractJava(tree.rootNode)
    return {
      file: sourcePath.replace(/\\/g, '/'),
      imports,
      exports,
      symbols,
      language: 'java',
    }
  },

  inferTechStack(facts: FactInputModule[]): string {
    return inferJavaStack(facts)
  },

  async loadParser(): Promise<Parser> {
    return getParser()
  },
}
