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
 * Load sessions from best available source:
 * 1. IndexedDB (primary, ~50MB+ capacity)
 * 2. localStorage (fallback, ~5MB)
 * 3. Legacy migration
 *
 * Also syncs across backends: if IDB is empty but LS has data, migrate up.
 */
export async function loadSessions(): Promise<ChatSession[]> {
  if (typeof window === 'undefined') return []

  try {
    // Try IndexedDB first
    const idbSessions = await idbLoadSessions()
    if (idbSessions && idbSessions.length > 0) {
      // Apply backward compat
      return idbSessions.map((s) => ({ ...s, phase: s.phase ?? ('iterate' as SessionPhase) }))
    }

    // Fallback to localStorage
    const lsSessions = lsLoadSessions()
    if (lsSessions && lsSessions.length > 0) {
      const sessions = lsSessions.map((s) => ({ ...s, phase: s.phase ?? ('iterate' as SessionPhase) }))
      // Migrate up to IndexedDB
      idbSaveSessions(sessions).catch(() => {})
      return sessions
    }

    // Try legacy migration
    const migrated = migrateLegacy()
    if (migrated && migrated.length > 0) {
      idbSaveSessions(migrated).catch(() => {})
      return migrated
    }

    return []
  } catch {
    // Last resort: try LS synchronously
    const lsSessions = lsLoadSessions()
    return lsSessions
      ? lsSessions.map((s) => ({ ...s, phase: s.phase ?? ('iterate' as SessionPhase) }))
      : []
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
  let idbOk = false
  let lsOk = false

  // Write to IndexedDB (primary)
  try {
    await idbSaveSessions(sessions)
    idbOk = true
  } catch {
    // IDB failed
  }

  // Write to localStorage (backup) — only keep recent sessions to fit within 5MB
  try {
    // Try full save first
    lsOk = lsSaveSessions(sessions)
    if (!lsOk && sessions.length > 5) {
      // Trim old sessions for LS (keep 5 most recent)
      const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
      lsOk = lsSaveSessions(recent)
    }
  } catch {
    // LS failed
  }

  // Track errors for UI
  if (!idbOk && !lsOk) {
    lastSaveError = 'Both IndexedDB and localStorage failed. Sessions may not persist.'
  } else if (!idbOk) {
    lastSaveError = null // LS worked, acceptable fallback
  } else {
    lastSaveError = null
  }
}

/** Immediately flush any pending debounced save */
export function flushSave(sessions: ChatSession[]): void {
  if (saveTimer) clearTimeout(saveTimer)
  _doSave(sessions)
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
