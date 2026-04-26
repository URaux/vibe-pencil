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
}
