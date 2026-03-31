import type { AgentBackend } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText } from '@/lib/agent-output'
import { buildSystemContext } from '@/lib/context-engine'
import type { Locale } from '@/lib/i18n'
import type { SessionPhase } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message: string
  history?: ChatMessage[]
  nodeContext?: string
  selectedNodeId?: string
  codeContext?: string
  buildSummaryContext?: string
  architecture_yaml: string
  backend?: AgentBackend
  model?: string
  locale?: Locale
  phase?: SessionPhase
}

function formatHistory(history: ChatMessage[] | undefined) {
  if (!history?.length) {
    return 'No prior conversation.'
  }

  return history
    .map((entry) => `<${entry.role}>\n${entry.content}\n</${entry.role}>`)
    .join('\n\n')
}

function getBackend(backend?: AgentBackend): AgentBackend {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini') {
    return backend
  }

  return (process.env.VIBE_CHAT_AGENT_BACKEND as AgentBackend) ?? 'claude-code'
}

function buildPrompt({
  message,
  history,
  nodeContext,
  selectedNodeId,
  codeContext,
  buildSummaryContext,
  architecture_yaml,
  locale,
  phase,
}: ChatRequest) {
  const systemContext = buildSystemContext({
    agentType: 'canvas',
    task: selectedNodeId ? 'discuss-node' : 'discuss',
    locale: locale ?? 'en',
    canvasYaml: architecture_yaml,
    selectedNodeContext: nodeContext ?? (selectedNodeId ? undefined : 'Global chat mode. No node is selected.'),
    conversationHistory: formatHistory(history),
    codeContext,
    buildSummaryContext,
    sessionPhase: phase,
  })

  return [
    systemContext,
    '',
    'Latest user message:',
    message,
  ].join('\n')
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function encodeEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  if (!payload.message?.trim()) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }

  const agentId = agentRunner.spawnAgent(
    'chat',
    buildPrompt(payload),
    getBackend(payload.backend),
    process.cwd(),
    payload.model
  )

  let cleanup = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sentLength = 0
      let closed = false

      const close = () => {
        if (closed) {
          return
        }

        closed = true
        cleanup()
        controller.close()
      }

      const push = (event: unknown) => {
        if (closed) {
          return
        }

        controller.enqueue(encodeEvent(event))
      }

      const intervalId = setInterval(() => {
        const status = agentRunner.getStatus(agentId)

        if (!status) {
          push({ type: 'error', error: 'Chat agent not found.' })
          close()
          return
        }

        const visibleText = extractAgentText(status.output)

        if (visibleText.length > sentLength) {
          push({ type: 'chunk', text: visibleText.slice(sentLength) })
          sentLength = visibleText.length
        }

        if (status.status === 'done') {
          push({ type: 'done' })
          close()
          return
        }

        if (status.status === 'error') {
          const errorMsg = status.errorMessage
            ? `Backend error: ${stripAnsi(status.errorMessage).slice(0, 200)}`
            : 'The AI backend encountered an error.'
          push({ type: 'error', error: errorMsg })
          close()
        }
      }, 125)

      cleanup = () => {
        clearInterval(intervalId)
      }

      request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
  })
}
