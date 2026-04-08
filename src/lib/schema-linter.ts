import type { BlockSchema, SchemaColumn, SchemaTable } from './types'

export interface LintIssue {
  severity: 'error' | 'warning'
  table: string
  column?: string
  rule: string
  message: string
  suggestion?: string
}

const SNAKE_CASE_REGEX = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const MONEY_KEYWORDS = ['price', 'amount', 'cost', 'total', 'balance']
const TIMESTAMP_KEYWORDS = ['_at', '_date', 'time']
const STATUS_COLUMN_NAMES = new Set(['status', 'type', 'category', 'state', 'role'])

function normalizeType(type: string) {
  return type.trim().toLowerCase()
}

function isVarcharOrText(type: string) {
  const normalizedType = normalizeType(type)

  return normalizedType === 'text' || normalizedType.startsWith('varchar')
}

function isStringLike(type: string) {
  const normalizedType = normalizeType(type)

  return normalizedType === 'string' || normalizedType === 'text' || normalizedType.startsWith('varchar')
}

function isFloatOrDouble(type: string) {
  const normalizedType = normalizeType(type)

  return normalizedType === 'float' || normalizedType.startsWith('double')
}

function isEnumType(type: string) {
  return normalizeType(type).startsWith('enum')
}

function hasForeignKey(column: SchemaColumn) {
  return Boolean(column.constraints?.foreign)
}

function hasIndexForColumn(table: SchemaTable, columnName: string) {
  return (table.indexes ?? []).some((index) => index.columns.includes(columnName))
}

function collectKnownTables(schema: BlockSchema, allSchemas?: Map<string, BlockSchema>) {
  const knownTables = new Set(schema.tables.map((table) => table.name))

  for (const externalSchema of allSchemas?.values() ?? []) {
    for (const table of externalSchema.tables) {
      knownTables.add(table.name)
    }
  }

  return knownTables
}

export function lintSchema(schema: BlockSchema, allSchemas?: Map<string, BlockSchema>): LintIssue[] {
  const issues: LintIssue[] = []
  const knownTables = collectKnownTables(schema, allSchemas)

  for (const table of schema.tables) {
    const tableName = table.name
    const hasPrimaryKey = table.columns.some((column) => column.constraints?.primary)
    const columnNames = new Set(table.columns.map((column) => column.name))

    if (!hasPrimaryKey) {
      issues.push({
        severity: 'error',
        table: tableName,
        rule: 'no-pk',
        message: `Table "${tableName}" has no primary key column.`,
        suggestion: 'Mark one column as primary or add an id column with primary: true.',
      })
    }

    if (!SNAKE_CASE_REGEX.test(tableName)) {
      issues.push({
        severity: 'warning',
        table: tableName,
        rule: 'no-snake-case',
        message: `Table "${tableName}" is not in snake_case.`,
        suggestion: 'Rename the table to snake_case, for example "user_accounts".',
      })
    }

    const missingTimestamps = ['created_at', 'updated_at'].filter((columnName) => !columnNames.has(columnName))
    if (missingTimestamps.length > 0) {
      issues.push({
        severity: 'warning',
        table: tableName,
        rule: 'missing-timestamps',
        message: `Table "${tableName}" is missing ${missingTimestamps.join(' and ')}.`,
        suggestion: 'Add both created_at and updated_at timestamptz columns.',
      })
    }

    if (table.columns.length > 0 && table.columns.every((column) => isStringLike(column.type))) {
      issues.push({
        severity: 'warning',
        table: tableName,
        rule: 'all-string',
        message: `Table "${tableName}" only uses string-like column types.`,
        suggestion: 'Use stronger types for identifiers, booleans, numbers, dates, and enums where appropriate.',
      })
    }

    for (const column of table.columns) {
      const columnName = column.name
      const normalizedName = columnName.toLowerCase()
      const isPrimary = Boolean(column.constraints?.primary)
      const isForeign = hasForeignKey(column)

      if (!SNAKE_CASE_REGEX.test(columnName)) {
        issues.push({
          severity: 'warning',
          table: tableName,
          column: columnName,
          rule: 'no-snake-case',
          message: `Column "${tableName}.${columnName}" is not in snake_case.`,
          suggestion: 'Rename the column to snake_case, for example "created_at".',
        })
      }

      if (MONEY_KEYWORDS.some((keyword) => normalizedName.includes(keyword)) && isFloatOrDouble(column.type)) {
        issues.push({
          severity: 'error',
          table: tableName,
          column: columnName,
          rule: 'float-money',
          message: `Column "${tableName}.${columnName}" uses ${column.type} for a money-like field.`,
          suggestion: 'Use a decimal or numeric type for money values.',
        })
      }

      if (TIMESTAMP_KEYWORDS.some((keyword) => normalizedName.includes(keyword)) && isVarcharOrText(column.type)) {
        issues.push({
          severity: 'error',
          table: tableName,
          column: columnName,
          rule: 'varchar-timestamp',
          message: `Column "${tableName}.${columnName}" stores a timestamp-like field as ${column.type}.`,
          suggestion: 'Use timestamptz for timestamps and dates.',
        })
      }

      if (STATUS_COLUMN_NAMES.has(normalizedName) && isVarcharOrText(column.type) && !isEnumType(column.type)) {
        issues.push({
          severity: 'error',
          table: tableName,
          column: columnName,
          rule: 'string-status',
          message: `Column "${tableName}.${columnName}" is a status-like field stored as ${column.type}.`,
          suggestion: 'Use an enum type or a constrained lookup table.',
        })
      }

      if (isForeign) {
        const targetTable = column.constraints?.foreign?.table ?? ''

        if (!knownTables.has(targetTable)) {
          issues.push({
            severity: 'error',
            table: tableName,
            column: columnName,
            rule: 'fk-no-target',
            message: `Column "${tableName}.${columnName}" references missing table "${targetTable}".`,
            suggestion: 'Point the foreign key at an existing table in this schema or the provided schema map.',
          })
        }

        if (!hasIndexForColumn(table, columnName)) {
          issues.push({
            severity: 'warning',
            table: tableName,
            column: columnName,
            rule: 'fk-no-index',
            message: `Foreign key column "${tableName}.${columnName}" is not indexed.`,
            suggestion: `Add an index on "${columnName}" to improve joins and deletes.`,
          })
        }
      }

      if ((isPrimary || isForeign) && !column.constraints?.notNull) {
        issues.push({
          severity: 'warning',
          table: tableName,
          column: columnName,
          rule: 'missing-not-null',
          message: `Column "${tableName}.${columnName}" should be marked not null.`,
          suggestion: 'Set notNull: true on primary and foreign key columns.',
        })
      }
    }
  }

  return issues
}
