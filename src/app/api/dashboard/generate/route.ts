import fs from 'fs'
import { extractAgentText } from '@/lib/agent-output'
import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GenerateDashboardRequest {
  dir: string
  prompt: string
  backend: AgentBackend
  model?: string
  modules: Array<{ id: string; name: string }>
}

interface ProposedTask {
  nodeId: string
  title: string
  priority: 0 | 1 | 2 | 3
}

function buildPrompt(prompt: string, modules: Array<{ id: string; name: string }>) {
  const moduleLines = modules.map((module) => `- [${module.id}] ${module.name}`).join('\n')

  return `You are a project management assistant for a software project.

The project has these modules:
${moduleLines}

The user says: "${prompt}"

Break this into concrete, actionable development tasks. For each task:
1. Assign it to the most relevant module by ID
2. Suggest a priority (0-3, where 0 = critical)
3. Write a clear, concise title in the user's language

Return ONLY a JSON array with no extra text:
[{ "nodeId": "container-1", "title": "...", "priority": 1 }]`
}

async function waitForCompletion(agentId: string, timeoutMs = 60_000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const status = agentRunner.getStatus(agentId)

    if (!status) {
      throw new Error('Generation agent not found.')
    }

    if (status.status === 'done') {
      return status
    }

    if (status.status === 'error') {
      throw new Error(status.errorMessage ?? 'Generation agent failed.')
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  agentRunner.stopAgent(agentId)
  throw new Error('Generation timed out.')
}

function extractJsonArray(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fencedMatch?.[1], text.trim()]
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')

  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1))
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    try {
      const parsed = JSON.parse(candidate) as unknown
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

function normalizeTasks(
  payload: unknown,
  modules: Array<{ id: string; name: string }>
): ProposedTask[] {
  if (!Array.isArray(payload)) {
    throw new Error('Agent did not return a JSON array.')
  }

  const validModuleIds = new Set(modules.map((module) => module.id))

  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return []
    }

    const { nodeId, title, priority } = entry as {
      nodeId?: unknown
      title?: unknown
      priority?: unknown
    }

    if (
      typeof nodeId !== 'string' ||
      !validModuleIds.has(nodeId) ||
      typeof title !== 'string' ||
      !title.trim() ||
      ![0, 1, 2, 3].includes(priority as number)
    ) {
      return []
    }

    return [
      {
        nodeId,
        title: title.trim(),
        priority: priority as 0 | 1 | 2 | 3,
      } satisfies ProposedTask,
    ]
  })
}

export async function POST(request: Request) {
  const { dir, prompt, backend, model, modules } = (await request.json()) as GenerateDashboardRequest

  if (!prompt.trim()) {
    return Response.json({ error: 'Prompt cannot be empty.' }, { status: 400 })
  }

  if (modules.length === 0) {
    return Response.json({ tasks: [] })
  }

  fs.mkdirSync(dir, { recursive: true })

  try {
    const agentId = agentRunner.spawnAgent(
      'dashboard',
      buildPrompt(prompt, modules),
      backend,
      dir,
      model
    )
    const status = await waitForCompletion(agentId)
    const agentText = extractAgentText(status.output)
    const parsed = extractJsonArray(agentText || status.output)

    if (!parsed) {
      throw new Error('Could not parse a JSON task list from the agent output.')
    }

    return Response.json({ tasks: normalizeTasks(parsed, modules) })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Dashboard generation failed.' },
      { status: 500 }
    )
  }
}
