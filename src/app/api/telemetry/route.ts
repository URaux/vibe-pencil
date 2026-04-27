import { readRecentPersistedTurns } from '@/lib/orchestrator/log'
import type { TurnRecord } from '@/lib/orchestrator/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function filterTurns(
  turns: TurnRecord[],
  params: { intent?: string | null; status?: string | null; q?: string | null }
): TurnRecord[] {
  let result = turns

  if (params.intent) {
    const intents = params.intent.split(',').map((s) => s.trim()).filter(Boolean)
    if (intents.length > 0) {
      result = result.filter((t) => t.intent !== undefined && intents.includes(t.intent))
    }
  }

  if (params.status) {
    result = result.filter((t) => t.dispatchStatus === params.status)
  }

  if (params.q) {
    const q = params.q.toLowerCase()
    result = result.filter((t) => t.userPromptHash.toLowerCase().includes(q))
  }

  return result
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const intent = url.searchParams.get('intent')
  const status = url.searchParams.get('status')
  const q = url.searchParams.get('q')

  const turns: TurnRecord[] = await readRecentPersistedTurns(100)
  const filtered = filterTurns(turns, { intent, status, q })

  return Response.json({ turns: filtered })
}
