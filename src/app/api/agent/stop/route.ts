import { agentRunner } from '@/lib/agent-runner-instance'

export const runtime = 'nodejs'

interface StopAgentRequest {
  agentId: string
}

export async function POST(request: Request) {
  const { agentId } = (await request.json()) as StopAgentRequest
  agentRunner.stopAgent(agentId)

  return Response.json({ ok: true })
}
