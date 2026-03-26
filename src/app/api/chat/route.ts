import type { AgentBackend } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText } from '@/lib/agent-output'

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
  architecture_yaml: string
}

const CANVAS_ACTION_INSTRUCTIONS = [
  'When you recommend canvas modifications, include a ```json:canvas-action block.',
  'Use one of these actions:',
  '- add-node: {"action":"add-node","node":{"id?":"...","type":"service","position?":{"x":0,"y":0},"data":{"name":"...","description":"...","status":"idle"}}}',
  '- update-node: {"action":"update-node","target_id":"node-id","data":{"description":"..."}}',
  '- remove-node: {"action":"remove-node","target_id":"node-id"}',
  '- add-edge: {"action":"add-edge","edge":{"id?":"...","source":"node-a","target":"node-b","type":"sync","label?":"..."}}',
  'Keep normal prose outside the code block, and keep code blocks valid JSON.',
].join('\n')

function formatHistory(history: ChatMessage[] | undefined) {
  if (!history?.length) {
    return 'No prior conversation.'
  }

  return history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n\n')
}

function getBackend(): AgentBackend {
  return process.env.VIBE_CHAT_AGENT_BACKEND === 'codex' ? 'codex' : 'claude-code'
}

function buildPrompt({ message, history, nodeContext, architecture_yaml }: ChatRequest) {
  return [
    'You are the AI discussion panel for a software architecture canvas.',
    'Respond as a collaborative architecture assistant grounded in the provided canvas state.',
    'Reference the selected node context when it is available.',
    CANVAS_ACTION_INSTRUCTIONS,
    '',
    'Architecture YAML:',
    architecture_yaml,
    '',
    'Selected node context:',
    nodeContext ?? 'Global chat mode. No node is selected.',
    '',
    'Conversation so far:',
    formatHistory(history),
    '',
    'Latest user message:',
    message,
  ].join('\n')
}

function encodeEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  if (!payload.message?.trim()) {
    return Response.json({ error: '消息内容不能为空。' }, { status: 400 })
  }

  const agentId = agentRunner.spawnAgent('chat', buildPrompt(payload), getBackend(), process.cwd())

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
          push({ type: 'error', error: '未找到对话代理。' })
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
          push({ type: 'error', error: status.errorMessage ?? 'AI 对话失败。' })
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
