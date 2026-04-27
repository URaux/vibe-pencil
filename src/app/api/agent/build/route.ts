import type { BuildPlan } from '@/lib/orchestrator/handlers/build'

export const runtime = 'nodejs'

interface BuildRouteRequest {
  plan: BuildPlan
}

function planToSpawnBody(plan: BuildPlan): Record<string, unknown> {
  return plan.dispatchBody
}

export async function POST(request: Request) {
  let body: BuildRouteRequest
  try {
    body = (await request.json()) as BuildRouteRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { plan } = body
  if (!plan || typeof plan !== 'object') {
    return Response.json({ error: 'Missing or invalid plan' }, { status: 400 })
  }

  const spawnBody = planToSpawnBody(plan)

  const origin = new URL(request.url).origin
  const spawnUrl = `${origin}${plan.dispatchUrl}`

  const spawnResponse = await fetch(spawnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spawnBody),
  })

  if (!spawnResponse.ok) {
    const errText = await spawnResponse.text().catch(() => `HTTP ${spawnResponse.status}`)
    return Response.json({ error: `Spawn failed: ${errText.slice(0, 300)}` }, { status: spawnResponse.status })
  }

  const spawnResult = (await spawnResponse.json()) as { agentId?: string }
  return Response.json({ agentId: spawnResult.agentId, plan })
}
