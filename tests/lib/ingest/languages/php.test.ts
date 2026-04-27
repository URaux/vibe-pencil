import { describe, it, expect } from 'vitest'
import { phpAdapter } from '../../../../src/lib/ingest/languages/php'
import type { PhpParsedSymbol } from '../../../../src/lib/ingest/languages/php'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await phpAdapter.loadParser()
  const tree = parser.parse(source)
  const result = phpAdapter.extractFacts(tree, '/fake/App.php')
  tree.delete()
  return result
}

describe('phpAdapter', () => {
  it('Test 1: class_declaration → kind class, exported', async () => {
    const src = `<?php\nclass Foo {}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: interface_declaration → kind interface, exported', async () => {
    const src = `<?php\ninterface Bar { public function baz(); }\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('Bar')
    expect(result.exports).toContain('Bar')
  })

  it('Test 3: trait_declaration → kind class, exported', async () => {
    const src = `<?php\ntrait Loggable {}\n`
    const result = await parse(src)
    const traits = result.symbols.filter((s) => s.kind === 'class' && s.name === 'Loggable')
    expect(traits).toHaveLength(1)
    expect(result.exports).toContain('Loggable')
  })

  it('Test 4: top-level function_definition → kind function, exported', async () => {
    const src = `<?php\nfunction helper() { return 1; }\n`
    const result = await parse(src)
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('helper')
    expect(result.exports).toContain('helper')
  })

  it('Test 5: public method in class → function with parentClass', async () => {
    const src = `<?php\nclass User {\n  public function greet() { return "hi"; }\n}\n`
    const result = await parse(src)
    const greet = result.symbols.find((s) => s.name === 'greet') as PhpParsedSymbol | undefined
    expect(greet).toBeDefined()
    expect(greet?.kind).toBe('function')
    expect(greet?.attributes?.parentClass).toBe('User')
  })

  it('Test 6: private method is NOT exported', async () => {
    const src = `<?php\nclass User {\n  private function secret() {}\n}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('secret')
  })

  it('Test 7: protected method is NOT exported', async () => {
    const src = `<?php\nclass Base {\n  protected function init() {}\n}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('init')
  })

  it('Test 8: private method symbol is NOT included', async () => {
    const src = `<?php\nclass Svc {\n  private function doInternal() {}\n  public function run() {}\n}\n`
    const result = await parse(src)
    expect(result.symbols.find((s) => s.name === 'doInternal')).toBeUndefined()
    expect(result.symbols.find((s) => s.name === 'run')).toBeDefined()
  })

  it('Test 9: namespace_use_declaration → ParsedImport', async () => {
    const src = `<?php\nuse Illuminate\\Http\\Request;\nclass A {}\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === 'Illuminate\\Http\\Request')
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('Request')
  })

  it('Test 10: use alias → aliased name in import names', async () => {
    const src = `<?php\nuse Symfony\\Component\\HttpFoundation\\Request as SfRequest;\nclass A {}\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from.includes('Request'))
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('SfRequest')
  })

  it('Test 11: namespace_definition emits class symbol', async () => {
    const src = `<?php\nnamespace App\\Controllers;\nclass HomeController {}\n`
    const result = await parse(src)
    expect(result.symbols.find((s) => s.name === 'HomeController')).toBeDefined()
  })

  it('Test 12: multiple classes in one file', async () => {
    const src = `<?php\nclass Alpha {}\nclass Beta {}\nclass Gamma {}\n`
    const result = await parse(src)
    const names = result.symbols.filter((s) => s.kind === 'class').map((s) => s.name)
    expect(names).toContain('Alpha')
    expect(names).toContain('Beta')
    expect(names).toContain('Gamma')
  })

  it('inferTechStack: Illuminate import → PHP/Laravel', async () => {
    const src = `<?php\nuse Illuminate\\Http\\Request;\nclass A {}\n`
    const result = await parse(src)
    expect(phpAdapter.inferTechStack([result])).toBe('PHP/Laravel')
  })

  it('inferTechStack: Symfony import → PHP/Symfony', async () => {
    const src = `<?php\nuse Symfony\\Component\\HttpFoundation\\Response;\nclass A {}\n`
    const result = await parse(src)
    expect(phpAdapter.inferTechStack([result])).toBe('PHP/Symfony')
  })

  it('inferTechStack: no known framework → PHP', async () => {
    const src = `<?php\nclass Plain {}\n`
    const result = await parse(src)
    expect(phpAdapter.inferTechStack([result])).toBe('PHP')
  })
})
