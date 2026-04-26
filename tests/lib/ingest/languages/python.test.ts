/**
 * Python adapter tests — W2.D2.
 *
 * Each test parses an inline Python source string via pythonAdapter.loadParser()
 * + extractFacts(). No fixture files needed.
 */

import { describe, it, expect } from 'vitest'
import Parser from 'web-tree-sitter'
import { pythonAdapter } from '../../../../src/lib/ingest/languages/python'
import type { PythonParsedSymbol } from '../../../../src/lib/ingest/languages/python'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

// ---------------------------------------------------------------------------
// Helper: parse a Python source string through the adapter
// ---------------------------------------------------------------------------

async function parse(source: string): Promise<FactInputModule> {
  const parser = await pythonAdapter.loadParser()
  const tree = parser.parse(source)
  const result = pythonAdapter.extractFacts(tree, '/fake/module.py')
  tree.delete()
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pythonAdapter', () => {
  it('Test 1: class_definition → 1 class fact named Foo', async () => {
    const result = await parse('class Foo:\n    pass\n')
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
  })

  it('Test 2: top-level def bar() → 1 function fact, NOT a method', async () => {
    const result = await parse('def bar():\n    pass\n')
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('bar')
    // Must not carry a parentClass attribute
    const sym = fns[0] as PythonParsedSymbol
    expect(sym.attributes?.parentClass).toBeUndefined()
  })

  it('Test 3: class Foo with method baz → 1 class + 1 method attached to Foo', async () => {
    const src = 'class Foo:\n    def baz(self):\n        pass\n'
    const result = await parse(src)

    const classSyms = result.symbols.filter((s) => s.kind === 'class')
    expect(classSyms).toHaveLength(1)
    expect(classSyms[0].name).toBe('Foo')

    const methodSyms = result.symbols.filter(
      (s) => s.kind === 'function' && (s as PythonParsedSymbol).attributes?.parentClass === 'Foo',
    )
    expect(methodSyms).toHaveLength(1)
    expect(methodSyms[0].name).toBe('baz')
  })

  it('Test 4: from fastapi import FastAPI → import fact + inferTechStack returns Python/FastAPI', async () => {
    const src = 'from fastapi import FastAPI\n'
    const result = await parse(src)

    const importFact = result.imports.find((i) => i.from === 'fastapi')
    expect(importFact).toBeDefined()
    expect(importFact?.names).toContain('FastAPI')

    const stack = pythonAdapter.inferTechStack([result])
    expect(stack).toBe('Python/FastAPI')
  })

  it('Test 5: decorated function → function fact with decorators attribute', async () => {
    const src = '@app.get("/")\ndef root():\n    pass\n'
    const result = await parse(src)

    const fn = result.symbols.find((s) => s.name === 'root') as PythonParsedSymbol | undefined
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
    const decorators = fn?.attributes?.decorators ?? []
    expect(decorators.length).toBeGreaterThan(0)
    // The decorator text should start with '@'
    expect(decorators[0]).toMatch(/^@/)
    expect(decorators[0]).toContain('app.get')
  })

  it('inferTechStack returns Python/Django for django import', async () => {
    const result = await parse('import django\n')
    expect(pythonAdapter.inferTechStack([result])).toBe('Python/Django')
  })

  it('inferTechStack returns Python/Flask for flask import', async () => {
    const result = await parse('from flask import Flask\n')
    expect(pythonAdapter.inferTechStack([result])).toBe('Python/Flask')
  })

  it('inferTechStack returns plain Python when no known framework', async () => {
    const result = await parse('import os\nimport sys\n')
    expect(pythonAdapter.inferTechStack([result])).toBe('Python')
  })
})
