import { agentRunner } from '@/lib/agent-runner-instance'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const agentId = new URL(request.url).searchParams.get('agentId')

  if (!agentId) {
    return Response.json({ error: 'Missing agentId' }, { status: 400 })
  }

  const status = agentRunner.getStatus(agentId)

  if (!status) {
    return Response.json({ error: 'Agent not found' }, { status: 404 })
  }

  return Response.json(status)
}
