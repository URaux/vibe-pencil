'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getRandomLoadingMessage } from '@/lib/loading-messages'

interface LogLine {
  text: string
  isLoadingMessage?: boolean
  nodeId?: string
  nodeName?: string
}

export function OutputLog() {
  const buildOutputLog = useAppStore(
    (state) => (state as any).buildOutputLog as Record<string, string> | undefined
  ) ?? {}
  const buildState = useAppStore((state) => state.buildState)
  const nodes = useAppStore((state) => state.nodes)

  const targetNodeIds: string[] = (buildState as any).targetNodeIds ?? []

  // Build name map
  const nodeNameMap = new Map<string, string>()
  for (const node of nodes) {
    if (node.type === 'block') {
      nodeNameMap.set(node.id, (node.data as any).name ?? node.id)
    }
  }

  // Filter state: 'all' | nodeId
  const [filter, setFilter] = useState<'all' | string>('all')
  const [pinToBottom, setPinToBottom] = useState(true)
  const [isUserScrolled, setIsUserScrolled] = useState(false)

  // Local display buffer for loading messages (display-only, not in store)
  const [loadingLines, setLoadingLines] = useState<string[]>([])
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rotate loading messages every 4-6s during active build
  useEffect(() => {
    if (!buildState.active) {
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current)
        loadingIntervalRef.current = null
      }
      return
    }
    const schedule = () => {
      const delay = 4000 + Math.random() * 2000
      loadingIntervalRef.current = setTimeout(() => {
        const msg = getRandomLoadingMessage()
        setLoadingLines((prev) => [...prev, msg])
        schedule()
      }, delay) as unknown as ReturnType<typeof setInterval>
    }
    schedule()
    return () => {
      if (loadingIntervalRef.current) clearTimeout(loadingIntervalRef.current as unknown as ReturnType<typeof setTimeout>)
    }
  }, [buildState.active])

  // Build displayed lines
  const displayLines: LogLine[] = []

  if (filter === 'all') {
    // Interleave all node outputs with [NodeName] prefix per line
    for (const nodeId of targetNodeIds) {
      const output = buildOutputLog[nodeId]
      if (!output) continue
      const name = nodeNameMap.get(nodeId) ?? nodeId
      for (const line of output.split('\n')) {
        displayLines.push({ text: line, nodeId, nodeName: name })
      }
    }
    // Append loading messages at the end
    for (const msg of loadingLines) {
      displayLines.push({ text: msg, isLoadingMessage: true })
    }
  } else {
    // Single node view
    const output = buildOutputLog[filter] ?? ''
    for (const line of output.split('\n')) {
      displayLines.push({ text: line, nodeId: filter })
    }
    // Append loading messages
    for (const msg of loadingLines) {
      displayLines.push({ text: msg, isLoadingMessage: true })
    }
  }

  // Auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const scrolledUp = el.scrollTop + el.clientHeight < el.scrollHeight - 20
    setIsUserScrolled(scrolledUp)
    if (!scrolledUp) setPinToBottom(true)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (pinToBottom && !isUserScrolled) {
      el.scrollTop = el.scrollHeight
    }
  }, [displayLines.length, pinToBottom, isUserScrolled])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        {/* Filter dropdown */}
        <select
          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-300"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {/* TODO: i18n */}
          <option value="all">All nodes</option>
          {targetNodeIds.map((id) => (
            <option key={id} value={id}>
              {nodeNameMap.get(id) ?? id}
            </option>
          ))}
        </select>

        <span className="flex-1" />

        {/* Pin-to-bottom toggle */}
        <button
          type="button"
          onClick={() => {
            setPinToBottom((v) => !v)
            setIsUserScrolled(false)
          }}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            pinToBottom
              ? 'bg-orange-50 text-orange-600'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
          }`}
          title={pinToBottom ? 'Auto-scroll on' : 'Auto-scroll off'}
        >
          {/* TODO: i18n */}
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {pinToBottom ? 'Following' : 'Follow'}
        </button>
      </div>

      {/* Log area */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200"
        onScroll={handleScroll}
      >
        {displayLines.length === 0 ? (
          <span className="italic text-slate-500">
            {/* TODO: i18n */}
            {buildState.active ? 'Waiting for output...' : 'No output yet.'}
          </span>
        ) : (
          displayLines.map((line, i) => {
            if (line.isLoadingMessage) {
              return (
                <div key={`lm-${i}`} className="italic text-slate-500">
                  {line.text}
                </div>
              )
            }
            if (filter === 'all' && line.nodeName) {
              return (
                <div key={i} className="whitespace-pre-wrap">
                  <span className="mr-1 text-amber-400">[{line.nodeName}]</span>
                  <span>{line.text}</span>
                </div>
              )
            }
            return (
              <div key={i} className="whitespace-pre-wrap">
                {line.text}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
