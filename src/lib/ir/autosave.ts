import type { Ir } from './schema'
import { serializeIr } from './serialize'

export type PostIr = (ir: Ir) => Promise<{ ok: boolean; mtime?: number; error?: string }>

export interface AutosaveStatus {
  phase: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  lastSavedAt?: number
  lastMtime?: number
  lastError?: string
  dirty: boolean
}

export interface AutosaveOptions {
  debounceMs?: number
  onStatus?: (status: AutosaveStatus) => void
  postIr: PostIr
}

// Autosave engine: diff current IR against last-persisted snapshot, debounce
// writes, call `postIr` which the caller wires to POST /api/ir.
//
// Filtering by "substantial change" is implicit: IR excludes position and
// UI-only state, so a canvas pan/drag that doesn't touch any semantic field
// produces the same IR bytes and skips the write entirely.
export class IrAutosave {
  private lastSerialized: string | null = null
  private pendingIr: Ir | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private status: AutosaveStatus = { phase: 'idle', dirty: false }
  private readonly debounceMs: number
  private readonly postIr: PostIr
  private readonly onStatus?: (status: AutosaveStatus) => void

  constructor(options: AutosaveOptions) {
    this.debounceMs = options.debounceMs ?? 5000
    this.postIr = options.postIr
    this.onStatus = options.onStatus
  }

  // Call this from store subscriptions. Returns true when a write was queued,
  // false if the IR bytes match the last saved snapshot.
  notifyCanvasMutated(ir: Ir): boolean {
    const serialized = serializeIr(ir)
    if (serialized === this.lastSerialized) {
      // No substantial change: skip. Status remains whatever it last was.
      return false
    }

    this.pendingIr = ir
    this.emit({ ...this.status, phase: 'pending', dirty: true })

    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)

    return true
  }

  // Force immediate write of any pending IR (e.g. before tab close / SPA nav).
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pendingIr) return false

    const ir = this.pendingIr
    const serialized = serializeIr(ir)
    this.pendingIr = null
    this.emit({ ...this.status, phase: 'saving', dirty: true })

    try {
      const res = await this.postIr(ir)
      if (!res.ok) {
        const err = res.error ?? 'unknown autosave error'
        this.emit({
          phase: 'error',
          dirty: true,
          lastError: err,
          lastSavedAt: this.status.lastSavedAt,
          lastMtime: this.status.lastMtime,
        })
        return false
      }
      this.lastSerialized = serialized
      this.emit({
        phase: 'saved',
        dirty: false,
        lastSavedAt: Date.now(),
        lastMtime: res.mtime,
      })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({
        phase: 'error',
        dirty: true,
        lastError: message,
        lastSavedAt: this.status.lastSavedAt,
        lastMtime: this.status.lastMtime,
      })
      return false
    }
  }

  // Seed the engine with an already-persisted IR so the next canvas change
  // that matches disk state doesn't trigger a redundant write.
  seed(ir: Ir | null, mtime?: number): void {
    this.lastSerialized = ir ? serializeIr(ir) : null
    this.emit({
      phase: 'idle',
      dirty: false,
      lastSavedAt: ir ? Date.now() : undefined,
      lastMtime: mtime,
    })
  }

  getStatus(): AutosaveStatus {
    return this.status
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pendingIr = null
  }

  private emit(status: AutosaveStatus): void {
    this.status = status
    this.onStatus?.(status)
  }
}

// Default HTTP poster that talks to /api/ir. Browser-side only.
export const browserPostIr: PostIr = async (ir) => {
  const res = await fetch('/api/ir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ir }),
  })
  if (!res.ok) {
    let error = `HTTP ${res.status}`
    try {
      const body = await res.json()
      error = body.error ?? error
    } catch {
      /* ignore */
    }
    return { ok: false, error }
  }
  const body = await res.json()
  return { ok: true, mtime: body.mtime }
}
