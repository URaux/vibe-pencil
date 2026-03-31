'use client'

import { useEffect, useRef, useState } from 'react'
import { useCanvasProgress } from '@/hooks/useCanvasProgress'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ContainerColor } from '@/lib/types'

const COLOR_DOT: Record<ContainerColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400',
}

const COLOR_BAR: Record<ContainerColor, string> = {
  blue: 'bg-blue-400',
  green: 'bg-green-400',
  purple: 'bg-purple-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  slate: 'bg-slate-400',
}

function pillColor(percentage: number, hasError: boolean, hasBuilding: boolean): string {
  if (hasError) return 'bg-red-500'
  if (hasBuilding) return 'bg-amber-400'
  if (percentage === 100) return 'bg-green-500'
  return 'bg-blue-400'
}

function overallBarFill(percentage: number, hasError: boolean, hasBuilding: boolean) {
  if (hasError) return 'bg-red-400'
  if (hasBuilding) return 'bg-amber-400'
  if (percentage === 100) return 'bg-green-500'
  return 'bg-blue-400'
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
  )
}

export function ProgressWidget() {
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const progress = useCanvasProgress()
  const setSelectedNodeId = useAppStore((state) => state.setSelectedNodeId)
  useAppStore((state) => state.locale) // re-render on locale change

  const { totalBlocks, doneBlocks, buildingBlocks, errorBlocks, percentage, containers } = progress

  // Auto-expand during active build
  useEffect(() => {
    if (buildingBlocks > 0) {
      setExpanded(true)
    }
  }, [buildingBlocks])

  // Collapse on Escape or click outside
  useEffect(() => {
    if (!expanded) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false)
    }

    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [expanded])

  // Hide if no blocks
  if (totalBlocks === 0) return null

  const hasError = errorBlocks > 0
  const hasBuilding = buildingBlocks > 0

  return (
    <div
      ref={panelRef}
      className="fixed bottom-12 left-4 z-40"
    >
      {expanded ? (
        <div className="w-80 rounded-2xl border border-slate-200/80 bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">{t('project_progress')}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-600">{percentage}%</span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={t('collapse')}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Overall progress */}
          <div className="px-4 py-3">
            <div className="mb-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ${overallBarFill(percentage, hasError, hasBuilding)}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>{t('blocks_built', { done: doneBlocks, total: totalBlocks })}</span>
              {hasBuilding && (
                <span className="flex items-center gap-1 text-amber-600">
                  <Spinner />
                  {buildingBlocks}
                </span>
              )}
              {hasError && (
                <span className="text-red-500">{errorBlocks} {t('error')}</span>
              )}
            </div>
          </div>

          {/* Per-container rows */}
          {containers.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto border-t border-slate-100 pb-2">
              {containers.map((c) => (
                <div key={c.id} className="px-4 py-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_DOT[c.color]}`} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                      {c.name}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {c.done}/{c.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${COLOR_BAR[c.color]}`}
                      style={{ width: c.total === 0 ? '0%' : `${Math.round(c.progress * 100)}%` }}
                    />
                  </div>

                  {/* Error nodes */}
                  {c.errorNodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedNodeId(n.id)}
                      className="mt-1 flex w-full items-start gap-1 text-left text-xs text-red-500 hover:text-red-700"
                      title={n.error}
                    >
                      <span className="mt-0.5 shrink-0">!</span>
                      <span className="truncate">{n.name}</span>
                    </button>
                  ))}

                  {/* Building nodes */}
                  {c.buildingNodes.map((n) => (
                    <div
                      key={n.id}
                      className="mt-1 flex items-center gap-1 text-xs text-amber-600"
                    >
                      <Spinner />
                      <span className="truncate">{n.name}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Collapsed pill */
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white px-3 py-2 shadow-md hover:shadow-lg transition-shadow"
          title={t('project_progress')}
        >
          {/* Mini progress bar */}
          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-300 ${pillColor(percentage, hasError, hasBuilding)}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-slate-600">{percentage}%</span>
          <span className="text-xs text-slate-400">
            {doneBlocks}/{totalBlocks}
          </span>
          {hasBuilding && <Spinner />}
          {hasError && !hasBuilding && (
            <span className="h-2 w-2 rounded-full bg-red-500" />
          )}
        </button>
      )}
    </div>
  )
}
