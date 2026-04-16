'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { irToSchemaDocument } from '@/lib/ir/migrate'
import { stringify } from 'yaml'
import { yamlToCanvas } from '@/lib/schema-engine'
import type { Ir } from '@/lib/ir'
import { IR_LAST_MTIME_KEY } from '@/components/IrAutosaveBootstrap'
import type { IrWatchEvent } from '@/app/api/ir/watch/route'

/** How long (ms) to debounce fs watch events before acting on them. */
const DEBOUNCE_MS = 400

/** Reconnect delay (ms) when SSE stream closes unexpectedly. */
const RECONNECT_DELAY_MS = 5000

type DialogVariant = 'dirty' | 'clean'

interface DialogState {
  variant: DialogVariant
  mtime: number
}

function getLastMtime(): number | null {
  try {
    const raw = sessionStorage.getItem(IR_LAST_MTIME_KEY)
    if (raw === null) return null
    const val = Number(raw)
    return Number.isFinite(val) ? val : null
  } catch {
    return null
  }
}

/**
 * Subscribes to /api/ir/watch (SSE) and shows a dialog when the on-disk
 * ir.yaml is modified externally (e.g. via git pull or direct IDE edit).
 *
 * Conflict policy C2: UI state wins by default.
 *   - If there are unsaved local changes, ask the user whether to keep or reload.
 *   - If the canvas is clean (no unsaved changes), offer a lightweight reload toast.
 */
export function IrExternalWatcher() {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // ---------- Reload action ----------

  const reloadFromDisk = useCallback(async () => {
    try {
      const res = await fetch('/api/ir', { method: 'GET' })
      if (!res.ok) return
      const body = (await res.json()) as { ir: Ir | null; mtime?: number }
      if (!body.ir) return

      const schemaDoc = irToSchemaDocument(body.ir)
      const yamlStr = stringify(schemaDoc)
      const { nodes, edges } = await yamlToCanvas(yamlStr)
      useAppStore.getState().setCanvas(nodes, edges)

      // Update baseline mtime so the watcher doesn't re-fire for this write
      if (body.mtime !== undefined) {
        try {
          sessionStorage.setItem(IR_LAST_MTIME_KEY, String(body.mtime))
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error('[ir-watcher] reload failed:', err)
    }
  }, [])

  // ---------- SSE subscription ----------

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    const es = new EventSource('/api/ir/watch')
    esRef.current = es

    es.onmessage = (e: MessageEvent<string>) => {
      if (!mountedRef.current) return
      let event: IrWatchEvent
      try {
        event = JSON.parse(e.data) as IrWatchEvent
      } catch {
        return
      }

      if (event.type !== 'changed' || event.mtime === undefined) return

      const incomingMtime = event.mtime

      // Debounce rapid sequences of fs events
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (!mountedRef.current) return

        const localMtime = getLastMtime()
        // Only react when the disk is strictly newer than our last save
        if (localMtime !== null && incomingMtime <= localMtime) return

        // Check autosave dirty state
        const storeNodes = useAppStore.getState().nodes
        const storeEdges = useAppStore.getState().edges
        // Determine if canvas is "dirty" (has content that differs from last known disk state)
        // We infer dirty by checking saveState from the legacy autosave hook too.
        // Simplest heuristic: check if saveState is 'saving', or use the ir autosave status
        // exposed via a module-level accessor if available.
        // Since we can't easily reach IrAutosave's dirty flag without prop-drilling, we use
        // the legacy saveState as a proxy: 'saving' means writes are in-flight.
        const saveState = useAppStore.getState().saveState
        const hasPotentiallyUnsavedWork = storeNodes.length > 0 || storeEdges.length > 0
        const isDirty = saveState === 'saving' || hasPotentiallyUnsavedWork

        setDialog({
          variant: isDirty ? 'dirty' : 'clean',
          mtime: incomingMtime,
        })
      }, DEBOUNCE_MS)
    }

    es.onerror = () => {
      es.close()
      esRef.current = null
      // Reconnect after delay (SSE can fail when the file doesn't exist yet)
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, RECONNECT_DELAY_MS)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [connect])

  // ---------- Dialog handlers ----------

  const handleDiscardAndReload = useCallback(async () => {
    setDialog(null)
    await reloadFromDisk()
  }, [reloadFromDisk])

  const handleKeepLocal = useCallback((incomingMtime: number) => {
    // Record the incoming mtime so we don't keep showing the dialog.
    // The next autosave will overwrite disk anyway (C2 policy).
    try {
      sessionStorage.setItem(IR_LAST_MTIME_KEY, String(incomingMtime))
    } catch {
      /* ignore */
    }
    setDialog(null)
  }, [])

  const handleIgnore = useCallback((incomingMtime: number) => {
    // Suppress future alerts for this particular change
    try {
      sessionStorage.setItem(IR_LAST_MTIME_KEY, String(incomingMtime))
    } catch {
      /* ignore */
    }
    setDialog(null)
  }, [])

  if (!dialog) return null

  // ---------- Render ----------

  if (dialog.variant === 'dirty') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ir-watcher-title"
        className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />

        <div className="relative w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-amber-500" aria-hidden="true">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </span>
            <h2
              id="ir-watcher-title"
              className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-800"
            >
              检测到外部改动
            </h2>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            磁盘上的架构文件被外部改动了（比如 git pull 或 IDE 里直接编辑）。你本地有未保存的改动，请选择：
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => handleKeepLocal(dialog.mtime)}
              className="vp-button-secondary rounded-xl px-4 py-2 text-sm font-medium"
            >
              保留本地（下次保存会覆盖磁盘）
            </button>
            <button
              type="button"
              onClick={handleDiscardAndReload}
              className="vp-button-primary rounded-xl px-4 py-2 text-sm font-medium"
            >
              丢弃本地并重载
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Clean variant — lightweight toast
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ir-watcher-title"
      className="fixed bottom-6 right-6 z-[200] w-full max-w-sm"
    >
      <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-xl">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-blue-500" aria-hidden="true">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </span>
          <h2
            id="ir-watcher-title"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-700"
          >
            架构已被外部更新
          </h2>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          磁盘上的架构文件被改动了，是否重载同步？
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => handleIgnore(dialog.mtime)}
            className="vp-button-secondary rounded-xl px-3 py-1.5 text-xs font-medium"
          >
            忽略
          </button>
          <button
            type="button"
            onClick={handleDiscardAndReload}
            className="vp-button-primary rounded-xl px-3 py-1.5 text-xs font-medium"
          >
            重载
          </button>
        </div>
      </div>
    </div>
  )
}
