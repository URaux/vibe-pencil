/**
 * GET /api/telemetry/metrics
 *
 * Returns per-intent dispatch metrics aggregated from
 * .archviber/cache/orchestrator-log.jsonl and dispatch-trace.jsonl.
 */

import { computeHandlerMetrics } from '@/lib/orchestrator/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const metrics = await computeHandlerMetrics()
    return Response.json({ metrics })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
