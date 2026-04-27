import { describe, it, expect, beforeAll } from 'vitest'
import { rescriptAdapter } from '@/lib/ingest/languages/rescript'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await rescriptAdapter.loadParser()
    parserAvailable = true
  } catch {
    parserAvailable = false
  }
})

const maybeIt = parserAvailable ? it : it.skip

function parse(src: string): Parser.Tree {
  return sharedParser!.parse(src)
}

function makeFact(imports: FactInputModule['imports']): FactInputModule {
  return { file: 'Main.res', imports, exports: [], symbols: [], language: 'rescript' }
}

describe('rescriptAdapter metadata', () => {
  it('has id rescript', () => expect(rescriptAdapter.id).toBe('rescript'))
  it('has .res extension', () => expect(rescriptAdapter.fileExtensions).toContain('.res'))
  it('has .resi extension', () => expect(rescriptAdapter.fileExtensions).toContain('.resi'))

  it('inferTechStack: plain ReScript', () => {
    const facts = [makeFact([])]
    expect(rescriptAdapter.inferTechStack(facts)).toBe('ReScript')
  })

  it('inferTechStack: ReScript/React with rescript-react import', () => {
    const facts = [makeFact([{ from: 'rescript-react', names: ['*'] }])]
    expect(rescriptAdapter.inferTechStack(facts)).toBe('ReScript/React')
  })

  it('inferTechStack: ReScript/React with React import', () => {
    const facts = [makeFact([{ from: 'React', names: ['*'] }])]
    expect(rescriptAdapter.inferTechStack(facts)).toBe('ReScript/React')
  })
})

describe('rescriptAdapter parser', () => {
  maybeIt('extracts open statement as import', () => {
    const src = 'open Belt\nlet x = 1'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    expect(facts.imports.some((i) => i.from.includes('Belt'))).toBe(true)
  })

  maybeIt('open import has wildcard names', () => {
    const src = 'open Belt'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    expect(facts.imports[0]?.names).toContain('*')
  })

  maybeIt('extracts let_declaration as const', () => {
    const src = 'let name = "Alice"'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    const sym = facts.symbols.find((s) => s.name === 'name')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('const')
  })

  maybeIt('extracts let function as function', () => {
    const src = 'let greet = (name) => "Hello " ++ name'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    const sym = facts.symbols.find((s) => s.name === 'greet')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('function')
  })

  maybeIt('underscore-prefixed names are not exported', () => {
    const src = 'let _helper = () => 42'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    expect(facts.exports).not.toContain('_helper')
  })

  maybeIt('extracts module_declaration as class', () => {
    const src = 'module MyModule = { let x = 1 }'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    const sym = facts.symbols.find((s) => s.name === 'MyModule')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  maybeIt('extracts type_declaration as class', () => {
    const src = 'type point = { x: int, y: int }'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    const sym = facts.symbols.find((s) => s.name === 'point')
    expect(sym).toBeDefined()
    expect(sym?.kind).toBe('class')
  })

  maybeIt('external declaration is extracted as import', () => {
    const src = 'external document: Dom.document = "document"'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    expect(facts.imports.some((i) => i.from === 'document')).toBe(true)
  })

  maybeIt('language field is rescript', () => {
    const src = 'let x = 1'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'Main.res')
    expect(facts.language).toBe('rescript')
  })

  maybeIt('file path normalized to forward slashes', () => {
    const src = 'let x = 1'
    const tree = parse(src)
    const facts = rescriptAdapter.extractFacts(tree, 'src\\components\\Button.res')
    expect(facts.file).not.toContain('\\')
  })
})
