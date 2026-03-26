import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'

export const runtime = 'nodejs'

interface SpawnAgentRequest {
  nodeId: string
  prompt: string
  backend: AgentBackend
  workDir: string
  model?: string
}

interface BuildAllRequest {
  waves: string[][]
  prompts: Record<string, string>
  backend: AgentBackend
  workDir: string
  maxParallel: number
  model?: string
}

export async function POST(request: Request) {
  const payload = (await request.json()) as SpawnAgentRequest | BuildAllRequest

  if ('waves' in payload) {
    const agentId = `build-${Date.now()}`

    void agentRunner.buildAll(
      payload.waves,
      new Map(Object.entries(payload.prompts)),
      payload.backend,
      payload.workDir,
      payload.maxParallel,
      payload.model
    )

    return Response.json({ agentId })
  }

  const agentId = agentRunner.spawnAgent(
    payload.nodeId,
    payload.prompt,
    payload.backend,
    payload.workDir,
    payload.model
  )

  return Response.json({ agentId })
}
