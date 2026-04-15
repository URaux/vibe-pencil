import { describe, it, expect } from 'vitest'
import {
  parseTreeSitterFile,
  detectLanguage,
  LANGUAGE_EXTENSIONS,
  TreeSitterNotImplementedError,
  UnsupportedLanguageError,
} from '../../../src/lib/ingest/ast-treesitter'

/**
 * W2.D2 smoke test — verifies the tree-sitter scaffold loads, exposes the
 * expected shape, and correctly maps file extensions to languages. The
 * underlying parser is currently a stub; once the real implementation
 * lands, extend this suite with content-level assertions.
 */
describe('ast-treesitter scaffold', () => {
  describe('detectLanguage', () => {
    it('maps .ts / .tsx / .js / .jsx correctly', () => {
      expect(detectLanguage('foo.ts')).toBe('typescript')
      expect(detectLanguage('foo.tsx')).toBe('tsx')
      expect(detectLanguage('foo.js')).toBe('javascript')
      expect(detectLanguage('foo.jsx')).toBe('jsx')
    })

    it('handles case-insensitive extensions and absolute paths', () => {
      expect(detectLanguage('C:/proj/Foo.TS')).toBe('typescript')
      expect(detectLanguage('/abs/path/Bar.JSX')).toBe('jsx')
    })

    it('returns undefined for .d.ts declaration files', () => {
      expect(detectLanguage('types.d.ts')).toBeUndefined()
    })

    it('returns undefined for unsupported extensions', () => {
      expect(detectLanguage('README.md')).toBeUndefined()
      expect(detectLanguage('foo.py')).toBeUndefined()
      expect(detectLanguage('no-extension')).toBeUndefined()
    })

    it('exposes a readable LANGUAGE_EXTENSIONS map', () => {
      expect(LANGUAGE_EXTENSIONS['.ts']).toBe('typescript')
      expect(LANGUAGE_EXTENSIONS['.tsx']).toBe('tsx')
      expect(LANGUAGE_EXTENSIONS['.js']).toBe('javascript')
      expect(LANGUAGE_EXTENSIONS['.jsx']).toBe('jsx')
    })
  })

  describe('parseTreeSitterFile', () => {
    it('returns the expected shape for a simple TS input (stub mode)', () => {
      const result = parseTreeSitterFile(
        'C:/fake/src/foo.ts',
        'export const answer = 42\n',
      )

      expect(result.file).toBe('C:/fake/src/foo.ts')
      expect(result.language).toBe('typescript')
      expect(Array.isArray(result.imports)).toBe(true)
      expect(Array.isArray(result.exports)).toBe(true)
      expect(Array.isArray(result.symbols)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
      // Stub returns empty — a real parser should replace this.
      expect(result.warnings.some((w) => w.includes('stub'))).toBe(true)
    })

    it('normalizes Windows backslash paths to forward slashes', () => {
      const result = parseTreeSitterFile('C:\\fake\\src\\bar.tsx', '')
      expect(result.file).toBe('C:/fake/src/bar.tsx')
      expect(result.language).toBe('tsx')
    })

    it('throws UnsupportedLanguageError for unsupported extensions', () => {
      expect(() =>
        parseTreeSitterFile('foo.py', 'print(1)'),
      ).toThrow(UnsupportedLanguageError)
    })

    it('throws TreeSitterNotImplementedError when strict mode requested', () => {
      expect(() =>
        parseTreeSitterFile('foo.ts', 'const x = 1', { strict: true }),
      ).toThrow(TreeSitterNotImplementedError)
    })
  })
})
