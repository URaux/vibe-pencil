import { describe, it, expect, beforeAll } from 'vitest'
import { jsonConfigAdapter, detectJsonFileType } from '@/lib/ingest/languages/json-config'
import type { JsonParsedSymbol } from '@/lib/ingest/languages/json-config'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import type Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await jsonConfigAdapter.loadParser()
    parserAvailable = true
  } catch {
    parserAvailable = false
  }
})

const maybeIt = parserAvailable ? it : it.skip

function parse(src: string) {
  return sharedParser!.parse(src)
}

function makeFact(exports: string[]): FactInputModule {
  return { file: 'pkg.json', imports: [], exports, symbols: [], language: 'json' }
}

// ---------------------------------------------------------------------------
// detectJsonFileType
// ---------------------------------------------------------------------------

describe('detectJsonFileType', () => {
  it('package.json → project-config', () => {
    expect(detectJsonFileType('package.json')).toBe('project-config')
    expect(detectJsonFileType('/repo/package.json')).toBe('project-config')
  })

  it('tsconfig.json → ts-config', () => {
    expect(detectJsonFileType('tsconfig.json')).toBe('ts-config')
    expect(detectJsonFileType('tsconfig.base.json')).toBe('ts-config')
  })

  it('.eslintrc.json → lint-config', () => {
    expect(detectJsonFileType('.eslintrc.json')).toBe('lint-config')
  })

  it('.prettierrc.json → lint-config', () => {
    expect(detectJsonFileType('.prettierrc.json')).toBe('lint-config')
  })

  it('jest.config.json → test-config', () => {
    expect(detectJsonFileType('jest.config.json')).toBe('test-config')
  })

  it('schema.json → json-schema', () => {
    expect(detectJsonFileType('api.schema.json')).toBe('json-schema')
  })

  it('other.json → json-data', () => {
    expect(detectJsonFileType('other.json')).toBe('json-data')
  })
})

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('jsonConfigAdapter metadata', () => {
  it('has id json', () => expect(jsonConfigAdapter.id).toBe('json'))
  it('has .json extension', () => expect(jsonConfigAdapter.fileExtensions).toContain('.json'))

  it('inferTechStack: Next.js when next export present', () => {
    expect(jsonConfigAdapter.inferTechStack([makeFact(['next'])])).toBe('Next.js')
  })

  it('inferTechStack: React when react export present', () => {
    expect(jsonConfigAdapter.inferTechStack([makeFact(['react'])])).toBe('React')
  })

  it('inferTechStack: Node/Fastify when fastify present', () => {
    expect(jsonConfigAdapter.inferTechStack([makeFact(['fastify'])])).toBe('Node/Fastify')
  })

  it('inferTechStack: Node/Config default', () => {
    expect(jsonConfigAdapter.inferTechStack([makeFact([])])).toBe('Node/Config')
  })
})

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('jsonConfigAdapter parser', () => {
  maybeIt('extracts top-level keys as const symbols', () => {
    const src = '{"name": "my-pkg", "version": "1.0.0", "private": true}'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'package.json')
    const names = facts.symbols.map((s) => s.name)
    expect(names).toContain('name')
    expect(names).toContain('version')
    expect(names).toContain('private')
  })

  maybeIt('all symbols have kind const', () => {
    const src = '{"scripts": {}, "dependencies": {}}'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'package.json')
    expect(facts.symbols.every((s) => s.kind === 'const')).toBe(true)
  })

  maybeIt('all top-level symbols are exported', () => {
    const src = '{"foo": 1, "bar": 2}'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'config.json')
    const syms = facts.symbols as JsonParsedSymbol[]
    expect(syms.every((s) => s.exported)).toBe(true)
    expect(facts.exports).toContain('foo')
    expect(facts.exports).toContain('bar')
  })

  maybeIt('empty object produces no symbols', () => {
    const src = '{}'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'empty.json')
    expect(facts.symbols).toHaveLength(0)
    expect(facts.exports).toHaveLength(0)
  })

  maybeIt('file path normalized to forward slashes', () => {
    const src = '{"key": 1}'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'config\\settings.json')
    expect(facts.file).not.toContain('\\')
  })

  maybeIt('non-object root (array) produces no symbols', () => {
    const src = '[1, 2, 3]'
    const facts = jsonConfigAdapter.extractFacts(parse(src), 'array.json')
    expect(facts.symbols).toHaveLength(0)
  })
})
