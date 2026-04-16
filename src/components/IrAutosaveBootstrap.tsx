'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { canvasToIr } from '@/lib/ir/canvas-to-ir'
import { IrAutosave, browserPostIr, type AutosaveStatus } from '@/lib/ir/autosave'
import type { Ir } from '@/lib/ir'

/** sessionStorage key shared with IrExternalWatcher so it can detect external edits. */
export const IR_LAST_MTIME_KEY = 'ir-last-mtime'

interface Props {
  debounceMs?: number
  onStatus?: (status: AutosaveStatus) => void
}

// Mount once in the app tree. Subscribes to canvas state and writes IR to
// /api/ir on substantial change.
export function IrAutosaveBootstrap({ debounceMs = 5000, onStatus }: Props) {
  const autosaveRef = useRef<IrAutosave | null>(null)

  useEffect(() => {
    // Wrap the status callback to persist lastMtime into sessionStorage so the
    // external watcher can read it without prop-drilling or a Context.
    const wrappedOnStatus = (status: AutosaveStatus) => {
      if (status.lastMtime !== undefined) {
        try {
          sessionStorage.setItem(IR_LAST_MTIME_KEY, String(status.lastMtime))
        } catch {
          /* sessionStorage unavailable in some sandboxed environments */
        }
      }
      onStatus?.(status)
    }

    const autosave = new IrAutosave({
      postIr: browserPostIr,
      debounceMs,
      onStatus: wrappedOnStatus,
    })
    autosaveRef.current = autosave

    // Seed from disk so the first local canvas change that happens to match
    // disk state (common on reload + restore flows) doesn't trigger a redundant
    // POST.
    let cancelled = false
    fetch('/api/ir', { method: 'GET' })
      .then((res) => res.json())
      .then((body: { ir: Ir | null; mtime?: number }) => {
        if (cancelled) return
        autosave.seed(body.ir ?? null, body.mtime)
        // Persist seed mtime so the external watcher has a valid baseline even
        // before the first autosave write.
        if (body.mtime !== undefined) {
          try {
            sessionStorage.setItem(IR_LAST_MTIME_KEY, String(body.mtime))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        if (cancelled) return
        autosave.seed(null)
      })

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      // Short-circuit when the fields IR consumes haven't changed. Position-only
      // drags and selection changes fall through here cheaply.
      if (
        state.nodes === prev.nodes &&
        state.edges === prev.edges &&
        state.projectName === prev.projectName
      ) {
        return
      }

      try {
        const ir = canvasToIr(state.nodes, state.edges, state.projectName)
        autosave.notifyCanvasMutated(ir)
      } catch (err) {
        // Canvas may transiently be in an un-serializable state during multi-step
        // mutations; log and wait for the next consistent tick.
        console.warn('[ir-autosave] canvasToIr failed:', err)
      }
    })

    const flushBeforeUnload = () => {
      void autosave.flush()
    }
    window.addEventListener('beforeunload', flushBeforeUnload)

    return () => {
      cancelled = true
      window.removeEventListener('beforeunload', flushBeforeUnload)
      unsubscribe()
      autosave.dispose()
      autosaveRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
