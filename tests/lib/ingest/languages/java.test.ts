import { describe, it, expect } from 'vitest'
import { javaAdapter } from '../../../../src/lib/ingest/languages/java'
import type { JavaParsedSymbol } from '../../../../src/lib/ingest/languages/java'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await javaAdapter.loadParser()
  const tree = parser.parse(source)
  const result = javaAdapter.extractFacts(tree, '/fake/Main.java')
  tree.delete()
  return result
}

describe('javaAdapter', () => {
  it('Test 1: public class declaration is exported', async () => {
    const src = `package com.example;\n\npublic class Foo {}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: package-private class is NOT exported', async () => {
    const src = `class Helper {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('Helper')
  })

  it('Test 3: interface declaration → kind interface', async () => {
    const src = `package com.example;\n\npublic interface Bar { void doIt(); }\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('Bar')
  })

  it('Test 4: method declaration carries parentClass attribute', async () => {
    const src = `public class User {\n  public String greet() { return "hi"; }\n}\n`
    const result = await parse(src)
    const greet = result.symbols.find((s) => s.name === 'greet') as JavaParsedSymbol | undefined
    expect(greet).toBeDefined()
    expect(greet?.kind).toBe('function')
    expect(greet?.attributes?.parentClass).toBe('User')
  })

  it('Test 5: import → ParsedImport per FQN', async () => {
    const src =
      `package com.example;\n\nimport java.util.List;\nimport java.util.Map;\n\npublic class A {}\n`
    const result = await parse(src)
    const utilImports = result.imports.filter((i) => i.from.startsWith('java.util'))
    expect(utilImports).toHaveLength(2)
    expect(utilImports.map((i) => i.from).sort()).toEqual(['java.util.List', 'java.util.Map'])
  })

  it('Test 6: wildcard import emits *', async () => {
    const src = `package com.example;\n\nimport java.util.*;\n\npublic class A {}\n`
    const result = await parse(src)
    const wild = result.imports.find((i) => i.from === 'java.util')
    expect(wild?.names).toEqual(['*'])
  })

  it('Test 7: annotation captured on class', async () => {
    const src =
      `package com.example;\n\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class App {}\n`
    const result = await parse(src)
    const cls = result.symbols.find((s) => s.name === 'App') as JavaParsedSymbol | undefined
    expect(cls?.attributes?.annotations).toContain('@SpringBootApplication')
  })

  it('Test 8: enum_declaration → class kind', async () => {
    const src = `public enum Status { OK, ERROR }\n`
    const result = await parse(src)
    const e = result.symbols.find((s) => s.name === 'Status')
    expect(e?.kind).toBe('class')
  })

  it('Test 9: record_declaration → class kind', async () => {
    const src = `public record Point(int x, int y) {}\n`
    const result = await parse(src)
    const r = result.symbols.find((s) => s.name === 'Point')
    expect(r?.kind).toBe('class')
  })

  it('inferTechStack: Spring Boot import → Java/Spring Boot', async () => {
    const src = `package x;\n\nimport org.springframework.boot.SpringApplication;\n\nclass A {}\n`
    const result = await parse(src)
    expect(javaAdapter.inferTechStack([result])).toBe('Java/Spring Boot')
  })

  it('inferTechStack: Quarkus import → Java/Quarkus', async () => {
    const src = `package x;\n\nimport io.quarkus.runtime.Quarkus;\n\nclass A {}\n`
    const result = await parse(src)
    expect(javaAdapter.inferTechStack([result])).toBe('Java/Quarkus')
  })

  it('inferTechStack: jakarta.servlet → Java/Jakarta Servlet', async () => {
    const src = `package x;\n\nimport jakarta.servlet.http.HttpServlet;\n\nclass A {}\n`
    const result = await parse(src)
    expect(javaAdapter.inferTechStack([result])).toBe('Java/Jakarta Servlet')
  })

  it('inferTechStack: plain Java with no known framework', async () => {
    const src = `package x;\n\nimport java.util.List;\n\nclass A {}\n`
    const result = await parse(src)
    expect(javaAdapter.inferTechStack([result])).toBe('Java')
  })
})
