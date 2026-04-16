'use client'

import { useEffect, useState } from 'react'
import type { BlockSchema, ColumnConstraints, SchemaColumn, SchemaIndex, SchemaTable } from '@/lib/types'

interface SchemaEditorProps {
  schema: BlockSchema | undefined
  onChange: (schema: BlockSchema | undefined) => void
  readOnly?: boolean
  hint?: string
}

function createEmptyColumn(): SchemaColumn {
  return {
    name: '',
    type: 'varchar(255)',
  }
}

function createEmptyIndex(): SchemaIndex {
  return {
    name: '',
    columns: [],
  }
}

function createEmptyTable(): SchemaTable {
  return {
    name: '',
    columns: [createEmptyColumn()],
    indexes: [],
  }
}

function normalizeConstraints(constraints: ColumnConstraints | undefined) {
  if (!constraints) {
    return undefined
  }

  const nextConstraints: ColumnConstraints = {}

  if (constraints.primary) {
    nextConstraints.primary = true
  }
  if (constraints.unique) {
    nextConstraints.unique = true
  }
  if (constraints.notNull) {
    nextConstraints.notNull = true
  }
  if (constraints.default?.trim()) {
    nextConstraints.default = constraints.default.trim()
  }
  if (constraints.foreign && (constraints.foreign.table.trim() || constraints.foreign.column.trim())) {
    nextConstraints.foreign = {
      table: constraints.foreign.table.trim(),
      column: constraints.foreign.column.trim(),
    }
  }

  return Object.keys(nextConstraints).length > 0 ? nextConstraints : undefined
}

function parseForeignReference(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return undefined
  }

  const [table = '', ...columnParts] = trimmedValue.split('.')

  return {
    table: table.trim(),
    column: columnParts.join('.').trim(),
  }
}

function formatForeignReference(constraints: ColumnConstraints | undefined) {
  if (!constraints?.foreign) {
    return ''
  }

  return [constraints.foreign.table, constraints.foreign.column].filter(Boolean).join('.')
}

function getColumnHighlight(column: SchemaColumn) {
  const isPrimary = column.constraints?.primary
  const isForeign = Boolean(column.constraints?.foreign)

  if (isPrimary && isForeign) {
    return 'border border-slate-200 bg-gradient-to-r from-amber-50 via-white to-sky-50'
  }

  if (isPrimary) {
    return 'border border-amber-200 bg-amber-50'
  }

  if (isForeign) {
    return 'border border-sky-200 bg-sky-50'
  }

  return 'border border-slate-200 bg-white'
}

export default function SchemaEditor({ schema, onChange, readOnly = false, hint }: SchemaEditorProps) {
  const [localSchema, setLocalSchema] = useState<BlockSchema | undefined>(schema)
  const [isExpanded, setIsExpanded] = useState(Boolean(schema))

  useEffect(() => {
    setLocalSchema(schema)
    setIsExpanded(Boolean(schema))
  }, [schema])

  function commitSchema(nextSchema: BlockSchema | undefined) {
    setLocalSchema(nextSchema)
    setIsExpanded(Boolean(nextSchema))
    if (!readOnly) {
      onChange(nextSchema)
    }
  }

  function updateSchema(updater: (current: BlockSchema) => BlockSchema) {
    if (readOnly) {
      return
    }
    const nextSchema = updater(localSchema ?? { tables: [] })
    commitSchema(nextSchema.tables.length > 0 ? nextSchema : undefined)
  }

  function updateTable(tableIndex: number, updater: (table: SchemaTable) => SchemaTable) {
    updateSchema((current) => ({
      tables: current.tables.map((table, index) => (index === tableIndex ? updater(table) : table)),
    }))
  }

  function updateColumn(
    tableIndex: number,
    columnIndex: number,
    updater: (column: SchemaColumn) => SchemaColumn
  ) {
    updateTable(tableIndex, (table) => ({
      ...table,
      columns: table.columns.map((column, index) =>
        index === columnIndex ? updater(column) : column
      ),
    }))
  }

  function updateIndex(
    tableIndex: number,
    indexIndex: number,
    updater: (index: SchemaIndex) => SchemaIndex
  ) {
    updateTable(tableIndex, (table) => ({
      ...table,
      indexes: (table.indexes ?? []).map((index, currentIndex) =>
        currentIndex === indexIndex ? updater(index) : index
      ),
    }))
  }

  function handleAddSchema() {
    if (readOnly) {
      return
    }
    commitSchema({ tables: [] })
    setIsExpanded(true)
  }

  if (!localSchema && !isExpanded) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
        {readOnly ? (
          <p className="text-sm text-slate-500">
            {hint ?? 'Schema is defined in the data layer.'}
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleAddSchema}
          disabled={readOnly}
          className="vp-button-secondary rounded-2xl px-4 py-2 text-sm font-medium"
        >
          + Add Schema
        </button>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Database Schema</h3>
          <p className="text-xs text-slate-500">
            {localSchema ? `${localSchema.tables.length} table${localSchema.tables.length === 1 ? '' : 's'}` : 'No tables yet'}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-slate-400">{hint}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!localSchema ? (
            <button
              type="button"
              onClick={handleAddSchema}
              disabled={readOnly}
              className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium uppercase tracking-[0.2em]"
            >
              + Add Schema
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium uppercase tracking-[0.2em]"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="mt-4 space-y-4">
          {localSchema?.tables.map((table, tableIndex) => (
            <div key={`table-${tableIndex}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Table Name
                  </span>
                  <input
                    type="text"
                    value={table.name}
                    onChange={(event) =>
                      updateTable(tableIndex, (currentTable) => ({
                        ...currentTable,
                        name: event.target.value,
                      }))
                    }
                    placeholder="users"
                    className="vp-input w-full rounded-2xl px-4 py-3 text-sm"
                    disabled={readOnly}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateSchema((current) => ({
                      tables: current.tables.filter((_, index) => index !== tableIndex),
                    }))
                  }
                  disabled={readOnly}
                  className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium text-rose-600"
                >
                  Delete Table
                </button>
              </div>

              <div className="mt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Columns</h4>
                    <p className="mt-1 text-xs text-slate-500">Name | Type | PK | FK | NOT NULL | Unique</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateTable(tableIndex, (currentTable) => ({
                        ...currentTable,
                        columns: [...currentTable.columns, createEmptyColumn()],
                      }))
                    }
                    disabled={readOnly}
                    className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium"
                  >
                    Add Column
                  </button>
                </div>

                {table.columns.length > 0 ? (
                  <div className="space-y-2">
                    <div className="hidden min-w-[760px] grid-cols-[minmax(140px,1.2fr)_minmax(140px,1fr)_64px_minmax(160px,1.3fr)_96px_72px] gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid">
                      <span>Name</span>
                      <span>Type</span>
                      <span className="text-center">PK</span>
                      <span>FK</span>
                      <span className="text-center">Not Null</span>
                      <span className="text-center">Unique</span>
                    </div>
                    <div className="overflow-x-auto pb-1">
                      <div className="min-w-[760px] space-y-2">
                        {table.columns.map((column, columnIndex) => (
                          <div key={`column-${tableIndex}-${columnIndex}`} className="flex items-start gap-2">
                            <div
                              className={`grid flex-1 grid-cols-[minmax(140px,1.2fr)_minmax(140px,1fr)_64px_minmax(160px,1.3fr)_96px_72px] gap-2 rounded-2xl p-3 ${getColumnHighlight(column)}`}
                            >
                              <input
                                type="text"
                                value={column.name}
                                onChange={(event) =>
                                  updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                    ...currentColumn,
                                    name: event.target.value,
                                  }))
                                }
                                placeholder="id"
                                className="vp-input rounded-2xl px-3 py-2 text-sm"
                                disabled={readOnly}
                              />
                              <input
                                type="text"
                                value={column.type}
                                onChange={(event) =>
                                  updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                    ...currentColumn,
                                    type: event.target.value,
                                  }))
                                }
                                placeholder="uuid"
                                className="vp-input rounded-2xl px-3 py-2 text-sm"
                                disabled={readOnly}
                              />
                              <label className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(column.constraints?.primary)}
                                  onChange={(event) =>
                                    updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                      ...currentColumn,
                                      constraints: normalizeConstraints({
                                        ...currentColumn.constraints,
                                        primary: event.target.checked || undefined,
                                      }),
                                    }))
                                  }
                                  className="h-4 w-4 accent-amber-500"
                                  disabled={readOnly}
                                />
                              </label>
                              <input
                                type="text"
                                value={formatForeignReference(column.constraints)}
                                onChange={(event) =>
                                  updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                    ...currentColumn,
                                    constraints: normalizeConstraints({
                                      ...currentColumn.constraints,
                                      foreign: parseForeignReference(event.target.value),
                                    }),
                                  }))
                                }
                                placeholder="users.id"
                                className="vp-input rounded-2xl px-3 py-2 text-sm"
                                disabled={readOnly}
                              />
                              <label className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(column.constraints?.notNull)}
                                  onChange={(event) =>
                                    updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                      ...currentColumn,
                                      constraints: normalizeConstraints({
                                        ...currentColumn.constraints,
                                        notNull: event.target.checked || undefined,
                                      }),
                                    }))
                                  }
                                  className="h-4 w-4 accent-slate-700"
                                  disabled={readOnly}
                                />
                              </label>
                              <label className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(column.constraints?.unique)}
                                  onChange={(event) =>
                                    updateColumn(tableIndex, columnIndex, (currentColumn) => ({
                                      ...currentColumn,
                                      constraints: normalizeConstraints({
                                        ...currentColumn.constraints,
                                        unique: event.target.checked || undefined,
                                      }),
                                    }))
                                  }
                                  className="h-4 w-4 accent-slate-700"
                                  disabled={readOnly}
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateTable(tableIndex, (currentTable) => ({
                                  ...currentTable,
                                  columns: currentTable.columns.filter((_, index) => index !== columnIndex),
                                }))
                              }
                              disabled={readOnly}
                              className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                    No columns yet.
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Indexes</h4>
                    <p className="mt-1 text-xs text-slate-500">Use comma-separated column names.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateTable(tableIndex, (currentTable) => ({
                        ...currentTable,
                        indexes: [...(currentTable.indexes ?? []), createEmptyIndex()],
                      }))
                    }
                    disabled={readOnly}
                    className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium"
                  >
                    Add Index
                  </button>
                </div>

                {table.indexes && table.indexes.length > 0 ? (
                  <div className="space-y-2">
                    {table.indexes.map((index, indexIndex) => (
                      <div
                        key={`index-${tableIndex}-${indexIndex}`}
                        className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(140px,1fr)_minmax(200px,1.3fr)_88px_auto]"
                      >
                        <input
                          type="text"
                          value={index.name}
                          onChange={(event) =>
                            updateIndex(tableIndex, indexIndex, (currentIndex) => ({
                              ...currentIndex,
                              name: event.target.value,
                            }))
                          }
                          placeholder="idx_users_email"
                          className="vp-input rounded-2xl px-3 py-2 text-sm"
                          disabled={readOnly}
                        />
                        <input
                          type="text"
                          value={index.columns.join(', ')}
                          onChange={(event) =>
                            updateIndex(tableIndex, indexIndex, (currentIndex) => ({
                              ...currentIndex,
                              columns: event.target.value
                                .split(',')
                                .map((columnName) => columnName.trim())
                                .filter(Boolean),
                            }))
                          }
                          placeholder="email, tenant_id"
                          className="vp-input rounded-2xl px-3 py-2 text-sm"
                          disabled={readOnly}
                        />
                        <label className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(index.unique)}
                            onChange={(event) =>
                              updateIndex(tableIndex, indexIndex, (currentIndex) => ({
                                ...currentIndex,
                                unique: event.target.checked || undefined,
                              }))
                            }
                            className="h-4 w-4 accent-slate-700"
                            disabled={readOnly}
                          />
                          Unique
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            updateTable(tableIndex, (currentTable) => ({
                              ...currentTable,
                              indexes: (currentTable.indexes ?? []).filter((_, currentIndex) => currentIndex !== indexIndex),
                            }))
                          }
                          disabled={readOnly}
                          className="vp-button-secondary rounded-2xl px-3 py-2 text-xs font-medium text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                    No indexes yet.
                  </div>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              updateSchema((current) => ({
                tables: [...current.tables, createEmptyTable()],
              }))
            }
            disabled={readOnly}
            className="vp-button-primary rounded-2xl px-4 py-3 text-sm font-medium"
          >
            Add Table
          </button>
        </div>
      ) : null}
    </section>
  )
}
