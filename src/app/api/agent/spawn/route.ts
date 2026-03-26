import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'

export const runtime = 'nodejs'

interface SpawnAgentRequest {
  nodeId: string
  prompt: string
  backend: AgentBackend
  workDir: string
}

export async function POST(request: Request) {
  const { nodeId, prompt, backend, workDir } = (await request.json()) as SpawnAgentRequest
  const agentId = agentRunner.spawnAgent(nodeId, prompt, backend, workDir)

  return Response.json({ agentId })
}
