'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { getRandomLoadingMessage } from '@/lib/loading-messages'
import { BuildResults } from './build/BuildResults'
import { DrawerHeader } from './build/DrawerHeader'
import { WaveList } from './build/WaveList'
import { OutputLog } from './build/OutputLog'

type DrawerTab = 'waves' | 'output' | 'results'

const MIN_HEIGHT = 120
const MAX_HEIGHT_VH = 0.6
const DEFAULT_HEIGHT = 280

// ---- Collapsed summary strip ----

function CollapsedStrip({ onClick }: { onClick: () => void }) {
  const buildState = useAppStore((state) => state.buildState)
  const nodes = useAppStore((state) => state.nodes)

  const targetNodeIds: string[] = (buildState as any).targetNodeIds ?? []
  const startedAt: number | undefined = (buildState as any).startedAt
  const active = buildState.active

  // Count statuses
  let doneCount = 0
  let errorCount = 0
  let buildingCount = 0
  for (const id of targetNodeIds) {
    const node = nodes.find((n) => n.id === id)
    if (!node || node.type !== 'block') continue
    const status = (node.data as any).status
    if (status === 'done') doneCount++
    else if (status === 'error') errorCount++
    else if (status === 'building') buildingCount++
  }
  const total = targetNodeIds.length

  // Elapsed
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (!startedAt) { setElapsed(''); return }
    const update = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000)
      if (s < 60) setElapsed(`${s}s`)
      else {
        const m = Math.floor(s / 60)
        setElapsed(`${m}m ${s % 60}s`)
      }
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  let summary: string
  if (active) {
    // TODO: i18n
    summary = `Building... Wave ${buildState.currentWave}/${buildState.totalWaves} | ${doneCount}/${total} nodes${elapsed ? ` | ${elapsed}` : ''}`
  } else {
    const parts: string[] = []
    if (doneCount > 0) parts.push(`${doneCount}/${total} built`)
    if (errorCount > 0) parts.push(`${errorCount} failed`)
    summary = parts.join(', ') + (elapsed ? ` | ${elapsed}` : '')
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className="vp-panel flex h-10 w-full cursor-pointer items-center border-t border-slate-200/80 px-4 hover:bg-slate-50"
    >
      {active && <span className="vp-spinner mr-3 shrink-0" />}
      <span className="flex-1 truncate text-xs text-slate-600">{summary}</span>
      {/* Expand icon */}
      <svg
        className="ml-2 h-4 w-4 shrink-0 text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </div>
  )
}

// ---- Main BuildDrawer ----

export function BuildDrawer() {
  const drawerState = useAppStore((state) => (state as any).drawerState as 'hidden' | 'open' | 'collapsed' | undefined) ?? 'hidden'
  const setDrawerState = useAppStore((state) => (state as any).setDrawerState as ((s: 'hidden' | 'open' | 'collapsed') => void) | undefined)
  const buildState = useAppStore((state) => state.buildState)

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT)
  const [activeTab, setActiveTab] = useState<DrawerTab>('waves')
  const [loadingMessage] = useState(getRandomLoadingMessage)

  const dragStartY = useRef<number | null>(null)
  const dragStartHeight = useRef<number>(DEFAULT_HEIGHT)
  const prevActive = useRef<boolean>(false)

  // Auto-open on build start, collapse on build end
  useEffect(() => {
    const wasActive = prevActive.current
    const isActive = buildState.active
    if (!wasActive && isActive) {
      setDrawerState?.('open')
    }
    if (wasActive && !isActive) {
      setDrawerState?.('collapsed')
    }
    prevActive.current = isActive
  }, [buildState.active, setDrawerState])

  // Drag-to-resize
  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight

    const onMouseMove = (ev: MouseEvent) => {
      if (dragStartY.current === null) return
      const delta = dragStartY.current - ev.clientY
      const maxH = window.innerHeight * MAX_HEIGHT_VH
      const next = Math.min(maxH, Math.max(MIN_HEIGHT, dragStartHeight.current + delta))
      setPanelHeight(next)
    }

    const onMouseUp = () => {
      dragStartY.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelHeight])

  const handleStopAll = useCallback(async () => {
    await fetch('/api/agent/stop', { method: 'POST' })
    const state = useAppStore.getState()
    for (const nodeId of state.buildState.targetNodeIds) {
      const node = state.nodes.find((n) => n.id === nodeId)
      if (node && (node.data.status === 'building' || node.data.status === 'waiting')) {
        state.updateNodeStatus(nodeId, 'error', undefined, 'Stopped by user')
      }
    }
    state.setBuildState({
      active: false,
      completedAt: Date.now(),
    })
  }, [])

  const handleCollapse = useCallback(() => {
    setDrawerState?.('collapsed')
  }, [setDrawerState])

  const handleExpand = useCallback(() => {
    setDrawerState?.('open')
  }, [setDrawerState])

  const buildCompleted = !buildState.active && (buildState as any).completedAt !== undefined

  if (drawerState === 'hidden') return null

  if (drawerState === 'collapsed') {
    return (
      <div className="vp-drawer-enter fixed bottom-12 left-0 right-0 z-40">
        <CollapsedStrip onClick={handleExpand} />
      </div>
    )
  }

  // Open state
  return (
    <div
      className="vp-panel vp-drawer-enter fixed bottom-12 left-0 right-0 z-40 flex flex-col border-t border-slate-200/80"
      style={{ height: panelHeight }}
    >
      {/* Drag handle */}
      <div
        className="flex h-4 w-full cursor-ns-resize items-center justify-center"
        onMouseDown={onDragHandleMouseDown}
      >
        <div className="h-1 w-8 rounded-full bg-slate-300" />
      </div>

      {/* Header */}
      <DrawerHeader
        onStopAll={handleStopAll}
        onCollapse={handleCollapse}
        loadingMessage={loadingMessage}
      />

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-slate-200/80">
        {(['waves', 'output', ...(buildCompleted ? ['results' as DrawerTab] : [])] as DrawerTab[]).map(
          (tab) => (
            <button
              key={tab}
              type="button"
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-orange-400 text-orange-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {/* TODO: i18n */}
              {tab === 'waves' ? 'Waves' : tab === 'output' ? 'Output Log' : 'Results'}
            </button>
          )
        )}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'waves' && <WaveList />}
        {activeTab === 'output' && <OutputLog />}
        {activeTab === 'results' && buildCompleted && <BuildResults />}
      </div>
    </div>
  )
}
