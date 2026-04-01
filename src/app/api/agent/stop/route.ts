import { agentRunner } from '@/lib/agent-runner-instance'

export const runtime = 'nodejs'

interface StopAgentRequest {
  agentId?: string
}

export async function POST(request: Request) {
  let agentId: string | undefined
  try {
    const body = (await request.json()) as StopAgentRequest
    agentId = body.agentId
  } catch {
    // Empty or invalid body — treat as stop-all
  }

  if (agentId) {
    agentRunner.stopAgent(agentId)
  } else {
    agentRunner.stopAll()
  }

  return Response.json({ ok: true })
}
