/**
 * Registry unit tests — W2.D2.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Parser from 'web-tree-sitter'
import { registerAdapter, findAdapter, listAdapters } from '../../../../src/lib/ingest/languages/registry'
import type { LanguageAdapter } from '../../../../src/lib/ingest/languages/types'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(id: string, exts: string[]): LanguageAdapter {
  return {
    id,
    fileExtensions: exts,
    extractFacts(_tree: Parser.Tree, sourcePath: string): FactInputModule {
      return { file: sourcePath, imports: [], exports: [], symbols: [] }
    },
    inferTechStack(_facts: FactInputModule[]): string {
      return id
    },
    async loadParser(): Promise<Parser> {
      throw new Error('not implemented')
    },
  }
}

// Each test gets a fresh module-level registry by re-importing via a factory.
// Since the registry is module-singleton, we manipulate it directly and rely on
// test isolation via fresh adapter ids.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registry', () => {
  describe('registerAdapter + findAdapter + listAdapters', () => {
    it('registers an adapter and retrieves it by extension', () => {
      const adapter = makeAdapter('test-lang-a', ['.texa', '.texb'])
      registerAdapter(adapter)

      expect(findAdapter('foo.texa')).toBe(adapter)
      expect(findAdapter('bar.texb')).toBe(adapter)
    })

    it('listAdapters returns all registered adapters', () => {
      const a1 = makeAdapter('test-lang-list1', ['.ll1'])
      const a2 = makeAdapter('test-lang-list2', ['.ll2'])
      registerAdapter(a1)
      registerAdapter(a2)

      const list = listAdapters()
      expect(list).toContain(a1)
      expect(list).toContain(a2)
    })

    it('listAdapters returns a snapshot — later registration does not mutate prior snapshot', () => {
      const a1 = makeAdapter('test-lang-snap1', ['.snap1'])
      registerAdapter(a1)
      const snapshot = listAdapters()
      const before = snapshot.length

      const a2 = makeAdapter('test-lang-snap2', ['.snap2'])
      registerAdapter(a2)

      // snapshot must not grow
      expect(snapshot.length).toBe(before)
    })
  })

  describe('findAdapter — unknown extension', () => {
    it('returns null for an extension with no registered adapter', () => {
      expect(findAdapter('README.md')).toBeNull()
      expect(findAdapter('no-extension')).toBeNull()
      expect(findAdapter('foo.xyz_never_registered')).toBeNull()
    })
  })

  describe('duplicate id replacement', () => {
    it('registering the same id twice replaces the first adapter (last-writer-wins)', () => {
      const v1 = makeAdapter('test-lang-dup', ['.dupx'])
      const v2 = makeAdapter('test-lang-dup', ['.dupx'])
      registerAdapter(v1)
      registerAdapter(v2)

      // findAdapter should return v2, not v1
      expect(findAdapter('foo.dupx')).toBe(v2)

      // listAdapters should contain exactly one entry for 'test-lang-dup'
      const list = listAdapters()
      const matching = list.filter((a) => a.id === 'test-lang-dup')
      expect(matching.length).toBe(1)
      expect(matching[0]).toBe(v2)
    })
  })
})
