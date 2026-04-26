/**
 * Schema diff — Phase 3 drift extension.
 *
 * Compares two block.schema values (the Pydantic-style table schema
 * embedded on data-store blocks) and produces a structured diff that the
 * drift renderer can surface in PR comments.
 *
 * Granularity:
 *   - tables: added / removed / changed (by table.name)
 *   - within a changed table: columns added / removed / changed; indexes added / removed
 *   - within a changed column: type change OR constraint change
 *
 * Pure logic; no I/O.
 */

import type { IrBlock } from '@/lib/ir/schema'

type BlockSchema = NonNullable<IrBlock['schema']>
type SchemaTable = BlockSchema['tables'][number]
type SchemaColumn = SchemaTable['columns'][number]
type SchemaIndex = NonNullable<SchemaTable['indexes']>[number]

export interface ColumnChange {
  name: string
  changes: string[]
}

export interface TableChange {
  name: string
  addedColumns: SchemaColumn[]
  removedColumns: SchemaColumn[]
  changedColumns: ColumnChange[]
  addedIndexes: SchemaIndex[]
  removedIndexes: SchemaIndex[]
}

export interface SchemaDriftReport {
  addedTables: SchemaTable[]
  removedTables: SchemaTable[]
  changedTables: TableChange[]
  /** Convenience flag — true when there's no schema diff at all. */
  clean: boolean
}

function indexBy<T>(items: readonly T[], keyFn: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>()
  for (const it of items) m.set(keyFn(it), it)
  return m
}

function columnsEqual(a: SchemaColumn, b: SchemaColumn): boolean {
  if (a.type !== b.type) return false
  const ac = a.constraints ?? {}
  const bc = b.constraints ?? {}
  if ((ac.primary ?? false) !== (bc.primary ?? false)) return false
  if ((ac.unique ?? false) !== (bc.unique ?? false)) return false
  if ((ac.notNull ?? false) !== (bc.notNull ?? false)) return false
  if ((ac.default ?? '') !== (bc.default ?? '')) return false
  const af = ac.foreign
  const bf = bc.foreign
  if (af === undefined && bf === undefined) return true
  if (af === undefined || bf === undefined) return false
  return af.table === bf.table && af.column === bf.column
}

function describeColumnChange(before: SchemaColumn, after: SchemaColumn): string[] {
  const out: string[] = []
  if (before.type !== after.type) {
    out.push(`type: ${before.type} → ${after.type}`)
  }
  const bc = before.constraints ?? {}
  const ac = after.constraints ?? {}
  if ((bc.primary ?? false) !== (ac.primary ?? false)) {
    out.push(`primary: ${Boolean(bc.primary)} → ${Boolean(ac.primary)}`)
  }
  if ((bc.unique ?? false) !== (ac.unique ?? false)) {
    out.push(`unique: ${Boolean(bc.unique)} → ${Boolean(ac.unique)}`)
  }
  if ((bc.notNull ?? false) !== (ac.notNull ?? false)) {
    out.push(`notNull: ${Boolean(bc.notNull)} → ${Boolean(ac.notNull)}`)
  }
  if ((bc.default ?? '') !== (ac.default ?? '')) {
    out.push(`default: ${bc.default ?? '(none)'} → ${ac.default ?? '(none)'}`)
  }
  const bf = bc.foreign
  const af = ac.foreign
  if (bf === undefined && af !== undefined) {
    out.push(`foreign: (none) → ${af.table}.${af.column}`)
  } else if (bf !== undefined && af === undefined) {
    out.push(`foreign: ${bf.table}.${bf.column} → (none)`)
  } else if (bf !== undefined && af !== undefined) {
    if (bf.table !== af.table || bf.column !== af.column) {
      out.push(`foreign: ${bf.table}.${bf.column} → ${af.table}.${af.column}`)
    }
  }
  return out
}

function indexesEqual(a: SchemaIndex, b: SchemaIndex): boolean {
  if (a.name !== b.name) return false
  if ((a.unique ?? false) !== (b.unique ?? false)) return false
  if (a.columns.length !== b.columns.length) return false
  for (let i = 0; i < a.columns.length; i++) {
    if (a.columns[i] !== b.columns[i]) return false
  }
  return true
}

function diffTable(before: SchemaTable, after: SchemaTable): TableChange | null {
  const beforeCols = indexBy(before.columns, (c) => c.name)
  const afterCols = indexBy(after.columns, (c) => c.name)
  const addedColumns: SchemaColumn[] = []
  const removedColumns: SchemaColumn[] = []
  const changedColumns: ColumnChange[] = []
  for (const [name, col] of afterCols) {
    const prev = beforeCols.get(name)
    if (!prev) addedColumns.push(col)
    else if (!columnsEqual(prev, col)) {
      changedColumns.push({ name, changes: describeColumnChange(prev, col) })
    }
  }
  for (const [name, col] of beforeCols) {
    if (!afterCols.has(name)) removedColumns.push(col)
  }

  const beforeIdx = before.indexes ?? []
  const afterIdx = after.indexes ?? []
  const addedIndexes: SchemaIndex[] = []
  const removedIndexes: SchemaIndex[] = []
  for (const i of afterIdx) {
    if (!beforeIdx.some((b) => indexesEqual(b, i))) addedIndexes.push(i)
  }
  for (const i of beforeIdx) {
    if (!afterIdx.some((a) => indexesEqual(a, i))) removedIndexes.push(i)
  }

  if (
    addedColumns.length === 0 &&
    removedColumns.length === 0 &&
    changedColumns.length === 0 &&
    addedIndexes.length === 0 &&
    removedIndexes.length === 0
  ) {
    return null
  }
  return {
    name: after.name,
    addedColumns,
    removedColumns,
    changedColumns,
    addedIndexes,
    removedIndexes,
  }
}

export function detectSchemaDrift(
  before: BlockSchema | undefined,
  after: BlockSchema | undefined,
): SchemaDriftReport {
  const beforeTables = before?.tables ?? []
  const afterTables = after?.tables ?? []
  const beforeMap = indexBy(beforeTables, (t) => t.name)
  const afterMap = indexBy(afterTables, (t) => t.name)

  const addedTables: SchemaTable[] = []
  const removedTables: SchemaTable[] = []
  const changedTables: TableChange[] = []
  for (const [name, t] of afterMap) {
    const prev = beforeMap.get(name)
    if (!prev) addedTables.push(t)
    else {
      const change = diffTable(prev, t)
      if (change) changedTables.push(change)
    }
  }
  for (const [name, t] of beforeMap) {
    if (!afterMap.has(name)) removedTables.push(t)
  }

  const clean =
    addedTables.length === 0 && removedTables.length === 0 && changedTables.length === 0
  return { addedTables, removedTables, changedTables, clean }
}

/** Render a SchemaDriftReport as a compact markdown fragment. */
export function renderSchemaDriftMarkdown(report: SchemaDriftReport): string {
  if (report.clean) return ''
  const lines: string[] = []
  if (report.addedTables.length > 0) {
    lines.push(`  - tables added: ${report.addedTables.map((t) => `\`${t.name}\``).join(', ')}`)
  }
  if (report.removedTables.length > 0) {
    lines.push(`  - tables removed: ${report.removedTables.map((t) => `\`${t.name}\``).join(', ')}`)
  }
  for (const t of report.changedTables) {
    const parts: string[] = []
    if (t.addedColumns.length > 0) parts.push(`+${t.addedColumns.length} cols`)
    if (t.removedColumns.length > 0) parts.push(`-${t.removedColumns.length} cols`)
    if (t.changedColumns.length > 0) parts.push(`~${t.changedColumns.length} cols`)
    if (t.addedIndexes.length > 0) parts.push(`+${t.addedIndexes.length} idx`)
    if (t.removedIndexes.length > 0) parts.push(`-${t.removedIndexes.length} idx`)
    lines.push(`  - \`${t.name}\`: ${parts.join(', ')}`)
    for (const c of t.changedColumns.slice(0, 3)) {
      lines.push(`    - column \`${c.name}\`: ${c.changes.join('; ')}`)
    }
    if (t.changedColumns.length > 3) {
      lines.push(`    - … +${t.changedColumns.length - 3} more column changes`)
    }
  }
  return lines.join('\n')
}
