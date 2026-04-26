/**
 * C++ adapter tests — Phase 3 / lang-cpp.
 *
 * Each test parses an inline C++ source string via cppAdapter.loadParser()
 * + extractFacts(). No fixture files needed.
 */

import { describe, it, expect } from 'vitest'
import { cppAdapter } from '../../../../src/lib/ingest/languages/cpp'
import type { CppParsedSymbol } from '../../../../src/lib/ingest/languages/cpp'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await cppAdapter.loadParser()
  const tree = parser.parse(source)
  const result = cppAdapter.extractFacts(tree, '/fake/main.cpp')
  tree.delete()
  return result
}

describe('cppAdapter', () => {
  // ---- Symbol kinds ---------------------------------------------------------

  it('Test 1: class_specifier → 1 class fact', async () => {
    const src = `class Foo {\npublic:\n  int x;\n};\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
  })

  it('Test 2: struct_specifier → SymbolKind class', async () => {
    const src = `struct Point { float x; float y; };\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Point')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  it('Test 3: union_specifier → SymbolKind class', async () => {
    const src = `union Data { int i; float f; };\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Data')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  it('Test 4: enum_specifier → SymbolKind class', async () => {
    const src = `enum Color { Red, Green, Blue };\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Color')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  it('Test 5: top-level function_definition → SymbolKind function, exported', async () => {
    const src = `int add(int a, int b) { return a + b; }\n`
    const result = await parse(src)
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('add')
    expect(result.exports).toContain('add')
  })

  it('Test 6: method inside class body → function with parentClass attribute', async () => {
    const src = `class MyClass {\npublic:\n  void greet() { }\n};\n`
    const result = await parse(src)
    const greet = result.symbols.find((s) => s.name === 'greet') as CppParsedSymbol | undefined
    expect(greet).toBeDefined()
    expect(greet?.kind).toBe('function')
    expect(greet?.attributes?.parentClass).toBe('MyClass')
  })

  it('Test 7: namespace_definition → SymbolKind class', async () => {
    const src = `namespace utils {\nvoid helper() {}\n}\n`
    const result = await parse(src)
    const ns = result.symbols.find((s) => s.name === 'utils')
    expect(ns).toBeDefined()
    expect(ns?.kind).toBe('class')
  })

  it('Test 8: template_declaration wrapping function → unwrapped as function', async () => {
    const src = `template<typename T>\nT identity(T v) { return v; }\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'identity')
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
  })

  it('Test 9: template_declaration wrapping class → unwrapped as class', async () => {
    const src = `template<typename T>\nclass Stack {\npublic:\n  T top;\n};\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Stack')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  // ---- Visibility -----------------------------------------------------------

  it('Test 10: name starting with _ is NOT exported', async () => {
    const src = `void _internal() {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('_internal')
  })

  it('Test 11: regular top-level name IS exported', async () => {
    const src = `class Engine {};\n`
    const result = await parse(src)
    expect(result.exports).toContain('Engine')
  })

  // ---- Includes -------------------------------------------------------------

  it('Test 12: #include <vector> → ParsedImport with from="vector"', async () => {
    const src = `#include <vector>\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === 'vector')
    expect(imp).toBeDefined()
  })

  it('Test 13: #include "foo.h" → ParsedImport with from="foo.h"', async () => {
    const src = `#include "foo.h"\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === 'foo.h')
    expect(imp).toBeDefined()
  })

  // ---- inferTechStack -------------------------------------------------------

  it('inferTechStack → C++/Qt for QtWidgets include', async () => {
    const src = `#include <QtWidgets/QApplication>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++/Qt')
  })

  it('inferTechStack → C++/Boost for boost/ include', async () => {
    const src = `#include <boost/algorithm/string.hpp>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++/Boost')
  })

  it('inferTechStack → C++/OpenCV for opencv include', async () => {
    const src = `#include <opencv2/core.hpp>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++/OpenCV')
  })

  it('inferTechStack → C++/Eigen for Eigen include', async () => {
    const src = `#include <Eigen/Dense>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++/Eigen')
  })

  it('inferTechStack → C++/GoogleTest for gtest include', async () => {
    const src = `#include <gtest/gtest.h>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++/GoogleTest')
  })

  it('inferTechStack → plain C++ for stdlib-only includes', async () => {
    const src = `#include <iostream>\n#include <string>\n`
    const result = await parse(src)
    expect(cppAdapter.inferTechStack([result])).toBe('C++')
  })
})
