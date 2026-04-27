/**
 * Tests for src/lib/ingest/languages/nim.ts
 *
 * nim.wasm is absent in this repo, so loadParser() is expected to throw.
 * All extraction tests work against synthetic SyntaxNode mock trees that
 * mimic what tree-sitter-nim would produce.
 */

import { describe, expect, it } from 'vitest'
import { nimAdapter } from '../../../../src/lib/ingest/languages/nim'
import type Parser from 'web-tree-sitter'

// ---------------------------------------------------------------------------
// Helpers: build a minimal fake SyntaxNode tree
// ---------------------------------------------------------------------------

type FakeNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  children: FakeNode[]
  namedChildren: FakeNode[]
  namedChild: (idx: number) => FakeNode | null
  childCount: number
}

function fakeNode(
  type: string,
  text: string,
  children: FakeNode[] = [],
  row = 0,
): FakeNode {
  const named = children.filter((c) => c.type !== '*' && c.type !== ',')
  return {
    type,
    text,
    startPosition: { row, column: 0 },
    endPosition: { row, column: text.length },
    children,
    namedChildren: named,
    namedChild: (idx: number) => named[idx] ?? null,
    childCount: children.length,
  }
}

function id(name: string, row = 0): FakeNode {
  return fakeNode('identifier', name, [], row)
}

function star(): FakeNode {
  return fakeNode('*', '*', [], 0)
}

function makeTree(children: FakeNode[]): Parser.Tree {
  const root = fakeNode('source_file', '', children)
  root.namedChildren = children
  return { rootNode: root as unknown as Parser.SyntaxNode } as unknown as Parser.Tree
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('nimAdapter', () => {
  it('Test 1: loadParser() throws when nim.wasm is absent', async () => {
    await expect(nimAdapter.loadParser()).rejects.toThrow(/tree-sitter-nim\.wasm not found/i)
  })

  it('Test 2: import_statement → ParsedImport entries', () => {
    const importNode = fakeNode('import_statement', 'import os, strutils', [
      id('os'),
      id('strutils'),
    ], 0)
    const tree = makeTree([importNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    expect(result.imports.length).toBeGreaterThanOrEqual(2)
    const froms = result.imports.map((i) => i.from)
    expect(froms).toContain('os')
    expect(froms).toContain('strutils')
  })

  it('Test 3: type_declaration without * → class, not exported', () => {
    const typeNode = fakeNode('type_declaration', 'type Animal = object', [
      id('Animal'),
    ], 2)
    const tree = makeTree([typeNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    const cls = result.symbols.find((s) => s.name === 'Animal')
    expect(cls).toBeDefined()
    expect(cls?.kind).toBe('class')
    expect(cls?.exported).toBe(false)
    expect(result.exports).not.toContain('Animal')
  })

  it('Test 4: type_declaration with * export marker → exported class', () => {
    // proc Foo*() in Nim — star after identifier
    const typeNode = fakeNode('type_declaration', 'type Foo* = object', [
      id('Foo'),
      star(),
    ], 4)
    const tree = makeTree([typeNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    const cls = result.symbols.find((s) => s.name === 'Foo')
    expect(cls).toBeDefined()
    expect(cls?.exported).toBe(true)
    expect(result.exports).toContain('Foo')
  })

  it('Test 5: proc_declaration top-level without * → function, not exported', () => {
    const procNode = fakeNode('proc_declaration', 'proc helper() = discard', [
      id('helper'),
    ], 6)
    const tree = makeTree([procNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    const fn = result.symbols.find((s) => s.name === 'helper')
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
    expect(fn?.exported).toBe(false)
  })

  it('Test 6: proc_declaration with * → exported function', () => {
    const procNode = fakeNode('proc_declaration', 'proc run*() = discard', [
      id('run'),
      star(),
    ], 8)
    const tree = makeTree([procNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    const fn = result.symbols.find((s) => s.name === 'run')
    expect(fn).toBeDefined()
    expect(fn?.exported).toBe(true)
    expect(result.exports).toContain('run')
  })

  it('Test 7: proc nested inside type_declaration → function with parentClass', () => {
    const procNode = fakeNode('proc_declaration', 'proc speak() = discard', [
      id('speak'),
    ], 11)
    const typeNode = fakeNode('type_declaration', 'type Dog = object', [
      id('Dog'),
      procNode,
    ], 10)
    const tree = makeTree([typeNode])
    const result = nimAdapter.extractFacts(tree, '/fake/main.nim')
    const speak = result.symbols.find((s) => s.name === 'speak') as
      | (typeof result.symbols[0] & { attributes?: { parentClass?: string } })
      | undefined
    expect(speak).toBeDefined()
    expect(speak?.kind).toBe('function')
    expect(speak?.attributes?.parentClass).toBe('Dog')
  })

  it('Test 8: adapter metadata — id, fileExtensions', () => {
    expect(nimAdapter.id).toBe('nim')
    expect(nimAdapter.fileExtensions).toContain('.nim')
  })

  it('Test 9: inferTechStack — nimble import → Nim/Nimble', () => {
    const facts = [
      {
        file: 'main.nim',
        imports: [{ from: 'nimble', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'nim' as const,
      },
    ]
    const stack = nimAdapter.inferTechStack(facts)
    expect(stack).toBe('Nim/Nimble')
  })

  it('Test 10: inferTechStack — no nimble → Nim', () => {
    const facts = [
      {
        file: 'main.nim',
        imports: [{ from: 'os', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'nim' as const,
      },
    ]
    const stack = nimAdapter.inferTechStack(facts)
    expect(stack).toBe('Nim')
  })
})
