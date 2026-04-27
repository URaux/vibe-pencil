import { readRecentPersistedTurns } from '@/lib/orchestrator/log'
import type { TurnRecord } from '@/lib/orchestrator/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function filterTurnsByDate(
  turns: TurnRecord[],
  params: { since?: string | null; until?: string | null }
): TurnRecord[] {
  let result = turns
  if (params.since) {
    const sinceMs = new Date(params.since).getTime()
    result = result.filter((t) => new Date(t.timestamp).getTime() >= sinceMs)
  }
  if (params.until) {
    const untilMs = new Date(params.until).getTime()
    result = result.filter((t) => new Date(t.timestamp).getTime() <= untilMs)
  }
  return result
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')

  const turns: TurnRecord[] = await readRecentPersistedTurns(100, {
    since: since ?? undefined,
    until: until ?? undefined,
  })

  return Response.json({ turns })
}
