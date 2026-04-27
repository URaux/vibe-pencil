/**
 * Handler metrics aggregation.
 *
 * Reads .archviber/cache/orchestrator-log.jsonl and (optionally)
 * .archviber/cache/dispatch-trace.jsonl, then aggregates per-intent stats.
 *
 * Exported: computeHandlerMetrics(opts?) → Record<Intent, IntentMetrics>
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { INTENTS } from './types'
import type { Intent } from './types'
import type { TurnRecord } from './log'

export interface IntentMetrics {
  totalCalls: number
  okCount: number
  errorCount: number
  notImplementedCount: number
  okRate: number
  errorRate: number
  avgConfidence: number
  avgDurationMs: number | null
}

export type HandlerMetrics = Record<Intent, IntentMetrics>

function emptyMetrics(): IntentMetrics {
  return {
    totalCalls: 0,
    okCount: 0,
    errorCount: 0,
    notImplementedCount: 0,
    okRate: 0,
    errorRate: 0,
    avgConfidence: 0,
    avgDurationMs: null,
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw err
  }
  const out: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // Skip malformed lines.
    }
  }
  return out
}

interface DispatchTraceEntry {
  timestamp: string
  intent: string
  promptHash: string
  classifierConfidence: number
  dispatchStatus: 'ok' | 'not_implemented' | 'error'
  error?: string
  durationMs: number
}

export interface ComputeHandlerMetricsOpts {
  /** Override path to orchestrator-log.jsonl */
  logPath?: string
  /** Override path to dispatch-trace.jsonl (optional; used for durationMs when available) */
  tracePath?: string
}

const DEFAULT_LOG_PATH = path.join('.archviber', 'cache', 'orchestrator-log.jsonl')
const DEFAULT_TRACE_PATH = path.join('.archviber', 'cache', 'dispatch-trace.jsonl')

export async function computeHandlerMetrics(
  opts: ComputeHandlerMetricsOpts = {}
): Promise<HandlerMetrics> {
  const logPath = opts.logPath ?? DEFAULT_LOG_PATH
  const tracePath = opts.tracePath ?? DEFAULT_TRACE_PATH

  const [turns, traces] = await Promise.all([
    readJsonl<TurnRecord>(logPath),
    readJsonl<DispatchTraceEntry>(tracePath),
  ])

  // Index trace entries by intent for durationMs lookup.
  // When multiple traces exist per intent, we'll average them below.
  const traceDurationsByIntent: Record<string, number[]> = {}
  for (const t of traces) {
    if (!INTENTS.includes(t.intent as Intent)) continue
    if (!traceDurationsByIntent[t.intent]) traceDurationsByIntent[t.intent] = []
    traceDurationsByIntent[t.intent].push(t.durationMs)
  }

  // Initialize per-intent accumulators.
  const acc: Record<
    Intent,
    { total: number; ok: number; error: number; notImpl: number; confSum: number; confCount: number }
  > = Object.fromEntries(
    INTENTS.map((i) => [i, { total: 0, ok: 0, error: 0, notImpl: 0, confSum: 0, confCount: 0 }])
  ) as Record<Intent, { total: number; ok: number; error: number; notImpl: number; confSum: number; confCount: number }>

  for (const turn of turns) {
    const intent = turn.intent
    if (!intent || !INTENTS.includes(intent as Intent)) continue
    const a = acc[intent as Intent]
    a.total++
    if (turn.dispatchStatus === 'ok') a.ok++
    else if (turn.dispatchStatus === 'error') a.error++
    else if (turn.dispatchStatus === 'not_implemented') a.notImpl++
    if (typeof turn.confidence === 'number') {
      a.confSum += turn.confidence
      a.confCount++
    }
  }

  // Also account for dispatch-trace entries not in orchestrator-log (dispatch-trace is richer).
  for (const t of traces) {
    if (!INTENTS.includes(t.intent as Intent)) continue
    // Only add if dispatchStatus is present; orchestrator-log may already cover these.
    // We deduplicate by using a separate counter from dispatch-trace for ok/error/notImpl.
    // Strategy: prefer orchestrator-log for call counts; use dispatch-trace for durationMs only.
    // If orchestrator-log has no entries for an intent but trace does, count from trace.
    const a = acc[t.intent as Intent]
    if (a.total === 0) {
      // Trace-only: populate from trace entries.
      a.total++
      if (t.dispatchStatus === 'ok') a.ok++
      else if (t.dispatchStatus === 'error') a.error++
      else if (t.dispatchStatus === 'not_implemented') a.notImpl++
      if (typeof t.classifierConfidence === 'number') {
        a.confSum += t.classifierConfidence
        a.confCount++
      }
    }
  }

  const result: HandlerMetrics = Object.fromEntries(
    INTENTS.map((intent) => {
      const a = acc[intent]
      const durations = traceDurationsByIntent[intent]
      const avgDurationMs =
        durations && durations.length > 0
          ? durations.reduce((s, d) => s + d, 0) / durations.length
          : null

      const metrics: IntentMetrics = {
        totalCalls: a.total,
        okCount: a.ok,
        errorCount: a.error,
        notImplementedCount: a.notImpl,
        okRate: a.total > 0 ? a.ok / a.total : 0,
        errorRate: a.total > 0 ? a.error / a.total : 0,
        avgConfidence: a.confCount > 0 ? a.confSum / a.confCount : 0,
        avgDurationMs,
      }
      return [intent, metrics]
    })
  ) as HandlerMetrics

  return result
}
