import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  parseTreeSitterFile,
  detectLanguage,
  LANGUAGE_EXTENSIONS,
  UnsupportedLanguageError,
} from '../../../src/lib/ingest/ast-treesitter'

/**
 * W2.D2 — real tree-sitter parser tests.
 *
 * Loads one fixture per language and asserts the extracted imports /
 * exports / symbols contain the declarations written in the fixture.
 */

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/ast-treesitter')

async function loadFixture(name: string): Promise<{ filePath: string; source: string }> {
  const filePath = path.join(FIXTURES_DIR, name)
  const source = await readFile(filePath, 'utf8')
  return { filePath, source }
}

describe('ast-treesitter', () => {
  describe('detectLanguage', () => {
    it('maps TS/JS family correctly', () => {
      expect(detectLanguage('foo.ts')).toBe('typescript')
      expect(detectLanguage('foo.tsx')).toBe('tsx')
      expect(detectLanguage('foo.js')).toBe('javascript')
      expect(detectLanguage('foo.jsx')).toBe('jsx')
      expect(detectLanguage('foo.mjs')).toBe('javascript')
      expect(detectLanguage('foo.cjs')).toBe('javascript')
    })

    it('maps Python and Go', () => {
      expect(detectLanguage('foo.py')).toBe('python')
      expect(detectLanguage('foo.pyi')).toBe('python')
      expect(detectLanguage('foo.go')).toBe('go')
    })

    it('handles case-insensitive extensions and absolute paths', () => {
      expect(detectLanguage('C:/proj/Foo.TS')).toBe('typescript')
      expect(detectLanguage('/abs/path/Bar.JSX')).toBe('jsx')
      expect(detectLanguage('/abs/path/Snake.PY')).toBe('python')
    })

    it('returns undefined for .d.ts declaration files', () => {
      expect(detectLanguage('types.d.ts')).toBeUndefined()
    })

    it('returns undefined for unsupported extensions', () => {
      expect(detectLanguage('README.md')).toBeUndefined()
      expect(detectLanguage('no-extension')).toBeUndefined()
      expect(detectLanguage('foo.rs')).toBeUndefined()
    })

    it('exposes a readable LANGUAGE_EXTENSIONS map', () => {
      expect(LANGUAGE_EXTENSIONS['.ts']).toBe('typescript')
      expect(LANGUAGE_EXTENSIONS['.tsx']).toBe('tsx')
      expect(LANGUAGE_EXTENSIONS['.js']).toBe('javascript')
      expect(LANGUAGE_EXTENSIONS['.jsx']).toBe('jsx')
      expect(LANGUAGE_EXTENSIONS['.py']).toBe('python')
      expect(LANGUAGE_EXTENSIONS['.go']).toBe('go')
    })
  })

  describe('parseTreeSitterFile — shape invariants', () => {
    it('normalizes Windows backslash paths to forward slashes', async () => {
      const { source } = await loadFixture('sample.ts')
      const result = await parseTreeSitterFile('C:\\fake\\src\\bar.tsx', source)
      expect(result.file).toBe('C:/fake/src/bar.tsx')
      expect(result.language).toBe('tsx')
      expect(Array.isArray(result.imports)).toBe(true)
      expect(Array.isArray(result.exports)).toBe(true)
      expect(Array.isArray(result.symbols)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('throws UnsupportedLanguageError for unsupported extensions', async () => {
      await expect(
        parseTreeSitterFile('foo.rs', 'fn main() {}'),
      ).rejects.toThrow(UnsupportedLanguageError)
    })
  })

  describe('TypeScript fixture', () => {
    it('extracts imports, exports, and top-level symbols', async () => {
      const { filePath, source } = await loadFixture('sample.ts')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('typescript')
      const fromValues = r.imports.map((i) => i.from)
      expect(fromValues).toContain('node:fs/promises')
      expect(fromValues).toContain('node:path')
      expect(fromValues).toContain('./helpers')

      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining([
        'GREETING', 'counter', 'greet', 'Logger', 'Config', 'Handler',
      ]))

      expect(r.symbols.find((s) => s.name === 'Logger')?.kind).toBe('class')
      expect(r.symbols.find((s) => s.name === 'greet')?.kind).toBe('function')
      expect(r.symbols.find((s) => s.name === 'Config')?.kind).toBe('interface')
      expect(r.symbols.find((s) => s.name === 'Handler')?.kind).toBe('type')

      expect(r.exports).toEqual(expect.arrayContaining([
        'GREETING', 'greet', 'Logger', 'Config', 'Handler', 'default',
      ]))
    })
  })

  describe('TSX fixture', () => {
    it('extracts React component imports and exports', async () => {
      const { filePath, source } = await loadFixture('sample.tsx')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('tsx')
      expect(r.imports.map((i) => i.from)).toContain('react')
      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining(['Button', 'Panel', 'ButtonProps']))
      expect(r.exports).toContain('default')
    })
  })

  describe('JavaScript fixture', () => {
    it('extracts imports, exports, and symbols', async () => {
      const { filePath, source } = await loadFixture('sample.js')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('javascript')
      const fromValues = r.imports.map((i) => i.from)
      expect(fromValues).toContain('node:fs')
      expect(fromValues).toContain('node:path')

      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining(['VERSION', 'readConfig', 'Store']))
      expect(r.symbols.find((s) => s.name === 'Store')?.kind).toBe('class')
      expect(r.symbols.find((s) => s.name === 'readConfig')?.kind).toBe('function')
      expect(r.exports).toContain('default')
    })
  })

  describe('JSX fixture', () => {
    it('extracts React component imports and exports', async () => {
      const { filePath, source } = await loadFixture('sample.jsx')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('jsx')
      expect(r.imports.map((i) => i.from)).toContain('react')
      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining(['Title', 'Layout']))
      expect(r.exports).toContain('default')
    })
  })

  describe('Python fixture', () => {
    it('extracts imports, exports (public names), and symbols', async () => {
      const { filePath, source } = await loadFixture('sample.py')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('python')
      const fromValues = r.imports.map((i) => i.from)
      expect(fromValues).toContain('os')
      expect(fromValues).toContain('sys')
      expect(fromValues).toContain('pathlib')
      expect(fromValues).toContain('typing')

      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining([
        'GREETING', 'greet', 'fetch_config', 'Logger',
      ]))
      expect(r.symbols.find((s) => s.name === 'Logger')?.kind).toBe('class')
      expect(r.symbols.find((s) => s.name === 'greet')?.kind).toBe('function')

      // Python "exports": public (non-underscore) module-level names.
      expect(r.exports).toEqual(expect.arrayContaining([
        'GREETING', 'greet', 'fetch_config', 'Logger',
      ]))
      expect(r.exports).not.toContain('_private')
      expect(r.exports).not.toContain('_Hidden')
    })
  })

  describe('Go fixture', () => {
    it('extracts imports, exports (capitalized names), and symbols', async () => {
      const { filePath, source } = await loadFixture('sample.go')
      const r = await parseTreeSitterFile(filePath, source)

      expect(r.language).toBe('go')
      const fromValues = r.imports.map((i) => i.from)
      expect(fromValues).toContain('fmt')
      expect(fromValues).toContain('os')
      expect(fromValues).toContain('strings')

      const names = r.symbols.map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining([
        'Version', 'Counter', 'Config', 'Handler', 'Greet',
      ]))
      expect(r.symbols.find((s) => s.name === 'Greet')?.kind).toBe('function')
      expect(r.symbols.find((s) => s.name === 'Config')?.kind).toBe('class')
      expect(r.symbols.find((s) => s.name === 'Handler')?.kind).toBe('type')

      // Go "exports": capitalized identifiers.
      expect(r.exports).toEqual(expect.arrayContaining([
        'Version', 'Counter', 'Config', 'Handler', 'Greet',
      ]))
      expect(r.exports).not.toContain('internalTag')
      expect(r.exports).not.toContain('logger')
      expect(r.exports).not.toContain('privateHelper')
    })
  })
})
