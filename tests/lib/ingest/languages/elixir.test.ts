import { describe, it, expect } from 'vitest'
import { elixirAdapter } from '../../../../src/lib/ingest/languages/elixir'
import type { ElixirParsedSymbol } from '../../../../src/lib/ingest/languages/elixir'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string, file = '/fake/app.ex'): Promise<FactInputModule> {
  const parser = await elixirAdapter.loadParser()
  const tree = parser.parse(source)
  const result = elixirAdapter.extractFacts(tree, file)
  tree.delete()
  return result
}

describe('elixirAdapter', () => {
  it('Test 1: defmodule → class, exported', async () => {
    const result = await parse('defmodule MyApp.Router do\nend\n')
    expect(result.symbols.find(s => s.kind === 'class' && s.name === 'MyApp.Router')).toBeDefined()
    expect(result.exports).toContain('MyApp.Router')
  })
  it('Test 2: def → function, exported, parentClass set', async () => {
    const result = await parse('defmodule M do\n  def hello(c, _) do c end\nend\n')
    const fn = result.symbols.find(s => s.name === 'hello') as ElixirParsedSymbol | undefined
    expect(fn?.kind).toBe('function')
    expect(fn?.attributes?.parentClass).toBe('M')
    expect(result.exports).toContain('hello')
  })
  it('Test 3: defp → function, NOT exported', async () => {
    const result = await parse('defmodule M do\n  defp secret() do :ok end\nend\n')
    expect(result.symbols.find(s => s.name === 'secret')).toBeDefined()
    expect(result.exports).not.toContain('secret')
  })
  it('Test 4: defp has parentClass attribute', async () => {
    const result = await parse('defmodule Mod do\n  defp priv() do :ok end\nend\n')
    const fn = result.symbols.find(s => s.name === 'priv') as ElixirParsedSymbol | undefined
    expect(fn?.attributes?.parentClass).toBe('Mod')
  })
  it('Test 5: use → ParsedImport', async () => {
    const result = await parse('defmodule R do\n  use Phoenix.Router\nend\n')
    expect(result.imports.find(i => i.from === 'Phoenix.Router')).toBeDefined()
  })
  it('Test 6: import → ParsedImport', async () => {
    const result = await parse('defmodule M do\n  import Plug.Conn\nend\n')
    const imp = result.imports.find(i => i.from === 'Plug.Conn')
    expect(imp?.names).toContain('Conn')
  })
  it('Test 7: multiple defs all exported', async () => {
    const result = await parse('defmodule C do\n  def index(c,_) do c end\n  def show(c,_) do c end\nend\n')
    expect(result.exports).toContain('index')
    expect(result.exports).toContain('show')
  })
  it('Test 8: def exported, defp not exported, both in symbols', async () => {
    const result = await parse('defmodule S do\n  def run() do :ok end\n  defp internal() do :ok end\nend\n')
    expect(result.exports).toContain('run')
    expect(result.exports).not.toContain('internal')
    expect(result.symbols.find(s => s.name === 'internal')).toBeDefined()
  })
  it('Test 9: multiple defmodules in one file', async () => {
    const result = await parse('defmodule Alpha do\nend\ndefmodule Beta do\nend\n')
    const names = result.symbols.filter(s => s.kind === 'class').map(s => s.name)
    expect(names).toContain('Alpha')
    expect(names).toContain('Beta')
  })
  it('Test 10: .exs extension works', async () => {
    const result = await parse('defmodule Mix.Tasks.Hello do\n  def run(_) do :ok end\nend\n', '/fake/hello.exs')
    expect(result.file).toBe('/fake/hello.exs')
    expect(result.symbols.find(s => s.name === 'Mix.Tasks.Hello')).toBeDefined()
  })
  it('inferTechStack: Phoenix → Elixir/Phoenix', async () => {
    const result = await parse('defmodule R do\n  use Phoenix.Router\nend\n')
    expect(elixirAdapter.inferTechStack([result])).toBe('Elixir/Phoenix')
  })
  it('inferTechStack: Ecto → Elixir/Ecto', async () => {
    const result = await parse('defmodule R do\n  use Ecto.Schema\nend\n')
    expect(elixirAdapter.inferTechStack([result])).toBe('Elixir/Ecto')
  })
  it('inferTechStack: no framework → Elixir', async () => {
    const result = await parse('defmodule Plain do\nend\n')
    expect(elixirAdapter.inferTechStack([result])).toBe('Elixir')
  })
})
