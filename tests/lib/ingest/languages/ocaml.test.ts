import { describe, it, expect } from 'vitest'
import { ocamlAdapter } from '../../../../src/lib/ingest/languages/ocaml'

async function parse(source: string, file = '/fake/main.ml') {
  const parser = await ocamlAdapter.loadParser()
  const tree = parser.parse(source)
  const result = ocamlAdapter.extractFacts(tree, file)
  tree.delete()
  return result
}

describe('ocamlAdapter', () => {
  it('Test 1: open directive → ParsedImport', async () => {
    const result = await parse('open Printf\n')
    expect(result.imports.map((i) => i.from)).toContain('Printf')
  })

  it('Test 2: include directive → ParsedImport', async () => {
    const result = await parse('include Base\n')
    expect(result.imports.map((i) => i.from)).toContain('Base')
  })

  it('Test 3: multiple open directives → multiple imports', async () => {
    const result = await parse('open Printf\nopen Stdlib\n')
    const froms = result.imports.map((i) => i.from)
    expect(froms).toContain('Printf')
    expect(froms).toContain('Stdlib')
  })

  it('Test 4: module_definition → class symbol, exported', async () => {
    const result = await parse('module M = struct\n  let x = 1\nend\n')
    const mod = result.symbols.find((s) => s.name === 'M')
    expect(mod).toBeDefined()
    expect(mod?.kind).toBe('class')
    expect(mod?.exported).toBe(true)
    expect(result.exports).toContain('M')
  })

  it('Test 5: type_definition → class symbol, exported', async () => {
    const result = await parse('type color = Red | Green | Blue\n')
    const typ = result.symbols.find((s) => s.name === 'color')
    expect(typ).toBeDefined()
    expect(typ?.kind).toBe('class')
    expect(result.exports).toContain('color')
  })

  it('Test 6: value_definition with parameters → function, exported', async () => {
    const result = await parse('let add x y = x + y\n')
    const fn = result.symbols.find((s) => s.name === 'add')
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
    expect(fn?.exported).toBe(true)
    expect(result.exports).toContain('add')
  })

  it('Test 7: value_definition without parameters → const, exported', async () => {
    const result = await parse('let myConst = 42\n')
    const c = result.symbols.find((s) => s.name === 'myConst')
    expect(c).toBeDefined()
    expect(c?.kind).toBe('const')
    expect(c?.exported).toBe(true)
  })

  it('Test 8: record type_definition → class symbol', async () => {
    const result = await parse('type point = { x: int; y: int }\n')
    const pt = result.symbols.find((s) => s.name === 'point')
    expect(pt).toBeDefined()
    expect(pt?.kind).toBe('class')
  })

  it('Test 9: multiple top-level declarations extracted correctly', async () => {
    const src = 'open Printf\ntype t = int\nlet run () = ()\nlet n = 1\n'
    const result = await parse(src)
    expect(result.imports).toHaveLength(1)
    const kinds = result.symbols.map((s) => s.kind)
    expect(kinds).toContain('class')    // type t
    expect(kinds).toContain('function') // let run ()
    expect(kinds).toContain('const')    // let n
  })

  it('Test 10: adapter id and fileExtensions', () => {
    expect(ocamlAdapter.id).toBe('ocaml')
    expect(ocamlAdapter.fileExtensions).toContain('.ml')
    expect(ocamlAdapter.fileExtensions).toContain('.mli')
  })

  it('Test 11: inferTechStack — Core import → OCaml/Jane Street', () => {
    const facts = [
      {
        file: 'main.ml',
        imports: [{ from: 'Core', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'ocaml' as const,
      },
    ]
    expect(ocamlAdapter.inferTechStack(facts)).toBe('OCaml/Jane Street')
  })

  it('Test 12: inferTechStack — Lwt import → OCaml/Lwt', () => {
    const facts = [
      {
        file: 'main.ml',
        imports: [{ from: 'Lwt', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'ocaml' as const,
      },
    ]
    expect(ocamlAdapter.inferTechStack(facts)).toBe('OCaml/Lwt')
  })

  it('Test 13: inferTechStack — stdlib → OCaml default', () => {
    const facts = [
      {
        file: 'main.ml',
        imports: [{ from: 'Printf', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'ocaml' as const,
      },
    ]
    expect(ocamlAdapter.inferTechStack(facts)).toBe('OCaml')
  })
})
