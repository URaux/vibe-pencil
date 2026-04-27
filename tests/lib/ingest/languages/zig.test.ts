import { describe, it, expect } from 'vitest'
import { zigAdapter } from '../../../../src/lib/ingest/languages/zig'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await zigAdapter.loadParser()
  const tree = parser.parse(source)
  const result = zigAdapter.extractFacts(tree, '/fake/main.zig')
  tree.delete()
  return result
}

describe('zigAdapter', () => {
  it('Test 1: pub fn → function fact, exported', async () => {
    const src = `pub fn main() !void {}\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'main')
    expect(fn?.kind).toBe('function')
    expect(result.exports).toContain('main')
  })

  it('Test 2: private fn (no pub) → function fact, NOT exported', async () => {
    const src = `fn helper() void {}\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'helper')
    expect(fn?.kind).toBe('function')
    expect(result.exports).not.toContain('helper')
  })

  it('Test 3: pub const struct → class fact, exported', async () => {
    const src = `pub const Config = struct { name: []const u8 };\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Config')
    expect(sym?.kind).toBe('class')
    expect(result.exports).toContain('Config')
  })

  it('Test 4: private const struct → class fact, NOT exported', async () => {
    const src = `const Internal = struct {};\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Internal')
    expect(sym?.kind).toBe('class')
    expect(result.exports).not.toContain('Internal')
  })

  it('Test 5: pub const enum → class fact, exported', async () => {
    const src = `pub const Color = enum { Red, Green, Blue };\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'Color')
    expect(sym?.kind).toBe('class')
    expect(result.exports).toContain('Color')
  })

  it('Test 6: pub const plain value → const fact, exported', async () => {
    const src = `pub const MAX_SIZE: usize = 1024;\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'MAX_SIZE')
    expect(sym?.kind).toBe('const')
    expect(result.exports).toContain('MAX_SIZE')
  })

  it('Test 7: private const plain value → const fact, NOT exported', async () => {
    const src = `const PRIVATE: u32 = 0;\n`
    const result = await parse(src)
    const sym = result.symbols.find((s) => s.name === 'PRIVATE')
    expect(sym?.kind).toBe('const')
    expect(result.exports).not.toContain('PRIVATE')
  })

  it('Test 8: @import("std") → ParsedImport, NOT a symbol', async () => {
    const src = `const std = @import("std");\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === 'std')
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('std')
    // Should not appear as a const symbol
    expect(result.symbols.find((s) => s.name === 'std')).toBeUndefined()
  })

  it('Test 9: @import with relative path → ParsedImport', async () => {
    const src = `const util = @import("./util.zig");\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === './util.zig')
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('util')
  })

  it('Test 10: mixed file — functions, structs, enums, imports, consts', async () => {
    const src = [
      `const std = @import("std");`,
      `pub const MAX: usize = 100;`,
      `pub fn run() void {}`,
      `fn internal() void {}`,
      `pub const Node = struct { val: u32 };`,
      `pub const Status = enum { Ok, Err };`,
    ].join('\n') + '\n'

    const result = await parse(src)

    // imports
    expect(result.imports.find((i) => i.from === 'std')).toBeDefined()

    // exported names
    expect(result.exports).toContain('MAX')
    expect(result.exports).toContain('run')
    expect(result.exports).toContain('Node')
    expect(result.exports).toContain('Status')

    // private fn not exported
    expect(result.exports).not.toContain('internal')

    // symbol kinds
    expect(result.symbols.find((s) => s.name === 'MAX')?.kind).toBe('const')
    expect(result.symbols.find((s) => s.name === 'run')?.kind).toBe('function')
    expect(result.symbols.find((s) => s.name === 'internal')?.kind).toBe('function')
    expect(result.symbols.find((s) => s.name === 'Node')?.kind).toBe('class')
    expect(result.symbols.find((s) => s.name === 'Status')?.kind).toBe('class')
  })

  it('Test 11: fileExtensions includes .zig', () => {
    expect(zigAdapter.fileExtensions).toContain('.zig')
  })

  it('Test 12: id is "zig"', () => {
    expect(zigAdapter.id).toBe('zig')
  })

  it('inferTechStack: std import → "Zig"', async () => {
    const src = `const std = @import("std");\n`
    const result = await parse(src)
    expect(zigAdapter.inferTechStack([result])).toBe('Zig')
  })

  it('inferTechStack: no imports → default "Zig"', async () => {
    const src = `pub fn main() void {}\n`
    const result = await parse(src)
    expect(zigAdapter.inferTechStack([result])).toBe('Zig')
  })
})
