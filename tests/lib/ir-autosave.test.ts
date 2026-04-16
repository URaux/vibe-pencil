import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IrAutosave, type PostIr } from '@/lib/ir/autosave'
import type { Ir } from '@/lib/ir'
import { IR_VERSION } from '@/lib/ir'

const fixedMetadata = {
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

function buildIr(overrides: Partial<Ir['project']> & { blocks?: Ir['blocks'] } = {}): Ir {
  return {
    version: IR_VERSION,
    project: {
      name: overrides.name ?? 'Test',
      metadata: overrides.metadata ?? fixedMetadata,
    },
    containers: [],
    blocks: overrides.blocks ?? [],
    edges: [],
    audit_log: [],
    seed_state: {},
  }
}

describe('IrAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a write on first mutation and flushes after debounce', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 1 })
    const autosave = new IrAutosave({ postIr, debounceMs: 100 })
    const seeded = buildIr()
    autosave.seed(seeded)

    const mutated = buildIr({ name: 'Renamed' })
    const queued = autosave.notifyCanvasMutated(mutated)
    expect(queued).toBe(true)
    expect(postIr).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(postIr).toHaveBeenCalledTimes(1)
    expect(postIr).toHaveBeenCalledWith(mutated)
    expect(autosave.getStatus().phase).toBe('saved')
  })

  it('skips write when IR bytes match last saved snapshot', () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 1 })
    const autosave = new IrAutosave({ postIr, debounceMs: 100 })
    const ir = buildIr()
    autosave.seed(ir)

    const queued = autosave.notifyCanvasMutated(ir)
    expect(queued).toBe(false)
    vi.advanceTimersByTime(500)
    expect(postIr).not.toHaveBeenCalled()
  })

  it('coalesces rapid mutations into a single write', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 1 })
    const autosave = new IrAutosave({ postIr, debounceMs: 200 })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'A' }))
    vi.advanceTimersByTime(100)
    autosave.notifyCanvasMutated(buildIr({ name: 'B' }))
    vi.advanceTimersByTime(100)
    autosave.notifyCanvasMutated(buildIr({ name: 'C' }))
    await vi.advanceTimersByTimeAsync(200)

    expect(postIr).toHaveBeenCalledTimes(1)
    const firstArg = postIr.mock.calls[0][0]
    expect(firstArg.project.name).toBe('C')
  })

  it('flush() forces immediate write without waiting for debounce', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 1 })
    const autosave = new IrAutosave({ postIr, debounceMs: 5000 })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'Flushed' }))
    expect(postIr).not.toHaveBeenCalled()

    const flushed = await autosave.flush()
    expect(flushed).toBe(true)
    expect(postIr).toHaveBeenCalledTimes(1)
  })

  it('reports error status when postIr fails', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: false, error: 'disk full' })
    const statusLog: string[] = []
    const autosave = new IrAutosave({
      postIr,
      debounceMs: 10,
      onStatus: (s) => statusLog.push(s.phase),
    })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'E' }))
    await vi.advanceTimersByTimeAsync(10)

    expect(autosave.getStatus().phase).toBe('error')
    expect(autosave.getStatus().lastError).toBe('disk full')
    expect(autosave.getStatus().dirty).toBe(true)
  })

  it('reports error when postIr throws', async () => {
    const postIr = vi.fn<PostIr>().mockRejectedValue(new Error('network down'))
    const autosave = new IrAutosave({ postIr, debounceMs: 10 })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'X' }))
    await vi.advanceTimersByTimeAsync(10)

    expect(autosave.getStatus().phase).toBe('error')
    expect(autosave.getStatus().lastError).toBe('network down')
  })

  it('dispose cancels pending writes', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 1 })
    const autosave = new IrAutosave({ postIr, debounceMs: 100 })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'Canceled' }))
    autosave.dispose()
    await vi.advanceTimersByTimeAsync(200)

    expect(postIr).not.toHaveBeenCalled()
  })

  it('emits status transitions: idle → pending → saving → saved', async () => {
    const postIr = vi.fn<PostIr>().mockResolvedValue({ ok: true, mtime: 42 })
    const phases: string[] = []
    const autosave = new IrAutosave({
      postIr,
      debounceMs: 10,
      onStatus: (s) => phases.push(s.phase),
    })
    autosave.seed(buildIr())

    autosave.notifyCanvasMutated(buildIr({ name: 'Y' }))
    await vi.advanceTimersByTimeAsync(10)

    expect(phases).toEqual(['idle', 'pending', 'saving', 'saved'])
    expect(autosave.getStatus().lastMtime).toBe(42)
  })
})
