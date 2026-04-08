import { describe, expect, it } from 'vitest'
import { extractFKEdges, fkEdgeLabel, validateFKEdges } from '../../src/lib/fk-edge-utils'
import type { BlockSchema, FKEdgeData } from '../../src/lib/types'

describe('fk-edge-utils', () => {
  it('extracts FK edges when the referenced table is in a different block', () => {
    const blockSchemas = new Map<string, BlockSchema>([
      [
        'orders-block',
        {
          tables: [
            {
              name: 'orders',
              columns: [
                { name: 'id', type: 'bigint', constraints: { primary: true } },
                {
                  name: 'user_id',
                  type: 'bigint',
                  constraints: { foreign: { table: 'users', column: 'id' } },
                },
              ],
            },
          ],
        },
      ],
      [
        'users-block',
        {
          tables: [
            {
              name: 'users',
              columns: [{ name: 'id', type: 'bigint', constraints: { primary: true } }],
            },
          ],
        },
      ],
    ])

    expect(extractFKEdges(blockSchemas)).toEqual([
      {
        edgeType: 'fk',
        sourceTable: 'orders',
        sourceColumn: 'user_id',
        targetTable: 'users',
        targetColumn: 'id',
      },
    ])
  })

  it('does not extract same-block foreign keys as cross-block edges', () => {
    const blockSchemas = new Map<string, BlockSchema>([
      [
        'commerce-block',
        {
          tables: [
            {
              name: 'users',
              columns: [{ name: 'id', type: 'bigint', constraints: { primary: true } }],
            },
            {
              name: 'orders',
              columns: [
                { name: 'id', type: 'bigint', constraints: { primary: true } },
                {
                  name: 'user_id',
                  type: 'bigint',
                  constraints: { foreign: { table: 'users', column: 'id' } },
                },
              ],
            },
          ],
        },
      ],
    ])

    expect(extractFKEdges(blockSchemas)).toEqual([])
  })

  it('returns an error when an FK edge targets a nonexistent table', () => {
    const blockSchemas = new Map<string, BlockSchema>([
      [
        'orders-block',
        {
          tables: [
            {
              name: 'orders',
              columns: [
                { name: 'id', type: 'bigint', constraints: { primary: true } },
                { name: 'user_id', type: 'bigint' },
              ],
            },
          ],
        },
      ],
    ])

    const edges: FKEdgeData[] = [
      {
        edgeType: 'fk',
        sourceTable: 'orders',
        sourceColumn: 'user_id',
        targetTable: 'users',
        targetColumn: 'id',
      },
    ]

    expect(validateFKEdges(edges, blockSchemas)).toEqual([
      {
        edge: edges[0],
        error: 'Target table not found: users',
      },
    ])
  })

  it('returns no errors for a valid FK edge', () => {
    const blockSchemas = new Map<string, BlockSchema>([
      [
        'orders-block',
        {
          tables: [
            {
              name: 'orders',
              columns: [
                { name: 'id', type: 'bigint', constraints: { primary: true } },
                { name: 'user_id', type: 'bigint' },
              ],
            },
          ],
        },
      ],
      [
        'users-block',
        {
          tables: [
            {
              name: 'users',
              columns: [{ name: 'id', type: 'bigint', constraints: { primary: true } }],
            },
          ],
        },
      ],
    ])

    const edges: FKEdgeData[] = [
      {
        edgeType: 'fk',
        sourceTable: 'orders',
        sourceColumn: 'user_id',
        targetTable: 'users',
        targetColumn: 'id',
      },
    ]

    expect(validateFKEdges(edges, blockSchemas)).toEqual([])
  })

  it('formats FK labels as sourceTable.sourceColumn → targetTable.targetColumn', () => {
    const edge: FKEdgeData = {
      edgeType: 'fk',
      sourceTable: 'orders',
      sourceColumn: 'user_id',
      targetTable: 'users',
      targetColumn: 'id',
    }

    expect(fkEdgeLabel(edge)).toBe('orders.user_id → users.id')
  })
})
