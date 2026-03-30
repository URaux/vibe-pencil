'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getRandomLoadingMessage } from '@/lib/loading-messages'

interface DrawerHeaderProps {
  onStopAll: () => void
  onCollapse: () => void
  loadingMessage: string
}

export function DrawerHeader({ onStopAll, onCollapse, loadingMessage }: DrawerHeaderProps) {
  const buildState = useAppStore((state) => state.buildState)
  const [message, setMessage] = useState(loadingMessage)

  // Rotate loading message every 5 seconds while build is active
  useEffect(() => {
    if (!buildState.active) return
    const interval = setInterval(() => {
      setMessage(getRandomLoadingMessage())
    }, 5000)
    return () => clearInterval(interval)
  }, [buildState.active])

  // Sync external loadingMessage prop on initial/prop change
  useEffect(() => {
    setMessage(loadingMessage)
  }, [loadingMessage])

  const { currentWave, totalWaves } = buildState

  return (
    <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-2.5">
      {/* Left: title + whimsical message */}
      <div className="min-w-0 flex-1">
        {/* TODO: i18n — "Build Progress" */}
        <span className="text-sm font-semibold text-slate-700">Build Progress</span>
        {buildState.active && (
          <span className="ml-2 truncate text-xs italic text-slate-400">{message}</span>
        )}
      </div>

      {/* Center: wave indicator */}
      {totalWaves > 0 && (
        <div className="mx-4 flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
          {/* TODO: i18n — "Wave" */}
          <span>Wave</span>
          <span className="tabular-nums text-slate-700">
            {currentWave}/{totalWaves}
          </span>
        </div>
      )}

      {/* Right: Stop All + Collapse */}
      <div className="flex shrink-0 items-center gap-2">
        {buildState.active && (
          <button
            type="button"
            onClick={onStopAll}
            className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            {/* TODO: i18n — "Stop All" */}
            Stop All
          </button>
        )}
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Collapse drawer"
          title="Collapse"
        >
          {/* Minimize / chevron-down icon */}
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
