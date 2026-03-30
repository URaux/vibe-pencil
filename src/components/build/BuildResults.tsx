'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import type { BuildStatus } from '@/lib/types'

// ---- Elapsed time helper ----

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

// ---- Result card ----

interface ResultCardProps {
  nodeId: string
  nodeName: string
  status: BuildStatus
  elapsedMs: number | undefined
  errorMessage: string | undefined
  outputTail: string | undefined
}

function ResultCard({ nodeName, status, elapsedMs, errorMessage, outputTail }: ResultCardProps) {
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!errorMessage) return
    void navigator.clipboard.writeText(errorMessage).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isError = status === 'error'
  const isBlocked = status === ('blocked' as string)
  const isDone = status === 'done'

  // Border/background accent per status
  const cardClass = isError
    ? 'border-red-200 bg-red-50/50'
    : isBlocked
    ? 'border-slate-200 bg-slate-50/50 opacity-70'
    : 'border-green-200 bg-green-50/50'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${cardClass}`}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Status icon */}
        <span className="shrink-0">
          {isError ? (
            <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : isBlocked ? (
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
            </svg>
          ) : (
            <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-slate-800">{nodeName}</span>
        {/* Elapsed */}
        {elapsedMs !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-slate-400">
            {formatElapsed(elapsedMs)}
          </span>
        )}
        {/* Status badge */}
        {isBlocked && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {t('blocked_status')}
          </span>
        )}
      </div>

      {/* Error section */}
      {isError && errorMessage && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-red-600">Error</span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded px-2 py-0.5 text-[10px] text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-red-50 p-2 text-[10px] text-red-700">
            {errorMessage}
          </pre>
        </div>
      )}

      {/* Output tail for done nodes */}
      {isDone && outputTail && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
            onClick={() => setOutputExpanded((v) => !v)}
          >
            {outputExpanded ? 'Hide output' : 'Show last output'}
          </button>
          {outputExpanded && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-2 text-[10px] text-slate-300">
              {outputTail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Summary header ----

interface SummaryHeaderProps {
  doneCount: number
  errorCount: number
  blockedCount: number
  totalCount: number
  elapsedMs: number | undefined
}

function SummaryHeader({ doneCount, errorCount, blockedCount, totalCount, elapsedMs }: SummaryHeaderProps) {
  const nonBlockedTotal = totalCount - blockedCount

  let icon: React.ReactNode
  let text: string

  if (errorCount === 0 && blockedCount === 0) {
    icon = (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
        <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
    text = t('build_complete', { count: doneCount })
  } else if (doneCount === 0 && errorCount > 0) {
    icon = (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
        <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    )
    text = t('build_failed')
  } else {
    icon = (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
        <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </span>
    )
    text = t('build_partial', { done: doneCount, total: nonBlockedTotal, failed: errorCount })
  }

  return (
    <div className="flex items-center gap-3 border-b border-slate-200/80 px-4 py-3">
      {icon}
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-800">{text}</p>
        {elapsedMs !== undefined && (
          <p className="text-xs text-slate-400">
            {t('elapsed_time')}: {formatElapsed(elapsedMs)}
          </p>
        )}
      </div>
    </div>
  )
}

// ---- Last N lines of output ----

function getOutputTail(output: string | undefined, lines = 3): string | undefined {
  if (!output) return undefined
  const allLines = output.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (allLines.length === 0) return undefined
  return allLines.slice(-lines).join('\n')
}

// ---- Main BuildResults ----

export function BuildResults() {
  const buildState = useAppStore((state) => state.buildState)
  const nodes = useAppStore((state) => state.nodes)
  const buildOutputLog = useAppStore((state) => state.buildOutputLog)

  const { targetNodeIds, nodeTimings, blockedNodes, startedAt, completedAt } = buildState

  // Compute totals
  let doneCount = 0
  let errorCount = 0
  let blockedCount = 0

  interface CardData {
    nodeId: string
    nodeName: string
    status: BuildStatus
    elapsedMs: number | undefined
    errorMessage: string | undefined
    outputTail: string | undefined
    sortKey: number
  }

  const cards: CardData[] = []

  for (const nodeId of targetNodeIds) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== 'block') continue

    const data = node.data as { status?: BuildStatus; name?: string; errorMessage?: string }
    const status = data.status ?? 'idle'
    const timings = nodeTimings[nodeId]
    const elapsedMs =
      timings?.startedAt !== undefined && timings?.finishedAt !== undefined
        ? timings.finishedAt - timings.startedAt
        : undefined

    if (status === 'done') doneCount++
    else if (status === 'error') errorCount++
    else if (status === ('blocked' as string)) blockedCount++

    // sortKey: 0 = error, 1 = blocked, 2 = done, 3 = other
    const sortKey = status === 'error' ? 0 : status === ('blocked' as string) ? 1 : status === 'done' ? 2 : 3

    cards.push({
      nodeId,
      nodeName: data.name ?? nodeId,
      status,
      elapsedMs,
      errorMessage: data.errorMessage,
      outputTail: getOutputTail(buildOutputLog[nodeId]),
      sortKey,
    })
  }

  // Sort: errors first, blocked second, done last
  cards.sort((a, b) => a.sortKey - b.sortKey)

  const totalCount = targetNodeIds.length
  const elapsedMs =
    startedAt !== undefined && completedAt !== undefined ? completedAt - startedAt : undefined

  if (totalCount === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-slate-400">
        {t('results')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SummaryHeader
        doneCount={doneCount}
        errorCount={errorCount}
        blockedCount={blockedCount}
        totalCount={totalCount}
        elapsedMs={elapsedMs}
      />
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {cards.map((card) => (
          <ResultCard
            key={card.nodeId}
            nodeId={card.nodeId}
            nodeName={card.nodeName}
            status={card.status}
            elapsedMs={card.elapsedMs}
            errorMessage={card.errorMessage}
            outputTail={card.outputTail}
          />
        ))}
      </div>
    </div>
  )
}
