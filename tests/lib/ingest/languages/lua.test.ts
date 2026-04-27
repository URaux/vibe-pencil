import { describe, it, expect } from 'vitest'
import { luaAdapter } from '../../../../src/lib/ingest/languages/lua'
import type { LuaParsedSymbol } from '../../../../src/lib/ingest/languages/lua'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

// Parse the full file once — avoids WASM re-init and crash-after-abort issues
const FULL_SRC = [
  'local M = {}',
  '',
  'function M.greet(name)',
  '  return "hi " .. name',
  'end',
  '',
  'local function helper()',
  '  return 1',
  'end',
  '',
  'function topLevel()',
  '  return 2',
  'end',
  '',
  'local lapis = require("lapis")',
  'local cfg = require("lapis.config")',
  '',
  'VERSION = "1.0"',
  'ANOTHER_CONST = "x"',
  '',
  'return M',
].join('\n')

let _cache: FactInputModule | null = null
async function getResult(): Promise<FactInputModule> {
  if (_cache) return _cache
  const parser = await luaAdapter.loadParser()
  const tree = parser.parse(FULL_SRC)
  _cache = luaAdapter.extractFacts(tree, '/fake/app.lua')
  return _cache
}

async function parseSingle(source: string, file = '/fake/app.lua'): Promise<FactInputModule> {
  const parser = await luaAdapter.loadParser()
  const tree = parser.parse(source)
  return luaAdapter.extractFacts(tree, file)
}

describe('luaAdapter', () => {
  it('Test 1: top-level function → kind function, exported', async () => {
    const r = await getResult()
    expect(r.symbols.find(s => s.name === 'topLevel')?.kind).toBe('function')
    expect(r.exports).toContain('topLevel')
  })

  it('Test 2: local function → in symbols, NOT exported', async () => {
    const r = await getResult()
    expect(r.symbols.find(s => s.name === 'helper')?.kind).toBe('function')
    expect(r.exports).not.toContain('helper')
  })

  it('Test 3: dotted function M.greet → function with parentClass=M', async () => {
    const r = await getResult()
    const fn = r.symbols.find(s => s.name === 'greet') as LuaParsedSymbol | undefined
    expect(fn?.kind).toBe('function')
    expect(fn?.attributes?.parentClass).toBe('M')
    expect(r.exports).toContain('greet')
  })

  it('Test 4: require("lapis") → ParsedImport', async () => {
    const r = await getResult()
    const imp = r.imports.find(i => i.from === 'lapis')
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('lapis')
  })

  it('Test 5: require("lapis.config") → last segment as name', async () => {
    const r = await getResult()
    const imp = r.imports.find(i => i.from === 'lapis.config')
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('config')
  })

  it('Test 6: ALL_CAPS global → const, exported', async () => {
    const r = await getResult()
    expect(r.symbols.find(s => s.name === 'VERSION')?.kind).toBe('const')
    expect(r.exports).toContain('VERSION')
  })

  it('Test 7: second ALL_CAPS const also exported', async () => {
    const r = await getResult()
    expect(r.exports).toContain('ANOTHER_CONST')
  })

  it('Test 8: local require vars not in symbols', async () => {
    const r = await getResult()
    expect(r.symbols.find(s => s.name === 'lapis')).toBeUndefined()
    expect(r.symbols.find(s => s.name === 'cfg')).toBeUndefined()
  })

  it('Test 9: both require imports captured', async () => {
    const r = await getResult()
    expect(r.imports.find(i => i.from === 'lapis')).toBeDefined()
    expect(r.imports.find(i => i.from === 'lapis.config')).toBeDefined()
  })

  it('Test 10: local function not in exports', async () => {
    const r = await getResult()
    expect(r.exports).not.toContain('helper')
  })

  it('Test 11: multiple top-level functions', async () => {
    const r = await parseSingle('function foo()\nend\nfunction bar()\nend\n')
    expect(r.exports).toContain('foo')
    expect(r.exports).toContain('bar')
  })

  it('Test 12: file path forward slashes', async () => {
    const r = await parseSingle('function f()\nend\n', 'C:\\path\\app.lua')
    expect(r.file).toBe('C:/path/app.lua')
  })

  it('inferTechStack: love → Lua/LÖVE', () => {
    const fakeResult: FactInputModule = { file: 'f.lua', imports: [{ from: 'love', names: ['love'] }], exports: [], symbols: [] }
    expect(luaAdapter.inferTechStack([fakeResult])).toBe('Lua/LÖVE')
  })

  it('inferTechStack: lapis → Lua/Lapis', () => {
    const fakeResult: FactInputModule = { file: 'f.lua', imports: [{ from: 'lapis', names: ['lapis'] }], exports: [], symbols: [] }
    expect(luaAdapter.inferTechStack([fakeResult])).toBe('Lua/Lapis')
  })

  it('inferTechStack: plain → Lua', () => {
    const fakeResult: FactInputModule = { file: 'f.lua', imports: [], exports: [], symbols: [] }
    expect(luaAdapter.inferTechStack([fakeResult])).toBe('Lua')
  })
})
