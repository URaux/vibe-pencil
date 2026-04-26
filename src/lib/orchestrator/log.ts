import { promises as fs } from 'node:fs'
import path from 'node:path'
import { INTENTS } from './types'
import type { Intent } from './types'

export interface ClassifyLogEntry {
  timestamp: string
  prompt: string
  intent: (typeof INTENTS)[number]
  confidence: number
  fallback: boolean
  fallbackReason?: string
  durationMs: number
}

const DEFAULT_LOG_PATH = path.join('.archviber', 'cache', 'classifier-log.jsonl')

export async function appendClassifyLog(
  entry: ClassifyLogEntry,
  opts: { path?: string } = {}
): Promise<void> {
  const targetPath = opts.path ?? DEFAULT_LOG_PATH

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    console.warn('[orchestrator/classifier-log] Failed to append log entry', error)
  }
}

// ---------------------------------------------------------------------------
// Telemetry ring buffer — last 100 turns, in-memory only.
// ---------------------------------------------------------------------------

export interface TurnRecord {
  timestamp: string
  userPromptHash: string
  irBlocks: number
  intent?: Intent
  confidence?: number
  fallback?: boolean
  fallbackReason?: string
  dispatchStatus?: 'ok' | 'not_implemented' | 'error'
  error?: string
}

const RING_SIZE = 100
const ring: TurnRecord[] = []
let ringHead = 0

function pushRing(record: TurnRecord): void {
  ring[ringHead % RING_SIZE] = record
  ringHead++
}

export function getRecentTurns(): TurnRecord[] {
  if (ring.length < RING_SIZE) return ring.slice()
  const start = ringHead % RING_SIZE
  return [...ring.slice(start), ...ring.slice(0, start)]
}

const DEBUG = process.env.DEBUG_ORCHESTRATOR === '1'

export function recordTurnStart(params: { userPromptHash: string; irBlocks: number }): TurnRecord {
  const record: TurnRecord = {
    timestamp: new Date().toISOString(),
    userPromptHash: params.userPromptHash,
    irBlocks: params.irBlocks,
  }
  pushRing(record)
  if (DEBUG) console.log('[orchestrator/telemetry] turn-start', record)
  return record
}

export function recordClassification(
  record: TurnRecord,
  params: { intent: Intent; confidence: number; fallback: boolean; fallbackReason?: string }
): void {
  record.intent = params.intent
  record.confidence = params.confidence
  record.fallback = params.fallback
  record.fallbackReason = params.fallbackReason
  if (DEBUG) console.log('[orchestrator/telemetry] classify', params)
}

export function recordDispatch(
  record: TurnRecord,
  params: { intent: Intent; status: 'ok' | 'not_implemented' | 'error'; error?: string }
): void {
  record.dispatchStatus = params.status
  record.error = params.error
  if (DEBUG) console.log('[orchestrator/telemetry] dispatch', params)

  // Phase 3 persistent telemetry: append the finalized turn to disk.
  // The ring buffer is in-memory only; for default-on production usage we
  // need queryable history. Fire-and-forget — we don't await this in the
  // hot chat path, and a write failure logs to stderr but never throws.
  void persistTurn(record)
}

// ---------------------------------------------------------------------------
// Persistent telemetry (Phase 3) — appends finalized turns to a JSONL file
// at .archviber/cache/orchestrator-log.jsonl. Override the path via
// ARCHVIBER_TELEMETRY_FILE; disable entirely with ARCHVIBER_TELEMETRY=0.
// ---------------------------------------------------------------------------

const DEFAULT_TELEMETRY_PATH = path.join('.archviber', 'cache', 'orchestrator-log.jsonl')

function telemetryEnabled(): boolean {
  return process.env.ARCHVIBER_TELEMETRY !== '0'
}

function telemetryPath(): string {
  return process.env.ARCHVIBER_TELEMETRY_FILE ?? DEFAULT_TELEMETRY_PATH
}

export async function persistTurn(record: TurnRecord): Promise<void> {
  if (!telemetryEnabled()) return
  const target = telemetryPath()
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.appendFile(target, `${JSON.stringify(record)}\n`, 'utf8')
  } catch (error) {
    // Fire-and-forget; never break the chat path on a write failure.
    if (DEBUG) console.warn('[orchestrator/telemetry] persistTurn failed', error)
  }
}

/** Read the last N entries from the persistent log. Used by dashboards/tests. */
export async function readRecentPersistedTurns(limit = 100): Promise<TurnRecord[]> {
  const target = telemetryPath()
  let text: string
  try {
    text = await fs.readFile(target, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw err
  }
  const lines = text.split('\n').filter((l) => l.length > 0)
  const tail = lines.slice(Math.max(0, lines.length - limit))
  const out: TurnRecord[] = []
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as TurnRecord)
    } catch {
      // Skip malformed lines silently — don't block reads on a stray bad write.
    }
  }
  return out
}
