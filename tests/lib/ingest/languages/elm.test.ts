/**
 * Tests for src/lib/ingest/languages/elm.ts
 *
 * tree-sitter-elm.wasm ships in tree-sitter-wasms but its ABI version (12) is
 * incompatible with the installed web-tree-sitter (requires 13-14). All
 * extraction tests therefore use synthetic SyntaxNode mock trees that mirror
 * what the real parser would produce. loadParser() is expected to throw due to
 * the ABI mismatch.
 */

import { describe, expect, it } from 'vitest'
import { elmAdapter } from '../../../../src/lib/ingest/languages/elm'
import type Parser from 'web-tree-sitter'

// ---------------------------------------------------------------------------
// Fake SyntaxNode tree helpers
// ---------------------------------------------------------------------------

type FakeNode = {
  type: string
  text: string
  childCount: number
  children: FakeNode[]
  namedChildren: FakeNode[]
  namedChildCount: number
  child: (i: number) => FakeNode | null
  namedChild: (i: number) => FakeNode | null
  childForFieldName: (field: string) => FakeNode | null
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
}

function fakeNode(type: string, text: string, children: FakeNode[] = [], row = 0): FakeNode {
  const named = children.filter((c) => !['(', ')', ',', '=', ':', 'module', 'exposing', 'import', 'type', 'alias'].includes(c.type))
  return {
    type,
    text,
    children,
    namedChildren: named,
    namedChildCount: named.length,
    childCount: children.length,
    child: (i: number) => children[i] ?? null,
    namedChild: (i: number) => named[i] ?? null,
    childForFieldName: () => null,
    startPosition: { row, column: 0 },
    endPosition: { row, column: text.length },
  }
}

function lower(name: string, row = 0): FakeNode {
  return fakeNode('lower_case_identifier', name, [], row)
}

function upper(name: string, row = 0): FakeNode {
  return fakeNode('upper_case_identifier', name, [], row)
}

function upperQid(name: string, row = 0): FakeNode {
  return fakeNode('upper_case_qid', name, [], row)
}

function doubleDot(): FakeNode {
  return fakeNode('double_dot', '..', [], 0)
}

function exposedValue(name: string): FakeNode {
  return fakeNode('exposed_value', name, [lower(name)])
}

function exposedType(name: string): FakeNode {
  return fakeNode('exposed_type', name, [upper(name)])
}

function exposingList(children: FakeNode[]): FakeNode {
  return fakeNode('exposing_list', '(' + children.map((c) => c.text).join(', ') + ')', children)
}

function exposingAll(): FakeNode {
  return fakeNode('exposing_list', '(..)', [doubleDot()])
}

function moduleDecl(modName: string, expList: FakeNode): FakeNode {
  return fakeNode('module_declaration', `module ${modName} exposing ${expList.text}`, [
    upperQid(modName),
    expList,
  ])
}

function importClause(modName: string, expList?: FakeNode): FakeNode {
  const children: FakeNode[] = [upperQid(modName)]
  if (expList) children.push(expList)
  return fakeNode('import_clause', `import ${modName}`, children)
}

function funcDeclLeft(name: string, params: string[]): FakeNode {
  const children: FakeNode[] = [lower(name), ...params.map((p) => lower(p))]
  return fakeNode('function_declaration_left', name + ' ' + params.join(' '), children)
}

function valueDecl(name: string, params: string[]): FakeNode {
  const left = funcDeclLeft(name, params)
  return fakeNode('value_declaration', name + ' ' + params.join(' ') + ' = ...', [left])
}

function typeDecl(name: string): FakeNode {
  return fakeNode('type_declaration', `type ${name} = ...`, [upper(name)])
}

function typeAliasDecl(name: string): FakeNode {
  return fakeNode('type_alias_declaration', `type alias ${name} = ...`, [upper(name)])
}

function makeTree(children: FakeNode[]): Parser.Tree {
  const root = fakeNode('file', '', children)
  return { rootNode: root as unknown as Parser.SyntaxNode } as unknown as Parser.Tree
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('elmAdapter', () => {
  it('Test 1: loadParser() throws due to ABI incompatibility', async () => {
    await expect(elmAdapter.loadParser()).rejects.toThrow(/Incompatible|language version|not found/i)
  })

  it('Test 2: import_clause without exposing → ParsedImport with names=[*]', () => {
    const tree = makeTree([importClause('Html')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const htmlImport = result.imports.find((i) => i.from === 'Html')
    expect(htmlImport).toBeDefined()
    expect(htmlImport?.names).toContain('*')
  })

  it('Test 3: import_clause with explicit exposing → named imports', () => {
    const expList = exposingList([exposedValue('div'), exposedValue('text')])
    const tree = makeTree([importClause('Html', expList)])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const htmlImport = result.imports.find((i) => i.from === 'Html')
    expect(htmlImport).toBeDefined()
    expect(htmlImport?.names).toContain('div')
    expect(htmlImport?.names).toContain('text')
  })

  it('Test 4: import with exposing (..) → names=[*]', () => {
    const tree = makeTree([importClause('Browser', exposingAll())])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const imp = result.imports.find((i) => i.from === 'Browser')
    expect(imp?.names).toContain('*')
  })

  it('Test 5: value_declaration with params → function symbol', () => {
    const tree = makeTree([valueDecl('update', ['msg', 'model'])])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const sym = result.symbols.find((s) => s.name === 'update')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('function')
  })

  it('Test 6: value_declaration without params → const symbol', () => {
    const tree = makeTree([valueDecl('main', [])])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const sym = result.symbols.find((s) => s.name === 'main')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('const')
  })

  it('Test 7: type_declaration → class symbol', () => {
    const tree = makeTree([typeDecl('Model')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const sym = result.symbols.find((s) => s.name === 'Model')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  it('Test 8: type_alias_declaration → class symbol', () => {
    const tree = makeTree([typeAliasDecl('Flags')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    const sym = result.symbols.find((s) => s.name === 'Flags')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  it('Test 9: exposing explicit list → only listed names in exports', () => {
    const expList = exposingList([exposedValue('main'), exposedType('Model')])
    const decl = moduleDecl('Main', expList)
    const tree = makeTree([
      decl,
      valueDecl('main', []),
      valueDecl('helper', []),
      typeDecl('Model'),
    ])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(result.exports).toContain('main')
    expect(result.exports).toContain('Model')
    expect(result.exports).not.toContain('helper')
  })

  it('Test 10: exposing (..) wildcard → all top-level names exported', () => {
    const decl = moduleDecl('Main', exposingAll())
    const tree = makeTree([
      decl,
      valueDecl('main', []),
      valueDecl('helper', ['x']),
      typeDecl('Model'),
    ])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(result.exports).toContain('main')
    expect(result.exports).toContain('helper')
    expect(result.exports).toContain('Model')
  })

  it('Test 11: file path is normalized to forward slashes', () => {
    const tree = makeTree([])
    const result = elmAdapter.extractFacts(tree, 'C:\\Users\\foo\\Main.elm')
    expect(result.file).toBe('C:/Users/foo/Main.elm')
  })

  it('Test 12: language is set to elm', () => {
    const tree = makeTree([])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(result.language).toBe('elm')
  })

  it('inferTechStack: Browser import → Elm/Browser', () => {
    const tree = makeTree([importClause('Browser')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(elmAdapter.inferTechStack([result])).toBe('Elm/Browser')
  })

  it('inferTechStack: SPA import → Elm/SPA', () => {
    const tree = makeTree([importClause('Spa')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(elmAdapter.inferTechStack([result])).toBe('Elm/SPA')
  })

  it('inferTechStack: plain Elm (no known framework) → Elm', () => {
    const tree = makeTree([importClause('Html')])
    const result = elmAdapter.extractFacts(tree, '/fake/Main.elm')
    expect(elmAdapter.inferTechStack([result])).toBe('Elm')
  })
})
