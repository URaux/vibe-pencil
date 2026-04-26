/**
 * Ruby adapter tests — phase3/lang-ruby.
 *
 * Each test parses an inline Ruby source string via rubyAdapter.loadParser()
 * + extractFacts(). No fixture files needed.
 */

import { describe, it, expect } from 'vitest'
import { rubyAdapter } from '../../../../src/lib/ingest/languages/ruby'
import type { RubyParsedSymbol } from '../../../../src/lib/ingest/languages/ruby'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function parse(source: string): Promise<FactInputModule> {
  const parser = await rubyAdapter.loadParser()
  const tree = parser.parse(source)
  const result = rubyAdapter.extractFacts(tree, '/fake/module.rb')
  tree.delete()
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rubyAdapter', () => {
  it('Test 1: class definition → class fact, exported', async () => {
    const result = await parse('class Foo\nend\n')
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: underscore-prefixed method → not exported', async () => {
    // Ruby class names must start with uppercase — underscore-prefix is only
    // meaningful on methods/variables. The adapter applies Python-style convention:
    // underscore-prefixed methods are considered private (not exported).
    const result = await parse('def _private_helper\n  42\nend\n')
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('_private_helper')
    expect(result.exports).not.toContain('_private_helper')
  })

  it('Test 3: module definition → class kind, exported', async () => {
    const result = await parse('module MyNamespace\nend\n')
    const mods = result.symbols.filter((s) => s.kind === 'class')
    expect(mods).toHaveLength(1)
    expect(mods[0].name).toBe('MyNamespace')
    expect(result.exports).toContain('MyNamespace')
  })

  it('Test 4: top-level method → function kind, exported', async () => {
    const result = await parse('def greet\n  puts "hi"\nend\n')
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('greet')
    expect(result.exports).toContain('greet')
    // No parentClass on a top-level method
    const sym = fns[0] as RubyParsedSymbol
    expect(sym.attributes?.parentClass).toBeUndefined()
  })

  it('Test 5: method nested in class → function kind with attributes.parentClass', async () => {
    const src = 'class Bar\n  def do_thing\n    42\n  end\nend\n'
    const result = await parse(src)

    const classSyms = result.symbols.filter((s) => s.kind === 'class')
    expect(classSyms).toHaveLength(1)
    expect(classSyms[0].name).toBe('Bar')

    const methods = result.symbols.filter(
      (s) => s.kind === 'function' && (s as RubyParsedSymbol).attributes?.parentClass === 'Bar',
    )
    expect(methods).toHaveLength(1)
    expect(methods[0].name).toBe('do_thing')
  })

  it('Test 6: require statement → import fact', async () => {
    const result = await parse("require 'json'\n")
    const imp = result.imports.find((i) => i.from === 'json')
    expect(imp).toBeDefined()
  })

  it('Test 7: require_relative → import fact', async () => {
    const result = await parse("require_relative './helpers'\n")
    const imp = result.imports.find((i) => i.from === './helpers')
    expect(imp).toBeDefined()
  })

  it('Test 8: SCREAMING_CASE constant → const fact', async () => {
    const result = await parse('MAX_RETRIES = 3\n')
    const consts = result.symbols.filter((s) => s.kind === 'const')
    expect(consts).toHaveLength(1)
    expect(consts[0].name).toBe('MAX_RETRIES')
    expect(result.exports).toContain('MAX_RETRIES')
  })

  it('Test 9: inferTechStack with Rails import → Ruby/Rails', async () => {
    const result = await parse("require 'rails'\n")
    expect(rubyAdapter.inferTechStack([result])).toBe('Ruby/Rails')
  })

  it('Test 10: inferTechStack with active_record → Ruby/Rails', async () => {
    const result = await parse("require 'active_record'\n")
    expect(rubyAdapter.inferTechStack([result])).toBe('Ruby/Rails')
  })

  it('Test 11: inferTechStack with Sinatra → Ruby/Sinatra', async () => {
    const result = await parse("require 'sinatra'\n")
    expect(rubyAdapter.inferTechStack([result])).toBe('Ruby/Sinatra')
  })

  it('Test 12: inferTechStack with no known framework → Ruby', async () => {
    const result = await parse("require 'json'\nrequire 'date'\n")
    expect(rubyAdapter.inferTechStack([result])).toBe('Ruby')
  })
})
