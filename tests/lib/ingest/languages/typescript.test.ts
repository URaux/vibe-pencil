/**
 * TypeScript adapter regression tests — W2.D2.
 *
 * Verifies that `tsAdapter` emits the same facts as the legacy `ast-treesitter`
 * inline path for a well-known fixture. Uses the existing
 * `tests/fixtures/ast-treesitter/sample.ts` fixture so the expected values are
 * grounded in the same source that the old `ast-treesitter.test.ts` asserts.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import Parser from 'web-tree-sitter'
import { tsAdapter } from '../../../../src/lib/ingest/languages/typescript'

const FIXTURE = path.join(__dirname, '../../../fixtures/ast-treesitter/sample.ts')

async function parseFixture(filePath: string, source: string) {
  const parser = await tsAdapter.loadParser()
  const tree = parser.parse(source)
  const result = tsAdapter.extractFacts(tree as Parser.Tree, filePath)
  tree.delete()
  return result
}

describe('tsAdapter — regression against ast-treesitter fixture', () => {
  it('extracts same imports as the inline extractJsLike path', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture(FIXTURE, source)

    const fromValues = result.imports.map((i) => i.from)
    expect(fromValues).toContain('node:fs/promises')
    expect(fromValues).toContain('node:path')
    expect(fromValues).toContain('./helpers')
  })

  it('extracts same symbols (class, function, interface, type, const)', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture(FIXTURE, source)

    const names = result.symbols.map((s) => s.name)
    expect(names).toEqual(
      expect.arrayContaining(['GREETING', 'counter', 'greet', 'Logger', 'Config', 'Handler']),
    )
    expect(result.symbols.find((s) => s.name === 'Logger')?.kind).toBe('class')
    expect(result.symbols.find((s) => s.name === 'greet')?.kind).toBe('function')
    expect(result.symbols.find((s) => s.name === 'Config')?.kind).toBe('interface')
    expect(result.symbols.find((s) => s.name === 'Handler')?.kind).toBe('type')
    expect(result.symbols.find((s) => s.name === 'GREETING')?.kind).toBe('const')
  })

  it('extracts same exports as the inline path', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture(FIXTURE, source)

    expect(result.exports).toEqual(
      expect.arrayContaining(['GREETING', 'greet', 'Logger', 'Config', 'Handler', 'default']),
    )
  })

  it('no duplicate symbol names within a single module', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture(FIXTURE, source)

    const names = result.symbols.map((s) => s.name)
    const deduped = new Set(names)
    expect(names.length).toBe(deduped.size)
  })

  it('inferTechStack returns TypeScript for plain TS source (no framework imports)', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture(FIXTURE, source)
    expect(tsAdapter.inferTechStack([result])).toBe('TypeScript')
  })

  it('inferTechStack detects Next.js from next import', () => {
    const fakeModule = {
      file: '/fake/page.ts',
      imports: [{ from: 'next/router', names: ['useRouter'] }],
      exports: [],
      symbols: [],
    }
    expect(tsAdapter.inferTechStack([fakeModule])).toBe('TypeScript/Next.js')
  })

  it('normalizes Windows backslash path in file field', async () => {
    const source = await readFile(FIXTURE, 'utf8')
    const result = await parseFixture('C:\\Windows\\Path\\foo.ts', source)
    expect(result.file).toBe('C:/Windows/Path/foo.ts')
  })
})
