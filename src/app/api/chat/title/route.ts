import type { AgentBackend } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText } from '@/lib/agent-output'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TitleRequest {
  userMessage: string
  assistantMessage: string
  locale?: string
  backend?: AgentBackend
  model?: string
}

function getBackend(backend?: AgentBackend): AgentBackend {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini') {
    return backend
  }

  return (process.env.VIBE_CHAT_AGENT_BACKEND as AgentBackend) ?? 'claude-code'
}

function buildTitlePrompt(userMessage: string, assistantMessage: string, locale?: string): string {
  const snippet = assistantMessage.slice(0, 300)
  if (locale === 'zh') {
    return `根据以下对话生成一个简短标题（最多20字），只输出标题，不要加引号。\n\n用户: ${userMessage}\nAI: ${snippet}`
  }
  return `Generate a short title (max 20 chars) for this conversation. Output only the title, no quotes.\n\nUser: ${userMessage}\nAI: ${snippet}`
}

export async function POST(request: Request) {
  const payload = (await request.json()) as TitleRequest

  if (!payload.userMessage?.trim()) {
    return Response.json({ error: 'userMessage is required.' }, { status: 400 })
  }

  const prompt = buildTitlePrompt(
    payload.userMessage,
    payload.assistantMessage ?? '',
    payload.locale
  )

  const agentId = agentRunner.spawnAgent(
    'title',
    prompt,
    getBackend(payload.backend),
    process.cwd(),
    payload.model
  )

  // Poll until done — title gen is fast, no need to stream
  const POLL_INTERVAL_MS = 150
  const TIMEOUT_MS = 30_000
  const deadline = Date.now() + TIMEOUT_MS

  await new Promise<void>((resolve, reject) => {
    const iv = setInterval(() => {
      const status = agentRunner.getStatus(agentId)

      if (!status) {
        clearInterval(iv)
        reject(new Error('Title agent not found.'))
        return
      }

      if (status.status === 'done') {
        clearInterval(iv)
        resolve()
        return
      }

      if (status.status === 'error') {
        clearInterval(iv)
        reject(new Error(status.errorMessage ?? 'Title agent failed.'))
        return
      }

      if (Date.now() >= deadline) {
        clearInterval(iv)
        agentRunner.stopAgent(agentId)
        reject(new Error('Title generation timed out.'))
      }
    }, POLL_INTERVAL_MS)
  })

  const final = agentRunner.getStatus(agentId)
  const rawText = final ? extractAgentText(final.output) : ''
  let title = rawText.replace(/^["'`]|["'`]$/g, '').trim()
  // Take first line only (agent may output extra text)
  title = title.split('\n')[0].trim()
  // Deduplicate if the same text is repeated (agent output parsing artifact)
  if (title.length > 6) {
    const half = Math.floor(title.length / 2)
    if (title.slice(0, half) === title.slice(half)) {
      title = title.slice(0, half)
    }
  }
  title = title.slice(0, 20)

  return Response.json({ title })
}
