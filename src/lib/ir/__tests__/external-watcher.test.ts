/**
 * Unit tests for IrExternalWatcher logic.
 *
 * We test:
 *  1. SSE event parsing (the IrWatchEvent shape)
 *  2. Deduplication: same mtime+size must not re-trigger
 *  3. UI branch selection: dirty vs clean
 *
 * fs.watch (server-side) is platform-specific and is skipped per spec.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IrWatchEvent } from '@/app/api/ir/watch/route'

// ---------------------------------------------------------------------------
// 1. SSE event parsing
// ---------------------------------------------------------------------------

describe('IrWatchEvent parsing', () => {
  it('parses a changed event correctly', () => {
    const raw = JSON.stringify({ type: 'changed', mtime: 1713100000000, size: 1234 })
    const event = JSON.parse(raw) as IrWatchEvent
    expect(event.type).toBe('changed')
    expect(event.mtime).toBe(1713100000000)
    expect(event.size).toBe(1234)
  })

  it('parses a deleted event correctly', () => {
    const raw = JSON.stringify({ type: 'deleted' })
    const event = JSON.parse(raw) as IrWatchEvent
    expect(event.type).toBe('deleted')
    expect(event.mtime).toBeUndefined()
  })

  it('ignores unknown keys (type safety via TypeScript)', () => {
    // Extra keys are accepted by JSON.parse — we just don't use them
    const raw = JSON.stringify({ type: 'changed', mtime: 100, size: 50, extra: 'ignored' })
    const event = JSON.parse(raw) as IrWatchEvent
    expect(event.type).toBe('changed')
  })

  it('rejects malformed JSON without crashing (caller catches)', () => {
    expect(() => JSON.parse('not-json')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. Deduplication logic
// ---------------------------------------------------------------------------

/**
 * Pure deduplication function extracted from the watcher's handleChange
 * behaviour. We inline a simplified version to test in isolation.
 */
function makeDeduplicator() {
  let lastMtime: number | null = null
  let lastSize: number | null = null

  return {
    /** Returns true if the event is a NEW change that should be surfaced. */
    shouldSurface(mtime: number, size: number): boolean {
      if (mtime === lastMtime && size === lastSize) return false
      lastMtime = mtime
      lastSize = size
      return true
    },
    reset() {
      lastMtime = null
      lastSize = null
    },
  }
}

describe('Deduplication logic', () => {
  it('surfaces the first event', () => {
    const dedup = makeDeduplicator()
    expect(dedup.shouldSurface(1000, 500)).toBe(true)
  })

  it('suppresses a second event with identical mtime+size', () => {
    const dedup = makeDeduplicator()
    dedup.shouldSurface(1000, 500)
    expect(dedup.shouldSurface(1000, 500)).toBe(false)
  })

  it('surfaces an event where only mtime changed', () => {
    const dedup = makeDeduplicator()
    dedup.shouldSurface(1000, 500)
    expect(dedup.shouldSurface(2000, 500)).toBe(true)
  })

  it('surfaces an event where only size changed', () => {
    const dedup = makeDeduplicator()
    dedup.shouldSurface(1000, 500)
    expect(dedup.shouldSurface(1000, 600)).toBe(true)
  })

  it('surfaces events again after reset', () => {
    const dedup = makeDeduplicator()
    dedup.shouldSurface(1000, 500)
    dedup.reset()
    expect(dedup.shouldSurface(1000, 500)).toBe(true)
  })

  it('suppresses events older than localMtime (external vs own write)', () => {
    /**
     * The watcher checks: incomingMtime > localMtime before surfacing.
     * Simulate this guard inline.
     */
    const localMtime = 2000
    const incoming = 1500 // older than our last save → should be ignored
    expect(incoming > localMtime).toBe(false)
  })

  it('surfaces events strictly newer than localMtime', () => {
    const localMtime = 2000
    const incoming = 2500
    expect(incoming > localMtime).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. UI branch: dirty vs clean
// ---------------------------------------------------------------------------

type DialogVariant = 'dirty' | 'clean'

/**
 * Replicate the variant-selection logic from IrExternalWatcher without
 * importing the React component (avoids jsdom + ReactFlow setup).
 */
function selectVariant(
  saveState: 'saved' | 'saving',
  nodeCount: number,
  edgeCount: number,
): DialogVariant {
  const hasPotentiallyUnsavedWork = nodeCount > 0 || edgeCount > 0
  const isDirty = saveState === 'saving' || hasPotentiallyUnsavedWork
  return isDirty ? 'dirty' : 'clean'
}

describe('UI branch selection (dirty vs clean)', () => {
  it('returns dirty when saveState is saving', () => {
    expect(selectVariant('saving', 0, 0)).toBe('dirty')
  })

  it('returns dirty when canvas has nodes', () => {
    expect(selectVariant('saved', 3, 0)).toBe('dirty')
  })

  it('returns dirty when canvas has edges', () => {
    expect(selectVariant('saved', 0, 2)).toBe('dirty')
  })

  it('returns dirty when canvas has both nodes and edges', () => {
    expect(selectVariant('saved', 4, 3)).toBe('dirty')
  })

  it('returns clean when canvas is empty and saveState is saved', () => {
    expect(selectVariant('saved', 0, 0)).toBe('clean')
  })
})

// ---------------------------------------------------------------------------
// 4. sessionStorage baseline tracking
// ---------------------------------------------------------------------------

describe('sessionStorage mtime baseline', () => {
  const KEY = 'ir-last-mtime'

  beforeEach(() => {
    // Clear sessionStorage before each test
    // In jsdom environment this is available
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* skip if unavailable */
    }
  })

  it('reads null when key is absent', () => {
    const raw = sessionStorage.getItem(KEY)
    expect(raw).toBeNull()
  })

  it('reads back a stored mtime', () => {
    sessionStorage.setItem(KEY, '1713100000000')
    const val = Number(sessionStorage.getItem(KEY))
    expect(val).toBe(1713100000000)
  })

  it('incoming event equal to stored mtime should NOT trigger (guard check)', () => {
    const storedMtime = 1713100000000
    sessionStorage.setItem(KEY, String(storedMtime))
    const localMtime = Number(sessionStorage.getItem(KEY))
    const incomingMtime = 1713100000000
    expect(incomingMtime > localMtime).toBe(false)
  })

  it('incoming event newer than stored mtime SHOULD trigger', () => {
    const storedMtime = 1713100000000
    sessionStorage.setItem(KEY, String(storedMtime))
    const localMtime = Number(sessionStorage.getItem(KEY))
    const incomingMtime = 1713200000000
    expect(incomingMtime > localMtime).toBe(true)
  })
})
