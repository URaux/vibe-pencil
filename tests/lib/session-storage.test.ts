import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportSessions, importSessions, loadSessions, saveSessions } from '@/lib/session-storage'
import type { ChatSession } from '@/lib/store'

function makeSessions(): ChatSession[] {
  return [
    {
      id: 'session-1',
      title: 'Alpha',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      phase: 'brainstorm',
    },
    {
      id: 'session-2',
      title: 'Beta',
      messages: [
        { role: 'user', content: 'Design it' },
      ],
      createdAt: 1700000002000,
      updatedAt: 1700000003000,
      phase: 'design',
    },
  ]
}

describe('session-storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    window.localStorage.clear()
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('IndexedDB unavailable in test')
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('exports sessions and imports them back without data loss', async () => {
    const sessions = makeSessions()
    let exportedBlob: Blob | undefined
    const click = vi.fn()

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        exportedBlob = blob
        return 'blob:archviber-test'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement)

    exportSessions(sessions)

    expect(click).toHaveBeenCalledTimes(1)
    expect(exportedBlob).toBeDefined()

    const file = new File([await exportedBlob!.text()], 'sessions.json', {
      type: 'application/json',
    })

    await expect(importSessions(file)).resolves.toEqual(sessions)
  })

  it('returns an empty array when both IndexedDB and localStorage are empty', async () => {
    await expect(loadSessions()).resolves.toEqual([])
  })

  it('debounces rapid saves into a single localStorage write', async () => {
    const sessions = makeSessions()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    vi.useFakeTimers()

    for (let i = 0; i < 10; i += 1) {
      saveSessions(sessions)
    }

    expect(setItemSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    expect(setItemSpy).toHaveBeenCalledTimes(1)
  })
})
