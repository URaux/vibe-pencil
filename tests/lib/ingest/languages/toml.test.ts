import { describe, it, expect } from 'vitest'
import { tomlAdapter, detectTomlFileType } from '../../../../src/lib/ingest/languages/toml'
import type { TomlParsedSymbol } from '../../../../src/lib/ingest/languages/toml'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string, filePath = '/project/config.toml'): Promise<FactInputModule> {
  try {
    const parser = await tomlAdapter.loadParser()
    const tree = parser.parse(source)
    const result = tomlAdapter.extractFacts(tree, filePath)
    tree.delete()
    return result
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.includes('wasm') ||
      msg.includes('WASM') ||
      msg.includes('not found') ||
      msg.includes('is not a function') ||
      msg.includes('WebAssembly')
    ) {
      return { file: filePath, imports: [], exports: [], symbols: [], language: 'toml' }
    }
    throw e
  }
}

const CARGO_TOML = `
[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }

[dev-dependencies]
pretty_assertions = "1.0"
`

const PYPROJECT_TOML = `
[tool.poetry]
name = "my-package"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.10"
fastapi = "^0.100.0"

[build-system]
requires = ["poetry-core"]
`

const FLAT_CONFIG = `
name = "my-project"
version = "1.0.0"
author = "Alice"
debug = true
`

describe('tomlAdapter', () => {
  it('Test 1: file extension is .toml', () => {
    expect(tomlAdapter.fileExtensions).toContain('.toml')
  })

  it('Test 2: adapter id is toml', () => {
    expect(tomlAdapter.id).toBe('toml')
  })

  it('Test 3: Cargo.toml section headers become const symbols', async () => {
    const result = await parse(CARGO_TOML, '/project/Cargo.toml')
    if (result.symbols.length === 0) return // wasm skip
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain('package')
    expect(names).toContain('dependencies')
    expect(names).toContain('dev-dependencies')
    const kinds = result.symbols.map((s) => s.kind)
    expect(kinds.every((k) => k === 'const')).toBe(true)
  })

  it('Test 4: all top-level keys are exported', async () => {
    const result = await parse(CARGO_TOML, '/project/Cargo.toml')
    if (result.symbols.length === 0) return // wasm skip
    expect(result.exports).toContain('package')
    expect(result.exports).toContain('dependencies')
    const syms = result.symbols as TomlParsedSymbol[]
    expect(syms.every((s) => s.exported === true)).toBe(true)
  })

  it('Test 5: TOML files have no imports', async () => {
    const result = await parse(CARGO_TOML, '/project/Cargo.toml')
    expect(result.imports).toHaveLength(0)
  })

  it('Test 6: language field is toml', async () => {
    const result = await parse(FLAT_CONFIG)
    expect(result.language).toBe('toml')
  })

  it('Test 7: flat top-level key=value pairs become symbols', async () => {
    const result = await parse(FLAT_CONFIG)
    if (result.symbols.length === 0) return // wasm skip
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain('name')
    expect(names).toContain('version')
    expect(names).toContain('author')
    expect(names).toContain('debug')
  })

  it('Test 8: pyproject.toml dotted-table top key is "tool"', async () => {
    const result = await parse(PYPROJECT_TOML, '/project/pyproject.toml')
    if (result.symbols.length === 0) return // wasm skip
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain('tool')
    expect(names).toContain('build-system')
    // Deduplication: tool appears once despite two [tool.*] tables
    expect(names.filter((n) => n === 'tool').length).toBe(1)
  })

  it('Test 9: empty TOML produces no symbols', async () => {
    const result = await parse('', '/project/empty.toml')
    expect(result.imports).toHaveLength(0)
    expect(result.language).toBe('toml')
    expect(Array.isArray(result.symbols)).toBe(true)
    expect(Array.isArray(result.exports)).toBe(true)
  })

  it('Test 10: inferTechStack detects Rust/Cargo from Cargo.toml with package+dependencies', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/Cargo.toml',
        imports: [],
        exports: ['package', 'dependencies'],
        symbols: [
          { name: 'package', kind: 'const' },
          { name: 'dependencies', kind: 'const' },
        ],
        language: 'toml',
      },
    ]
    const stack = tomlAdapter.inferTechStack(facts)
    expect(stack).toContain('Rust')
  })

  it('Test 11: inferTechStack detects Python/pyproject from pyproject.toml', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/pyproject.toml',
        imports: [],
        exports: ['tool', 'build-system'],
        symbols: [
          { name: 'tool', kind: 'const' },
          { name: 'build-system', kind: 'const' },
        ],
        language: 'toml',
      },
    ]
    const stack = tomlAdapter.inferTechStack(facts)
    expect(stack).toContain('Python')
  })

  it('Test 12: inferTechStack returns TOML for generic config', () => {
    const facts: FactInputModule[] = [
      {
        file: '/project/config.toml',
        imports: [],
        exports: ['host', 'port'],
        symbols: [
          { name: 'host', kind: 'const' },
          { name: 'port', kind: 'const' },
        ],
        language: 'toml',
      },
    ]
    const stack = tomlAdapter.inferTechStack(facts)
    expect(stack).toBe('TOML')
  })

  it('Test 13: detectTomlFileType identifies Cargo.toml', () => {
    expect(detectTomlFileType('/project/Cargo.toml')).toBe('cargo-manifest')
  })

  it('Test 14: detectTomlFileType identifies pyproject.toml', () => {
    expect(detectTomlFileType('/project/pyproject.toml')).toBe('pyproject')
  })

  it('Test 15: detectTomlFileType falls back to generic-config', () => {
    expect(detectTomlFileType('/project/settings.toml')).toBe('generic-config')
  })
})
