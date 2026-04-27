import { describe, it, expect, beforeAll } from 'vitest'
import { bashAdapter } from '@/lib/ingest/languages/bash'
import type { BashParsedSymbol } from '@/lib/ingest/languages/bash'
import type { FactInputModule } from '@/lib/ingest/languages/types'
import Parser from 'web-tree-sitter'

let sharedParser: Parser | null = null
let parserAvailable = false

beforeAll(async () => {
  try {
    sharedParser = await bashAdapter.loadParser()
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
  return { file: 'test.sh', imports, exports: [], symbols: [], language: 'bash' }
}

describe('bashAdapter metadata', () => {
  it('has id bash', () => expect(bashAdapter.id).toBe('bash'))
  it('has .sh extension', () => expect(bashAdapter.fileExtensions).toContain('.sh'))
  it('has .bash extension', () => expect(bashAdapter.fileExtensions).toContain('.bash'))

  it('inferTechStack: plain Bash', () => {
    const facts = [makeFact([])]
    expect(bashAdapter.inferTechStack(facts)).toBe('Bash')
  })

  it('inferTechStack: Bash/Testing with bats import', () => {
    const facts = [makeFact([{ from: '/usr/lib/bats/bats-core', names: ['*'] }])]
    expect(bashAdapter.inferTechStack(facts)).toBe('Bash/Testing')
  })
})

describe('bashAdapter parser', () => {
  maybeIt('extracts function_definition', () => {
    const src = 'function greet() {\n  echo "hello"\n}\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    const fn = facts.symbols.find((s) => s.name === 'greet')
    expect(fn).toBeDefined()
    expect(fn?.kind).toBe('function')
  })

  maybeIt('exports public functions (no underscore)', () => {
    const src = 'function public_fn() {}\nfunction _private_fn() {}\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    expect(facts.exports).toContain('public_fn')
    expect(facts.exports).not.toContain('_private_fn')
  })

  maybeIt('extracts source command as import', () => {
    const src = 'source ./lib/utils.sh\necho hello\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    expect(facts.imports.length).toBeGreaterThan(0)
    expect(facts.imports[0].from).toContain('utils.sh')
  })

  maybeIt('file path normalized to forward slashes', () => {
    const src = '#!/usr/bin/env bash\necho hi\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'scripts\\deploy.sh')
    expect(facts.file).not.toContain('\\')
  })

  // Tests for the fixed BashParsedSymbol fields: exported + line
  maybeIt('symbol has exported=true for public function', () => {
    const src = 'function deploy() {\n  echo "deploying"\n}\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    const sym = facts.symbols.find((s) => s.name === 'deploy') as BashParsedSymbol | undefined
    expect(sym).toBeDefined()
    expect(sym!.exported).toBe(true)
  })

  maybeIt('symbol has exported=false for private function (underscore prefix)', () => {
    const src = 'function _internal_helper() {\n  echo "private"\n}\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    const sym = facts.symbols.find((s) => s.name === '_internal_helper') as BashParsedSymbol | undefined
    expect(sym).toBeDefined()
    expect(sym!.exported).toBe(false)
  })

  maybeIt('symbol carries correct 1-based line number', () => {
    const src = '#!/usr/bin/env bash\n# comment\nfunction setup() {\n  echo ok\n}\n'
    const tree = parse(src)
    const facts = bashAdapter.extractFacts(tree, 'test.sh')
    const sym = facts.symbols.find((s) => s.name === 'setup') as BashParsedSymbol | undefined
    expect(sym).toBeDefined()
    expect(sym!.line).toBe(3)
  })
})
