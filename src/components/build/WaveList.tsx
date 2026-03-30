'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { BuildStatus } from '@/lib/types'

// ---- Elapsed time helpers ----

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

function useElapsed(startedAt: number | undefined, finishedAt: number | undefined): string {
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (startedAt !== undefined && finishedAt === undefined) {
      timerRef.current = setInterval(() => setNow(Date.now()), 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [startedAt, finishedAt])

  if (startedAt === undefined) return '--'
  const end = finishedAt ?? now
  return formatElapsed(end - startedAt)
}

// ---- Status icon ----

function StatusIcon({ status }: { status: BuildStatus | 'waiting' | 'blocked' }) {
  if (status === 'building') {
    return <span className="vp-spinner shrink-0" />
  }
  if (status === 'done') {
    return (
      <span className="vp-checkmark-pop shrink-0">
        <svg
          className="h-3 w-3 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="shrink-0">
        <svg
          className="h-3 w-3 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    )
  }
  // waiting / idle / blocked
  return (
    <span className="shrink-0">
      <svg
        className="h-3 w-3 text-slate-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    </span>
  )
}

// ---- Wave aggregate status ----

function waveAggregateStatus(
  nodeIds: string[],
  nodeStatusMap: Map<string, BuildStatus>
): 'done' | 'building' | 'waiting' | 'error' {
  const statuses = nodeIds.map((id) => nodeStatusMap.get(id) ?? 'idle')
  if (statuses.every((s) => s === 'done')) return 'done'
  if (statuses.some((s) => s === 'building')) return 'building'
  if (statuses.some((s) => s === 'error')) return 'error'
  return 'waiting'
}

// ---- Node row ----

interface NodeRowProps {
  nodeId: string
  nodeName: string
  status: BuildStatus
  startedAt: number | undefined
  finishedAt: number | undefined
  errorMessage: string | undefined
  blockedByName: string | undefined
}

function NodeRow({
  nodeName,
  status,
  startedAt,
  finishedAt,
  errorMessage,
  blockedByName,
}: NodeRowProps) {
  const elapsed = useElapsed(startedAt, finishedAt)
  const [errorExpanded, setErrorExpanded] = useState(false)

  return (
    <div className="pl-4">
      <div className="flex items-center gap-2 py-1 text-xs">
        <StatusIcon status={status} />
        <span className="flex-1 truncate text-slate-700">{nodeName}</span>
        <span className="shrink-0 tabular-nums text-slate-400">{elapsed}</span>
      </div>

      {/* Blocked badge */}
      {status === ('blocked' as string) && blockedByName && (
        <div className="mb-1 ml-5 text-xs text-red-400">
          {/* TODO: i18n — "Blocked by:" */}
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium">
            Blocked by: {blockedByName}
          </span>
        </div>
      )}

      {/* Error row */}
      {status === 'error' && errorMessage && (
        <div className="mb-1 ml-5">
          <button
            type="button"
            className="text-xs text-red-400 underline underline-offset-2 hover:text-red-500"
            onClick={() => setErrorExpanded((v) => !v)}
          >
            {/* TODO: i18n */}
            {errorExpanded ? 'Hide error' : 'Show error'}
          </button>
          {errorExpanded && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-[10px] text-red-600">
              {errorMessage}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Wave section ----

interface WaveSectionProps {
  waveIndex: number
  nodeIds: string[]
  nodeStatusMap: Map<string, BuildStatus>
  nodeNameMap: Map<string, string>
  nodeTimings: Record<string, { startedAt?: number; finishedAt?: number }>
  nodeErrorMap: Map<string, string | undefined>
  blockedNodes: Record<string, string>
}

function WaveSection({
  waveIndex,
  nodeIds,
  nodeStatusMap,
  nodeNameMap,
  nodeTimings,
  nodeErrorMap,
  blockedNodes,
}: WaveSectionProps) {
  const aggregate = waveAggregateStatus(nodeIds, nodeStatusMap)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Wave header */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
        onClick={() => setCollapsed((v) => !v)}
      >
        {/* Aggregate icon */}
        <span className="shrink-0">
          {aggregate === 'done' ? (
            <svg
              className="h-3.5 w-3.5 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : aggregate === 'building' ? (
            <span className="vp-spinner" />
          ) : aggregate === 'error' ? (
            <svg
              className="h-3.5 w-3.5 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              className="h-3.5 w-3.5 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="10" />
            </svg>
          )}
        </span>

        {/* TODO: i18n — "Wave" */}
        <span>Wave {waveIndex + 1}</span>
        <span className="ml-auto text-slate-300">{collapsed ? '▶' : '▼'}</span>
      </button>

      {/* Node rows */}
      {!collapsed && (
        <div className="pb-1">
          {nodeIds.map((nodeId) => {
            const status = nodeStatusMap.get(nodeId) ?? 'idle'
            const timings = nodeTimings[nodeId] ?? {}
            const blockedById = blockedNodes[nodeId]
            const blockedByName = blockedById ? nodeNameMap.get(blockedById) : undefined
            return (
              <NodeRow
                key={nodeId}
                nodeId={nodeId}
                nodeName={nodeNameMap.get(nodeId) ?? nodeId}
                status={status}
                startedAt={timings.startedAt}
                finishedAt={timings.finishedAt}
                errorMessage={nodeErrorMap.get(nodeId)}
                blockedByName={blockedByName}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Main WaveList ----

export function WaveList() {
  // Read planned waves from buildState (will be populated after Phase 1.2 store changes)
  const waves = useAppStore((state) => (state.buildState as any).waves as string[][] | undefined) ?? []
  const nodeTimings =
    useAppStore((state) => (state.buildState as any).nodeTimings as Record<string, { startedAt?: number; finishedAt?: number }> | undefined) ?? {}
  const blockedNodes =
    useAppStore((state) => (state.buildState as any).blockedNodes as Record<string, string> | undefined) ?? {}
  const nodes = useAppStore((state) => state.nodes)

  // Build lookup maps from nodes
  const nodeStatusMap = new Map<string, BuildStatus>()
  const nodeNameMap = new Map<string, string>()
  const nodeErrorMap = new Map<string, string | undefined>()

  for (const node of nodes) {
    if (node.type === 'block') {
      const data = node.data as { status?: BuildStatus; name?: string; errorMessage?: string }
      nodeStatusMap.set(node.id, data.status ?? 'idle')
      nodeNameMap.set(node.id, data.name ?? node.id)
      nodeErrorMap.set(node.id, data.errorMessage)
    }
  }

  if (waves.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-slate-400">
        {/* TODO: i18n */}
        No wave data available.
      </div>
    )
  }

  return (
    <div className="overflow-y-auto">
      {waves.map((nodeIds, i) => (
        <WaveSection
          key={i}
          waveIndex={i}
          nodeIds={nodeIds}
          nodeStatusMap={nodeStatusMap}
          nodeNameMap={nodeNameMap}
          nodeTimings={nodeTimings}
          nodeErrorMap={nodeErrorMap}
          blockedNodes={blockedNodes}
        />
      ))}
    </div>
  )
}
