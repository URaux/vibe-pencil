import type { BlockSchema, FKEdgeData, SchemaColumn, SchemaTable } from './types'

interface TableLocation {
  blockId: string
  table: SchemaTable
}

function normalizeBaseType(type: string): string {
  return type.trim().toLowerCase().replace(/\(.*\)/, '').replace(/\s+/g, ' ')
}

function collectTableLocations(blockSchemas: Map<string, BlockSchema>): Map<string, TableLocation[]> {
  const tableLocations = new Map<string, TableLocation[]>()

  for (const [blockId, schema] of blockSchemas) {
    for (const table of schema.tables) {
      const existing = tableLocations.get(table.name) ?? []
      existing.push({ blockId, table })
      tableLocations.set(table.name, existing)
    }
  }

  return tableLocations
}

function findColumn(table: SchemaTable, columnName: string): SchemaColumn | undefined {
  return table.columns.find((column) => column.name === columnName)
}

function findTable(blockSchemas: Map<string, BlockSchema>, tableName: string): TableLocation | undefined {
  for (const [blockId, schema] of blockSchemas) {
    const table = schema.tables.find((candidate) => candidate.name === tableName)
    if (table) {
      return { blockId, table }
    }
  }

  return undefined
}

export function extractFKEdges(blockSchemas: Map<string, BlockSchema>): FKEdgeData[] {
  const tableLocations = collectTableLocations(blockSchemas)
  const edges: FKEdgeData[] = []

  for (const [sourceBlockId, schema] of blockSchemas) {
    for (const table of schema.tables) {
      for (const column of table.columns) {
        const foreign = column.constraints?.foreign
        if (!foreign) continue

        const targetLocation = (tableLocations.get(foreign.table) ?? []).find(
          (location) => location.blockId !== sourceBlockId
        )

        if (!targetLocation) continue

        edges.push({
          edgeType: 'fk',
          sourceTable: table.name,
          sourceColumn: column.name,
          targetTable: foreign.table,
          targetColumn: foreign.column,
        })
      }
    }
  }

  return edges
}

export function validateFKEdges(
  edges: FKEdgeData[],
  blockSchemas: Map<string, BlockSchema>
): Array<{ edge: FKEdgeData; error: string }> {
  const errors: Array<{ edge: FKEdgeData; error: string }> = []

  for (const edge of edges) {
    const sourceLocation = findTable(blockSchemas, edge.sourceTable)
    if (!sourceLocation) {
      errors.push({ edge, error: `Source table not found: ${edge.sourceTable}` })
      continue
    }

    const sourceColumn = findColumn(sourceLocation.table, edge.sourceColumn)
    if (!sourceColumn) {
      errors.push({
        edge,
        error: `Source column not found: ${edge.sourceTable}.${edge.sourceColumn}`,
      })
      continue
    }

    const targetLocation = findTable(blockSchemas, edge.targetTable)
    if (!targetLocation) {
      errors.push({ edge, error: `Target table not found: ${edge.targetTable}` })
      continue
    }

    const targetColumn = findColumn(targetLocation.table, edge.targetColumn)
    if (!targetColumn) {
      errors.push({
        edge,
        error: `Target column not found: ${edge.targetTable}.${edge.targetColumn}`,
      })
      continue
    }

    if (normalizeBaseType(sourceColumn.type) !== normalizeBaseType(targetColumn.type)) {
      errors.push({
        edge,
        error: `Incompatible FK column types: ${edge.sourceTable}.${edge.sourceColumn} (${sourceColumn.type}) vs ${edge.targetTable}.${edge.targetColumn} (${targetColumn.type})`,
      })
    }
  }

  return errors
}

export function fkEdgeLabel(fk: FKEdgeData): string {
  return `${fk.sourceTable}.${fk.sourceColumn} → ${fk.targetTable}.${fk.targetColumn}`
}
