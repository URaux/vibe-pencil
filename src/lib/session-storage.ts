/**
 * Robust session storage with IndexedDB primary + localStorage fallback.
 * Handles quota limits, corruption recovery, and cross-tab sync.
 */
import type { ChatSession } from './store'

const DB_NAME = 'archviber-sessions'
const DB_VERSION = 1
const STORE_NAME = 'chat-sessions'
const LS_KEY = 'vp-chat-sessions'
const LS_LEGACY_KEY = 'vp-chat-histories'

type SessionPhase = 'brainstorm' | 'design' | 'iterate'

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbSaveSessions(sessions: ChatSession[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)

  // Clear existing and write all (simple bulk replace)
  store.clear()
  for (const session of sessions) {
    store.put(session)
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('aborted'))
    }
  })
}

async function idbLoadSessions(): Promise<ChatSession[] | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()

    return new Promise((resolve) => {
      request.onsuccess = () => {
        db.close()
        const results = request.result as ChatSession[]
        resolve(results.length > 0 ? results : null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Server file helpers (authoritative — survives browser cache clears)
// ---------------------------------------------------------------------------

const SERVER_ENDPOINT = '/api/sessions'

async function serverLoadSessions(): Promise<ChatSession[] | null> {
  try {
    const res = await fetch(SERVER_ENDPOINT, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { sessions?: ChatSession[] }
    return Array.isArray(data.sessions) ? data.sessions : null
  } catch {
    return null
  }
}

async function serverSaveSessions(sessions: ChatSession[]): Promise<boolean> {
  try {
    const res = await fetch(SERVER_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions }),
      keepalive: true, // allow save during tab unload
    })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers (fallback)
// ---------------------------------------------------------------------------

function lsSaveSessions(sessions: ChatSession[]): boolean {
  try {
    const json = JSON.stringify(sessions)
    window.localStorage.setItem(LS_KEY, json)
    return true
  } catch {
    return false
  }
}

function lsLoadSessions(): ChatSession[] | null {
  try {
    const stored = window.localStorage.getItem(LS_KEY)
    if (stored) {
      return JSON.parse(stored) as ChatSession[]
    }
    return null
  } catch {
    return null
  }
}

function migrateLegacy(): ChatSession[] | null {
  try {
    const legacy = window.localStorage.getItem(LS_LEGACY_KEY)
    if (!legacy) return null

    const entries = JSON.parse(legacy) as Array<[string, Array<{ role: string; content: string }>]>
    const now = Date.now()
    const migrated: ChatSession[] = entries
      .filter(([, messages]) => messages.length > 0)
      .map(([key, messages], index) => {
        const firstUser = messages.find((m) => m.role === 'user')
        const title = firstUser ? firstUser.content.slice(0, 30) : key
        return {
          id: `migrated-${index}-${now}`,
          title,
          messages: messages as ChatSession['messages'],
          createdAt: now - (entries.length - index) * 1000,
          updatedAt: now - (entries.length - index) * 1000,
          phase: 'iterate' as SessionPhase,
        }
      })

    window.localStorage.removeItem(LS_LEGACY_KEY)
    return migrated
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load sessions from best available source, in priority order:
 * 1. Server file (authoritative — lives in ArchViber/data/sessions.json, survives browser clears)
 * 2. IndexedDB (local cache)
 * 3. localStorage (sync fallback)
 * 4. Legacy migration
 *
 * Auto-syncs missing layers: if server has data but IDB is empty, IDB is seeded.
 * If server is empty but IDB/LS has data (first run after migration), that data
 * is promoted up to the server so it survives future browser clears.
 */
export async function loadSessions(): Promise<ChatSession[]> {
  if (typeof window === 'undefined') return []

  const withPhaseDefault = (arr: ChatSession[]): ChatSession[] =>
    arr.map((s) => ({ ...s, phase: s.phase ?? ('iterate' as SessionPhase) }))

  // Drop trailing empty assistant messages — they represent interrupted turns
  // that never completed. On a fresh page load there is no in-flight request,
  // so showing a spinner for these is always wrong.
  const sanitize = (arr: ChatSession[]): ChatSession[] =>
    arr.map((s) => {
      const last = s.messages.at(-1)
      if (last && last.role === 'assistant' && !last.content?.trim()) {
        return { ...s, messages: s.messages.slice(0, -1) }
      }
      return s
    })

  try {
    // 1. Server file — the authoritative source.
    const serverSessions = await serverLoadSessions()
    if (serverSessions && serverSessions.length > 0) {
      const sessions = sanitize(withPhaseDefault(serverSessions))
      // Seed IDB so subsequent tab loads have a fast local cache.
      idbSaveSessions(sessions).catch(() => {})
      return sessions
    }

    // 2. IDB — local cache. If server returned nothing (or was unreachable),
    // fall back to whatever we have locally and PROMOTE it to the server so
    // existing data isn't left stranded in the browser on first upgrade.
    const idbSessions = await idbLoadSessions()
    if (idbSessions && idbSessions.length > 0) {
      const sessions = sanitize(withPhaseDefault(idbSessions))
      serverSaveSessions(sessions).catch(() => {})
      return sessions
    }

    // 3. LS fallback — same promotion treatment.
    const lsSessions = lsLoadSessions()
    if (lsSessions && lsSessions.length > 0) {
      const sessions = sanitize(withPhaseDefault(lsSessions))
      idbSaveSessions(sessions).catch(() => {})
      serverSaveSessions(sessions).catch(() => {})
      return sessions
    }

    // 4. Legacy migration — same promotion.
    const migrated = migrateLegacy()
    if (migrated && migrated.length > 0) {
      idbSaveSessions(migrated).catch(() => {})
      serverSaveSessions(migrated).catch(() => {})
      return migrated
    }

    return []
  } catch {
    const lsSessions = lsLoadSessions()
    return lsSessions ? sanitize(withPhaseDefault(lsSessions)) : []
  }
}

/** Save pending flag to debounce writes */
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSaveError: string | null = null

/**
 * Save sessions to both backends. Debounced to avoid write storms during streaming.
 * Returns any error message for UI display.
 */
export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return

  // Debounce: wait 500ms after last call before writing
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    _doSave(sessions)
  }, 500)
}

async function _doSave(sessions: ChatSession[]): Promise<void> {
  // Server file is authoritative (survives browser cache clears); IDB and LS
  // are fast local mirrors. We fire all three in parallel and report the worst
  // failure. A server-only failure is still flagged because the browser-local
  // copies alone won't survive a cache clear.
  const [serverOk, idbOk, lsOk] = await Promise.all([
    serverSaveSessions(sessions),
    idbSaveSessions(sessions).then(() => true).catch((err) => {
      console.error('[session-storage] IndexedDB save failed:', err)
      return false
    }),
    Promise.resolve().then(() => {
      try {
        const ok = lsSaveSessions(sessions)
        if (!ok) {
          console.warn(
            '[session-storage] localStorage full (>5MB); sync cache will keep its last good snapshot.',
          )
        }
        return ok
      } catch (err) {
        console.warn('[session-storage] localStorage write unavailable:', err)
        return false
      }
    }),
  ])

  if (!serverOk && !idbOk && !lsOk) {
    lastSaveError =
      'All persistence layers failed (server file, IndexedDB, localStorage). Export now!'
  } else if (!serverOk) {
    lastSaveError =
      'Server-file save failed — sessions only in browser storage. Clearing browser data will lose them.'
  } else if (!idbOk && !lsOk) {
    lastSaveError =
      'Browser cache write failed; server file is fine. Sessions persist on disk.'
  } else {
    lastSaveError = null
  }
}

/** Immediately flush any pending debounced save */
export function flushSave(sessions: ChatSession[]): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  return _doSave(sessions)
}

/** Get last save error (null if OK) */
export function getLastSaveError(): string | null {
  return lastSaveError
}

/**
 * Export all sessions as a JSON file download.
 */
export function exportSessions(sessions: ChatSession[]): void {
  const json = JSON.stringify(sessions, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `archviber-sessions-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Import sessions from a JSON file, merging with existing.
 */
export function importSessions(file: File): Promise<ChatSession[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as ChatSession[]
        if (!Array.isArray(imported)) throw new Error('Invalid format')
        resolve(imported.map((s) => ({ ...s, phase: s.phase ?? ('iterate' as SessionPhase) })))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
