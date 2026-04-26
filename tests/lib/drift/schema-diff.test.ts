import { describe, expect, it } from 'vitest'
import { detectSchemaDrift, renderSchemaDriftMarkdown } from '@/lib/drift/schema-diff'
import type { IrBlock } from '@/lib/ir/schema'

type BlockSchema = NonNullable<IrBlock['schema']>

const empty: BlockSchema = { tables: [] }

function table(name: string, columns: Array<{ name: string; type: string; constraints?: Record<string, unknown> }>, indexes?: Array<{ name: string; columns: string[]; unique?: boolean }>): BlockSchema['tables'][number] {
  return {
    name,
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type,
      ...(c.constraints ? { constraints: c.constraints as never } : {}),
    })),
    ...(indexes ? { indexes } : {}),
  }
}

describe('detectSchemaDrift', () => {
  it('clean=true on identical schemas', () => {
    const s: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }])] }
    const r = detectSchemaDrift(s, s)
    expect(r.clean).toBe(true)
  })

  it('detects added table', () => {
    const a: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }])] }
    const b: BlockSchema = {
      tables: [table('users', [{ name: 'id', type: 'int' }]), table('orders', [{ name: 'id', type: 'int' }])],
    }
    const r = detectSchemaDrift(a, b)
    expect(r.addedTables).toHaveLength(1)
    expect(r.addedTables[0].name).toBe('orders')
  })

  it('detects removed table', () => {
    const a: BlockSchema = {
      tables: [table('users', [{ name: 'id', type: 'int' }]), table('legacy', [{ name: 'x', type: 'int' }])],
    }
    const b: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }])] }
    const r = detectSchemaDrift(a, b)
    expect(r.removedTables).toHaveLength(1)
    expect(r.removedTables[0].name).toBe('legacy')
  })

  it('detects added/removed columns', () => {
    const a: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }, { name: 'old', type: 'text' }])] }
    const b: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }, { name: 'new', type: 'text' }])] }
    const r = detectSchemaDrift(a, b)
    expect(r.changedTables).toHaveLength(1)
    expect(r.changedTables[0].addedColumns.map((c) => c.name)).toEqual(['new'])
    expect(r.changedTables[0].removedColumns.map((c) => c.name)).toEqual(['old'])
  })

  it('detects column type change', () => {
    const a: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }])] }
    const b: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'bigint' }])] }
    const r = detectSchemaDrift(a, b)
    expect(r.changedTables[0].changedColumns).toHaveLength(1)
    expect(r.changedTables[0].changedColumns[0].changes[0]).toContain('int → bigint')
  })

  it('detects column constraint change (notNull)', () => {
    const a: BlockSchema = {
      tables: [table('users', [{ name: 'name', type: 'text', constraints: { notNull: false } }])],
    }
    const b: BlockSchema = {
      tables: [table('users', [{ name: 'name', type: 'text', constraints: { notNull: true } }])],
    }
    const r = detectSchemaDrift(a, b)
    expect(r.changedTables[0].changedColumns[0].changes[0]).toMatch(/notNull/)
  })

  it('detects added/removed indexes', () => {
    const a: BlockSchema = {
      tables: [
        table('users', [{ name: 'email', type: 'text' }], [{ name: 'idx_email', columns: ['email'], unique: true }]),
      ],
    }
    const b: BlockSchema = {
      tables: [table('users', [{ name: 'email', type: 'text' }])],
    }
    const r = detectSchemaDrift(a, b)
    expect(r.changedTables[0].removedIndexes).toHaveLength(1)
  })

  it('handles undefined → defined as added tables', () => {
    const r = detectSchemaDrift(undefined, { tables: [table('users', [{ name: 'id', type: 'int' }])] })
    expect(r.addedTables).toHaveLength(1)
    expect(r.clean).toBe(false)
  })

  it('clean when both undefined', () => {
    const r = detectSchemaDrift(undefined, undefined)
    expect(r.clean).toBe(true)
  })
})

describe('renderSchemaDriftMarkdown', () => {
  it('returns empty string when clean', () => {
    expect(renderSchemaDriftMarkdown({ addedTables: [], removedTables: [], changedTables: [], clean: true })).toBe('')
  })

  it('renders a compact summary with column changes', () => {
    const a: BlockSchema = { tables: [table('users', [{ name: 'id', type: 'int' }, { name: 'old', type: 'text' }])] }
    const b: BlockSchema = {
      tables: [
        table('users', [{ name: 'id', type: 'bigint' }, { name: 'new', type: 'text' }]),
        table('orders', [{ name: 'id', type: 'int' }]),
      ],
    }
    const r = detectSchemaDrift(a, b)
    const md = renderSchemaDriftMarkdown(r)
    expect(md).toContain('orders')
    expect(md).toContain('users')
    expect(md).toContain('+1 cols')
    expect(md).toContain('-1 cols')
    expect(md).toContain('~1 cols')
    expect(md).toContain('int → bigint')
  })

  it('truncates column changes to first 3 with footer', () => {
    const a: BlockSchema = {
      tables: [
        table('t', Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, type: 'int' }))),
      ],
    }
    const b: BlockSchema = {
      tables: [
        table('t', Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, type: 'bigint' }))),
      ],
    }
    const r = detectSchemaDrift(a, b)
    const md = renderSchemaDriftMarkdown(r)
    expect(md).toContain('+2 more column changes')
  })
})
