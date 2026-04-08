import { describe, expect, it } from 'vitest'
import { lintSchema } from '../../src/lib/schema-linter'
import type { BlockSchema, SchemaTable } from '../../src/lib/types'

function makeSchema(tables: SchemaTable[]): BlockSchema {
  return { tables }
}

describe('schema-linter', () => {
  it('reports an error when a table has no primary key', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'users',
          columns: [{ name: 'email', type: 'varchar(255)' }],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', table: 'users', rule: 'no-pk' }))
  })

  it('reports an error when a money-like column uses float', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'total_price', type: 'float' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', table: 'orders', column: 'total_price', rule: 'float-money' }))
  })

  it('reports an error when a timestamp-like column uses varchar', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'events',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'created_at', type: 'varchar(255)' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', table: 'events', column: 'created_at', rule: 'varchar-timestamp' }))
  })

  it('reports an error when a foreign key target table does not exist', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            {
              name: 'user_id',
              type: 'uuid',
              constraints: { foreign: { table: 'users', column: 'id' }, notNull: true },
            },
          ],
          indexes: [{ name: 'orders_user_id_idx', columns: ['user_id'] }],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', table: 'orders', column: 'user_id', rule: 'fk-no-target' }))
  })

  it('reports status-like text columns but allows enum types', () => {
    const badIssues = lintSchema(
      makeSchema([
        {
          name: 'accounts',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'status', type: 'text' },
          ],
        },
      ])
    )

    const goodIssues = lintSchema(
      makeSchema([
        {
          name: 'accounts',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'status', type: "enum('active','inactive')" },
          ],
        },
      ])
    )

    expect(badIssues).toContainEqual(expect.objectContaining({ severity: 'error', table: 'accounts', column: 'status', rule: 'string-status' }))
    expect(goodIssues.some((issue) => issue.rule === 'string-status')).toBe(false)
  })

  it('warns when created_at or updated_at is missing', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'profiles',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'updated_at', type: 'timestamptz' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', table: 'profiles', rule: 'missing-timestamps' }))
  })

  it('warns when a foreign key column is not indexed', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'created_at', type: 'timestamptz' },
            { name: 'updated_at', type: 'timestamptz' },
          ],
        },
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            {
              name: 'user_id',
              type: 'uuid',
              constraints: { foreign: { table: 'users', column: 'id' }, notNull: true },
            },
            { name: 'created_at', type: 'timestamptz' },
            { name: 'updated_at', type: 'timestamptz' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', table: 'orders', column: 'user_id', rule: 'fk-no-index' }))
  })

  it('warns when table or column names are not snake_case', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'UserAccounts',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'createdAt', type: 'timestamptz' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', table: 'UserAccounts', rule: 'no-snake-case' }))
  })

  it('warns when every column in a table is string-like', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'raw_imports',
          columns: [
            { name: 'id', type: 'varchar(255)', constraints: { primary: true, notNull: true } },
            { name: 'payload', type: 'text' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', table: 'raw_imports', rule: 'all-string' }))
  })

  it('warns when a primary key is missing notNull', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'widgets',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true } },
            { name: 'created_at', type: 'timestamptz' },
            { name: 'updated_at', type: 'timestamptz' },
          ],
        },
      ])
    )

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', table: 'widgets', column: 'id', rule: 'missing-not-null' }))
  })

  it('returns no issues for a clean valid schema', () => {
    const issues = lintSchema(
      makeSchema([
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            { name: 'status', type: "enum('active','inactive')" },
            { name: 'created_at', type: 'timestamptz' },
            { name: 'updated_at', type: 'timestamptz' },
          ],
        },
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'uuid', constraints: { primary: true, notNull: true } },
            {
              name: 'user_id',
              type: 'uuid',
              constraints: { foreign: { table: 'users', column: 'id' }, notNull: true },
            },
            { name: 'amount', type: 'decimal(10,2)' },
            { name: 'created_at', type: 'timestamptz' },
            { name: 'updated_at', type: 'timestamptz' },
          ],
          indexes: [{ name: 'orders_user_id_idx', columns: ['user_id'] }],
        },
      ])
    )

    expect(issues).toEqual([])
  })
})
